import { invoke } from '@tauri-apps/api/core'

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

export async function execGit(dir: string, args: string[]): Promise<string> {
  if (!isTauri) throw new Error('execGit requires Tauri environment')
  return invoke('exec_git', { dir, args })
}

export async function execCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  if (!isTauri) throw new Error('execCommand requires Tauri environment')
  return invoke('exec_command', { cmd, args, cwd })
}

export async function spawnProcess(cmd: string, args: string[], cwd: string): Promise<number> {
  if (!isTauri) throw new Error('spawnProcess requires Tauri environment')
  return invoke('spawn_process', { cmd, args, cwd })
}

export async function killProcess(pid: number): Promise<void> {
  if (!isTauri) throw new Error('killProcess requires Tauri environment')
  return invoke('kill_process', { pid })
}

export async function sendToProcess(pid: number, message: string): Promise<void> {
  if (!isTauri) throw new Error('sendToProcess requires Tauri environment')
  return invoke('send_to_process', { pid, message })
}

export { isTauri }
