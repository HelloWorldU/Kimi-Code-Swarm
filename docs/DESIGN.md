# DESIGN

> Kimi-Code-Swarm 的顶层设计。

## 核心信念

1. **Agent = Model + Harness**。模型决定天花板，Harness 决定能否摸到天花板。
2. **地图即边界**。AGENTS.md 只当目录，细节去 docs/ 按需加载。
3. **约束即教学**。报错必须附带修复方法。
4. **仓库即事实源**。Slack 对 Agent 等于不存在。

## 核心公式

```
开发效率 = f(指挥官决策, N × Agent 并发, Harness 约束)
```

> 不是"单个 Agent 多强"，而是"指挥官能同时调度多少个 Agent 不混乱"。

## 价值定位

**本项目是 Harness Engineering 的实践场，不是商业产品。**

系统本身遵循 Harness Engineering 原则构建（约束即代码、机械化检查、文档单一事实源、熵管理循环），
但值得注意的是：系统**产出的软件并不自动继承这些 infra**。一个用本系统写出来的项目，仍然需要
自己去搭建 AST 规则、CI 流水线、文档同步检测、健康检查等 Harness 层。

因此，本项目的最大价值不在于"做出了一个多 Agent 调度工具"，而在于：

1. **实践 Harness Engineering 的完整方法论** — 从约束设计到机械化执行到熵管理
2. **验证"指挥官 + N Agent + Harness"模式的可行性** — 在真实开发场景中跑通
3. **开源共享实践路径** — 让其他团队参考这套搭建方式，而非直接依赖本工具

> **核心回路**：**实践发现问题 → 抽象定义 → 解决问题**。功能缺陷不是麻烦，而是验证方法论的燃料。每一次 bug、每一次文档不一致、每一次生产环境意外，都是完善 Harness 的机会。

> 好的产品让你能做事。好的 Harness 让你能放心地让 Agent 做事。
> 但首先，你需要一个 Harness 来构建那个 Harness。

## 五层 Harness 架构

| 层 | 目录 | 职责 | 当前状态 |
|--|------|------|---------|
| L1 Context | `AGENTS.md` + `docs/` | 上下文分层，按需加载 | ✅ 完整 |
| L2 Constraints | `docs/CONSTRAINTS.md` + `ci/` + `ast/` | 机械化约束（类型/Linter/自定义 ESLint 规则/AST/文档同步/测试/Dead Code 检测，报错地图式自定位） | ✅ CI 流水线 + pre-commit hook（npm install 自动配置）：typecheck → typecheck:engine → lint → analyze → test → check-docs → check-test → build |
| L2.5 Shell | `src-tauri/` | Tauri v2 桌面壳层：Rust 主进程（唯一有权 spawn 进程） | ✅ IPC 命令已就绪（git / spawn / kill / keyring / store） |
| L3 Observability | UI 面板 + 染色日志 | Metrics(✅ Token/实例) / Logs(✅ 染色流) / Traces(⏳ 待实现) | ✅ UI 面板已就绪 |
| L4 Entropy Mgmt | `scripts/cleanup.ts` + `scripts/health-check.ts` | 循环清理 + 定期一致性检查（信息供给型） | ✅ health-check 已实现 |
| L5 Source of Truth | 仓库即唯一知识源 | 所有决策写入文件 | ✅ 文档与代码同步更新 |

## 产品形态

**本地 Agent 指挥中心 App**。详见 [`product-specs/index.md`](product-specs/index.md)。

指挥官通过点击操作完成：新建任务 → 自动 clone → 启动 CLI → 下达指令 → 监控进度 → 审阅 PR → 合并。

## 约束体系

详见 [`CONSTRAINTS.md`](CONSTRAINTS.md)。核心设计哲学：

> **好的 Skill 让你能做事。好的系统让你能放心地让 Agent 做事。**

受 OpenAI 经验启发：
- **共享实用程序包优先** — 将不变式集中管理，减少重复造轮子
- **禁止 YOLO 式数据探测** — 验证边界或依赖类型化 SDK，禁止基于猜测构建
- **约束即代码** — 所有规则必须机械可执行
- **循环清理** — 定期自动化扫描偏差、更新质量等级、发起重构 PR
- **反复 bug 必须留痕** — 同一 bug 反复出现时遵循 `harness/bug-fix.yaml`：诊断 → 隔离 → **日志插桩** → 修复 → 验证 → **留痕**。盲修等于没修
- **代码改动必验证** — 任何 Agent 代码变更遵循 `harness/new-task.yaml`：build → start → test → lint/analyze → PR → 审阅 → 合并。未验证代码禁止合入 main

## Harness 目录定位

`harness/*.yaml` 是**流程约束模板**，不是可执行代码。

当前包含四个模板：
- **`harness/new-instance.yaml`**：新建 Agent 的完整流程（收集信息 → 创建 Agent → 启动 Engine → 多轮对话 → **自动提交审阅** → **自动合并**）
- **`harness/new-task.yaml`**：指挥官向已有 Agent 派发新任务的流程
- **`harness/bug-fix.yaml`**：修复 Bug 的诊断-隔离-修复-验证-留痕流程
- **`harness/auto-test.yaml`**：自动化测试验证流程

### 约束分层哲学

| 层级 | 抽象程度 | 自由度 | 示例 |
|------|---------|--------|------|
| **Must**（红线） | 高 | 0% | "禁止盲修"、"未验证代码不得合入 main" |
| **Must-Not**（禁令） | 高 | 0% | "禁止吞没错误"、"禁止跳过审阅" |
| **Reference**（参考） | 低 | 100% | "可用 Logger"、"建议读 20 条日志" |

**核心原则**：工程师只定义方向和红线（Must/Must-Not），具体执行细节（Reference）交给 Agent 自由发挥。过度具体的约束会导致 Agent 漂移——Agent 会机械执行步骤而忽略真实目标，或在步骤间自动补全不符合设想的细节。

### 与 CI 约束的分工

- **CI（`npm run ci`）**：验证代码质量（编译/Linter/AST/测试/构建）—— 这些是机械可执行的硬约束
- **harness**：定义 Agent 执行任务的**方向、红线和参考建议**—— 高抽象层的软性约束
- **硬化路径**：只有 Must/Must-Not 中的关键节点才会被逐步编码到 CI/AST 中。Reference 层永远保持软性
- **AST 扫描范围**：`analyze` 同时扫描 `src/` 和 `tests/`，`tests/` 目录排除孤立文件检测（测试文件不被视为 dead code）

### 当前硬化状态

| harness 准则 | 硬化方式 | 状态 |
|-------------|---------|------|
| bug-fix: 禁止吞没错误 | AST `error-handling/empty-catch` + fixer 自动修复 | ✅ 硬约束 |
| bug-fix: 鼓励留痕 | AST `error-handling/missing-logger` (warn) + check-docs-sync（要求 docs/ 变更） | ⚡ 半硬（warn + 分支检查）；check-docs-sync 与 check-test-sync 脚本内部错误均记录 console.error，禁止静默失败 |
| new-task: 未验证代码禁止合入 | CI 流水线 + PR 门控 | ✅ 硬约束 |
| new-task: 审阅通过才能合并 | PR review 机制 | ⚡ 半硬（Mock 模式可跳过） |
| new-instance: Agent 生命周期 | Agent Engine IPC + 状态机驱动 | ✅ 硬约束（Engine 统一托管，禁止前端直接 spawn CLI） |
| auto-test: E2E 验证 | Playwright + Chromium + Vite dev server（Mock 模式） | ✅ 硬约束（UI 改动后必须跑通 smoke test） |

> **技术债务**: AST 分析器当前基于正则实现，已暴露系统性缺陷（无法区分代码/字符串/注释、语法变体需持续打补丁）。长期应迁移至 TypeScript ESTree AST Parser。详见 `docs/design-docs/ast-parser-vs-regex.md`。当前约束分层：empty-catch 为 error（阻断），missing-logger 为 warn（不阻断）；非关键路径允许用 `// expected: ...` 意图注释替代日志，关键路径（外部调用/状态变更）仍必须有 log.error。

## 关键决策记录

1. **Vue 而不是 React**：reactive() 对高频日志流更友好
2. **先 Web 后桌面**：先验证 UI 交互，再套 Electron/Tauri 壳
3. **Markdown 渲染 instead of 纯文本**：Agent 回复常含代码块、列表等结构化内容，引入 `marked` + `highlight.js` + `DOMPurify` 做安全 Markdown 渲染，比纯文本可读性大幅提升
4. **Global Composable 而不是 Pinia**：当前复杂度足够，跨窗口时迁移
