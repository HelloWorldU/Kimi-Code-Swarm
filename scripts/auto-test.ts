#!/usr/bin/env tsx
/**
 * Agent 自测脚本
 *
 * 用法:
 *   npx tsx scripts/auto-test.ts
 */

import { spawn, ChildProcess, execSync } from 'child_process'
import { connect } from 'net'
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

/** TCP 层探测端口是否可连 */
function tcpConnect(port: number, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('timeout'))
    }, timeout)
    socket.on('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve()
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      socket.destroy()
      reject(err)
    })
  })
}

/** 检查 WebView2 进程是否带 CDP 参数 */
function diagnoseWebView2(): string {
  try {
    const out = execSync(
      'wmic process where "name like \'%msedgewebview2%\'" get CommandLine /format:csv 2>nul',
      { encoding: 'utf-8', shell: 'cmd.exe' }
    )
    return out || '(无 WebView2 进程)'
  } catch (e) {
    return `诊断失败: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** 检查端口监听状态 */
function diagnosePort(port: number): string {
  try {
    const out = execSync(`netstat -an | findstr "${port}"`, { encoding: 'utf-8', shell: 'cmd.exe' })
    return out || '(端口未监听)'
  } catch {
    return '(端口未监听)'
  }
}

async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr = ''
  let checkCount = 0

  while (Date.now() < deadline) {
    checkCount++
    try {
      await tcpConnect(port, 2000)
      log('CDP', `端口 ${port} TCP 可连（尝试 ${checkCount} 次）`)
      return
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }

    // 每 5 秒打印一次诊断
    if (checkCount % 5 === 0) {
      log('CDP', `仍在等待端口 ${port}... (${Math.round((Date.now() - (deadline - timeoutMs)) / 1000)}s)`)
      log('DIAG', '端口状态: ' + diagnosePort(port).trim().replace(/\n/g, ', '))
    }

    await new Promise((r) => setTimeout(r, 1000))
  }

  // 最终诊断
  log('DIAG', '=== 最终诊断 ===')
  log('DIAG', '端口状态: ' + diagnosePort(port).trim().replace(/\n/g, ', '))
  log('DIAG', 'WebView2 进程: ' + diagnoseWebView2().trim().replace(/\n/g, ', ').slice(0, 500))

  throw new Error(
    `CDP 端口 ${port} 在 ${timeoutMs}ms 内未就绪。` +
    `最后错误: ${lastErr}。` +
    `可能原因: (1) WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 未生效 ` +
    `(2) WebView2 运行时版本过旧 ` +
    `(3) 端口被占用`
  )
}

async function main() {
  let tauriProcess: ChildProcess | null = null
  let failed = false

  try {
    // 1. 快速验证
    log('CI', '运行快速验证...')
    await run('npm', ['run', 'ci'], SWARM)
    log('CI', `${COLORS.green}通过${COLORS.reset}`)

    // 2. 启动 Tauri 应用（不 detached，保留输出用于调试）
    log('TAURI', '启动 Tauri 应用...')
    process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
    tauriProcess = spawn('npx', ['tauri', 'dev'], {
      cwd: SWARM,
      stdio: 'pipe',
      shell: true,
    })
    log('TAURI', `PID: ${tauriProcess.pid}`)

    // 把 stdout/stderr 转发出来，方便看启动进度
    tauriProcess.stdout?.on('data', (d) => process.stdout.write(d))
    tauriProcess.stderr?.on('data', (d) => process.stderr.write(d))

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
        spawn('taskkill', ['/PID', String(tauriProcess.pid), '/T', '/F'], {
          shell: true,
          stdio: 'ignore',
          detached: true,
        })
      } catch {
        // ignore
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
