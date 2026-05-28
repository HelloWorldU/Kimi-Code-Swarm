# STATUS

> **功能实现状态单一事实源**。Agent 每次启动或遗忘上下文时，先查此表。  
> 任何功能实现状态变更（从 Mock 到真实、从预留到实现、从实现到废弃），必须同步更新此文档。

---

## 图例

| 符号 | 含义 |
|------|------|
| ✅ | 真实实现 — 代码已写，可运行，非模拟 |
| ⚡ | 双模式 — 有真实路径，但依赖外部配置（如 Token）；未配置时降级为 Mock |
| 🚧 | 框架/占位 — 目录或接口已建，核心逻辑待填充 |
| ❌ | 未实现 — 仅存在于规格或 TODO 中 |

---

## 核心功能

| 功能模块 | 状态 | 说明 | 关键文件 |
|----------|------|------|----------|
| Vue 前端 Dashboard | ✅ | 浏览器可完整运行 | `kimi-code-swarm/src/` |
| Tauri v2 桌面壳 | ✅ | Rust IPC 命令已实现 | `src-tauri/src/lib.rs` |
| 快速启动文档 | ✅ | README/AGENTS/FRONTEND 均包含前置条件、依赖版本、API Key 获取方式 | `README.md`, `AGENTS.md`, `docs/FRONTEND.md` |
| Kimi API Key 登录 | ✅ | keyring 安全存储，Kimi CLI 存在性验证（拒绝 fallback），退出登录完整重置（停引擎+删key+清store+reload） | `src/components/LoginView.vue`, `src/api/ipc.ts`, `src-tauri/src/lib.rs`, `src/store/useSwarmStore.ts` |
| Agent 管理（最多5个，五角色固定） | ✅ | Dashboard 卡片网格，数量限制，点击进详情页；五角色分工：UI/Core/Docs/Review/Tools | `src/components/AgentDashboard.vue`, `src/components/AgentDetail.vue`, `src/App.vue`, `docs/ARCHITECTURE.md` |
| Agent 状态持久化 | ✅ | tauri-plugin-store 自动保存/恢复 Agent 列表 | `src/store/useSwarmStore.ts` |
| Git 自动化（clone/checkout/commit/push） | ✅ | Tauri 环境通过 IPC 执行真实 git | `src/api/ipc.ts` |
| GitHub API（PR 创建/合并/查询） | ✅ | 配置 GitHub Token 后 Agent Engine 调用真实 GitHub REST API；无 Token 降级为 Mock | `agent-engine/src/github-api.ts` |
| 全员审阅门控 | 🚧 | PR 创建 + CI 监控 + 审阅结果处理（approve/reject/fix）已实现；**reviewer 自动指派和触发在手动提交审阅时工作，但在 Agent 自动流程（`sendInstruction` → `autoSubmitForReview`）中缺失** —— `agent.ts` 内部 `submitForReview` 未调用 `assignReviewers`，也未触发 `performReview`，导致自动执行完指令后没有 reviewer 介入。详见 [`docs/PR_WORKFLOW.md`](PR_WORKFLOW.md) | `src/store/useSwarmStore.ts`, `agent-engine/src/agent.ts`, `agent-engine/src/engine.ts`, `docs/PR_WORKFLOW.md` |
| Agent Engine 进程管理 | ✅ | Rust 后台 spawn Node.js Agent Engine，stdin/stdout 管道通信；生产环境用预编译 `dist/index.js`，开发环境 fallback 到 tsx；Windows 主动探测 `node.exe` 路径（nvm-windows 兼容） | `src-tauri/src/lib.rs`, `agent-engine/src/index.ts` |
| Kimi CLI 接入 | ✅ | `sendInstruction` 调用 `kimi --print --quiet`，实时 stdout 流式捕获，可取消 | `src/store/useSwarmStore.ts` |
| Token 预算控制 | ✅ | sendInstruction 前检查预算；process-output 中按输出行长度估算并累加；耗尽时自动 kill 进程 | `src/store/useSwarmStore.ts` |
| Agent 多轮对话交互 | ✅ | 聊天式气泡 UI，支持 input/output/system/error 消息类型；ready/stopped/completed 状态下可持续对话；working 状态显示执行中指示器；**日志已分流**（system/error 技术日志带组件前缀+颜色走终端 stderr，input/output 及关键状态变更进 UI）；**stop-agent 已修复**（前端乐观更新 + await IPC）；**滚动到底部按钮**（用户上滚后显示浮动下箭头，点击平滑滚回底部） | `src/components/AgentDetail.vue`, `src/store/useSwarmStore.ts`, `agent-engine/src/agent.ts` |
| Agent 自动提交审阅 | ✅ | Agent 执行完指令后检测到文件变更自动 `git add/commit/push` 并创建 PR；pre-commit 失败时将完整执行日志全量回传修复（最多 3 轮）；PR 创建后自动轮询 GitHub Actions CI（30s 间隔），CI 失败时自动获取日志并修复重新提交（最多 3 轮）；**Kimi CLI 自动修复设 120s 超时保护**；无 GitHub Token 时降级为 Mock PR | `agent-engine/src/agent.ts` |

## 质量约束

| 功能模块 | 状态 | 说明 | 关键文件 |
|----------|------|------|----------|
| AST 结构分析器 | ✅ | 5 套规则（error-handling/vue-structure/import-restrictions/style-constraints/dead-code），CI 强制运行；error-handling 经 4 轮补丁修复后覆盖 catch { / this.log('error') / 字符串注释过滤 | `ast/analyzer.ts` |
| 文档同步检测 | ✅ | pre-commit 硬约束 | `ci/scripts/check-docs-sync.ts` |
| 定期健康检查 | ✅ | 信息供给型，不阻断 | `scripts/health-check.ts` |
| Dead Code 检测 | ✅ | ESLint 模块内 + AST 分析器跨模块（孤立文件/未使用导出） | `ast/rules/dead-code.ts`, `eslint.config.mjs` |
| 可观测性 | ⚡ | Metrics/Logs 已就绪；Traces 待实现；Token 趋势图/负载热力图/错误率告警待接入 | `src/components/AnalyticsPanel.vue` |

## 测试与评估

| 功能模块 | 状态 | 说明 | 关键文件 |
|----------|------|------|----------|
| `tests/` 单元测试 | ✅ | 前端 Vitest（25 个通过）；测试同步硬约束已接入 CI | `tests/unit/`, `tests/integration/` |
| 测试同步硬约束 | ✅ | PR CI 阻断：`src/` 新增代码 → `tests/` 必须有对应更新 | `ci/scripts/check-test-sync.ts` |
| `evals/` 回归测试 | ✅ | bug-fix / new-task 流程评估：分支规范、根因留痕、测试覆盖、文档同步 | `evals/bug-fix.eval.ts`, `evals/new-task.eval.ts` |
| ESLint 模块边界规则 | ✅ | 自定义规则 `no-process-in-frontend`，禁止 `kimi-code-swarm/src/` 直接 spawn 进程 | `ci/lint-rules/no-process-in-frontend.js` |
| Zod 运行时验证 | ✅ | EngineCommand / AgentState / EngineEvent schema，engine.ts 入口安全解析 | `agent-engine/src/schemas.ts` |
| 文件变更展示 | ✅ | `git diff --name-only` 自动检测；点击文件通过 engine 获取真实 diff（Tauri）或 mock diff（浏览器） | `src/components/AgentDetail.vue`, `agent-engine/src/git.ts` |
| 监控分析页 | ✅ | 任务状态分布、Token 消耗排行、活跃任务、审阅队列 | `src/components/AnalyticsPanel.vue` |
| E2E 测试 | ⚡ | Playwright smoke 测试已可运行：登录 → 创建 Agent → 验证 Dashboard；浏览器 Mock 模式（无需 Tauri 后端），Rust IPC / Engine 进程 / Git 真实路径仍需集成测试覆盖 | `tests/e2e/smoke.spec.ts` |
| 后端集成测试 | ✅ | AgentEngine 完整生命周期（create/start/stop/instruct/review/merge/delete/ping/diff/error）9 个测试全部通过；降级行为已验证 | `tests/integration/engine.spec.ts` |
| 生产构建验证 | 🚧 | 已打通：resources 打包 + node.exe 探测 + dist 预编译 + 依赖补全；尚未接入 CI 自动化验证 | `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs` |
| 平台兼容性 | ⚡ | **Windows 为主**。Rust 进程管理含 Windows-only 分支（`CREATE_NO_WINDOW`、`taskkill`、硬编码 nvm 路径、cmd /c fallback）；macOS/Linux 待适配 | `src-tauri/src/lib.rs` |

---

*Last updated: 2026-05-28*
