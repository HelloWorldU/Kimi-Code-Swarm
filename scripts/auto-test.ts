#!/usr/bin/env tsx
/**
 * Agent 自测脚本
 *
 * 用法:
 *   npx tsx scripts/auto-test.ts
 *
 * 流程:
 *   1. npm run ci（快速验证：typecheck / lint / analyze / check-docs / test / build）
 *   2. 后台启动 Tauri 应用（cargo tauri dev）
 *   3. 等待 WebView2 CDP 端口就绪
 *   4. 运行 Playwright E2E
 *   5. 终止应用进程，输出结果
 *
 * 注意:
 *   - Windows 上需要 PowerShell 执行权限
 *   - Tauri 应用启动约需 15-30 秒（含 Rust 编译）
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
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`命令退出码: ${code}`))
    })
  })
}

function spawnDetached(cmd: string, args: string[], cwd: string): ChildProcess {
  return spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    shell: true,
  })
}

async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const http = await import('http')
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/json`, (res) => {
          if (res.statusCode === 200) resolve()
          else reject(new Error(`status ${res.statusCode}`))
        })
        req.on('error', reject)
        req.setTimeout(1000, () => reject(new Error('timeout')))
      })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error(`CDP 端口 ${port} 在 ${timeoutMs}ms 内未就绪`)
}

async function main() {
  let tauriProcess: ChildProcess | null = null
  let failed = false

  try {
    // 1. 快速验证
    log('CI', '运行快速验证...')
    await run('npm', ['run', 'ci'], SWARM)
    log('CI', `${COLORS.green}通过${COLORS.reset}`)

    // 2. 启动 Tauri 应用
    log('TAURI', '后台启动 Tauri 应用...')
    tauriProcess = spawnDetached('cargo', ['tauri', 'dev'], SWARM)
    log('TAURI', `PID: ${tauriProcess.pid}`)

    // 3. 等待 CDP 就绪
    log('CDP', '等待 WebView2 调试端口 (9222)...')
    await waitForCdp(9222, 60000)
    log('CDP', `${COLORS.green}就绪${COLORS.reset}`)

    // 4. 运行 E2E
    log('E2E', '运行 Playwright...')
    await run('npx', ['playwright', 'test'], SWARM)
    log('E2E', `${COLORS.green}通过${COLORS.reset}`)
  } catch (e) {
    failed = true
    log('FAIL', `${COLORS.red}${e instanceof Error ? e.message : String(e)}${COLORS.reset}`)
  } finally {
    // 5. 清理
    if (tauriProcess && tauriProcess.pid) {
      log('CLEANUP', `终止 Tauri 进程 ${tauriProcess.pid}...`)
      try {
        process.kill(-tauriProcess.pid, 'SIGTERM')
      } catch {
        // Windows 上 process group kill 可能失败，尝试 taskkill
        spawn('taskkill', ['/PID', String(tauriProcess.pid), '/T', '/F'], { shell: true })
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
