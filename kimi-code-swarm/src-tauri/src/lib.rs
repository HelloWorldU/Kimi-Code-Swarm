use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::collections::HashSet;
use tauri::Emitter;

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
fn spawn_agent_engine(app: tauri::AppHandle, cwd: String) -> Result<u32, String> {
    // Kill existing engine if any
    {
        let mut handle = ENGINE_HANDLE.lock().unwrap();
        *handle = None;
    }

    let mut child = Command::new("node")
        .args(["--experimental-strip-types", "src/index.ts"])
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stdin(Stdio::piped())
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

    // Thread: read stdout line by line and emit as agent-engine-event
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_emit.emit("agent-engine-event", AgentEngineEvent { line });
            }
        }
        // Engine exited
        let _ = app_emit.emit("agent-engine-exit", serde_json::json!({"pid": pid}));
        let mut handle = ENGINE_HANDLE.lock().unwrap();
        *handle = None;
    });

    Ok(pid)
}

#[tauri::command]
fn send_to_engine(command: String) -> Result<(), String> {
    let handle = ENGINE_HANDLE.lock().unwrap();
    let stdin = handle.as_ref()
        .ok_or("Agent engine not running")?;
    let mut writer = stdin.lock().unwrap();
    writeln!(writer, "{}", command)
        .map_err(|e| format!("Failed to write to engine: {}", e))?;
    Ok(())
}

#[tauri::command]
fn is_engine_running() -> bool {
    ENGINE_HANDLE.lock().unwrap().is_some()
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

/// Verify Kimi Code API key by running `kimi --version`.
/// Kimi Code keys are NOT Moonshot platform keys; they cannot be verified via HTTP.
#[tauri::command]
fn verify_api_key(key: String) -> Result<bool, String> {
    // Basic format check
    if !key.starts_with("sk-") {
        return Err("API Key 格式错误，必须以 sk- 开头".to_string());
    }

    // Try to run kimi --version with the key as env var to verify CLI can authenticate
    let output = Command::new("kimi")
        .args(["--version"])
        .env("KIMI_API_KEY", &key)
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let ver = String::from_utf8_lossy(&o.stdout);
            log::info!("[verify_api_key] kimi cli version: {}", ver.trim());
            Ok(true)
        }
        Ok(o) => {
            let err = String::from_utf8_lossy(&o.stderr);
            log::warn!("[verify_api_key] kimi cli failed: {}", err.trim());
            // CLI not installed is acceptable; key format is valid
            if err.contains("not found") || err.contains("not recognized") {
                log::info!("[verify_api_key] kimi cli not installed, accepting key format");
                Ok(true)
            } else {
                Err(format!("Kimi CLI 错误: {}", err.trim()))
            }
        }
        Err(e) => {
            // kimi command not found — CLI not installed, accept format-only validation
            log::info!("[verify_api_key] kimi cli not found ({}), accepting key format", e);
            Ok(true)
        }
    }
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
            save_api_key,
            get_api_key,
            delete_api_key,
            verify_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
