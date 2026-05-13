#!/usr/bin/env tsx
/**
 * Agent 自测脚本
 *
 * 用法:
 *   npx tsx scripts/auto-test.ts
 *
 * 流程:
 *   1. npm run ci（快速验证）
 *   2. 启动 Vite dev server（npm run dev）
 *   3. 运行 Playwright E2E（Chromium 访问 http://localhost:5173，Mock 模式）
 *   4. 终止 dev server，输出结果
 *
 * 注意:
 *   - E2E 在浏览器 Mock 模式下运行，不依赖 Tauri 后端
 *   - Tauri 桌面集成测试需另行验证
 */

import { spawn, ChildProcess } from 'child_process'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '..')
const SWARM = resolve(ROOT, 'kimi-code-swarm')

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

function log(stage: string, message: string) {
  console.log(`${COLORS.cyan}[${stage}]${COLORS.reset} ${message}`)
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`命令退出码: ${code}`))
    })
  })
}

async function waitForDevServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(url).catch(() => null)
    if (res?.ok) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Dev server ${url} 在 ${timeoutMs}ms 内未就绪`)
}

async function main() {
  let devServer: ChildProcess | null = null
  let failed = false

  try {
    // 1. 快速验证
    log('CI', '运行快速验证...')
    await run('npm', ['run', 'ci'], SWARM)
    log('CI', `${COLORS.green}通过${COLORS.reset}`)

    // 2. 启动 Vite dev server
    log('DEV', '启动 Vite dev server...')
    devServer = spawn('npm', ['run', 'dev'], {
      cwd: SWARM,
      stdio: 'pipe',
      shell: true,
    })
    log('DEV', `PID: ${devServer.pid}`)

    devServer.stdout?.on('data', (d) => process.stdout.write(d))
    devServer.stderr?.on('data', (d) => process.stderr.write(d))

    // 3. 等待 dev server 就绪
    log('DEV', '等待 http://localhost:5173 就绪...')
    await waitForDevServer('http://localhost:5173', 30000)
    log('DEV', `${COLORS.green}就绪${COLORS.reset}`)

    // 4. 运行 E2E
    log('E2E', '运行 Playwright...')
    await run('npx', ['playwright', 'test'], SWARM)
    log('E2E', `${COLORS.green}通过${COLORS.reset}`)
  } catch (e) {
    failed = true
    console.error(`[auto-test] E2E 流程异常: ${e instanceof Error ? e.message : String(e)}`)
    log('FAIL', `${COLORS.red}${e instanceof Error ? e.message : String(e)}${COLORS.reset}`)
  } finally {
    // 5. 清理
    if (devServer && devServer.pid) {
      log('CLEANUP', `终止 dev server ${devServer.pid}...`)
      try {
        spawn('taskkill', ['/PID', String(devServer.pid), '/T', '/F'], {
          shell: true,
          stdio: 'ignore',
          detached: true,
        })
      } catch {
        // expected: 进程可能已退出，taskkill 失败是正常的
      }
    }
  }

  if (failed) {
    process.exit(1)
  } else {
    log('DONE', `${COLORS.green}全部通过${COLORS.reset}`)
  }
}

main()
