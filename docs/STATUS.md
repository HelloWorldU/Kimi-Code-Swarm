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
| Kimi API Key 登录 | ✅ | keyring 安全存储，/v1/models 验证，退出登录清除 | `src/components/LoginView.vue`, `src/api/ipc.ts`, `src-tauri/src/lib.rs` |
| Agent 管理（最多5个） | ✅ | Dashboard 卡片网格，数量限制，点击进详情页 | `src/components/AgentDashboard.vue`, `src/components/AgentDetail.vue`, `src/App.vue` |
| Agent 状态持久化 | ✅ | tauri-plugin-store 自动保存/恢复 Agent 列表 | `src/store/useSwarmStore.ts` |
| Git 自动化（clone/checkout/commit/push） | ✅ | Tauri 环境通过 IPC 执行真实 git | `src/api/ipc.ts` |
| GitHub API（PR 创建/合并/查询） | ⚡ | 配置 Token 后走真实 API；否则 Mock | `src/api/github.ts` |
| 全员审阅门控 | ⚡ | 逻辑真实；Mock 模式 3 秒自动通过 | `src/store/useSwarmStore.ts` |
| Kimi CLI 接入 | ✅ | `sendInstruction` 调用 `kimi --print --quiet`，实时 stdout 流式捕获，可取消 | `src/store/useSwarmStore.ts` |
| Token 预算控制 | ✅ | sendInstruction 前检查预算；process-output 中按输出行长度估算并累加；耗尽时自动 kill 进程 | `src/store/useSwarmStore.ts` |

## 质量约束

| 功能模块 | 状态 | 说明 | 关键文件 |
|----------|------|------|----------|
| AST 结构分析器 | ✅ | 3 套规则，CI 强制运行 | `ast/analyzer.ts` |
| 文档同步检测 | ✅ | pre-commit 硬约束 | `ci/scripts/check-docs-sync.ts` |
| 定期健康检查 | ✅ | 信息供给型，不阻断 | `scripts/health-check.ts` |

## 测试与评估

| 功能模块 | 状态 | 说明 | 关键文件 |
|----------|------|------|----------|
| `evals/` 回归测试 | ❌ | 目录存在，用例待填充 | `evals/` |
| `tests/` 单元测试 | ⚡ | 前端测试已接入 Vitest（7 个通过）；项目级测试待填充 | `tests/` |
| 文件变更展示 | ✅ | `git diff --name-only` 自动检测，点击文件查看 diff | `src/components/TaskDetail.vue` |
| 监控分析页 | ✅ | 任务状态分布、Token 消耗排行、活跃任务、审阅队列 | `src/components/AnalyticsPanel.vue` |
| E2E 测试 | ❌ | Playwright 预留，v0.3 引入 | `tests/e2e/` |

---

*Last updated: 2026-05-04*
