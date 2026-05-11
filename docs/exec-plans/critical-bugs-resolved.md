# Critical Bugs Resolved

> **关键 Bug 根因记录表**。按时间倒序排列。
> Agent 遇到类似症状时，先查此表，避免重复踩坑。

---

## 2026-05-11 — Agent Engine spawn failure on Windows

**症状**：Tauri 桌面模式下点击"新建 Agent"，弹窗正常提交后 Agent 未出现在 Dashboard。前端报错 `Agent engine not running`。

**根因**：Rust `Command::new("npx")` 启动 Node.js 子进程时，Windows 上继承不到终端 PATH，`npx`（实际是 `npx.cmd` 批处理脚本）找不到，引擎进程从未启动。

**修复**：绕过 `npx` 和 `.cmd` 脚本，直接用 `node` 执行 tsx 的入口模块：
```rust
let tsx_cli = engine_dir.join("node_modules/tsx/dist/cli.mjs");
Command::new("node").arg(&tsx_cli).arg("src/index.ts")
```

**关键文件**：`kimi-code-swarm/src-tauri/src/lib.rs`
