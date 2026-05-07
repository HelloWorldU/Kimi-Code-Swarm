import readline from 'readline'
import { AgentEngine } from './engine.js'
import type { EngineCommand, EngineEvent } from './types.js'

const engine = new AgentEngine((event: EngineEvent) => {
  console.log(JSON.stringify(event))
})

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

// Boot message
console.log(JSON.stringify({ type: 'pong', message: 'Agent Engine started' }))

rl.on('line', async (line: string) => {
  try {
    const cmd = JSON.parse(line) as EngineCommand
    await engine.handleCommand(cmd)
  } catch (err) {
    console.log(JSON.stringify({ type: 'error', message: `Invalid command: ${String(err)}` }))
  }
})

rl.on('close', () => {
  process.exit(0)
})
