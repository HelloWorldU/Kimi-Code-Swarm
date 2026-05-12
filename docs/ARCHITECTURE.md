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
  - `components/AgentDetail.vue` — Agent 详情（多轮对话聊天 UI + 日志 + PR 审阅）
  - `components/AnalyticsPanel.vue` — 数据可视化（只读聚合）
- `src-tauri/` —— 唯一有权 spawn 进程的 Rust 后端
  - `save_api_key` / `get_api_key` / `delete_api_key` — OS Keyring 操作
  - `verify_api_key` — Kimi CLI 存在性检测（拒绝 fallback），启动引擎时注入 `KIMI_API_KEY`
  - `stop_agent_engine` — 向引擎发送 shutdown 命令

## Agent 五角色分工

系统固定 5 个 Agent 名额，各司其职：

| 角色 | 职责范围 | 关键目录 |
|------|---------|---------|
| **UI Agent** (`SwarmUI`) | Vue 组件、页面布局、样式交互、前端体验优化 | `src/components/`, `src/App.vue` |
| **Core Agent** (`SwarmCore`) | Tauri IPC、Rust 后端、Agent Engine、进程管理 | `src-tauri/`, `src/api/ipc.ts` |
| **Docs Agent** (`SwarmDocs`) | 文档维护、STATUS 更新、check-docs 修复、知识库同步 | `docs/`, `AGENTS.md` |
| **Review Agent** (`SwarmReview`) | PR 审阅、代码质量检查、约束合规确认 | `ci/`, `ast/`, PR 审阅队列 |
| **Tools Agent** (`SwarmTools`) | 定期脚本执行、dead code 清理、健康检查、熵管理 | `scripts/`, `ast/rules/dead-code.ts` |

**协作规则**：
- 各 Agent 只改自己职责范围内的代码，跨边界改动需经 Review Agent 确认
- 任何代码改动完成后必须走 `harness/new-task.yaml` 的 7-10 验证闭环（build → start → test → lint/analyze）
- Review Agent 拥有最终合入权，但自身代码也需其他 Agent 交叉审阅

**Agent 创建时序（Tauri 生产模式）**：
1. 前端弹窗收集信息 → 调用 `createAgent()`
2. `createAgent()` 发送 `create-agent` 命令给 Agent Engine（Rust → Node.js）
3. Engine 创建成功后推送 `agent-created` 事件 → 前端列表更新
4. **引擎未启动时**：`sendToEngine` 抛出异常，前端必须 `.catch()` 捕获并提示用户，禁止静默失败

## 登录流程

`login()` 执行验证链：
1. `verifyKimiApiKey(key)` — 通过 Rust 后端验证 API Key 有效性
2. `saveApiKey(key)` — 存入 OS Keyring
3. `state.isLoggedIn = true` — 切换 UI 状态
4. `loadPersistedAgents()` — 恢复持久化 Agent 列表
5. `startAgentEngine()` — 启动 Agent 引擎（失败时通过 Logger 记录）
6. `state.isAuthLoading = false` — 结束加载态

> **Debug 原则**：问题暴露但代码层面不明显时，优先通过 `src/utils/logger.ts` 增加运行时日志定位根因，而非盲猜。

## 退出登录流程

`logout()` 执行完整重置：
1. `stopAgentEngine()` — 停止 Node.js Agent 引擎进程
2. `deleteApiKey()` — 从 OS Keyring 删除 API Key
3. `saveStoreValue(STORE_KEY, {agents:[]})` — 清空持久化 Agent 列表
4. 重置所有 reactive state（`isLoggedIn` / `agents` / `engineConnected` 等）
5. 重置 bootstrap 标志（`bootstrapped` / `engineListenersInitialized`）
6. `window.location.reload()` — 强制页面重载，确保干净状态

## 实现状态速查

> 完整矩阵见 [`docs/STATUS.md`](STATUS.md)。

| 模块 | 状态 |
|------|------|
| Tauri IPC (`spawn_agent_engine`, `stop_agent_engine`, `send_to_engine` 等) | ✅ 真实 |
| GitHub API 封装 | ✅ 真实（Agent Engine 调用 GitHub REST API） |
| 审阅门控逻辑 | ✅ 真实 |
| 文件 diff 查看 (`getFileDiff` → engine → `git diff`) | ✅ 真实 |
| Kimi CLI 接入 (`detectKimiCli` + `spawn_process` + 实时事件) | ✅ 真实 |
| 统一日志 (`src/utils/logger.ts`) | ✅ 已接入 Store，替代散落 console |

## 引擎目录探测（开发/生产兼容性）

Rust `spawn_agent_engine()` 需要找到 `agent-engine` 目录。不同环境下的位置不同：

| 环境 | 当前工作目录 | agent-engine 实际位置 | 探测策略 |
|------|-------------|----------------------|---------|
| Tauri Dev (`cargo run`) | `src-tauri/` | `../agent-engine` | 优先检查 `../agent-engine` |
| Tauri Prod Bundle | 应用安装目录 | 与 app bundle 同级或内部 | fallback 到 `app_local_data_dir/agent-engine` |

```rust
fn agent_engine_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. 尝试 ../agent-engine（开发模式）
    // 2. fallback 到 app_local_data_dir/agent-engine（生产模式）
}
```

**教训**：不要用硬编码的相对路径 `'agent-engine'`。Tauri Dev 模式下 `cargo run` 的 CWD 是 `src-tauri/`，`agent-engine` 会指向 `src-tauri/agent-engine`（不存在），必须用 `../agent-engine`。

## TypeScript 执行方案

Agent Engine 用 TypeScript 编写，Rust 直接启动。详见 [`docs/CLI_HARNESS.md`](CLI_HARNESS.md) 的选型记录。

简要结论：
- ❌ `node --experimental-strip-types` — Windows ESM 下 `.js`→`.ts` 映射失败
- ✅ `npx tsx src/index.ts` — esbuild 驱动，seamless 映射，开发体验最佳

## E2E 测试架构

Playwright 通过 WebView2 CDP（`--remote-debugging-port=9222`）连接 Tauri 窗口：
- 仅验证前端 DOM 交互（登录 → 创建 Agent → Dashboard 验证）
- 不覆盖 Rust IPC、Agent Engine 进程、Git 操作等后端逻辑
- 后端集成测试待实现（见 `docs/STATUS.md`）
