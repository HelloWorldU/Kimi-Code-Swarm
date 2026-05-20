import readline from 'readline'
import { AgentEngine } from './engine.js'
import { getDataDir, acquireLock, loadEngineState } from './persist.js'
import type { EngineCommand, EngineEvent } from './types.js'

const emit = (event: EngineEvent) => {
  console.log(JSON.stringify(event))
}

// 数据目录：由 Rust 通过 KIMI_SWARM_DATA_DIR 注入；
// 缺失（dev / 单跑模式）→ 走无持久化模式，schedulePersist 自动 no-op。
let dataDir: string | undefined
try {
  dataDir = getDataDir()
} catch {
  dataDir = undefined
}

// 多实例锁：若另一引擎实例已活着，直接退出（避免并发写 engine-state.json）
if (dataDir) {
  try {
    acquireLock(dataDir)
  } catch (err) {
    console.error(`[persist] ${String(err)}`)
    emit({ type: 'error', message: String(err) })
    process.exit(1)
  }
}

const engine = new AgentEngine(emit, dataDir)

// 启动 restore：读 engine-state.json，重建每个 Agent，emit agent-created 给前端
const restoredIds: string[] = []
if (dataDir) {
  const persisted = await loadEngineState(dataDir)
  if (persisted) {
    for (const p of persisted.agents) {
      engine.restoreAgent(p)
      restoredIds.push(p.id)
    }
  }
}

// engine-restored 必须在所有 agent-created 之后、pong 之前：
// 前端拿到 restoredAgentIds 后做 diff，把 localStorage 里多出来的标 orphan
emit({ type: 'engine-restored', restoredAgentIds: restoredIds })
emit({ type: 'pong', message: 'Agent Engine started' })

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

rl.on('line', async (line: string) => {
  try {
    const cmd = JSON.parse(line) as EngineCommand
    await engine.handleCommand(cmd)
  } catch (err) {
    emit({ type: 'error', message: `Invalid command: ${String(err)}` })
  }
})

rl.on('close', () => {
  process.exit(0)
})
