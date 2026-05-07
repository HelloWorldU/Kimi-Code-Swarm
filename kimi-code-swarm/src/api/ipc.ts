import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { load } from '@tauri-apps/plugin-store'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// ── Legacy process commands ──

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

// ── Agent Engine commands ──

export async function spawnAgentEngine(): Promise<number> {
  if (!isTauri) return 0
  return invoke('spawn_agent_engine')
}

export async function stopAgentEngine(): Promise<void> {
  if (!isTauri) return
  return invoke('stop_agent_engine')
}

export async function sendToEngine(command: object): Promise<void> {
  if (!isTauri) return
  return invoke('send_to_engine', { command: JSON.stringify(command) })
}

export async function isEngineRunning(): Promise<boolean> {
  if (!isTauri) return false
  return invoke('is_engine_running')
}

export interface AgentEngineEventPayload {
  line: string
}

export async function listenAgentEngineEvent(
  callback: (payload: AgentEngineEventPayload) => void,
): Promise<() => void> {
  if (!isTauri) return () => {}
  const unlisten = await listen<AgentEngineEventPayload>('agent-engine-event', (event) => {
    callback(event.payload)
  })
  return unlisten
}

export async function listenAgentEngineExit(
  callback: (payload: { pid: number }) => void,
): Promise<() => void> {
  if (!isTauri) return () => {}
  const unlisten = await listen<{ pid: number }>('agent-engine-exit', (event) => {
    callback(event.payload)
  })
  return unlisten
}

// ── API Key Management ──

export async function saveApiKey(key: string): Promise<void> {
  if (!isTauri) {
    localStorage.setItem('kimi-api-key', key)
    return
  }
  return invoke('save_api_key', { password: key })
}

export async function getApiKey(): Promise<string | null> {
  if (!isTauri) {
    return localStorage.getItem('kimi-api-key')
  }
  return invoke('get_api_key')
}

export async function deleteApiKey(): Promise<void> {
  if (!isTauri) {
    localStorage.removeItem('kimi-api-key')
    return
  }
  return invoke('delete_api_key')
}

// ── App State Persistence ──

const STORE_NAME = 'app-state.json'

export async function getStore() {
  if (!isTauri) return null
  return load(STORE_NAME, { autoSave: true, defaults: {} })
}

export async function loadStoreValue<T>(key: string): Promise<T | null> {
  if (!isTauri) {
    const raw = localStorage.getItem(`store:${key}`)
    return raw ? JSON.parse(raw) : null
  }
  const store = await getStore()
  if (!store) return null
  return store.get(key) as Promise<T | null>
}

export async function saveStoreValue<T>(key: string, value: T): Promise<void> {
  if (!isTauri) {
    localStorage.setItem(`store:${key}`, JSON.stringify(value))
    return
  }
  const store = await getStore()
  if (!store) return
  await store.set(key, value)
}

// ── Kimi API Verification (via Rust backend, avoids WebView fetch encoding issues) ──

export async function verifyKimiApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  if (!isTauri) {
    // Browser mock mode: simulate validation
    return key.startsWith('sk-') ? { valid: true } : { valid: false, error: '浏览器模式：Key 需以 sk- 开头' }
  }
  try {
    const ok = await invoke<boolean>('verify_api_key', { key })
    return { valid: ok }
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) }
  }
}
