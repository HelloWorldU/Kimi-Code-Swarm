/**
 * 引擎自持久化：load / lock / 原子写 / debounce schedule
 *
 * 设计要点：
 * - 数据目录由 Rust 通过 KIMI_SWARM_DATA_DIR 环境变量注入（跨平台正确路径，引擎不猜）
 * - 多实例隔离靠 engine.lock（写自己 pid；已存在且 pid 活着 → 退出）
 * - 写盘抗 crash：先写 .tmp → rename 成最终文件
 * - 损坏不删用户数据：parse 失败 → rename 成 .corrupt.<ts> 留底，再返回 null（视作首次启动）
 * - 不刷盘：500ms debounce 合并多次保存
 *
 * 不持久化字段：logs（前端缓存）、pid（进程死了就无效）。
 */

import { readFile, writeFile, rename } from 'fs/promises'
import { existsSync, openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'

const STATE_FILE = 'engine-state.json'
const LOCK_FILE = 'engine.lock'
const DEBOUNCE_MS = 500

export interface PersistedAgent {
  id: string
  name: string
  status: string
  repoUrl: string
  workspace: string
  branch: string
  prStatus: string
  prNumber?: number
  prUrl?: string
  prAuthor?: string
  tokenUsed: number
  tokenBudget: number
  kimiSessionId?: string
  reviews: unknown[]
  changedFiles?: string[]
  createdAt: string
  lastActivity: string
}

export interface PersistedState {
  version: number
  agents: PersistedAgent[]
}

/** 读 Rust 注入的数据目录；缺失 → 抛错（不许默默落到错误位置） */
export function getDataDir(): string {
  const d = process.env.KIMI_SWARM_DATA_DIR
  if (!d || !d.trim()) {
    throw new Error(
      'KIMI_SWARM_DATA_DIR env var not set. Rust should inject it on engine spawn.',
    )
  }
  return d
}

/**
 * 抢占独占锁：写自己 pid。
 * - 锁已存在且 pid 活着 → throw（拒绝第二实例）
 * - 锁已存在但 pid 已死 → 抢占覆盖
 * - 用 openSync('wx') 让创建动作原子化，规避两个进程同时创建的竞态
 */
export function acquireLock(dir: string): void {
  const lockPath = join(dir, LOCK_FILE)

  // 已存在锁 → 判断是否抢占
  if (existsSync(lockPath)) {
    let pid: number | undefined
    try {
      pid = parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
    } catch {
      // 锁不可读 → 抢占
    }
    if (pid && !isNaN(pid)) {
      try {
        // signal 0 = 只查 pid 存活（Windows + POSIX 都支持）
        process.kill(pid, 0)
        // 没抛 = 活着 → 拒绝
        throw new Error(
          `Another engine instance is already running (pid=${pid}, lock=${lockPath}). Refusing to start.`,
        )
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ESRCH' && code !== 'EPERM') {
          // 不是「pid 不存在」也不是权限问题 → 重新抛
          throw err
        }
        // ESRCH / EPERM → pid 已死或不可达 → 抢占
      }
    }
    try { unlinkSync(lockPath) } catch { /* 容忍 */ }
  }

  // 原子化创建并写 pid
  const fd = openSync(lockPath, 'wx')
  try {
    writeSync(fd, String(process.pid))
  } finally {
    closeSync(fd)
  }

  // 进程结束时清掉锁
  const cleanup = () => {
    try { unlinkSync(lockPath) } catch { /* 容忍 */ }
  }
  process.once('exit', cleanup)
  process.once('SIGINT', () => { cleanup(); process.exit(0) })
  process.once('SIGTERM', () => { cleanup(); process.exit(0) })
}

/**
 * 读 engine-state.json。
 * - 不存在 → 返回 null（首次启动）
 * - 损坏 → 重命名成 .corrupt.<ts> 留底，返回 null
 * - 形状不对 → 同上
 */
export async function loadEngineState(dir: string): Promise<PersistedState | null> {
  const path = join(dir, STATE_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  try {
    const data = JSON.parse(text) as PersistedState
    if (typeof data !== 'object' || data === null || !Array.isArray(data.agents)) {
      throw new Error('Invalid shape (expected { version, agents: [] })')
    }
    return data
  } catch (err) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = `${path}.corrupt.${ts}`
    try {
      await rename(path, backup)
      console.error(`[persist] engine-state.json 损坏，已备份至 ${backup}: ${String(err)}`)
    } catch (renameErr) {
      console.error(`[persist] engine-state.json 损坏且备份失败: ${String(renameErr)}`)
    }
    return null
  }
}

let saveTimer: NodeJS.Timeout | undefined
let pendingState: PersistedState | undefined
let pendingDir: string | undefined

/**
 * 安排一次保存：500ms 内的多次调用合并成一次写。
 * 写入用 .tmp + rename 保证原子性（避免半截写）。
 */
export function schedulePersist(dir: string, state: PersistedState): void {
  pendingState = state
  pendingDir = dir
  if (saveTimer) return
  saveTimer = setTimeout(async () => {
    saveTimer = undefined
    const s = pendingState
    const d = pendingDir
    pendingState = undefined
    pendingDir = undefined
    if (!s || !d) return
    const path = join(d, STATE_FILE)
    const tmp = `${path}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8')
      await rename(tmp, path)
    } catch (err) {
      console.error(`[persist] 保存失败: ${String(err)}`)
    }
  }, DEBOUNCE_MS)
}
