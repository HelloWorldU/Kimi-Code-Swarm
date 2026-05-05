# ARCHITECTURE

## 数据流

```
UI (Vue) ←→ useSwarmStore (AgentTask[] + ReviewEntry[] + changedFiles)
  ←→ Tauri IPC ←→ Rust Main Process ←→ git / spawn CLI
  ←→ Real-time stdout events (process-output / process-exit)
  ←→ Git diff detection (post-execution file change tracking)
  ←→ GitHub API (PR create/merge/review)
  ←→ localStorage (GitHub Token)

## 审阅门控

PR 创建时，Store 自动生成 `ReviewEntry[]`，包含所有其他 Agent 作为 pending 审阅者。
`mergePr()` 执行前检查 `reviews.every(r => r.status === 'approved')`，未通过则拒绝合并。
```

## 状态分层

| 层级 | 存储 | 生命周期 |
|------|------|---------|
| UI State | reactive | 页面刷新丢失 |
| Runtime | Main Process | 应用关闭丢失 |
| Persistent | localStorage | 跨会话保留 |

## 模块边界

- `kimi-code-swarm/src/` —— 纯前端，禁止直接操作进程
  - `components/AnalyticsPanel.vue` — 数据可视化（只读聚合）
  - `components/TaskDetail.vue` — 交互面板（输入 + 审阅 + diff）
- `src-tauri/` —— 唯一有权 spawn 进程的 Rust 后端

## 实现状态速查

> 完整矩阵见 [`docs/STATUS.md`](STATUS.md)。

| 模块 | 状态 |
|------|------|
| Tauri IPC (`exec_git`, `exec_command`, `spawn_process`, `kill_process`) | ✅ 真实 |
| GitHub API 封装 | ⚡ 双模式（Token 可选） |
| 审阅门控逻辑 | ✅ 真实 |
| Kimi CLI 接入 (`detectKimiCli` + `spawn_process` + 实时事件) | ✅ 真实 |
