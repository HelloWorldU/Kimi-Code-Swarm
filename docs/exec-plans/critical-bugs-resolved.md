# Critical Bugs Resolved

> **关键 Bug 根因记录表**。按时间倒序排列。
> Agent 遇到类似症状时，先查此表，避免重复踩坑。

---

## 2026-05-15 — 打包后 App 登录弹黑窗口 + 引擎未启动

**症状**：Tauri 打包后的生产版 App，登录时弹出黑色 CMD 窗口；新建 Agent 时提示"创建失败，引擎未启动"。

**根因**（三个独立但叠加的问题）：

1. **Windows 子进程默认创建控制台窗口**：`Command::new("node")` / `Command::new("cmd")` / `Command::new("kimi")` 在 Windows 上会弹出黑色 CMD 窗口，因为桌面应用本身没有控制台，子进程被强制分配新窗口。
2. **agent-engine 未被打包进安装包**：`tauri.conf.json` 没有配置 `bundle.resources`，安装后 `resource_dir()` 下不存在 `agent-engine` 目录，导致 `agent_engine_dir()` 探测失败。
3. **引擎启动后没有健康检查**：`spawn_agent_engine()` 在 `spawn()` 成功后就立即返回，如果引擎因为缺少依赖立即崩溃（exit code ≠ 0），`ENGINE_HANDLE` 仍被设置为 `Some`，后续 `send_to_engine` 写入已死进程的 stdin → 失败。

**修复**：

```rust
// 1. Windows 隐藏控制台窗口
#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

// 2. tauri.conf.json 添加 resources 配置
"bundle": {
  "resources": {
    "../agent-engine": "agent-engine"
  }
}

// 3. 增强目录探测（添加 resource_dir 和 exe_dir）
if let Ok(resource_dir) = app.path().resource_dir() {
    let resource_path = resource_dir.join("agent-engine");
    if resource_path.exists() { return Ok(resource_path); }
}

// 4. 启动后健康检查
std::thread::sleep(Duration::from_millis(300));
if let Ok(Some(status)) = child.try_wait() {
    return Err("Agent engine crashed immediately...".into());
}
```

**关键文件**：`src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`

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
