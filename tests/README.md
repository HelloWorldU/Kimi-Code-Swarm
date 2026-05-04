# Tests

项目根级测试目录。放置**项目级**测试（AST 分析器、CI 脚本、health-check 等）。

前端应用测试在 `kimi-code-swarm/tests/` 下，使用 Vitest + Vue Test Utils。

## 分层

| 层级 | 目录 | 范围 | 工具 | 状态 |
|------|------|------|------|------|
| 前端单元测试 | `kimi-code-swarm/tests/unit/` | Store、API、组件 | Vitest + happy-dom | ✅ 已接入 |
| 项目级单元测试 | `tests/unit/` | AST、CI 脚本 | Vitest / Node | 🚧 占位 |
| 集成测试 | `tests/integration/` | 跨模块集成 | Vitest | 🚧 占位 |
| E2E 测试 | `tests/e2e/` | 端到端 | Playwright（预留） | ❌ 未开始 |

## 运行前端测试

```bash
cd kimi-code-swarm
npm test           # 运行所有前端测试
npm run test:watch # 监听模式
```

## 当前覆盖范围

- [x] `api/github.ts` — parseRepoUrl、Token 管理
- [x] `store/useSwarmStore.ts` — createTask、submitForReview 生成审阅者
- [ ] `api/ipc.ts` — Tauri 命令代理
- [ ] 组件渲染 — TaskCard、TaskDetail、SettingsPanel
