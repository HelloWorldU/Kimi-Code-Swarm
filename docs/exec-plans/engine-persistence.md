# 方案：引擎自持久化（实施版）

> **一句话**：Rust 通过 `KIMI_SWARM_DATA_DIR` 环境变量告诉引擎数据目录；引擎启动时从 `engine-state.json` 重建 Agent、emit `engine-restored` 事件；前端等这个事件再去填 `state.agents`，对不在恢复列表里的 localStorage 旧 Agent 标「孤儿」。重启不再变植物人，且每一项跟 kimi 原生 session resume 完全协作。

---

## 1. 现状（已读代码确认）

| 事实 | 出处 |
|------|------|
| 引擎入口 `index.ts` 只做：`new AgentEngine` + 收 stdin 命令 + emit boot `pong`，**没有任何 restore** | [agent-engine/src/index.ts](../../kimi-code-swarm/agent-engine/src/index.ts) |
| 引擎进程内存里只有空 `this.agents = new Map()` | [agent-engine/src/engine.ts:7](../../kimi-code-swarm/agent-engine/src/engine.ts#L7) |
| Rust `spawn_agent_engine` 已经在用 `cmd_builder.env("KIMI_API_KEY", key)` 注入环境变量 —— **再加一个 env 即可** | [src-tauri/src/lib.rs:295](../../kimi-code-swarm/src-tauri/src/lib.rs#L295) |
| Rust 已持有 `app.path().app_local_data_dir()` | [src-tauri/src/lib.rs:94](../../kimi-code-swarm/src-tauri/src/lib.rs#L94) |
| 前端 `STORE_KEY = 'agents'`、走 **`tauri-plugin-store`**（不是浏览器 localStorage）持久化完整 `AgentTask[]`；`persistAgents()` 在 store 里被 20+ 处调用 | [src/store/useSwarmStore.ts:26, 232](../../kimi-code-swarm/src/store/useSwarmStore.ts#L26) |
| `bootstrap()` 把 localStorage 里的 agents 直接塞回 `state.agents` —— 这就是「前端有、引擎没有」错配的源头 | [src/store/useSwarmStore.ts:30-51](../../kimi-code-swarm/src/store/useSwarmStore.ts#L30) |
| `agent-created` handler 现在是 `state.agents.push(agent)` —— 一旦引擎在 restore 时 emit，会跟前端已有的 agents **重复** | [src/store/useSwarmStore.ts:88-92](../../kimi-code-swarm/src/store/useSwarmStore.ts#L88) |

**症状**：用户能看到旧 Agent 和历史消息，但发指令时引擎 `this.agents.get(id)` 返回 `undefined`，指令静默丢弃；删除时引擎找不到对象，`E:/workspace/agent-xxx` 残留在磁盘上。

---

## 2. 架构分工

| 角色 | 职责 | 实现 |
|------|------|------|
| **引擎 = 事实源** | Agent 身份、运行状态、`kimiSessionId`、PR / review / token 等 | `<dataDir>/engine-state.json` |
| **前端 = 视图缓存** | 历史 `logs`、`selectedAgentId` 等 UI 状态 | `tauri-plugin-store`（沿用） |

引擎结构化字段（business state）→ 引擎写盘；前端只缓存看的东西。

---

## 3. 改动清单（按文件，可直接动手）

### Rust ([src-tauri/src/lib.rs](../../kimi-code-swarm/src-tauri/src/lib.rs))

`spawn_agent_engine` 在 `KIMI_API_KEY` 注入处（295 行附近）再加：

```rust
let data_dir = app.path().app_local_data_dir()
    .map_err(|e| format!("Failed to resolve data dir: {}", e))?;
std::fs::create_dir_all(&data_dir).ok();
cmd_builder.env("KIMI_SWARM_DATA_DIR", data_dir.to_string_lossy().as_ref());
```

跨平台路径由 Rust 解决；引擎只读 env，不猜路径。

### 引擎新增 `agent-engine/src/persist.ts`

| 导出 | 行为 |
|------|------|
| `getDataDir(): string` | 读 `process.env.KIMI_SWARM_DATA_DIR`；缺失时 throw（不允许默默落到错误位置） |
| `acquireLock(dir): void` | 写 `engine.lock`（自己 pid）；若已存在且 pid 活 → throw 退出；pid 已死 → 抢占 |
| `loadEngineState(dir): Promise<PersistedState \| null>` | 读 `engine-state.json`；parse 失败 → `rename` 成 `engine-state.json.corrupt.<ts>` 留底 + 返回 null |
| `schedulePersist(state): void` | **debounced 500ms**；写时**原子化**：`engine-state.json.tmp` → `rename` |

### 引擎 `agent-engine/src/agent.ts`

- 加静态 `Agent.fromPersisted(p, emit, onPrCreated): Agent`，把持久化字段塞回 `this.state`（含 `kimiSessionId`）。
- `syncState()` 末尾加：**当 business 字段变化才** `schedulePersist`。
  - business 字段集合：`kimiSessionId / prStatus / prNumber / prUrl / status / reviews / changedFiles / workspace / branch / prAuthor / ciStatus`
  - **`tokenUsed` 不算**（高频，不值得刷盘；丢了无所谓）
  - 实现：在 `Agent` 上维护 `lastPersistedFingerprint = JSON.stringify(businessSubset)`，变了才 schedule

### 引擎 `agent-engine/src/types.ts`

`EngineEvent` 加一项：

```ts
| { type: 'engine-restored'; restoredAgentIds: string[] }
```

### 引擎 `agent-engine/src/index.ts` 启动顺序改为

```ts
const dataDir = getDataDir()
acquireLock(dataDir)

const persisted = await loadEngineState(dataDir)
const engine = new AgentEngine(emit, dataDir)
const restoredIds: string[] = []
if (persisted) {
  for (const p of persisted.agents) {
    engine.restoreAgent(p)              // 内部 new Agent + 进 Map + emit agent-created
    restoredIds.push(p.id)
  }
}
emit({ type: 'engine-restored', restoredAgentIds: restoredIds })   // 必须在 agent-created 之后
emit({ type: 'pong', message: 'Agent Engine started' })
// 然后 readline 接 stdin
```

### 前端 [src/store/useSwarmStore.ts](../../kimi-code-swarm/src/store/useSwarmStore.ts) —— 渐进式

`bootstrap()`：仍 `loadPersistedAgents()`，但**只拿 logs 作缓存**，不直接塞 `state.agents`；标记 `state.engineReady = false`。

`handleEngineEvent` 改/加：

```ts
case 'agent-created': {
  const agent = event.agent as AgentTask
  agent.logs = logsCache.get(agent.id) ?? agent.logs ?? []
  const i = state.agents.findIndex(a => a.id === agent.id)
  if (i >= 0) state.agents[i] = agent     // 去重：替换，不重复 push
  else state.agents.push(agent)
  break
}
case 'engine-restored': {
  state.engineReady = true
  const restored = new Set(event.restoredAgentIds as string[])
  for (const a of state.agents) {
    if (!restored.has(a.id)) a.status = 'orphan'   // localStorage 多出来的 → 孤儿
  }
  break
}
```

`AgentTask.status` 加 `'orphan'`；UI 在 `engineReady=false` 时禁「发送/创建/删除」按钮。

> **不要一次拆掉** `persistAgents()`。Phase 1 让引擎 JSON 接管核心状态，前端 store 继续全量持久化作 fallback；Phase 3 再砍。

---

## 4. 关键机制

| 机制 | 实现 |
|------|------|
| 跨平台路径 | Rust `app_local_data_dir()` → env `KIMI_SWARM_DATA_DIR` → 引擎读 |
| 多实例隔离 | `engine.lock`(写 pid)，已存在且活着 → 退出 |
| 写盘抗 crash | 原子写：`.tmp` → `rename` |
| 损坏不删数据 | parse 失败 → `rename .corrupt.<ts>` 留底，空启动 |
| 不刷盘 | 500ms debounce + 仅 business 字段变才 schedule |
| 孤儿可见 | `engine-restored` 含 ID 列表；前端 diff 后给 localStorage 多出的标 `orphan` |
| 启动窗口期 | `state.engineReady` + UI 禁交互直到收到 `engine-restored` |

---

## 5. 持久化 JSON 格式

文件：`<KIMI_SWARM_DATA_DIR>/engine-state.json`

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
      "branch": "agent/test-abc",
      "instruction": "实现登录功能",
      "prStatus": "none",
      "prNumber": null,
      "prUrl": null,
      "prAuthor": null,
      "tokenUsed": 1234,
      "tokenBudget": 50000,
      "kimiSessionId": "1ec1a250-9e90-4fd0-8ba3-722e71e6440d",
      "reviews": [],
      "changedFiles": [],
      "ciStatus": null,
      "createdAt": "2026-05-19T10:00:00Z",
      "lastActivity": "2026-05-19T12:00:00Z"
    }
  ]
}
```

**不存**：`logs`（前端缓存）、`pid`（进程死了就无效）。
**保留 `createdAt`**：UI 排序/显示用。

---

## 6. 重启流程

```
1. 用户打开 App
2. 前端 bootstrap → 启 Rust → spawn engine（带 KIMI_SWARM_DATA_DIR 等 env）
3. 引擎：acquireLock → loadEngineState → for each agent: new Agent + emit agent-created
4. 引擎 emit { engine-restored, restoredAgentIds }
5. 引擎 emit { pong, "Agent Engine started" }
6. 前端：收到 agent-created（按 id 去重填 / 替换 state.agents，logs 从缓存拼回）
7. 前端：收到 engine-restored → state.engineReady = true，给 localStorage 多出的标 orphan
8. 用户发指令 → sendInstruction → 引擎用内存里的 kimiSessionId → kimi --print -r <id> 续接
```

---

## 7. 边界处理

| 场景 | 策略 |
|------|------|
| `engine-state.json` 损坏 | `rename .corrupt.<ts>` + 空启动 + emit error 提示用户 |
| 引擎 crash 时丢数据 | 仅丢最近 ≤500ms（debounce 窗口） |
| 用户手删 JSON | 空启动 → 前端 localStorage 里的全部变 `orphan`（可视化提示） |
| 多开 App | `engine.lock` 拒绝第二实例（推荐配合 [`tauri-plugin-single-instance`](https://crates.io/crates/tauri-plugin-single-instance) 在 Rust 侧也挡一道） |
| 启动窗口期用户操作 | `state.engineReady=false` 禁交互 |

---

## 8. 实施分阶段（降风险）

| Phase | 内容 | 状态 |
|-------|------|------|
| **1** | Rust 注入 env + `persist.ts`（load/lock/原子写）+ 启动 restore + emit `engine-restored` + 前端识别孤儿 + `engineReady` 门控 | ✅ 已落地（commit `5d6ac8b`） |
| **2** | `syncState` 接 `schedulePersist`，含 business-字段哈希判定 | ✅ 已落地（commit `2a03133`） |
| **3** | 砍掉前端 `persistAgents` 对核心字段的持久化，只留 slim 切片（id/name/repoUrl/branch/createdAt/lastActivity/tokenBudget/logs）；纯业务字段事件不再触发落盘 | ✅ 已落地（本次提交） |

---

## 9. 不在本方案范围（遗留）

- **kimi session 过期检测与 fallback**：`-r <过期 id>` 时 kimi 的实际报错串**未知**，需真机确认才能写检测。属于 session-resume migration 文档的遗留 TODO，单独跟进。
- **多开实例的进阶 UX**：本方案靠 lock 拒绝第二实例；若要更友好（focus 已有窗口），用 `tauri-plugin-single-instance`。

---

*Plan version: 2026-05-19（基于代码现状重写；上一版概念稿已合并入此）*
