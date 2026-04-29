# DESIGN

> Kimi-Code-Swarm 的顶层设计。

## 核心公式

```
Agent 表现 = f(Model, Harness)
```

## 五层 Harness 架构

| 层 | 目录 | 职责 |
|--|------|------|
| L1 Context | `AGENTS.md` + `docs/` | 上下文分层，按需加载 |
| L2 Constraints | `ci/` + `ast/` | 机械化约束（类型/Linter/AST） |
| L3 Observability | `docs/OBSERVABILITY.md` + UI 面板 | 实时监控 |
| L4 Entropy Mgmt | `scripts/cleanup.ts` | 熵管理 |
| L5 Source of Truth | 仓库即唯一知识源 | 所有决策写入文件 |

## 关键决策记录

1. **Vue 而不是 React**：reactive() 对高频日志流更友好
2. **先 Web 后桌面**：先验证 UI 交互，再套 Electron/Tauri 壳
3. **Global Composable 而不是 Pinia**：当前复杂度足够，跨窗口时迁移
