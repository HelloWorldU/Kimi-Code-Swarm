# DESIGN

> Kimi-Code-Swarm 的顶层设计。

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

> 好的产品让你能做事。好的 Harness 让你能放心地让 Agent 做事。
> 但首先，你需要一个 Harness 来构建那个 Harness。

## 五层 Harness 架构

| 层 | 目录 | 职责 | 当前状态 |
|--|------|------|---------|
| L1 Context | `AGENTS.md` + `docs/` | 上下文分层，按需加载 | ✅ 完整 |
| L2 Constraints | `docs/CONSTRAINTS.md` + `ci/` + `ast/` | 机械化约束（类型/Linter/AST/文档同步/测试/Dead Code 检测，报错地图式自定位） | ✅ CI 流水线 + pre-commit hook（npm install 自动配置）：typecheck → lint → analyze → check-docs → test → build |
| L2.5 Shell | `src-tauri/` | Tauri v2 桌面壳层：Rust 主进程 + Vue 渲染进程 | ✅ IPC 命令已就绪（git / spawn / kill / keyring / store） |
| L3 Observability | `docs/OBSERVABILITY.md` + UI 面板 | 实时监控 + 质量等级 | ✅ UI 面板已就绪 |
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

- **与 CI 约束的分工**：CI（`npm run ci`）验证代码质量（编译/Linter/AST/测试/构建），harness 定义 Agent 执行任务的**步骤顺序和关键决策点**
- **与硬约束的关系**：harness 是"软性约束"的载体，Agent 按需阅读参考。关键步骤通过扩展 CI 脚本逐步硬化：
  - `new-task.yaml` 的 build/test/lint 步骤 → 已被 CI 流水线覆盖
  - `bug-fix.yaml` 的 instrument（加日志）→ 由 AST `error-handling` 规则硬化
  - `bug-fix.yaml` 的 document（留痕）→ 由 `check-docs-sync` 扩展硬化
- **当前状态**：流程约束与代码约束互补，共同构成 Harness Engineering 的完整约束体系

## 关键决策记录

1. **Vue 而不是 React**：reactive() 对高频日志流更友好
2. **先 Web 后桌面**：先验证 UI 交互，再套 Electron/Tauri 壳
3. **Global Composable 而不是 Pinia**：当前复杂度足够，跨窗口时迁移
