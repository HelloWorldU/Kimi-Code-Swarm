# Kimi-Code-Swarm

> **本地 Agent 指挥中心 App**。指挥官通过 UI 派任务、监进度、审 PR。  
> 本文档是**地图，不是手册**。细节按需去 `docs/` 加载。

---

## 项目定位

> **Harness Engineering 的实践场**——约束即代码、机械化检查、文档单一事实源、熵管理。  
> 最大价值是**验证方法论**，而非售卖开箱即用的产品。

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
| **查看功能实现状态** | **[`docs/STATUS.md`](docs/STATUS.md)** |
| 检查代码 AST 结构 | `ast/analyzer.ts` |
| 使用工作流模板 | `harness/*.yaml` |
| 查看 Agent Skill 规范 | `skills/*/SKILL.md` |
| 查看约束体系 | [`docs/CONSTRAINTS.md`](docs/CONSTRAINTS.md) |
| 跑 CI 流水线 | `npm run ci` |
| 检查文档同步 | `npm run check-docs` |

---

## ⚡ 黄金原则

1. **地图即边界** —— 只读 `AGENTS.md`，细节去 `docs/` 按需加载。
2. **仓库是唯一事实源** —— Slack/口头约定对 Agent 等于不存在。
3. **执行即更新文档** —— 代码变更后必须同步更新相关文档；被 check-docs 阻断时回顾本次会话查阅过的文档。代码和文档不一致是 Harness 退化。
4. **功能状态必须披露** —— 实现后须在 [`docs/STATUS.md`](docs/STATUS.md) 标记状态。Agent 遗忘上下文时，STATUS.md 是第一恢复点。
5. **约束即代码** —— 所有规则必须机械可执行。不能自动检查的约定等于不存在。
6. **代码改动必验证** —— 改完后必须实际 build、启动 app、运行测试、过 lint/analyze，全部通过后才允许合入。纯文档/配置改动除外。
7. **debug 必加日志** —— 代码看不出根因时，禁止盲猜。立即增加日志（`src/utils/logger.ts`）把运行时状态打出来；修复后在注释或 commit 中记录根因。反复盲修同一 bug 是效率灾难。

---

## 🗺️ 目录结构

```
Kimi-Code-Swarm/
├── AGENTS.md              ← 🗺️ 地图（本文档）
├── README.md              ← 人类友好的项目介绍
├── docs/                  ← 📚 知识库（Agent 按需加载）
├── ast/                   ← 🔧 AST 结构约束代码
├── ci/                    ← ✅ CI 约束配置
├── scripts/               ← 🤖 自动化脚本
├── skills/                ← 🎯 Agent 能力 Skill（可复用工作流规范）
├── harness/               ← 📋 工作流模板（new-instance / bug-fix / new-task / auto-test）
└── kimi-code-swarm/       ← 💻 前端应用（Vue3 + Vite + Tailwind + Tauri v2）
    ├── src/                 前端源码
    ├── agent-engine/        Node.js Agent Engine（进程管理 + Git/GitHub 自动化）
    └── tests/               🧪 单元 / 集成 / E2E 测试
```

---

## 🎯 Agent Skill 体系

`skills/` 目录存放可复用的 Agent 能力规范（Skill），每个 Skill 是一个独立目录，内含 `SKILL.md`。完整清单和接入状态见 [`skills/AGENTS.md`](skills/AGENTS.md)。

**当前 Skill**：
- `skills/commit/` — Commit message 规范（✅ 已接入代码，动态读取）
- `skills/push/` — PR 推送规范（⚡ 静态规范，待演进）

---

## 🏗️ Harness 五层映射

| 层 | 知识文档 | 代码/配置 |
|--|----------|----------|
| L1 Context | `AGENTS.md` + `docs/` + `skills/` | — |
| L2 Constraints | `docs/DESIGN.md` + `docs/CONSTRAINTS.md` | `ast/`, `ci/` |
| L3 Observability | `docs/OBSERVABILITY.md` | UI 面板 |
| L4 Entropy Mgmt | `docs/DESIGN.md` | `scripts/cleanup.ts` |
| L5 Source of Truth | 仓库即唯一知识源 | — |

---

## 🚀 快速启动

前置条件：**Node.js 22+**、**Git**、**Kimi CLI**（`py -3.12 -m pip install kimi-cli`）、**Kimi API Key**

```bash
cd kimi-code-swarm
npm install          # 自动配置 Git hooks
npm run dev          # localhost:5173（浏览器模式）
```

Tauri 桌面模式（需要 Rust）：`cargo tauri dev`

首次打开 App 后在登录页输入 API Key，验证通过后存入系统 Keyring。

---

*Map version: 2026-05-15*
