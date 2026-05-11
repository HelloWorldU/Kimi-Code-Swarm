import { test, expect, chromium } from '@playwright/test'
import http from 'http'

/**
 * Smoke Test: 核心流程快速验证
 * 前置条件: Tauri 应用已通过 `cargo tauri dev` 启动
 */

/** 从 WebView2 CDP HTTP 端点获取 WebSocket URL */
function getWebSocketDebuggerUrl(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const pages = JSON.parse(data) as Array<{ webSocketDebuggerUrl?: string }>
          const wsUrl = pages[0]?.webSocketDebuggerUrl
          if (wsUrl) resolve(wsUrl)
          else reject(new Error('CDP /json/list 返回空列表'))
        } catch (e) {
          console.error('解析 CDP 响应失败:', e)
          reject(new Error(`解析 CDP 响应失败: ${String(e)}`))
        }
      })
    })
    req.on('error', (err) => reject(new Error(`CDP HTTP 请求失败: ${err.message}`)))
    req.setTimeout(5000, () => reject(new Error('CDP HTTP 请求超时')))
  })
}

/** 等待 CDP 端口就绪 */
async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await getWebSocketDebuggerUrl(port)
      return
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`CDP 连接重试失败: ${msg}`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error(`CDP 端口 ${port} 在 ${timeoutMs}ms 内未就绪`)
}

test.beforeEach(async () => {
  await waitForCdp(9222, 30000)
})

test('login and create agent flow', async () => {
  const wsUrl = await getWebSocketDebuggerUrl(9222)
  const browser = await chromium.connectOverCDP(wsUrl)
  const context = browser.contexts()[0]
  const page = context.pages()[0]

  // 1. 等待登录页面出现
  await expect(page.locator('[data-testid="login-button"]')).toBeVisible({
    timeout: 10000,
  })

  // 2. 输入 API Key 并登录
  await page.fill('[data-testid="api-key-input"]', 'sk-test-playwright-key')
  await page.click('[data-testid="login-button"]')

  // 3. 验证进入 Dashboard（新建 Agent 按钮出现）
  await expect(page.locator('[data-testid="create-agent-button"]')).toBeVisible({
    timeout: 10000,
  })

  // 4. 点击新建 Agent
  await page.click('[data-testid="create-agent-button"]')

  // 5. 填写表单
  await page.fill('[data-testid="agent-name-input"]', 'E2E 测试 Agent')
  await page.fill(
    '[data-testid="agent-repo-url-input"]',
    'https://github.com/HelloWorldU/Kimi-Code-Swarm',
  )
  await page.fill('[data-testid="agent-instruction-input"]', '运行 E2E 冒烟测试')

  // 6. 提交创建
  await page.click('[data-testid="agent-create-submit"]')

  // 7. 验证弹窗关闭、Dashboard 中出现新 Agent
  await expect(page.locator('[data-testid="agent-create-submit"]')).not.toBeVisible()
  await expect(page.locator('text=E2E 测试 Agent')).toBeVisible({ timeout: 5000 })

  await browser.close()
})
