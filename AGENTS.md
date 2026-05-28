# Kimi-Code-Swarm

> **本地 Agent 指挥中心 App**。指挥官通过 UI 派任务、监进度、审 PR。
> 本文档是**索引**，规则在 `.kimi/skills/`（kimi CLI 启动自动加载），细节去 `docs/` 按需读。

---

## 入口 skill

| 场景 | 加载 |
|------|------|
| 接到任何新任务 | `.kimi/skills/task-intake/SKILL.md`（必走，对齐批准后才动手） |
| 反复未解 / 卡死 | `.kimi/skills/debug/SKILL.md`（停止猜测式修改，加日志 + 与人类协作） |
| 冲突解决 / branch 同步 | `.kimi/skills/resolve-conflict/SKILL.md`（PR merge 后冲突解决偏好与行为引导） |

需要读哪些文档由 task-intake 阶段 1 引导。下面是常用关键文档清单，按需查：

| 想了解… | 去这里 |
|---------|--------|
| 系统设计 | `docs/DESIGN.md` |
| 架构 / 数据流 / 状态分层 | `docs/ARCHITECTURE.md` |
| 前端代码规范 | `docs/FRONTEND.md` |
| 前端组件规范 | `docs/COMPONENT_PATTERNS.md` |
| 功能实现状态 | `docs/STATUS.md` |
| 已知待办 | `docs/exec-plans/backlog.md` |

---

## 黄金原则

1. **地图即边界** — 只读本文件 + task-intake，细节按需；口头约定等于不存在
2. **代码变，文档必须同步变** — 被 check-docs 阻断时回顾本次已读文档
3. **约束即代码** — 不能自动检查的约定等于不存在

---

## 快速启动（人类开发者）

```bash
cd kimi-code-swarm
npm install          # 自动配置 Git hooks
npm run dev          # localhost:5173
npx tauri dev        # Tauri 桌面模式
```

首次打开 App 输入 API Key，验证通过后存入系统 Keyring。

---

*Map version: 2026-05-27*
