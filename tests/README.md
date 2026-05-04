# Tests

测试目录。包含单元测试、集成测试和端到端测试。

## 测试策略

| 层级 | 目录 | 工具 | 状态 |
|------|------|------|------|
| 单元测试 | `unit/` | Vitest + Vue Test Utils | 🚧 框架搭建中 |
| 集成测试 | `integration/` | Vitest | 🚧 框架搭建中 |
| E2E 测试 | `e2e/` | Playwright（预留） | ❌ 未开始 |

## 运行测试

```bash
cd kimi-code-swarm
npm test        # 运行所有测试
npm run test:ui # Vitest UI 模式
```

## 当前覆盖范围

- [ ] `store/useSwarmStore.ts` — 状态流转、审阅门控
- [ ] `api/github.ts` — PR 创建/合并、Token 管理
- [ ] `api/ipc.ts` — Tauri 命令代理
- [ ] 组件渲染 — TaskCard、TaskDetail、SettingsPanel
