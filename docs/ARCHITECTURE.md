# ARCHITECTURE

## 系统架构（四层）

```
┌─────────────────────────────────────────────────────────┐
│  1. 前端 Webview        kimi-code-swarm/src/  (Vue 3)     │
│     UI + useSwarmStore（响应式 UI 状态）                   │
└───────────────▲─────────────────────────┬────────────────┘
        Tauri IPC（invoke / event）        │
┌───────────────┴─────────────────────────▼────────────────┐
│  2. Rust 主进程         src-tauri/src/lib.rs              │
│     唯一能 spawn 进程的特权层                              │
└───────────────▲─────────────────────────┬────────────────┘
       engine stdout（读）        engine stdin（写）
        每行一个 JSON              每行一个 JSON
┌───────────────┴─────────────────────────▼────────────────┐
│  3. Node.js Agent Engine   agent-engine/  (常驻子进程)     │
│     AgentEngine 管理多个 Agent 实例                        │
└───────────────────────────┬───────────────────────────────┘
              spawn kimi（每个 Agent 一个）
┌───────────────────────────▼───────────────────────────────┐
│  4. Kimi CLI               真正干活的 AI                    │
│     kimi --print --output-format stream-json --thinking    │
└────────────────────────────────────────────────────────────┘
```

> 前端禁止直接 spawn 进程；所有 CLI 调用必须通过 Rust 主进程 → Agent Engine → Kimi CLI 的链路。

## 完整数据流

```
UI (Vue) ←→ useSwarmStore (UI state only)
  ←→ Tauri IPC ←→ Rust Main Process
    ←→ stdin/stdout JSON Lines ←→ Node.js Agent Engine
      ←→ spawn Kimi CLI (real-time stdout capture)
      ←→ Git operations (clone/commit/push)
      ←→ Token budget monitoring
  ←→ Tauri IPC ←→ OS Keyring (Kimi API Key)
  ←→ Agent Engine ←→ <app_local_data_dir>/engine-state.json (引擎自持久化：身份/状态/PR/session)
  ←→ tauri-plugin-store (UI 缓存：logs + selectedAgentId，restore 完成后做 diff)
  ←→ localStorage (GitHub Token, browser fallback)

## 审阅门控

PR 创建时，Store 自动生成 `ReviewEntry[]`，包含所有其他 Agent 作为 pending 审阅者。
`mergePr()` 执行前检查 `reviews.every(r => r.status === 'approved')`，未通过则拒绝合并。

审阅通过必须由外部动作触发（指挥官在 UI 点击各 reviewer 的通过/拒绝按钮，或 Tauri 模式下由其他 Agent 真实执行审阅），不会自动通过。

所有发往 engine 的 review 相关命令（`submit-for-review` / `submit-review` / `merge-pr`）都必须携带当前 GitHub Token；engine 的 `canMerge` / `mergePr` 根据 token 是否存在决定走真实 GitHub API 还是 mock 路径，缺失 token 会导致真实 PR 走到 mock merge。

`submit-review` 命令携带 `comment` 字段（来自自动审阅的 `review.comment`），确保 fix 闭环能获取具体审阅意见而非 fallback「审阅未通过」。

**自动合并的 mock 区分**：`handleReviewVerdict` 在 reviewer 全 approved 后，**仅当有 GitHub Token 时**才主动调 `mergePr` 自动合并；mock 模式（无 token）不自动合并，UI「合并」按钮仍可点，由用户决定时机手动合并——避免 mock merge 跟 GitHub 现实状态脱钩造成误判。

**审阅失败上限**：`ReviewEntry` 加 `status='failed'` 枚举 + `attempts` + `failureReason` 字段。`retryDeferredReviews` 给 `performReview` 传 `onFailed` 回调，累加 attempts；达 `MAX_REVIEW_ATTEMPTS=3` 后 status 置 `failed`，retry 自然停止。`handleReviewVerdict` 看到 `hasFailed=true` 时跳过 `fixBasedOnReviews`——「审阅多次跑不通」≠「内容拒绝」，不应让 agent 改代码方向，等用户手动处置（重试 / 改派 / 强制合并 / 打回）。
```

## 状态分层

| 层级 | 存储 | 生命周期 |
|------|------|---------|
| UI State | reactive | 页面刷新丢失 |
| Draft Input | `useSwarmStore.draftInputs` (reactive `Record<string, string>`) | 页面刷新丢失；切换 Agent / 离开详情页时自动保存/恢复，避免未发送输入丢失 |
| Runtime | Main Process | 应用关闭丢失 |
| Persistent | localStorage | 跨会话保留（浏览器 fallback） |
| Secure | OS Keyring | 跨会话保留，系统级加密 |
| App State | tauri-plugin-store (JSON) | 跨会话保留（logs / UI 选中等视图缓存） |
| Engine State | `<app_local_data_dir>/engine-state.json`（debounced 500ms / 原子写 .tmp→rename / 多实例 lock） | 跨会话保留（**事实源**：身份、运行状态、PR、`kimiSessionId`、token、reviews） |
| Agent Engine | Node.js process (JSON Lines over stdio) | 常驻进程，管理所有 Agent 生命周期 |

## 模块边界

- `kimi-code-swarm/src/` —— 纯前端，禁止直接操作进程
  - `components/LoginView.vue` — 登录页（API Key 输入 + 验证）
  - `components/AgentDashboard.vue` — Agent 卡片网格（最多 5 个），统计卡片带渐变背景与进度条
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
| **UI Agent** (`SwarmUI`) | Vue 组件、页面布局、样式交互、前端体验优化 | `kimi-code-swarm/src/components/`, `kimi-code-swarm/src/App.vue` |
| **Core Agent** (`SwarmCore`) | Tauri IPC、Rust 后端、Agent Engine、进程管理 | `kimi-code-swarm/src-tauri/`, `kimi-code-swarm/src/api/ipc.ts` |
| **Docs Agent** (`SwarmDocs`) | 文档维护、STATUS 更新、check-docs 修复、知识库同步 | `docs/`, `AGENTS.md` |
| **Review Agent** (`SwarmReview`) | PR 审阅、代码质量检查、约束合规确认 | `ci/`, `ast/`, PR 审阅队列 |
| **Tools Agent** (`SwarmTools`) | 定期脚本执行、dead code 清理、健康检查、熵管理 | `scripts/`, `ast/rules/dead-code.ts` |

**协作规则**：
- 各 Agent 只改自己职责范围内的代码，跨边界改动需经 Review Agent 确认
- 任何代码改动完成后必须走 `harness/new-task.yaml` 的 7-10 验证闭环（build → start → test → lint/analyze）
- Review Agent 拥有最终合入权，但自身代码也需其他 Agent 交叉审阅

**Agent 创建时序（Tauri 生产模式）**：
1. 前端弹窗收集信息（name / repoUrl / tokenBudget）→ 调用 `createAgent()`
2. `createAgent()` 发送 `create-agent` 命令给 Agent Engine（Rust → Node.js）
3. Engine 创建成功后推送 `agent-created` 事件 → 前端列表更新
4. 用户点击"启动"→ `startAgent()` 发送 `start-agent` 命令 → Engine 执行 clone/branch → 推送 `agent-status` 事件
5. **引擎未启动或命令发送失败时**：`sendToEngine` 抛出异常，`startAgent` 已添加 `try/catch` 捕获并写入 Agent 日志，禁止静默失败
6. 用户点击"停止"→ `stopAgent()` **乐观更新**前端状态为 `stopped`，再 `await sendToEngine({ type: 'stop-agent' })` → Engine 调用 `agent.stop()` 等待进程退出 → 推送 `agent-status` 事件；后端失败时自动回滚状态
7. 用户发送指令 → `sendInstruction()` 执行完毕且检测到文件变更 → Engine **自动调用 `autoSubmitForReview()`**：git add/commit/push → 创建 PR；任何步骤失败时，Engine 将完整执行日志（stdout + stderr + exit code）全量回传给 Kimi CLI，由 Agent 自主判断并修复，然后重试（最多 3 轮）→ 状态变为 `reviewing` → **自动启动 CI 监控**：Engine 每 30s 轮询 GitHub Checks API，CI 失败时自动将失败日志回传给 Agent 修复并重新提交（最多 3 轮）；CI 通过或超时后停止轮询

**全局组件挂载**：`App.vue` 全局挂载 `SwarmConfirmModal`（确认弹窗）和 `SwarmToast`（Toast 通知），配合 `useConfirm` / `useToast` composables 提供命令式调用能力。

**日志分流**:
- `input` / `output` / `think` / `tool_call` / `mcp` / `tool_result` 及关键状态变更（执行完毕/已停止/Token耗尽等）通过 `agent-stream` 事件进入前端聊天面板
- `system` / `error` 技术日志（PID、命令行参数、文件变更数、内部异常等）输出到 **stderr**，由终端直接显示（带 `[Agent]`/`[Kimi]`/`[Git]` 组件前缀和颜色），不污染 UI

**Stream 事件处理**:
- `agent-stream` 推送结构化 chunk（`text` / `think` / `tool_call` / `mcp` / `tool_result`），Store 根据类型拼接或新增 `LogEntry`
- `agent-output` 事件不再写入 UI 日志（避免与 `agent-stream` 重复渲染）

**状态同步事件 (`agent-state`)**:
- Engine 通过 `agent-state` 推送 Agent 完整状态快照，Store 增量更新对应字段
- 覆盖字段：`status`、`workspace`、`branch`、`prStatus`、`prNumber`、`prUrl`、`pid`、`tokenUsed`、`lastActivity`、`reviews`、`changedFiles`
- 引擎在 `syncState()` 中按**业务字段指纹**判定（只取 status / workspace / branch / pr* / kimiSessionId / reviews / changedFiles / ciStatus；剔除 tokenUsed / lastActivity 等高频抖动字段）；指纹未变则跳过持久化，避免 stdout 流式回推每 10 行就触发一次写盘
- 指纹变化时触发 `schedulePersist()`，500ms debounce 后写 `engine-state.json`
- 前端 `persistAgents()` 仅写 slim 切片到 `tauri-plugin-store`：`id / name / repoUrl / branch / createdAt / lastActivity / tokenBudget / logs`；业务字段（status / pr* / kimiSessionId / reviews / changedFiles / tokenUsed）一律不写，由引擎 restore 推回，避免双源
- `handleEngineEvent` 中纯业务字段事件（`agent-status` / `agent-state` / `file-changed`）不再触发 `persistAgents()`，仅 logs 类事件（`log` / `agent-created` / `agent-exit` 带新日志时 / `diff-result`）才落盘

**Token 预算实时同步**:
- Agent Engine 在 `agent.ts` 中通过 `syncState()` 将 `tokenUsed` 实时回推前端，避免前端硬编码或纯随机估算
- 增量同步阈值：每处理 10 行 stdout 或每累计 500 tokens；预算耗尽时立即同步并中断进程
- Browser 降级模式（非 Tauri）下，Store 以 5s 为周期模拟 token 增长，增量基于最近 `input` 类型 log 的长度估算（从 `logs` 数组倒序查找），模拟执行完成的 output tokens 按实际内容长度计算，不再使用硬编码值

## 登录流程

`login()` 执行验证链：
1. `verifyKimiApiKey(key)` — 通过 Rust 后端验证 API Key 有效性
2. `saveApiKey(key)` — 存入 OS Keyring
3. `state.isLoggedIn = true` — 切换 UI 状态
4. `loadPersistedAgents()` — 将 `tauri-plugin-store` 中的 agents 读入 `persistedAgentsCache`（**不直接塞入 `state.agents`**），`engineReady=false`
5. `startAgentEngine()` — **先 await 注册** `agent-engine-event` / `agent-engine-exit` 监听器（Tauri `listen()` 是 Promise，fire-and-forget 会丢启动期事件），再 spawn 引擎（失败时 Toast 提示用户具体错误）
6. Engine 启动后 emit `agent-created`（基于 `engine-state.json` restore）→ Store 从 cache 取回 logs 合并到运行态；emit `engine-restored` 携带 `restoredAgentIds` → Store 把 cache 里多出来的 agent 标 `orphan` 后加入列表、置 `engineReady=true`
7. `state.isAuthLoading = false` — 结束加载态

**UI 门控（`engineReady=false` 窗口期）**：从登录/bootstrap 到收到 `engine-restored` 之间，前端禁用所有「向引擎发命令」的按钮 —— 新建 Agent（`App.vue` 顶部）、TaskCard 的启动/停止/重启/删除、AgentDetail 的启动/发送/停止。按钮 tooltip 提示「引擎启动中…」，避免命令被打到一个未装载完的引擎上引发不一致。

> **Debug 原则**：问题暴露但代码层面不明显时，优先通过 `src/utils/logger.ts` 增加运行时日志定位根因，而非盲猜。

## 架构设计转变：从命令式错误处理到工具调用式反馈循环

> 记录时间：2026-05-14
> 对应修改：`agent-engine/src/git.ts` + `agent-engine/src/agent.ts`

### 转变前（问题）

`autoSubmitForReview` 采用**命令式错误处理**：
- `gitCommit()` 失败 → `catch(err)` → 把 `err.message`（一行摘要）丢给 Kimi CLI → Agent 盲猜修复
- 结果：pre-commit `check-docs-sync` 报错时，Agent 只看到 `Error: git error: ❌ 发现 2 处文档未同步`，3 次重试均失败

根因：**Engine 做了太多智能判断**（只传错误摘要），导致 Agent 信息匮乏。

### 转变后（方案）

采用**工具调用式反馈循环**（Tool Use / MCP 模式）：
- `gitAdd()` / `gitCommit()` / `gitPush()` 返回完整结果 `{ stdout, stderr, exitCode }`
- `submitForReview()` 收集每一步的执行日志，失败时返回全部 steps
- `autoSubmitForReview()` 把完整执行日志拼成 prompt 全量回传：

```
=== git add (exit: 0) ===
[stdout] ...
=== git commit (exit: 1) ===
[stdout] 🔍 pre-commit 检查...
         1️⃣ TypeScript...✅ 通过
         4️⃣ 文档同步检测...❌ 发现 2 处未同步
[stderr] husky - pre-commit hook exited with code 1
```

Agent 基于完整上下文自主判断："类型检查过了，问题只在文档同步，我需要改 COMPONENT_PATTERNS.md 的 props 规范段"。

### 核心理念

**Engine 不做智能判断，只做信息搬运工。** 工具执行完，stdout + stderr + exit code 全量返回给 Agent，让 Agent 自己看化验单、自己开药方。这与 MCP（Model Context Protocol）的工具调用哲学一致。

### 影响范围

| 模块 | 变更 |
|------|------|
| `git.ts` | `execGitRaw()` 新增，`gitAdd/Commit/Push` 返回 `GitResult` |
| `agent.ts` | `submitForReview()` 返回 `{ ok, steps }`，`autoSubmitForReview()` 全量日志回传 |

---

## 退出登录流程

`logout()` 执行完整重置：
1. `stopAgentEngine()` — 停止 Node.js Agent 引擎进程
2. `deleteApiKey()` — 从 OS Keyring 删除 API Key
3. 重置所有 reactive state（`isLoggedIn` / `agents` / `engineConnected` / `engineReady` 等）+ `persistedAgentsCache.clear()`
4. 重置 bootstrap 标志（`bootstrapped` / `engineListenersInitialized`）
5. `window.location.reload()` — 强制页面重载，确保干净状态

> **Phase 3 之后不再清 `tauri-plugin-store` 中的 agents 切片**：引擎 `engine-state.json` 是业务字段事实源，前端 store 只缓存 slim+logs（logs 引擎不持久化）。退登清掉 = 下次登录看不到历史对话。退登只清进程/凭据/内存态，store 留着供下次登录续看。

## 实现状态速查

> 完整矩阵见 [`docs/STATUS.md`](STATUS.md)。

| 模块 | 状态 |
|------|------|
| Tauri IPC (`spawn_agent_engine`, `stop_agent_engine`, `send_to_engine` 等) | ✅ 真实 |
| GitHub API 封装 | ✅ 真实（Agent Engine 调用 GitHub REST API） |
| 审阅门控逻辑 | ✅ 真实 |
| 文件 diff 查看 (`getFileDiff` → engine → `git diff`) | ✅ 真实 |
| Kimi CLI 接入 (`detectKimiCli` + `spawn_process` + `agent-stream` 实时事件) | ✅ 真实 |
| 统一日志 (`src/utils/logger.ts`) | ✅ 已接入 Store，替代散落 console |

## 引擎目录探测与启动（开发/生产兼容性）

Rust `spawn_agent_engine()` 需要找到 `agent-engine` 目录并启动 Node.js 进程。

### 目录探测

`tauri.conf.json` 通过 `bundle.resources` 将 `agent-engine` 打包进安装包，安装后位于 `resource_dir()/agent-engine`。

| 优先级 | 路径 | 适用场景 |
|--------|------|---------|
| 1 | `app_local_data_dir` 上两级 | Tauri Dev 调试模式 |
| 2 | `../agent-engine`（CWD 相对） | `cargo run` 从 `src-tauri/` 启动 |
| 3 | `resource_dir()/agent-engine` | **生产环境（Tauri bundle 安装后）** |
| 4 | `current_exe().parent()/agent-engine` | 便携版/绿色版 |
| 5 | `app_local_data_dir/agent-engine` | 最终 fallback |

### 启动方式

| 环境 | 启动命令 | 说明 |
|------|---------|------|
| 生产 | `node dist/index.js` | `tsc` 预编译，无需 tsx 运行时 |
| 开发 | `node node_modules/tsx/dist/cli.mjs src/index.ts` | tsx 现场转译，方便迭代 |

> 生产用的 `dist/` 由打包自动生成：`tauri.conf.json` 的 `beforeBuildCommand` 串联了 `npm run build:engine`（即 `tsc`），且 `agent-engine/tsconfig.json` 开启 `noEmitOnError` —— 类型错误会直接中断打包，而非漏进 `dist/`。CI（`npm run ci`）通过 `typecheck:engine` 单独校验 agent-engine。

### Node.js 路径探测

Windows 上 nvm-windows 不写入系统 PATH，GUI 进程继承不到。`find_node_exe()` 主动探测：
1. 常见安装路径（`C:
vm4w
odejs
ode.exe` 等）
2. 系统 PATH 搜索
3. `where node` 兜底
4. fallback 到 `"node"`

**教训**：
- 不要用硬编码的相对路径 `'agent-engine'`。Tauri Dev 模式下 `cargo run` 的 CWD 是 `src-tauri/`，`agent-engine` 会指向 `src-tauri/agent-engine`（不存在），必须用 `../agent-engine`。
- 生产环境必须通过 `bundle.resources` 把 agent-engine 打进安装包，否则安装后找不到目录。
- 开发时隐式依赖（如 zod 通过父级 `node_modules` 解析）会在打包后暴露，所有依赖必须显式声明在 `package.json` 中。
- `agent-engine` 是独立子包，有自己的 `tsconfig.json`；根目录的 `typecheck`/`lint`/`build` **不覆盖**它。CI 必须显式 `typecheck:engine`、打包必须显式 `build:engine`，否则 agent-engine 的类型错误会静默漏过（曾发生过半删变量导致编译失败却被 CI 放行）。

## TypeScript 执行方案

Agent Engine 用 TypeScript 编写，Rust 直接启动：

- ❌ `node --experimental-strip-types` — Windows ESM 下 `.js`→`.ts` 映射失败
- ✅ `npx tsx src/index.ts` — esbuild 驱动，seamless 映射，开发体验最佳（开发环境）
- ✅ `node dist/index.js` — `tsc` 预编译产物，无 tsx 运行时依赖（生产环境）

## E2E 测试架构

Playwright 通过 WebView2 CDP（`--remote-debugging-port=9222`）连接 Tauri 窗口：
- 仅验证前端 DOM 交互（登录 → 创建 Agent → Dashboard 验证）
- 不覆盖 Rust IPC、Agent Engine 进程、Git 操作等后端逻辑
- 后端集成测试 ✅ 已实现（AgentEngine 完整生命周期 9 个测试全部通过，见 `docs/STATUS.md`）
