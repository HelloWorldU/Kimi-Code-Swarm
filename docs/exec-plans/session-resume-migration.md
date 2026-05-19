# 方案：用 Kimi CLI 原生 Session 替换平铺 Prompt 伪造记忆

> 背景：Claude 诊断出根因——每轮 `sendInstruction` 都 spawn 新 Kimi CLI 进程，`--print` 是一次性非交互模式，Agent 靠 `buildContextPrompt` 把历史平铺进 prompt 伪造记忆。Kimi CLI 本身有 `-r <session-id>` 续会话能力，App 没利用。

---

## 实施状态（2026-05-19 落地，以此为准）

> 下方「改造目标 / 具体改动」是**原始计划**；实际落地与计划有以下差异：

- ✅ **已实现**：`runKimi` 支持 `sessionId`（`-r`）；stderr 捕获 session id 且不再误标 ERROR；`AgentState`/`AgentStateSnapshot`/`AgentTask` 贯穿 `kimiSessionId`；`syncState()` 已把 `kimiSessionId` 纳入快照（计划遗漏过，已补）。
- ⚠️ **偏差**：
  - **未采用 `continue`/`--continue`** —— 计划里的兜底选项无调用方，已从 `RunKimiOptions` 移除。
  - **无 session 的 fallback 已修正** —— 计划示例 `buildContextPrompt() || instruction` 会丢掉当前指令；实际实现为 `history ? \`${history}\n\nUser: ${instruction}\` : instruction`。
- ❌ **未实现：session 过期/丢失的检测与自动清除 `kimiSessionId`** —— 下方「边界」一节的「建议实现」**没有落地**。`-r <失效 id>` 时 kimi 的真实行为未知，需真机确认后再做。
- ❌ **未验证：`kimi --print -r <id>` 是否真能 resume** —— 仅过 TypeScript 编译与 mock 单测，核心行为**未在真 kimi 上跑过**。

---

## 改造目标

1. 每轮不再新开失忆的 Kimi 进程，而是 `resume` 已有会话。
2. 后续轮次只发**增量指令**，不再平铺整段历史。
3. `buildContextPrompt` 退居 fallback，长期可删。
4. 解决 Agent 每轮重新打招呼、重新探索代码库的现象。

---

## 改动范围（5 个文件）

| 文件 | 改动内容 |
|------|---------|
| `agent-engine/src/kimi.ts` | `runKimi` 支持 `sessionId` 参数（`-r`）和 `continue` 参数（`--continue`） |
| `agent-engine/src/types.ts` | `AgentState` / `AgentStateSnapshot` 增加 `kimiSessionId` |
| `agent-engine/src/agent.ts` | `sendInstruction` 走 session resume；stderr 过滤 session 提示；捕获并持久化 session id |
| `kimi-code-swarm/src/types/index.ts` | `AgentTask` 增加 `kimiSessionId` |
| `kimi-code-swarm/src/store/useSwarmStore.ts` | `agent-state` 事件同步 `kimiSessionId`，持久化到 store |

---

## 具体改动

### 1. `kimi.ts` —— runKimi 支持 session 续接

```ts
export interface RunKimiOptions {
  streamJson?: boolean
  thinking?: boolean
  /** 传入已有的 session id，用 -r <id> 恢复会话 */
  sessionId?: string
  /** 用 --continue 恢复该工作目录的上一个会话（兜底） */
  continue?: boolean
}

export function runKimi(
  kimiPath: string,
  workspace: string,
  instruction: string,
  options: RunKimiOptions = {},
): KimiProcess {
  const baseArgs = ['--work-dir', workspace, '--prompt', instruction, '--print']

  if (options.sessionId) {
    baseArgs.push('-r', options.sessionId)
  } else if (options.continue) {
    baseArgs.push('--continue')
  }

  if (options.streamJson) {
    baseArgs.push('--output-format', 'stream-json')
  }
  if (options.thinking) {
    baseArgs.push('--thinking')
  }
  // ... 其余不变
}
```

### 2. `types.ts` —— AgentState 增加 session id

```ts
export interface AgentState {
  // ... 现有字段
  /** Kimi CLI 原生会话 ID，用于 resume */
  kimiSessionId?: string
}

export type AgentStateSnapshot = Pick<
  AgentState,
  | 'status'
  | 'workspace'
  | 'branch'
  | 'prStatus'
  | 'prNumber'
  | 'prUrl'
  | 'pid'
  | 'tokenUsed'
  | 'lastActivity'
  | 'reviews'
  | 'changedFiles'
  | 'kimiSessionId'  // ← 新增
>
```

### 3. `agent.ts` —— sendInstruction 核心改造

#### 3.1 改造后的 sendInstruction 流程

```ts
async sendInstruction(instruction: string, githubToken?: string) {
  // 状态恢复逻辑不变 ...
  this.setStatus('working')
  this.state.instruction = instruction

  // token 预算检查（保留）
  // ...

  const kimiPath = await detectKimiCli()
  // ...

  // === 核心改造 ===
  // 如果有 session id，只发增量指令；否则走 fallback 平铺历史
  const hasSession = !!this.state.kimiSessionId
  const prompt = hasSession
    ? instruction
    : this.buildContextPrompt(instruction) || instruction

  this.process = runKimi(kimiPath, this.state.workspace, prompt, {
    streamJson: true,
    thinking: true,
    sessionId: this.state.kimiSessionId,
  })
  // ...
}
```

#### 3.2 stderr reader —— 捕获 session id + 过滤非错误信息

```ts
// 新增正则：匹配 Kimi 的 session resume 提示
const SESSION_RESUME_RE = /To resume this session: kimi -r ([a-f0-9-]+)/i

// stderr reader 改造
for await (const line of this.process!.stderr) {
  if (!this.running) break

  // 1. 过滤 loguru error 块（已有逻辑保留）
  if (line.includes('--- Logging error')) { loguruBlockActive = true; continue }
  if (loguruBlockActive && line.includes('--- End of logging error')) { loguruBlockActive = false; continue }
  if (loguruBlockActive) continue

  // 2. 捕获 session id（新增）
  const sessionMatch = SESSION_RESUME_RE.exec(line)
  if (sessionMatch) {
    this.state.kimiSessionId = sessionMatch[1]
    this.syncState() // 同步给前端持久化
    this.termLog('Kimi', 'info', `Session captured: ${this.state.kimiSessionId}`)
    continue // 这是正常提示，不是错误，不继续走 error 分支
  }

  // 3. 过滤空行
  if (!line.trim()) continue

  // 4. 真正的错误才标红
  this.log('error', line)
  this.emit({ type: 'agent-output', agentId: this.state.id, line, isStderr: true })
}
```

#### 3.3 buildContextPrompt 保留为 fallback

```ts
private buildContextPrompt(instruction: string): string {
  // 当 session 不可用时（首次、session 过期/丢失），仍然需要平铺历史兜底
  // 后续可在此加入 token 预算截断策略，但长期目标是让这段代码退役
  const history: string[] = []
  for (const log of this.state.logs) {
    if (log.type === 'input' || log.type === 'output') {
      if (log.type === 'input' && log.content === instruction) continue
      const prefix = log.type === 'input' ? 'User' : 'Assistant'
      history.push(`${prefix}: ${log.content}`)
    }
  }
  return history.join('\n\n')
}
```

### 4. 前端 `src/types/index.ts`

```ts
export interface AgentTask {
  // ... 现有字段
  /** Kimi CLI 原生会话 ID */
  kimiSessionId?: string
}
```

### 5. 前端 `src/store/useSwarmStore.ts`

```ts
case 'agent-state': {
  const agent = state.agents.find((a) => a.id === event.agentId)
  if (!agent) break
  const incoming = event.state as Record<string, unknown>
  // ... 现有字段同步
  if (incoming.kimiSessionId !== undefined) {
    agent.kimiSessionId = String(incoming.kimiSessionId)
  }
  // ...
}
```

---

## Session 生命周期与边界处理

### 正常流程

```
第 1 轮: runKimi(无 -r) → 运行完 stderr 出 "To resume this session: kimi -r <id>"
         → 捕获 id → 存 state → syncState → 前端持久化

第 2 轮: runKimi(-r <id>, prompt=增量指令) → Kimi 恢复完整上下文

第 N 轮: runKimi(-r <id>, prompt=增量指令) → 持续续接
```

### 边界：Session 丢失 / 过期

```ts
// 如果 runKimi 带 -r 返回错误（session 不存在或过期）
// stderr 会输出错误信息，走正常的 error 处理
// 此时可以：
// 1. 清除 this.state.kimiSessionId
// 2.  Fallback 到 buildContextPrompt 平铺历史
// 3. 或者尝试 --continue 按工作目录恢复
```

**建议实现**：在 `sendInstruction` 的 `try/catch` 或 stderr 错误检测中，识别 "session not found" 类错误，自动清除 `kimiSessionId`，下轮自动 fallback。

### 边界：引擎进程重启

`AgentEngine` 是 Node.js 进程，崩溃/重启后内存状态丢失。但由于：
- `syncState()` 会同步 `kimiSessionId` 给前端
- 前端持久化到 `localStorage`
- 引擎重启后，前端已经持有 `kimiSessionId`

**但需要确认**：当前引擎重启后，前端是否会重新把持久化的 agents 数据传给引擎？

→ 需要检查 `engine.ts` 的启动流程，看是否有"前端恢复引擎状态"的机制。如果没有，这是一个额外的 TODO。

---

## 为什么不直接删掉 buildContextPrompt

| 阶段 | 策略 |
|------|------|
| **本次改造** | 保留 `buildContextPrompt` 作为无 session 时的 fallback |
| **观察期** | 运行一段时间，确认 `-r` 续接稳定 |
| **清理期** | 确认无问题后，删除 `buildContextPrompt` 及相关 token 估算逻辑 |

---

## 验证清单

1. 创建新 Agent，发送第一条指令 → 日志应看到无 `-r` 参数。
2. 第一轮结束后 → stderr 应捕获到 session id，前端 `AgentTask.kimiSessionId` 有值。
3. 发送第二条指令 → 日志应看到带 `-r <id>`，prompt 仅为增量指令。
4. Agent 回复时不再重新打招呼、不再重新探索代码库。
5. `To resume this session: ...` 不再显示为红色 ERROR。
6. 刷新页面后，`kimiSessionId` 仍在，后续指令继续 `-r` 续接。
7. 故意传入错误的 session id → 应 fallback 到平铺历史，不崩溃。

---

## 一句话

**把每轮 spawn 新进程 + 平铺伪造记忆，改成捕获 session id + 后续 `-r` 续接原生会话。**

要我按这个方案开始实现吗？
