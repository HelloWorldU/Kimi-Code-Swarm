# ARCHITECTURE

## 数据流

```
UI (Vue) ←→ useSwarmStore (UI state only)
  ←→ Tauri IPC ←→ Rust Main Process
    ←→ stdin/stdout JSON Lines ←→ Node.js Agent Engine
      ←→ spawn Kimi CLI (real-time stdout capture)
      ←→ Git operations (clone/commit/push)
      ←→ Token budget monitoring
  ←→ Tauri IPC ←→ OS Keyring (Kimi API Key)
  ←→ tauri-plugin-store (Agent 列表持久化)
  ←→ localStorage (GitHub Token, browser fallback)

## 审阅门控

PR 创建时，Store 自动生成 `ReviewEntry[]`，包含所有其他 Agent 作为 pending 审阅者。
`mergePr()` 执行前检查 `reviews.every(r => r.status === 'approved')`，未通过则拒绝合并。
```

## 状态分层

| 层级 | 存储 | 生命周期 |
|------|------|---------|
| UI State | reactive | 页面刷新丢失 |
| Runtime | Main Process | 应用关闭丢失 |
| Persistent | localStorage | 跨会话保留（浏览器 fallback） |
| Secure | OS Keyring | 跨会话保留，系统级加密 |
| App State | tauri-plugin-store (JSON) | 跨会话保留（Agent 列表等） |
| Agent Engine | Node.js process (JSON Lines over stdio) | 常驻进程，管理所有 Agent 生命周期 |

## 模块边界

- `kimi-code-swarm/src/` —— 纯前端，禁止直接操作进程
  - `components/LoginView.vue` — 登录页（API Key 输入 + 验证）
  - `components/AgentDashboard.vue` — Agent 卡片网格（最多 5 个）
  - `components/AgentDetail.vue` — Agent 详情（指令输入 + 日志 + PR 审阅）
  - `components/AnalyticsPanel.vue` — 数据可视化（只读聚合）
- `src-tauri/` —— 唯一有权 spawn 进程的 Rust 后端
  - `save_api_key` / `get_api_key` / `delete_api_key` — OS Keyring 操作
  - `verify_api_key` — Kimi API 验证

## 实现状态速查

> 完整矩阵见 [`docs/STATUS.md`](STATUS.md)。

| 模块 | 状态 |
|------|------|
| Tauri IPC (`exec_git`, `exec_command`, `spawn_process`, `kill_process`) | ✅ 真实 |
| GitHub API 封装 | ⚡ 双模式（Token 可选） |
| 审阅门控逻辑 | ✅ 真实 |
| Kimi CLI 接入 (`detectKimiCli` + `spawn_process` + 实时事件) | ✅ 真实 |
