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

#[tauri::command]
fn verify_api_key(key: String) -> Result<bool, String> {
    let prefix: String = key.chars().take(20).collect();
    let bytes: Vec<u8> = key.bytes().take(30).collect();
    log::info!(
        "[verify_api_key] len={} prefix={:?} bytes={:?} has_space={} has_newline={}",
        key.len(), prefix, bytes, key.contains(' '), key.contains('\n')
    );

    let auth = format!("Bearer {}", key);
    log::info!("[verify_api_key] auth header prefix={:?}", &auth[..auth.len().min(35)]);

    let resp = ureq::get("https://api.moonshot.cn/v1/models")
        .set("Authorization", &auth)
        .call();
    match resp {
        Ok(r) => {
            log::info!("[verify_api_key] success status={}", r.status());
            Ok(r.status() == 200)
        }
        Err(ureq::Error::Status(code, r)) => {
            let body = r.into_string().unwrap_or_default();
            log::warn!("[verify_api_key] failed code={} body={}", code, body);
            Err(format!("HTTP {}: {}", code, body))
        }
        Err(ureq::Error::Transport(e)) => {
            Err(format!("网络错误: {}", e.message().unwrap_or("unknown")))
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
