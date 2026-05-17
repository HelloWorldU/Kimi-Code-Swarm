# Kimi-Code-Swarm

> **本地 Agent 指挥中心 App**。指挥官通过 UI 派任务、监进度、审 PR。
> 本文档是**索引**，规则去 `skills/`，细节去 `docs/` 按需加载。

---

## 快速决策树

| 场景 | 加载文档 | 检查清单 |
|------|---------|---------|
| 新建/修改代码 | `docs/FRONTEND.md` | build → lint → analyze → test |
| 修复 Bug | `skills/debug/SKILL.md` | 日志定位 → 修复 → 留痕 → 验证 |
| 提交代码 | `skills/commit/SKILL.md` | typecheck → lint → analyze → check-docs |
| 推 PR | `skills/push/SKILL.md` | CI 通过 → 审阅 → 合并 |
| 查看功能状态 | `docs/STATUS.md` | 状态同步 |
| 架构决策 | `docs/DESIGN.md` + `docs/ARCHITECTURE.md` | Plan Mode |

---

## 黄金原则

1. **地图即边界** — 只读 `AGENTS.md`，细节去 `docs/` 按需加载；口头约定等于不存在
2. **代码变，文档必须同步变** — 被 check-docs 阻断时回顾本次已读文档
3. **约束即代码** — 不能自动检查的约定等于不存在
4. **改完必须验证** — build → test → lint/analyze 全部通过才允许合入
5. **debug 必加日志** — 看不出根因时禁止盲猜，加日志定位；修复后留痕

---

## 技能索引

| 技能 | 文件 |
|------|------|
| Commit 规范 | `skills/commit/SKILL.md` |
| PR 推送 | `skills/push/SKILL.md` |
| Debug 规范 | `skills/debug/SKILL.md` |

## 文档索引

| 我想… | 去这里 |
|-------|--------|
| 理解系统设计 | `docs/DESIGN.md` |
| 了解架构 | `docs/ARCHITECTURE.md` |
| 写前端代码 | `docs/FRONTEND.md` |
| 组件规范 | `docs/COMPONENT_PATTERNS.md` |
| 查看功能状态 | `docs/STATUS.md` |
| 完整目录结构 | `docs/DIRECTORY.md` |

---

## 快速启动

```bash
cd kimi-code-swarm
npm install          # 自动配置 Git hooks
npm run dev          # localhost:5173
cargo tauri dev      # Tauri 桌面模式
```

首次打开 App 输入 API Key，验证通过后存入系统 Keyring。

---

*Map version: 2026-05-16*
