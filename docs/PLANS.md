# PLANS

> 执行计划索引。Agent 开始复杂工作前，先读活跃计划。

## 活跃计划

当前无活跃中的 P0/P1 计划。核心功能均已实现，进入迭代优化阶段。

| 计划 | 状态 | 文档 |
|------|------|------|
| P1: 仓库一致性检查器 | ✅ 已实现 | `scripts/health-check.ts` |

## 已完成

| 计划 | 完成时间 | 关键交付 |
|------|---------|---------|
| P0: Vue 前端原型 | 2026-04-29 | Dashboard + AgentDetail + 登录页 |
| P0: AST 分析器 + CI 流水线 | 2026-04-29 | 5 套规则 + pre-commit + GitHub Actions |
| P0: 任务系统与 CLI 接入 | 2026-05-12 | Agent Engine (tsx) + Kimi CLI + Git 自动化 + Zod 验证 |
| P1: evals/ 回归测试 | 2026-05-12 | bug-fix/new-task 流程评估 + Git 历史分析器 |
| P1: ESLint 模块边界规则 | 2026-05-12 | `no-process-in-frontend` 自定义规则 |
| P1: 运行时边界验证 | 2026-05-12 | Zod schema + engine.ts 入口 safeParse |
| P1: 测试同步硬约束 | 2026-05-12 | `check-test-sync.ts` + PR CI 阻断 |

## 定期检查机制（仓库一致性检查器）

> 信息供给型工具，定期运行，不阻断流程。Agent 结合上下文自主判断是否需要处理。
> 命令：`npm run health-check`

### 设计定位

与 `check-docs-sync.ts`（机械硬约束）分工不同：

| | `check-docs-sync.ts` | `health-check.ts` |
|--|----------------------|-------------------|
| 频率 | 每次 git commit / CI | 定期运行 |
| 强度 | 硬约束，不可绕过 | 信息供给，Agent 自主判断 |
| 精确度 | 100% 精确（glob 匹配） | 高层次概览即可 |
| 代价 | 代码复杂 | 消耗 token，代码极简 |

### 当前检查项（已实现）

| 检查项 | 说明 | 信息来源 |
|--------|------|---------|
| **doc-map 规则有效性** | 规则引用的文档是否实际存在 | `docs/doc-map.json` |
| **文档引用完整性** | docs/ 中的链接是否指向存在的文件 | `docs/**/*.md` |
| **覆盖概览** | 仓库根级目录是否在 doc-map 中体现（高层次） | 根级目录 vs doc-map 规则 |

### 未来扩展检查项（待实现）

| 检查项 | 说明 | 优先级 |
|--------|------|--------|
| **Harness 模板漂移** | harness/*.yaml 中的步骤是否与实际执行一致 | P2 |
| **AST 规则失效** | ast/rules/ 中的规则是否覆盖了当前代码库实际结构 | P2 |
| **文档过时** | AGENTS.md 中的目录结构描述是否与实际一致 | P2 |
| **质量等级扫描** | 代码复杂度趋势、重复模式检测 | P2 |

### 设计原则

- **只读检查**：不自动修改任何文件，只输出问题列表
- **有限入口**：只从 AGENTS.md、docs/、harness/ 等明确的信息源读取，不猜测
- **可配置忽略**：允许标记预期内的例外（如 `evals/` 当前为空是已知状态）

### 现状

MVP 已实现（`scripts/health-check.ts`）。当前覆盖 doc-map 有效性、文档链接、覆盖概览三层检查。
未来扩展项按优先级逐步填充。

## 技术债务

| 债务 | 优先级 | 影响 | 计划解决 |
|------|--------|------|---------|
| AST fixers 自动修复 | ✅ | `ast/fixers/error-handling.ts` 已实现 `--fix` 模式（自动注入 `log.error`）；其他规则 fixer 待补充 | 长期迭代 |
| Token 趋势图表 | P1 | 监控不完整 | 接入图表库后 |
| `scripts/cleanup.ts` 循环清理 | P2 | 熵管理逻辑未实现；质量等级扫描 | AST dead-code 已覆盖核心需求，降级为 P2 |
| health-check 扩展检查项 | P2 | 模板漂移、文档过时等 | 长期迭代 |
| PR Workflow 架构边界重构 | P1 | PR 创建 / CI / 审阅 / 修复 / 合并逻辑散落在 Agent、Engine、Store 和 GitHub API 中，导致自动/手动路径、real/mock 模式和多事实源交织 | 见 `docs/design-docs/pr-workflow-architecture-issues.md` |
| pre-commit hook Windows 兼容 | ✅ | 已添加 `ci/hooks/pre-commit.cmd` | — |
| AST Parser 迁移（正则 → ESTree） | P2 | 正则无法区分代码/字符串/注释，新语法变体需持续打补丁 | 触发条件：新语法变体再次导致约束失效 |
| Windows 路径兼容性测试 | P2 | 目前只在单台 Windows 机器验证 | 增加 CI 矩阵或多机测试 |
