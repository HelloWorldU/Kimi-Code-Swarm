use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use tauri::Emitter;

// Global set of active PIDs spawned by this app
static ACTIVE_PIDS: Mutex<HashSet<u32>> = Mutex::new(HashSet::new());

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

/// Execute a git command in the specified directory
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

/// Execute any shell command in the specified directory
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

/// Spawn a long-running process with real-time stdout/stderr capture
#[tauri::command]
fn spawn_process(
    app: tauri::AppHandle,
    cmd: String,
    args: Vec<String>,
    cwd: String,
) -> Result<u32, String> {
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

    // Thread: read stdout line by line
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_stdout.emit("process-output", ProcessOutputEvent {
                    pid,
                    line,
                    is_stderr: false,
                });
            }
        }
    });

    // Thread: read stderr line by line
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_stderr.emit("process-output", ProcessOutputEvent {
                    pid,
                    line,
                    is_stderr: true,
                });
            }
        }
    });

    // Thread: wait for process exit
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        ACTIVE_PIDS.lock().unwrap().remove(&pid);
        let _ = app_exit.emit("process-exit", ProcessExitEvent { pid, code });
    });

    Ok(pid)
}

/// Kill a spawned process by PID (and its children on Windows)
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
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }

    ACTIVE_PIDS.lock().unwrap().remove(&pid);
    Ok(())
}

/// Send input to a spawned process via a temporary mechanism
/// Note: Full PTY support requires additional work. For now, we log the intent.
#[tauri::command]
fn send_to_process(pid: u32, message: String) -> Result<(), String> {
    // TODO: Implement PTY-based stdin writing
    println!("[send_to_process] pid={} message={}", pid, message);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            exec_git,
            exec_command,
            spawn_process,
            kill_process,
            send_to_process,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
