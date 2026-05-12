# Kimi-Code-Swarm

> **本地 Agent 指挥中心 App**。指挥官通过 UI 派任务、监进度、审 PR。  
> 本文档是**地图**，不是手册。Agent 每次启动先读这张地图，细节按需去 `docs/` 加载。

---

## 项目定位

> **这不是一个商业产品，而是一个 Harness Engineering 的实践场。**
>
> 本项目遵循 Harness Engineering 原则搭建（约束即代码、机械化检查、文档单一事实源、熵管理），
> 但它**产出的软件并不自动具备 Harness Engineering 的 infra**——使用者仍需自己去造。
>
> 因此最大的价值不是"做出了一个多 Agent 调度工具"，而是**在构建它的过程中实践和验证 Harness Engineering 的方法论**。
> 开源的目的，是共享这套实践路径，而非售卖一个开箱即用的产品。

---

## 🧭 我想…

| 我想… | 去这里 |
|-------|--------|
| 理解系统设计哲学 | [`docs/DESIGN.md`](docs/DESIGN.md) |
| 了解系统架构 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| 了解产品规格 | [`docs/product-specs/index.md`](docs/product-specs/index.md) |
| 写前端代码 | [`docs/FRONTEND.md`](docs/FRONTEND.md) |
| 接入 CLI 进程 | [`docs/CLI_HARNESS.md`](docs/CLI_HARNESS.md) |
| 组件规范 | [`docs/COMPONENT_PATTERNS.md`](docs/COMPONENT_PATTERNS.md) |
| Token 监控设计 | [`docs/TOKEN_MONITORING.md`](docs/TOKEN_MONITORING.md) |
| 可观测性 | [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) |
| 查看执行计划 | [`docs/PLANS.md`](docs/PLANS.md) |
| 检查代码 AST 结构 | `ast/analyzer.ts` |
| 使用工作流模板 | `harness/*.yaml` |
| 运行清理脚本 | `scripts/cleanup.ts` |
| 查看约束体系 | [`docs/CONSTRAINTS.md`](docs/CONSTRAINTS.md) |
| **查看功能实现状态** | **[`docs/STATUS.md`](docs/STATUS.md)** |
| 跑 CI 流水线 | `npm run ci` |
| 检查文档同步 | `npm run check-docs` |

---

## ⚡ 黄金原则

1. **地图即边界** —— Agent 只读 `AGENTS.md`，细节去 `docs/` 按需加载
2. **机械化约束优先** —— 代码必须过 CI：类型 → Linter → **AST** → 构建
3. **仓库是唯一事实源** —— Slack/口头约定对 Agent 等于不存在
4. **执行即更新文档** —— **每次代码变更后，必须同步更新相关文档**。被 check-docs 阻断时，回顾本次会话查阅过的文档并更新；不确定关联文档时，回到 AGENTS.md 地图重新定位。代码和文档不一致是 Harness 退化。
5. **功能状态必须披露** —— 任何功能实现后，必须在 [`docs/STATUS.md`](docs/STATUS.md) 中标记其真实状态（✅ 真实 / ⚡ 双模式 / 🚧 框架 / ❌ 未实现）。Agent 遗忘上下文时，STATUS.md 是第一恢复点。
6. **约束即代码** —— 所有规则必须机械可执行。不能自动检查的约定等于不存在。详见 [`docs/CONSTRAINTS.md`](docs/CONSTRAINTS.md)。
7. **反复 bug → 日志 → 留痕** —— 同一个代码层面的 bug 反复出现时，必须先增加日志（`src/utils/logger.ts`）定位根因；修复后必须在代码注释或 commit 中记录根因。盲修同一 bug 是效率灾难。
8. **代码改动必验证** —— 任何 Agent 对代码的修改，改完后必须实际 build、启动 app、运行测试、过 lint/analyze，全部通过后才允许开 PR 合入 main。纯文档/配置改动除外。未验证的代码不得合入。
9. **代码不明显 → 加日志** —— 问题已暴露但代码层面看不出根因时，禁止在黑暗中盲猜。必须立即增加日志（`src/utils/logger.ts`）把运行时状态打出来，用数据定位问题。这是最高效的 debug 方法，也是保证效率的最后防线。

---

## 🗺️ 目录结构

```
Kimi-Code-Swarm/
├── AGENTS.md              ← 🗺️ 地图（~40行）
├── README.md              ← 人类友好的项目介绍
├── .gitignore
│
├── docs/                  ← 📚 知识库（Agent 按需加载）
│   ├── DESIGN.md            顶层设计 + Harness 五层架构
│   ├── ARCHITECTURE.md      系统架构、数据流、状态分层
│   ├── FRONTEND.md          前端编码规范 + 命令
│   ├── CLI_HARNESS.md       CLI 进程接入设计
│   ├── COMPONENT_PATTERNS.md Vue 组件规范
│   ├── TOKEN_MONITORING.md  Token 监控设计
│   ├── OBSERVABILITY.md     可观测性三层设计
│   ├── PLANS.md             执行计划索引
│   ├── design-docs/         设计决策记录
│   ├── exec-plans/          活跃/已完成计划 + 技术债务
│   ├── product-specs/       产品规格
│   └── index.md             本地 Agent 指挥中心 App 规格
│   └── references/          外部参考资料
│
├── ast/                   ← 🔧 AST 结构约束代码
│   ├── analyzer.ts          分析器入口
│   ├── rules/               规则定义
│   └── fixers/              自动修复器
│
├── ci/                    ← ✅ CI 约束配置
│   ├── hooks/               git hooks（提交前自动检查）
│   ├── lint-rules/          自定义 ESLint 规则（未来扩展）
│   └── scripts/             CI 辅助脚本（文档同步检查等）
├── evals/                 ← 📊 评估用例（预留）
│
├── scripts/               ← 🤖 自动化脚本
│   └── cleanup.ts           熵管理清理脚本
│
├── harness/               ← 📋 工作流模板
│   ├── new-instance.yaml    新建 Agent 模板（v2.0 Agent Engine 架构）
│   ├── bug-fix.yaml         修复 Bug 模板
│   └── new-task.yaml        新建任务模板（指挥官派任务）
│
└── kimi-code-swarm/       ← 💻 前端应用（Vue3 + Vite + Tailwind）
    ├── src/
    │   ├── types/
    │   ├── store/
    │   ├── components/
    │   ├── skills/
    │   ├── App.vue
    │   └── main.ts
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.js
    └── package.json
```

---

## 🏗️ Harness 五层映射

| 层 | 知识文档 | 代码/配置 |
|--|----------|----------|
| L1 Context | `AGENTS.md` + `docs/` | — |
| L2 Constraints | `docs/DESIGN.md` + `docs/CONSTRAINTS.md` | `ast/`, `ci/` |
| L3 Observability | `docs/OBSERVABILITY.md` | UI 面板 |
| L4 Entropy Mgmt | `docs/DESIGN.md` | `scripts/cleanup.ts` |
| L5 Source of Truth | 仓库即唯一知识源 | — |

---

## 🚀 快速启动

### 前置条件

- **Node.js 22+**
- **Git**
- **Kimi CLI**：`py -3.12 -m pip install kimi-cli`
- **Kimi API Key**：[kimi.com/code/console](https://www.kimi.com/code/console)

### 启动

```bash
cd kimi-code-swarm
npm install          # 自动配置 Git hooks
npm run dev          # localhost:5173（浏览器模式）
```

首次打开 App 后在登录页输入 API Key（所有 Agent 共享同一个 Key），验证通过后存入系统 Keyring。

---

*Map version: 2026-04-29*
