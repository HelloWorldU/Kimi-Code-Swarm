# Kimi-Code-Swarm

> Agent = Model + Harness.  
> 本文档是**地图**，不是手册。Agent 每次启动先读这张地图，细节按需去 `docs/` 加载。

---

## 🧭 我想…

| 我想… | 去这里 |
|-------|--------|
| 理解系统设计哲学 | [`docs/DESIGN.md`](docs/DESIGN.md) |
| 了解系统架构 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| 写前端代码 | [`docs/FRONTEND.md`](docs/FRONTEND.md) |
| 接入 CLI 进程 | [`docs/CLI_HARNESS.md`](docs/CLI_HARNESS.md) |
| 组件规范 | [`docs/COMPONENT_PATTERNS.md`](docs/COMPONENT_PATTERNS.md) |
| Token 监控设计 | [`docs/TOKEN_MONITORING.md`](docs/TOKEN_MONITORING.md) |
| 可观测性 | [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) |
| 查看执行计划 | [`docs/PLANS.md`](docs/PLANS.md) |
| 检查代码 AST 结构 | `ast/analyzer.ts` |
| 使用工作流模板 | `harness/*.yaml` |
| 运行清理脚本 | `scripts/cleanup.ts` |
| 跑 CI 流水线 | `npm run lint && npm run typecheck && npm run build` |

---

## ⚡ 黄金原则

1. **地图即边界** —— Agent 只读 `AGENTS.md`，细节去 `docs/` 按需加载
2. **机械化约束优先** —— 代码必须过 CI：类型 → Linter → **AST** → 构建
3. **仓库是唯一事实源** —— Slack/口头约定对 Agent 等于不存在
4. **执行即更新文档** —— **每次代码变更后，必须同步更新相关文档**。改 AST 规则 → 更新 `docs/DESIGN.md`；改 CI 配置 → 更新相关说明；新增功能 → 更新 `docs/PLANS.md`。代码和文档不一致是 Harness 退化。

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
│   ├── new-instance.yaml    新建 CLI 实例模板
│   └── bug-fix.yaml         修复 Bug 模板
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
| L2 Constraints | `docs/DESIGN.md` | `ast/`, `ci/` |
| L3 Observability | `docs/OBSERVABILITY.md` | UI 面板 |
| L4 Entropy Mgmt | `docs/DESIGN.md` | `scripts/cleanup.ts` |
| L5 Source of Truth | 仓库即唯一知识源 | — |

---

## 🚀 快速启动

```bash
cd kimi-code-swarm
npm install
npm run dev          # localhost:5173
```

---

*Map version: 2026-04-29*
