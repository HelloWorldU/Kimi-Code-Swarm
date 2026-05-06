import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { load } from '@tauri-apps/plugin-store'

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

// ── API Key Management (via OS keyring) ──

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

// ── App State Persistence (via tauri-plugin-store) ──

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

// ── Kimi API Verification ──

const KIMI_API_BASE = 'https://api.moonshot.cn/v1'

export async function verifyKimiApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const resp = await fetch(`${KIMI_API_BASE}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (resp.status === 401) {
      return { valid: false, error: 'API Key 无效或已过期' }
    }
    if (!resp.ok) {
      return { valid: false, error: `验证失败 (HTTP ${resp.status})` }
    }
    return { valid: true }
  } catch (e) {
    return { valid: false, error: `网络错误: ${String(e)}` }
  }
}
