import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function execGit(dir: string, args: string[]): Promise<string> {
  if (!isTauri) return `mock: git ${args.join(' ')}`
  return invoke('exec_git', { dir, args })
}

export async function execCommand(command: string, args?: string[], cwd?: string): Promise<string> {
  if (!isTauri) return `mock: ${command} ${(args || []).join(' ')}`
  return invoke('exec_command', { cmd: command, args: args || [], cwd: cwd || '.' })
}

export async function spawnProcess(command: string, args?: string[], cwd?: string): Promise<number> {
  if (!isTauri) return Math.floor(Math.random() * 10000)
  return invoke('spawn_process', { cmd: command, args: args || [], cwd: cwd || '.' })
}

export async function killProcess(pid: number): Promise<void> {
  if (!isTauri) return
  return invoke('kill_process', { pid })
}

export interface ProcessOutputPayload {
  pid: number
  line: string
  is_stderr: boolean
}

export interface ProcessExitPayload {
  pid: number
  code: number | null
}

export async function listenProcessOutput(
  callback: (payload: ProcessOutputPayload) => void,
): Promise<() => void> {
  if (!isTauri) return () => {}
  const unlisten = await listen<ProcessOutputPayload>('process-output', (event) => {
    callback(event.payload)
  })
  return unlisten
}

export async function listenProcessExit(
  callback: (payload: ProcessExitPayload) => void,
): Promise<() => void> {
  if (!isTauri) return () => {}
  const unlisten = await listen<ProcessExitPayload>('process-exit', (event) => {
    callback(event.payload)
  })
  return unlisten
}
