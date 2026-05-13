use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::collections::HashSet;
use tauri::Emitter;
use tauri::Manager;

const KEYRING_SERVICE: &str = "kimi-code-swarm";
const KEYRING_ACCOUNT: &str = "api-key";

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

// ── Helper: find agent-engine directory ──
fn agent_engine_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Try app root (development: project root)
    let app_root = app.path().app_local_data_dir()
        .map_err(|e| format!("Failed to get app dir: {}", e))?;

    // Development layout: app binary is in target/debug/ under src-tauri/
    // agent-engine is at ../agent-engine relative to src-tauri/
    let dev_path = app_root.parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("agent-engine"));

    if let Some(ref p) = dev_path {
        if p.exists() {
            return Ok(p.clone());
        }
    }

    // Fallback: try sibling of src-tauri (for cargo run from src-tauri dir)
    let fallback = PathBuf::from("../agent-engine");
    if fallback.exists() {
        return Ok(fallback);
    }

    // Production: bundle agent-engine alongside the app
    let prod_path = app_root.join("agent-engine");
    if prod_path.exists() {
        return Ok(prod_path);
    }

    Err(format!("Cannot find agent-engine directory. Tried: {:?}, {:?}, {:?}", dev_path, fallback, prod_path))
}

// ── Git / Shell commands ──
#[tauri::command]
fn exec_git(dir: String, args: Vec<String>) -> Result<String, String> {
    let output = Command::new("git")
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
    let output = Command::new(&cmd)
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
    let mut child = Command::new(&cmd)
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
        let _ = Command::new("taskkill")
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
    // Try local tsx CLI module first to avoid PATH / npx issues
    let tsx_cli = engine_dir.join("node_modules/tsx/dist/cli.mjs");
    let tsx_bin = engine_dir.join("node_modules/.bin/tsx");

    let mut cmd_builder = if tsx_cli.exists() {
        let mut cmd = Command::new("node");
        cmd.arg(&tsx_cli).arg("src/index.ts");
        cmd
    } else if tsx_bin.exists() {
        let mut cmd = Command::new("node");
        cmd.arg(&tsx_bin).arg("src/index.ts");
        cmd
    } else {
        // fallback: try npx via cmd /c on Windows to inherit PATH
        if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.args(["/c", "npx", "tsx", "src/index.ts"]);
            cmd
        } else {
            let mut cmd = Command::new("npx");
            cmd.args(["tsx", "src/index.ts"]);
            cmd
        }
    };

    cmd_builder
        .current_dir(&engine_dir)
        .stdout(Stdio::piped())
        .stdin(Stdio::piped());

    if let Some(key) = api_key {
        cmd_builder.env("KIMI_API_KEY", key);
        log::info!("[spawn_agent_engine] KIMI_API_KEY injected");
    }

    let mut child = cmd_builder
        .spawn()
        .map_err(|e| format!("Failed to spawn agent engine: {}", e))?;

    let pid = child.id();
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

    Ok(pid)
}

#[tauri::command]
fn send_to_engine(command: String) -> Result<(), String> {
    let log_cmd = if command.len() > 120 { format!("{}... ({} bytes)", &command[..120], command.len()) } else { command.clone() };
    log::info!("[send_to_engine] {}", log_cmd);
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
    for cmd in &candidates {
        if Command::new(cmd).args(["--version"]).output().is_ok() {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
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
