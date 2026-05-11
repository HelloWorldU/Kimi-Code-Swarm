import { test, expect, chromium } from '@playwright/test'

/**
 * Smoke Test: 核心流程快速验证
 * 前置条件: Tauri 应用已通过 `cargo tauri dev` 启动，且 WebView2 开启了
 *           `--remote-debugging-port=9222`
 */

test.beforeEach(async () => {
  // 等待 CDP 端口就绪（最多 30 秒）
  const deadline = Date.now() + 30000
  let lastErr: Error | null = null
  while (Date.now() < deadline) {
    try {
      const browser = await chromium.connectOverCDP('http://localhost:9222')
      await browser.close()
      return
    } catch (e) {
      lastErr = e as Error
      console.error(`CDP 连接重试失败: ${lastErr.message}`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(
    `CDP 端口 9222 未就绪。请先运行 "cargo tauri dev"。最后错误: ${lastErr?.message}`,
  )
})

test('login and create agent flow', async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
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
