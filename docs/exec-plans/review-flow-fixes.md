# Review / Merge 流程 — 对齐文档

> 走 `.kimi/skills/task-intake/SKILL.md` 阶段 1 + 阶段 2 + 阶段 3 已通过。
>
> **状态**：v4，**全部决策已锁定，进入阶段 4 实施**。F 选 F2（失败标 `failed` 等人工，不自动让 agent 改代码）。
>
> 实施顺序（5 commit）：1) C-1 → 2) A → 3) B → 4) C-2 + F → 5) E

---

## 阶段 1 — 需求澄清 + 文档清单

### Bug 总览

| ID | 现象 | 根因 | 决策 |
|---|---|---|---|
| **A** | PR 头部「打回」按钮：UI 显示「Agent 继续修改」但 agent 毫无动作 | `Agent.rejectPr()` 只清 reviews + 改 status，文案误导 | ✅ 只切状态、改文案不再误导 |
| **B** | CI 自动修复在 UI 黑盒进行 | `fixBasedOnCiFailure` 用 `runInstructionSilent`，不流式回写聊天 | ✅ B1：换 `sendInstruction`（接受失去 idle timeout 的 trade-off） |
| **C-1** | 真实 PR 但手动点 reviewer 通过走 mock merge | [useSwarmStore.ts:642](../../kimi-code-swarm/src/store/useSwarmStore.ts#L642) `submitReview` sendToEngine 漏传 `githubToken` | ✅ bug fix：补传 token |
| **C-2** | mock 模式下 reviewer 全过会自动 mock merge | `handleReviewVerdict` 一律「全 approved → mergePr」无 mock 区分 | ✅ C1：有 token 自动合 / 无 token 等用户手动点 |
| **D** | agent 自动 commit 时 pre-commit hook 没拦住（PR #18 现象） | kimi 在 agent workspace 实测两路径都拦了，根因当前不明 | ⏸ **跳过**，转入 backlog 等下次复现收集诊断 |
| **E-1（根因）** | `spawn ENAMETOOLONG`：runReview 启动 kimi 失败 | [git.ts:93](../../kimi-code-swarm/agent-engine/src/git.ts#L93) `git diff main...origin/${branch}` 用 reviewer **本地** `main`。reviewer workspace 的本地 main 永远停在 clone 时的版本（`gitFetch` 只更新 `origin/main` 不动本地 main），merge-base 是 reviewer 几天前的 main → diff 包含 reviewer 本地 main 到 PR 头之间**所有** main commit + PR 自己的 commit，远大于真实 PR diff，超 32767 触发 ENAMETOOLONG | ✅ 改用 `origin/main...origin/${branch}` |
| **E-2（兜底）** | 同上但保险层 | 即使 E-1 修了，未来超大 PR 仍可能踩 Windows 32767 上限（libuv 转义 `"` 扩张 2x） | ✅ **E1 stdin**（实测 kimi 支持 `echo ... \| kimi --print`） |
| **F** | reviewer 失败后 `retryDeferredReviews` 每 30s 重试**无上限**，agent 永远卡 reviewing | [engine.ts](../../kimi-code-swarm/agent-engine/src/engine.ts) `retryDeferredReviews` 没有失败计数/退避 | ✅ **F2**：失败 3 次后 status 标 `failed` + 写 failureReason 等人工 |

### 文档 / 文件清单

| 文件 | 涉及 bug | 改动概要 |
|---|---|---|
| `kimi-code-swarm/src/store/useSwarmStore.ts` | **C-1** | 第 642 行 sendToEngine 补传 githubToken |
| `kimi-code-swarm/agent-engine/src/agent.ts` | A / B | rejectPr 文案 + fixBasedOnCiFailure 改用 sendInstruction |
| `kimi-code-swarm/agent-engine/src/engine.ts` | **C-2 / F** | handleReviewVerdict 加 mock 判断 + retryDeferredReviews 加退避/上限 |
| `kimi-code-swarm/agent-engine/src/kimi.ts` | **E** | runKimi 改 stdin 或临时文件传 prompt |
| `kimi-code-swarm/src/components/AgentDetail.vue` | A | 「打回」按钮 tooltip / 提示文案 |
| `docs/ARCHITECTURE.md` | 全部 | 流程描述同步 |
| `docs/exec-plans/backlog.md` | A / B / C 已记 + D 新增条目 | 落地后移除 A/B/C，加入 D 待复现 |

---

## 阶段 2 — 场景与预期结果

### Bug A — 「打回」按钮不再误导

**正常路径**
- 场景 A1：用户点 PR 头部「打回」
- 预期：status → working，log「PR 已打回，请发送新指令继续」，输入框可用

**用户视角**：看到「请发送新指令继续」就知道要主动发了，不被骗

---

### Bug B — CI 自动修复在 UI 可见（B1）

**正常路径**
- 场景 B1：CI 失败 → `fixBasedOnCiFailure` 走 `sendInstruction`（不再 silent）
- 预期：聊天面板出现 input 气泡 +「GitHub Actions CI 失败，日志：……请修复」+ kimi 流式 think / output

**失败 / 边界**
- sendInstruction 没 idle timeout：kimi 卡死会一直挂，**接受 trade-off**（用户能看见可手动停）

---

### Bug C-1 — submitReview 补传 githubToken

**正常路径**
- 真实 PR + 有 token + 手动点最后 reviewer 通过 → cmd 带上 token → mergePr 走真实 GitHub API → 真实合并

---

### Bug C-2 — mock 模式禁自动合并（C1）

**正常路径**
- mock 模式（无 token）reviewer 全过 → 不自动调 mergePr，UI「合并」按钮可点，用户手动点 → mock merge
- 真实模式（有 token）reviewer 全过 → 保留自动 mergePr

---

### Bug E — runReview 不再因长 diff 崩

**真根因（E-1）：reviewer 本地 main 永不更新，导致 diff 被虚假放大**

`runReview` 调 [git.ts:93](../../kimi-code-swarm/agent-engine/src/git.ts#L93) `getBranchDiff`：

```ts
return await execGit(dir, ['diff', `main...origin/${branch}`])
```

- `dir` = reviewer agent 的 workspace（不是 PR 作者的）
- `main` = reviewer 自己的本地 main 分支
- 反对的事实：reviewer workspace 一旦 clone 之后，本地 `main` 永远停在 clone 时的版本。`gitFetch` 是 `git fetch origin`，只更新 `origin/main` 这类 remote-tracking ref，**不会更新本地 `main`**。

→ merge-base 是 reviewer 几天前的 main commit → diff 包含「reviewer 旧 main → PR 头」之间**所有**改动：
- 我推到 main 的所有 commit（skills 迁移、几个 fix、cherry-pick PR #18/#19 等）
- PR 自己的 commit

PR #20 真实 diff 本地复现 ~10.6k 字符；reviewer 视角下被虚假放大到可能 50k+，触发 ENAMETOOLONG。

**修复**：用 `origin/main` 替代本地 `main`：

```ts
return await execGit(dir, ['diff', `origin/main...origin/${branch}`])
```

`origin/main` 在 `gitFetch` 后总是最新远端 main，diff = 真实 PR diff。

**保险（E-2）：review path 走 stdin**

即使 E-1 修了，未来真出现超大 PR 仍可能踩 Windows 32767 上限（libuv 转义 `"` 每个扩张 2x，实测纯引号 16370 就崩）。kimi CLI 实测支持 stdin：

```
echo "..." | kimi --work-dir . --print     → EXIT 0
kimi --work-dir . --print <<< "..."        → EXIT 0
```

**实施**：

```ts
// kimi.ts
export interface RunKimiOptions {
  streamJson?: boolean
  thinking?: boolean
  sessionId?: string
  promptViaStdin?: boolean  // 新增
}

export function runKimi(kimiPath, workspace, instruction, options) {
  const useStdin = options.promptViaStdin
  const baseArgs = useStdin
    ? ['--work-dir', workspace, '--print']           // 不带 --prompt
    : ['--work-dir', workspace, '--prompt', instruction, '--print']
  // ...
  const child = spawn(spawnCmd, spawnArgs, {
    cwd: workspace,
    stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    env,
  })
  if (useStdin && child.stdin) {
    child.stdin.write(instruction)
    child.stdin.end()
  }
  // ...
}
```

**调用方**：
- `runReview` / `fixBasedOnCiFailure` / `generateCommitAndPrBody` → 切 `promptViaStdin: true`（都可能带大 diff）
- `sendInstruction`（用户聊天）→ 保留 `--prompt`（输入短、最小风险）

**修复候选**

- **方案 E1**：改 `runKimi` 把 prompt 通过 **stdin** 传，`baseArgs` 里不再带 `--prompt`
  - 前提：kimi CLI 支持从 stdin 读 prompt（需要先实测 `echo "..." | kimi --work-dir . --print` 是否生效）
  - 实测后如果支持：最优方案，无长度限制
  - 不支持：方案作废

- **方案 E2**：prompt 写入 workspace 内临时文件 `.kimi-prompt-tmp.md`，命令行参数改成 `--prompt "请读取 .kimi-prompt-tmp.md 并按其中描述执行"`
  - kimi 自己用内置 Read 工具读文件
  - 缺点：多一次 IO + kimi 必须主动调 Read tool 才看得到 prompt 内容（如果 kimi 不主动读会跑空）
  - 兜底用

- **方案 E3**：超长时**截断** diff 到 25k 字符，prompt 里加「diff 已截断，仅前 25k 字符」提示
  - 治标方案
  - 截断后审阅基于半截 diff，结论可能不可靠
  - 优点：实现一行 if

**实施细节决策点**

**实测结果（已跑）**：

```
echo "Reply with the single word: ok" | kimi --work-dir . --print  → EXIT 0
kimi --work-dir . --print <<< "Reply with the single word: ok"      → EXIT 0
```

kimi 完整读取 stdin 并响应。**确定走 E1**。

**实施细节**：

```ts
// kimi.ts
export interface RunKimiOptions {
  streamJson?: boolean
  thinking?: boolean
  sessionId?: string
  promptViaStdin?: boolean  // 新增
}

export function runKimi(kimiPath, workspace, instruction, options) {
  // ...
  const useStdin = options.promptViaStdin
  const baseArgs = useStdin
    ? ['--work-dir', workspace, '--print']           // 不带 --prompt
    : ['--work-dir', workspace, '--prompt', instruction, '--print']
  // ...
  const child = spawn(spawnCmd, spawnArgs, {
    cwd: workspace,
    stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    env,
  })
  if (useStdin) {
    child.stdin.write(instruction)
    child.stdin.end()
  }
  // ...
}
```

**调用方**：
- `runReview` / `fixBasedOnCiFailure` / `generateCommitAndPrBody` → 切 `promptViaStdin: true`（都可能带大 diff）
- `sendInstruction`（用户聊天）→ 保留 `--prompt`（输入短、minimize 改动面）

不走「长度阈值切换路径」——review path 一律走 stdin，简单可预测。

---

### Bug F — performReview 失败重试加上限和退避

**根因**：[engine.ts](../../kimi-code-swarm/agent-engine/src/engine.ts) `retryDeferredReviews` 每 30s 扫所有 reviewing agent，对 pending review 重新 `performReview`。**只要 reviewer 失败（status 没变成 approved / rejected），就一直 retry**。Bug E 的死循环就是它放大的。

**修复方向**

- 给 `ReviewEntry` 加 `attempts: number`（持久化字段）和可选 `failureReason: string`
- `performReview` 失败时 `attempts++`
- `retryDeferredReviews` 跳过 `attempts >= MAX_REVIEW_ATTEMPTS`（建议 3 次）的 entry
- 达到上限 → review status 标 `failed`（新枚举）或 `rejected` + 写入 failureReason
- UI 上「失败」状态显示原因，用户决定手动重试 / 跳过 / 改派别的 reviewer

**实施细节决策点**

- F1：失败 3 次后 status 标 `rejected`（沿用现有枚举，触发 `fixBasedOnReviews` 自动修代码）
- F2：失败 3 次后加新枚举 `failed`（不触发自动修复，等用户手动决定）

我倾向 **F2**——审阅失败不等于审阅意见为"拒绝"，自动让 agent 改代码方向不对。

**退避**（独立小决策）

- 当前固定 30s。失败次数多了可以指数退避（30 / 60 / 120s）减少日志噪音和 token 消耗
- 我建议加上（简单一行）

---

## 阶段 3 — 对齐门控（已通过 ✅）

全部决策锁定：
- A：只切状态 + 改文案不再误导
- B：B1（fixBasedOnCiFailure 换 sendInstruction）
- C-1：bug fix 补传 githubToken
- C-2：C1（mock 无 token → 等用户手动合并；真实 → 自动合并保留）
- D：跳过（root cause 不明，转 backlog 待复现）
- E：E-1（git.ts 用 `origin/main`）+ E-2（kimi.ts review path 走 stdin）
- F：F2（失败标 `failed` 等人工）

## 阶段 4 — 实施清单

**5 个原子 commit，按依赖顺序：**

1. **C-1**：`kimi-code-swarm/src/store/useSwarmStore.ts:642` `submitReview` sendToEngine 补传 `githubToken`
2. **A**：`agent.ts rejectPr` log 文案 + `AgentDetail.vue` 「打回」按钮 tooltip 改不误导
3. **B**：`agent.ts fixBasedOnCiFailure` 用 `sendInstruction` 替代 `runInstructionSilent`
4. **C-2 + F**：`engine.ts handleReviewVerdict` 加 mock-token 判断分支不自动 mergePr；`ReviewEntry` 加 `attempts` + `failureReason` + 新枚举 `failed`；`retryDeferredReviews` 跳过 attempts >= 3 + 失败标 `failed`；前端 types 同步 `failed` 状态 + UI 渲染失败原因
5. **E**：`git.ts getBranchDiff` 改 `origin/main...origin/${branch}`；`kimi.ts` 新增 `promptViaStdin` 选项 + review path（runReview / fixBasedOnCiFailure / generateCommitAndPrBody）切 stdin

每个 commit 跑 `npm run typecheck && lint && analyze`（agent-engine 额外 `npx tsc --noEmit`），落地后从 [`backlog.md`](backlog.md) 移除 A/B/C 三条 + 加入 D 待复现条目（含「下次复现需收集 git config dump / hook stderr 完整流」）。

---

*v3 (2026-05-27): 新增 Bug E（PR #20 spawn ENAMETOOLONG）+ Bug F（无限重试死循环），由 PR #20 审阅日志暴露。Bug D 决定跳过。*
