# 方案：引擎自持久化 + 前端缓存 Logs

> 解决重启后旧 Agent 变"植物人"的问题：引擎进程重启后无状态，前端有 localStorage 但引擎不认识这些 Agent。

---

## 1. 现状问题

| 层级 | 持久化？ | 重启后状态 |
|------|---------|-----------|
| 前端 Vue + useSwarmStore | ✅ localStorage（tauri-plugin-store） | 能恢复 Agent 列表和 Logs |
| 引擎 AgentEngine（Node.js） | ❌ 纯内存 | 全新空进程，没有任何 Agent 对象 |

**结果**：
- 用户能看到旧 Agent 和历史消息，但发指令时引擎 `this.agents.get(id)` 返回 `undefined`，指令被静默丢弃。
- 删除 Agent 时引擎同样找不到对象，`delete-agent` 里的目录清理逻辑完全没执行，`E:/workspace/agent-xxx` 残留在磁盘上，前端 UI 却显示"已删除"。

---

## 2. 目标架构：各司其职

```
┌─────────────────────────────────────────────┐
│  引擎 JSON (~/.config/kimi-code-swarm/)     │  ← 核心状态事实源
│  • Agent 身份、运行状态、kimiSessionId       │
│  • 审阅状态、PR 信息、Token 预算             │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│       AgentEngine (Node.js)                 │
│  • 启动时自加载 JSON，重建 Agent 对象       │
│  • 状态变更时异步写回 JSON                  │
│  • emit agent-created / agent-state 给前端  │
└──────────────┬──────────────────────────────┘
               │ JSON-RPC 事件
┌──────────────▼──────────────────────────────┐
│          Vue Frontend                       │
│  • 接收引擎事件，渲染 UI                     │
│  • localStorage 缓存 Logs（视图层）         │
│  • 重启后等引擎恢复，再拼上本地 Logs         │
└─────────────────────────────────────────────┘
```

**分工原则**：
- **引擎 = 唯一事实来源**：谁活着、在哪工作、kimi session 是什么
- **前端 = 视图缓存**：历史消息（Logs）存在本地是为了 UI 渲染快，丢了不影响业务

---

## 3. 持久化格式

文件：`~/.config/kimi-code-swarm/engine-state.json`（Tauri 的 `app_local_data_dir()`）

```json
{
  "version": 1,
  "agents": [
    {
      "id": "agent-abc123",
      "name": "测试",
      "status": "ready",
      "repoUrl": "https://github.com/...",
      "workspace": "E:/workspace/agent-abc123",
      "branch": "agent/test-abc123",
      "instruction": "实现登录功能",
      "prStatus": "none",
      "prNumber": null,
      "prUrl": null,
      "tokenUsed": 1234,
      "tokenBudget": 50000,
      "kimiSessionId": "1ec1a250-9e90-4fd0-8ba3-722e71e6440d",
      "reviews": [],
      "changedFiles": [],
      "lastActivity": "2026-05-19T12:00:00Z"
    }
  ]
}
```

**不存什么**：
- `logs`：前端自己缓存，引擎不存（避免文件膨胀）
- `pid`：进程 ID 重启后无效
- `createdAt`：可选，不影响续接能力

---

## 4. 重启恢复流程

```
1. 用户打开 App
   ↓
2. 前端启动 → 启动引擎进程
   ↓
3. 【引擎】读取 engine-state.json
   → 遍历 agents 数组
   → new Agent(...) 重建每个 Agent 对象
   → 把 kimiSessionId 塞回 this.state.kimiSessionId
   → emit { type: 'agent-created', agent: state }
   ↓
4. 【前端】接收 agent-created 事件
   → state.agents 填充核心状态
   → 从 localStorage 加载对应 agent 的 Logs 缓存
   → 拼接后渲染聊天界面
   ↓
5. 用户点击旧 Agent 发消息
   → 引擎 sendInstruction 直接用内存中的 kimiSessionId
   → kimi --print -r <id> 续接上一次的会话
```

---

## 5. 改动范围

### 引擎侧（agent-engine）

| 文件 | 改动 |
|------|------|
| `agent-engine/src/persist.ts`（新增） | `loadEngineState()` / `saveEngineState()` 读写 JSON |
| `agent-engine/src/engine.ts` | 构造函数启动时调用 `loadEngineState()` 恢复；Agent 状态变更时触发 `saveEngineState()` |
| `agent-engine/src/agent.ts` | `syncState()` 或状态变更钩子中触发保存；确保 `kimiSessionId` 被序列化 |

### 前端侧（kimi-code-swarm）

| 文件 | 改动 |
|------|------|
| `src/store/useSwarmStore.ts` | `bootstrap()` 不再把 `persisted` 当业务状态直接塞给 `state.agents`；改为等引擎 `agent-created` 事件；localStorage 继续存 Logs 缓存 |

### 关键决策

**Q: 前端 localStorage 里的 agents 还存吗？**

存，但**只存 Logs**，不存核心状态。结构调整：

```ts
// 改造前：localStorage 存完整 agents（含核心状态+Logs）
{ agents: AgentTask[] }

// 改造后：localStorage 只存 Logs 映射
{ 
  agentLogs: { [agentId]: LogEntry[] },
  uiState: { selectedAgentId: string | null }
}
```

或者更简单：继续用现有格式，但 `bootstrap()` 恢复时**只取 logs**，核心状态等引擎事件。渐进式改造，不一次拆完。

---

## 6. 边界与风险

| 场景 | 策略 |
|------|------|
| **engine-state.json 损坏** | 启动时 `try/catch`，损坏则清空重建（等价于全新启动） |
| **引擎 crash 时丢数据** | 每次 `syncState()` 都触发异步保存，crash 最多丢最近几秒 |
| **用户手动删了 engine-state.json** | 引擎空启动，前端 Logs 缓存还在但"孤儿"——UI 显示历史消息，发指令时引擎会 `this.agents.get(id) === undefined`。需要前端检测并提示"Agent 已失效" |
| **多开 App 实例** | 各实例独立进程 + 独立 JSON 文件，互不影响（桌面应用常规行为） |
| **Logs 缓存过期** | 前端 Logs 可以设 TTL（如 7 天），超期自动清理 |

---

## 7. 一句话

**引擎自己记住 Agent 是谁、session 在哪；前端只管记住聊过什么。** 重启后两边各恢复各的，拼起来就是一个完整的 Agent。

---

## Review 请确认

1. 持久化文件路径和格式是否 OK？
2. 前端 localStorage 的改造方式（渐进式 vs 一次性拆分）倾向哪个？
3. 是否有我没覆盖到的场景？
