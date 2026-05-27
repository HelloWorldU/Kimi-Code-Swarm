import { spawn, execFile, exec } from 'child_process'
import { promisify } from 'util'
import { createInterface } from 'readline'

const execFileAsync = promisify(execFile)

const CANDIDATES = [
  'kimi',
  'C:\\Python312\\Scripts\\kimi.exe',
]

// Also try module invocation via specific Python versions
const PYTHON_CANDIDATES = [
  { python: 'py', args: ['-3.12', '-m', 'kimi'] },
  { python: 'python3.12', args: ['-m', 'kimi'] },
  { python: 'python312', args: ['-m', 'kimi'] },
]

let cachedPath: string | null | undefined
let cachedModule: { python: string; args: string[] } | null | undefined

async function detectKimiModule(): Promise<{ python: string; args: string[] } | null> {
  if (cachedModule !== undefined) return cachedModule
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      await execFileAsync(candidate.python, [...candidate.args, '--version'])
      cachedModule = candidate
      return candidate
    } catch {
      // expected: 该 Python 候选不可用，尝试下一个
    }
  }
  cachedModule = null
  console.error('[kimi] 所有 Python 模块检测候选均失败，Kimi CLI 不可用')
  return null
}

export async function detectKimiCli(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath
  for (const cmd of CANDIDATES) {
    try {
      await execFileAsync(cmd, ['--version'])
      cachedPath = cmd
      return cmd
    } catch {
      // expected: 该 CLI 路径不存在，尝试下一个
    }
  }
  // Try module invocation as fallback
  const module = await detectKimiModule()
  if (module) {
    // Return a sentinel that runKimi will recognize
    cachedPath = '__MODULE__'
    return '__MODULE__'
  }
  cachedPath = null
  return null
}

export interface KimiProcess {
  pid: number
  stdout: AsyncIterable<string>
  stderr: AsyncIterable<string>
  wait(): Promise<number | null>
  kill(): void
}

export interface RunKimiOptions {
  /** 使用 --output-format stream-json 获取结构化流式输出（含 thinking / tool_call / mcp） */
  streamJson?: boolean
  /** 启用 --thinking 让模型输出思考过程 */
  thinking?: boolean
  /** 传入已有的 session id，用 -r <id> 恢复 Kimi CLI 原生会话 */
  sessionId?: string
  /**
   * prompt 通过 stdin 传给 kimi（不再用 --prompt 命令行参数）。
   * 适用于可变长内容（review diff / CI 日志），避免 Windows CreateProcessW
   * 命令行 32767 字符上限引发 ENAMETOOLONG（Bug E-2）。
   * 实测 kimi CLI 支持 `echo "..." | kimi --print` 写法。
   */
  promptViaStdin?: boolean
}

export function runKimi(
  kimiPath: string,
  workspace: string,
  instruction: string,
  options: RunKimiOptions = {},
): KimiProcess {
  // Kimi CLI 1.41.0 usage: kimi --work-dir <dir> --prompt "<text>" --print [...options]
  // --print: run in print mode (non-interactive)
  // --output-format stream-json: structured streaming output (thinking / tool_calls / text)
  // --final-message-only: only output the final assistant message (fallback for silent mode)
  const useStdin = options.promptViaStdin === true
  const baseArgs = useStdin
    ? ['--work-dir', workspace, '--print']
    : ['--work-dir', workspace, '--prompt', instruction, '--print']
  if (options.sessionId) {
    baseArgs.push('-r', options.sessionId)
  }
  if (options.streamJson) {
    baseArgs.push('--output-format', 'stream-json')
  }
  if (options.thinking) {
    baseArgs.push('--thinking')
  }
  if (!options.streamJson) {
    baseArgs.push('--final-message-only')
  }
  let spawnCmd = kimiPath
  let spawnArgs: string[]
  if (kimiPath === '__MODULE__') {
    const module = cachedModule!
    spawnCmd = module.python
    spawnArgs = [...module.args, ...baseArgs]
  } else {
    spawnArgs = baseArgs
  }

  const env = { ...process.env }
  // Windows 默认 GBK 编码无法处理 Unicode emoji，强制 Python 使用 UTF-8
  if (!env.PYTHONIOENCODING) {
    env.PYTHONIOENCODING = 'utf-8'
  }
  // Ensure KIMI_API_KEY is passed through (injected by Rust on engine spawn)
  // If somehow missing, try to read from env directly (development fallback)
  if (!env.KIMI_API_KEY) {
    const fallback = process.env.KIMI_API_KEY
    if (fallback) env.KIMI_API_KEY = fallback
  }

  const child = spawn(spawnCmd, spawnArgs, {
    cwd: workspace,
    stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    env,
  })

  if (useStdin && child.stdin) {
    child.stdin.write(instruction)
    child.stdin.end()
  }

  const pid = child.pid!

  async function* readLines(stream: import('stream').Readable): AsyncGenerator<string> {
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      yield line
    }
  }

  return {
    pid,
    stdout: readLines(child.stdout!),
    stderr: readLines(child.stderr!),
    wait: () => {
      // 如果进程已经退出，立即返回，避免重复监听已触发的 close 事件
      if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve(child.exitCode)
      }
      return new Promise((resolve) => {
        child.once('close', (code: number | null) => resolve(code))
      })
    },
    kill: () => {
      if (process.platform === 'win32' && child.pid) {
        // Windows: use taskkill /T /F to terminate the entire process tree
        exec(`taskkill /PID ${child.pid} /T /F`, (err) => {
          // If taskkill failed and process is still alive, fallback to default kill
          if (err && !child.killed) {
            child.kill('SIGTERM')
            setTimeout(() => {
              if (!child.killed) child.kill('SIGKILL')
            }, 2000)
          }
        })
      } else {
        child.kill('SIGTERM')
        // Force kill after 2s
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 2000)
      }
    },
  }
}
