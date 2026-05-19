use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::collections::HashSet;
use tauri::Emitter;
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const KEYRING_SERVICE: &str = "kimi-code-swarm";
const KEYRING_ACCOUNT: &str = "api-key";

// Windows: prevent console window popup when spawning child processes
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

// ── Global process tracking ──
static ACTIVE_PIDS: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

// Agent Engine process handle (singleton)
static ENGINE_HANDLE: LazyLock<Mutex<Option<Arc<Mutex<std::process::ChildStdin>>>>> = LazyLock::new(|| Mutex::new(None));

// ── Event types ──
#[derive(serde::Serialize, Clone)]
struct ProcessOutputEvent {
    pid: u32,
    line: String,
    is_stderr: bool,
}

#[derive(serde::Serialize, Clone)]
struct ProcessExitEvent {
    pid: u32,
    code: Option<i32>,
}

#[derive(serde::Serialize, Clone)]
struct AgentEngineEvent {
    line: String,
}

// ── Helper: find node.exe (nvm-windows installs node outside system PATH) ──
fn find_node_exe() -> Result<PathBuf, String> {
    // 1. Common installation paths (nvm-windows, official installer, etc.)
    let common_paths = [
        r"C:\nvm4w\nodejs\node.exe",
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        r"C:\nodejs\node.exe",
    ];
    for p in &common_paths {
        let path = PathBuf::from(p);
        if path.exists() { return Ok(path); }
    }

    if let Ok(path_env) = std::env::var("PATH") {
        for dir in path_env.split(';') {
            let candidate = PathBuf::from(dir).join("node.exe");
            if candidate.exists() { return Ok(candidate); }
        }
    }

    #[cfg(windows)]
    {
        let mut cmd = Command::new("where");
        hide_console(&mut cmd);
        if let Ok(output) = cmd.arg("node").output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                let path = PathBuf::from(line.trim());
                if path.exists() { return Ok(path); }
            }
        }
    }

    Ok(PathBuf::from("node"))
}

// ── Helper: find agent-engine directory ──
fn agent_engine_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut diagnostics = Vec::new();

    // Try app root (development: project root)
    let app_root = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to get app dir: {}", e))?;
    diagnostics.push(format!("app_local_data_dir={:?} -> exists={}", app_root, app_root.exists()));

    // Development layout: app binary is in target/debug/ under src-tauri/
    // agent-engine is at ../agent-engine relative to src-tauri/
    let dev_path = app_root.parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("agent-engine"));

    if let Some(ref p) = dev_path {
        if p.exists() { return Ok(p.clone()); }
    }

    let fallback = PathBuf::from("../agent-engine");
    if fallback.exists() { return Ok(fallback); }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let resource_path = resource_dir.join("agent-engine");
        if resource_path.exists() { return Ok(resource_path); }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let exe_sibling = exe_dir.join("agent-engine");
            if exe_sibling.exists() { return Ok(exe_sibling); }
        }
    }

    let prod_path = app_root.join("agent-engine");
    if prod_path.exists() { return Ok(prod_path); }

    Err(format!(
        "Cannot find agent-engine directory. Tried: dev, fallback, resource_dir, exe_dir, app_local_data_dir"
    ))
}

// ── Git / Shell commands ──
#[tauri::command]
fn exec_git(dir: String, args: Vec<String>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    hide_console(&mut cmd);
    let output = cmd
        .args(&args)
        .current_dir(&dir)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("git error: {}", stderr.trim()));
    }
    Ok(stdout.trim().to_string())
}

#[tauri::command]
fn exec_command(cmd: String, args: Vec<String>, cwd: String) -> Result<String, String> {
    let mut command = Command::new(&cmd);
    hide_console(&mut command);
    let output = command
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to execute {}: {}", cmd, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("{} error: {}", cmd, stderr.trim()));
    }
    Ok(stdout.trim().to_string())
}

// ── Process spawn / kill (legacy direct spawn) ──
#[tauri::command]
fn spawn_process(app: tauri::AppHandle, cmd: String, args: Vec<String>, cwd: String) -> Result<u32, String> {
    let mut command = Command::new(&cmd);
    hide_console(&mut command);
    let mut child = command
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", cmd, e))?;

    let pid = child.id();
    ACTIVE_PIDS.lock().unwrap().insert(pid);

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let app_stdout = app.clone();
    let app_stderr = app.clone();
    let app_exit = app.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_stdout.emit("process-output", ProcessOutputEvent { pid, line, is_stderr: false });
            }
        }
    });

    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_stderr.emit("process-output", ProcessOutputEvent { pid, line, is_stderr: true });
            }
        }
    });

    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        ACTIVE_PIDS.lock().unwrap().remove(&pid);
        let _ = app_exit.emit("process-exit", ProcessExitEvent { pid, code });
    });

    Ok(pid)
}

#[tauri::command]
fn kill_process(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("taskkill");
        hide_console(&mut cmd);
        let _ = cmd
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
    }
    ACTIVE_PIDS.lock().unwrap().remove(&pid);
    Ok(())
}

#[tauri::command]
fn send_to_process(_pid: u32, message: String) -> Result<(), String> {
    println!("[send_to_process] message={}", message);
    Ok(())
}

// ── Agent Engine ──
#[tauri::command]
fn spawn_agent_engine(app: tauri::AppHandle) -> Result<u32, String> {
    let engine_dir = agent_engine_dir(&app)?;
    log::info!("[spawn_agent_engine] using dir: {:?}", engine_dir);

    // Kill existing engine if any
    {
        let mut handle = ENGINE_HANDLE.lock().unwrap();
        *handle = None;
    }

    // Read API key from keyring and inject into engine environment
    let api_key = {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|e| format!("Keyring entry creation failed: {}", e))?;
        entry.get_password().ok()
    };

    // Use tsx to run TypeScript directly (handles .js -> .ts resolution)
    // Resolve node.exe path (nvm-windows may not be in GUI app PATH)
    let node_exe = find_node_exe().map_err(|e| format!(
        "Cannot find Node.js runtime: {}. \
         Please install Node.js 22+ (https://nodejs.org/) and ensure node.exe is accessible.",
        e
    ))?;

    // Production: use pre-compiled dist/index.js (no tsx runtime needed)
    // Development: fallback to tsx src/index.ts
    let dist_js = engine_dir.join("dist/index.js");
    let src_ts = engine_dir.join("src/index.ts");
    let tsx_cli = engine_dir.join("node_modules/tsx/dist/cli.mjs");

    let mut cmd_builder = if dist_js.exists() {
        log::info!("[spawn_agent_engine] using pre-compiled dist/index.js");
        let mut cmd = Command::new(&node_exe);
        hide_console(&mut cmd);
        cmd.arg(&dist_js);
        cmd
    } else if tsx_cli.exists() {
        log::info!("[spawn_agent_engine] using tsx cli.mjs (dev mode)");
        let mut cmd = Command::new(&node_exe);
        hide_console(&mut cmd);
        cmd.arg(&tsx_cli).arg(&src_ts);
        cmd
    } else {
        return Err("Cannot find dist/index.js or tsx. Please run 'npm run build' in agent-engine/".to_string());
    };

    cmd_builder
        .current_dir(&engine_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped());

    if let Some(key) = api_key {
        cmd_builder.env("KIMI_API_KEY", key);
    }

    let mut child = cmd_builder
        .spawn()
        .map_err(|e| format!(
            "Failed to spawn agent engine: {}. Engine dir: {:?}  Node: {:?}",
            e, engine_dir, node_exe
        ))?;

    let pid = child.id();

    // Health check: verify the engine didn't crash immediately (e.g. missing node_modules)
    std::thread::sleep(std::time::Duration::from_millis(300));
    match child.try_wait() {
        Ok(Some(status)) => {
            // Read first line of stderr for crash reason
            let mut stderr_reader = BufReader::new(child.stderr.take().unwrap());
            let mut first_stderr = String::new();
            let _ = stderr_reader.read_line(&mut first_stderr);
            return Err(format!(
                "Agent engine crashed immediately (exit code: {:?}).\n\nstderr: {}\n\nEngine dir: {:?}\n\nCommon causes:\n1. Missing node_modules (corrupted install)\n2. Node.js version incompatible\n3. Antivirus blocked tsx execution",
                status.code(), first_stderr.trim(), engine_dir
            ));
        }
        _ => {}
    }

    let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));

    {
        let mut handle = ENGINE_HANDLE.lock().unwrap();
        *handle = Some(stdin.clone());
    }

    let stdout = child.stdout.take().unwrap();
    let app_emit = app.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                // 非 JSON 行（如引擎崩溃输出）直接回显终端；JSON 事件由前端处理，不回显
                if serde_json::from_str::<serde_json::Value>(&line).is_err() {
                    println!("{}", line);
                }
                let _ = app_emit.emit("agent-engine-event", AgentEngineEvent { line });
            }
        }
        let _ = app_emit.emit("agent-engine-exit", serde_json::json!({"pid": pid}));
        let mut handle = ENGINE_HANDLE.lock().unwrap();
        *handle = None;
    });

    // 捕获 engine stderr 并打印到终端，使 engine 的 console.error 在开发模式下可见
    let stderr = child.stderr.take().unwrap();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                eprintln!("[agent-engine] {}", line);
            }
        }
    });

    Ok(pid)
}

#[tauri::command]
fn send_to_engine(command: String) -> Result<(), String> {
    log::info!("[send_to_engine] {} bytes", command.len());
    let handle = ENGINE_HANDLE.lock().unwrap();
    let stdin = handle.as_ref()
        .ok_or("Agent engine not running")?;
    let mut writer = stdin.lock().unwrap();
    writeln!(writer, "{}", command)
        .map_err(|e| format!("Failed to write to engine: {}", e))?;
    log::info!("[send_to_engine] command sent successfully");
    Ok(())
}

#[tauri::command]
fn is_engine_running() -> bool {
    ENGINE_HANDLE.lock().unwrap().is_some()
}

#[tauri::command]
fn stop_agent_engine() -> Result<(), String> {
    let mut handle = ENGINE_HANDLE.lock().unwrap();
    if let Some(stdin) = handle.take() {
        if let Ok(mut writer) = stdin.lock() {
            let _ = writeln!(writer, "{}", serde_json::json!({"type": "shutdown"}));
        }
    }
    Ok(())
}

// ── API Key Management ──
#[tauri::command]
fn save_api_key(password: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring entry creation failed: {}", e))?;
    entry.set_password(&password)
        .map_err(|e| format!("Failed to save API key: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_api_key() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring entry creation failed: {}", e))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get API key: {}", e)),
    }
}

#[tauri::command]
fn delete_api_key() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring entry creation failed: {}", e))?;
    entry.delete_credential()
        .map_err(|e| format!("Failed to delete API key: {}", e))?;
    Ok(())
}

/// Verify Kimi Code API key by checking format and detecting CLI availability.
/// Kimi Code keys are NOT Moonshot platform keys; they authenticate via the CLI itself.
#[tauri::command]
fn verify_api_key(key: String) -> Result<bool, String> {
    // Basic format check
    if !key.starts_with("sk-") {
        return Err("API Key 格式错误，必须以 sk- 开头".to_string());
    }

    // Try to detect kimi CLI
    let candidates = ["kimi", "C:\\Python312\\Scripts\\kimi.exe"];
    let mut found = false;
    for c in &candidates {
        let mut cmd = Command::new(c);
        hide_console(&mut cmd);
        if cmd.args(["--version"]).output().is_ok() {
            found = true;
            break;
        }
    }

    if !found {
        return Err("Kimi CLI 未找到。请先安装: py -3.12 -m pip install kimi-cli".to_string());
    }

    // CLI found; accept the key. Real validation happens when CLI executes.
    Ok(true)
}

/// ===================================================================
/// DEBUG CONSOLE SWITCH
/// ===================================================================
/// 设为 `true` 时，无论 debug/release build 都会附加控制台窗口，
/// 用于查看 Rust 后端 + Agent Engine 的实时 stderr 日志。
///
/// 使用方式（比生产打包快 3~4 倍）：
/// 1. 将此常量改为 `true`
/// 2. `cd src-tauri && cargo build`（~30s，debug 编译）
/// 3. 在 cmd 中运行 `..\target\debug\kimi-code-swarm.exe`，复现 bug，看日志
/// 4. 修完后改回 `false`，再跑 `cargo tauri build` 出正式包
/// ===================================================================
const DEBUG_CONSOLE: bool = true;

#[cfg(windows)]
fn open_debug_console() {
    if DEBUG_CONSOLE {
        extern "system" { fn AllocConsole() -> i32; }
        unsafe { AllocConsole(); }
        println!("[Kimi Code Swarm] Debug console open");
    }
}

#[cfg(not(windows))]
fn open_debug_console() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    open_debug_console();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .format(|out, message, record| {
                    out.finish(format_args!(
                        "[{}] [{}] {}",
                        record.target(),
                        record.level(),
                        message
                    ))
                })
                .build()
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            exec_git,
            exec_command,
            spawn_process,
            kill_process,
            send_to_process,
            spawn_agent_engine,
            send_to_engine,
            is_engine_running,
            stop_agent_engine,
            save_api_key,
            get_api_key,
            delete_api_key,
            verify_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
