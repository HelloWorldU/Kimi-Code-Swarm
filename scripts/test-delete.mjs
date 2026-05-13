/**
 * 沙盒测试：验证 Windows 上进程终止 + 目录删除的完整链路
 * 模拟 agent.stop() → engine delete-agent 的真实行为
 */
import { spawn, exec } from 'child_process'
import { rm, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

const workspace = 'E:/workspace/test-delete-sandbox'

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// 1. 清理并创建测试目录
console.log('[TEST] 创建测试目录:', workspace)
await rm(workspace, { recursive: true, force: true })
await mkdir(workspace, { recursive: true })
await writeFile(`${workspace}/test.txt`, 'hello world')
await mkdir(`${workspace}/nested/deep`, { recursive: true })
await writeFile(`${workspace}/nested/deep/file.txt`, 'deep')

console.log('[TEST] 测试目录和文件已创建')

// 2. 模拟 Kimi CLI：启动一个长时间运行的进程（占用工作目录）
console.log('[TEST] 启动模拟 Kimi CLI 进程...')
const child = spawn('ping', ['-t', '127.0.0.1'], {
  cwd: workspace,
  stdio: ['ignore', 'pipe', 'pipe'],
})

console.log(`[TEST] 模拟进程 PID: ${child.pid}`)

// 3. 模拟 kimi.ts 的 kill() 逻辑
function killProcess(pid) {
  return new Promise((resolve) => {
    if (process.platform === 'win32' && pid) {
      exec(`taskkill /PID ${pid} /T /F`, (err) => {
        if (err && !child.killed) {
          child.kill('SIGTERM')
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL')
          }, 2000)
        }
        resolve()
      })
    } else {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 2000)
      resolve()
    }
  })
}

// 4. 模拟 agent.stop() 的 wait() 逻辑（修复：支持进程已退出时立即返回）
function waitForExit() {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode)
  }
  return new Promise(resolve => {
    child.once('close', (code) => resolve(code))
  })
}

// 5. 等待 1 秒后 kill（模拟 agent 执行一段时间后停止）
await sleep(1000)
console.log('[TEST] 调用 kill() 终止进程...')
await killProcess(child.pid)

console.log('[TEST] 等待进程退出...')
const code = await waitForExit()
console.log(`[TEST] 进程已退出，exit code: ${code}`)

// 6. 模拟 engine.ts delete-agent 的延迟
console.log('[TEST] 等待 2 秒释放文件句柄...')
await sleep(2000)

// 7. 模拟 engine.ts 的 rm 重试逻辑
let deleted = false
let lastError = null

for (let attempt = 1; attempt <= 3; attempt++) {
  console.log(`[TEST] 第 ${attempt} 次尝试删除目录...`)
  try {
    await rm(workspace, { recursive: true, force: true })
    deleted = true
    console.log('[TEST] ✅ rm 删除成功')
    break
  } catch (err) {
    lastError = err
    console.log(`[TEST] ❌ 第 ${attempt} 次删除失败: ${err.message}`)
    if (attempt < 3) {
      await sleep(1000)
    }
  }
}

// 8. fallback: rmdir /s /q
if (!deleted && process.platform === 'win32') {
  console.log('[TEST] fallback: 尝试 rmdir /s /q...')
  try {
    await new Promise((resolve, reject) => {
      exec(`rmdir /s /q "${workspace}"`, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    deleted = true
    console.log('[TEST] ✅ rmdir 删除成功')
  } catch (err) {
    lastError = err
    console.log(`[TEST] ❌ rmdir 也失败了: ${err.message}`)
  }
}

// 9. 验证结果
if (existsSync(workspace)) {
  console.log(`[TEST] ❌ 最终失败：目录仍然存在: ${workspace}`)
  console.log(`[TEST] 最后遇到的错误: ${lastError?.message || 'unknown'}`)
  process.exit(1)
} else {
  console.log('[TEST] ✅ 最终成功：目录已确认删除')
  process.exit(0)
}
