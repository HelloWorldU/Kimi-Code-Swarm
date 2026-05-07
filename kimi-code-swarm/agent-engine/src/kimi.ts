import { spawn, type ChildProcess } from 'child_process'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const CANDIDATES = ['kimi', 'C:\\Python312\\Scripts\\kimi.exe']

let cachedPath: string | null | undefined

export async function detectKimiCli(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath
  for (const cmd of CANDIDATES) {
    try {
      await execFileAsync(cmd, ['--version'])
      cachedPath = cmd
      return cmd
    } catch {
      // try next
    }
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

export function runKimi(
  kimiPath: string,
  workspace: string,
  instruction: string,
): KimiProcess {
  const child = spawn(kimiPath, ['--print', '--quiet', '-w', workspace, '-y', instruction], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const pid = child.pid!

  async function* readStream(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
    for await (const chunk of stream) {
      const text = chunk.toString()
      for (const line of text.split('\n')) {
        if (line) yield line
      }
    }
  }

  return {
    pid,
    stdout: readStream(child.stdout!),
    stderr: readStream(child.stderr!),
    wait: () =>
      new Promise((resolve) => {
        child.on('close', (code) => resolve(code))
      }),
    kill: () => {
      child.kill('SIGTERM')
      // Force kill after 2s
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 2000)
    },
  }
}
