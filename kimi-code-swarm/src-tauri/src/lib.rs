use std::process::Command;
use std::sync::Mutex;
use std::collections::HashMap;

// Global process table for spawned CLI processes
static PROCESSES: Mutex<HashMap<u32, std::process::Child>> = Mutex::new(HashMap::new());

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

/// Spawn a long-running process (e.g., Kimi CLI)
#[tauri::command]
fn spawn_process(cmd: String, args: Vec<String>, cwd: String) -> Result<u32, String> {
    let child = Command::new(&cmd)
        .args(&args)
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", cmd, e))?;

    let pid = child.id();
    PROCESSES.lock().unwrap().insert(pid, child);
    Ok(pid)
}

/// Kill a spawned process by PID
#[tauri::command]
fn kill_process(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }

    PROCESSES.lock().unwrap().remove(&pid);
    Ok(())
}

/// Send input to a spawned process via a temporary mechanism
/// Note: Full PTY support requires additional work. For now, we log the intent.
#[tauri::command]
fn send_to_process(pid: u32, message: String) -> Result<(), String> {
    // TODO: Implement PTY-based stdin writing
    // For now, this is a placeholder until we integrate node-pty or similar
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
