import { test, expect, chromium } from '@playwright/test'

/**
 * Smoke Test: 核心流程快速验证
 *
 * 通过 Playwright 启动 Chromium，访问 Vite dev server (http://localhost:5173)。
 * 浏览器模式下应用自动进入 Mock 模式（isTauri = false），无需 Tauri 后端。
 *
 * 前置条件: Vite dev server 已启动（npm run dev）
 */

test('login and create agent flow', async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  // 访问前端 dev server
  await page.goto('http://localhost:5173')

  // 1. 等待登录页面出现
  await expect(page.locator('[data-testid="login-button"]')).toBeVisible({
    timeout: 10000,
  })

  // 2. 输入 API Key 并登录（Mock 模式下只检查 sk- 前缀）
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
