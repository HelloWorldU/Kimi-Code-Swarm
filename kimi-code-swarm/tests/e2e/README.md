# E2E Tests

端到端测试。通过 Playwright + WebView2 CDP 连接 Tauri 桌面应用，模拟真实用户操作。

## 前置条件

Tauri 应用必须已启动，且 WebView2 开启了远程调试端口：

```bash
cd kimi-code-swarm
cargo tauri dev
```

`tauri.conf.json` 中已配置 `additionalBrowserArgs: "--remote-debugging-port=9222"`。

## 运行测试

```bash
# 单独运行 E2E
npx playwright test

# 带 UI 调试模式
npx playwright test --ui
```

## 当前覆盖场景

- [x] 登录 → 创建 Agent → 验证 Dashboard 出现

## 限制说明

Playwright 通过 CDP 操控的是前端 DOM，**无法直接验证**以下内容：
- Rust IPC 命令内部逻辑
- keyring 存储是否成功
- Agent Engine 进程是否真实启动
- Git / Kimi CLI 调用是否成功

上述后端逻辑的验证需依赖单元测试或集成测试（TODO）。
