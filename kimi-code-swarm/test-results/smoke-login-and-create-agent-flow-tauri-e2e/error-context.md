# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> login and create agent flow
- Location: tests\e2e\smoke.spec.ts:29:1

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

# Test source

```ts
  1  | import { test, expect, chromium } from '@playwright/test'
  2  | 
  3  | /**
  4  |  * Smoke Test: 核心流程快速验证
  5  |  * 前置条件: Tauri 应用已通过 `cargo tauri dev` 启动，且 WebView2 开启了
  6  |  *           `--remote-debugging-port=9222`
  7  |  */
  8  | 
> 9  | test.beforeEach(async () => {
     |      ^ Test timeout of 30000ms exceeded while running "beforeEach" hook.
  10 |   // 等待 CDP 端口就绪（最多 30 秒）
  11 |   const deadline = Date.now() + 30000
  12 |   let lastErr: Error | null = null
  13 |   while (Date.now() < deadline) {
  14 |     try {
  15 |       const browser = await chromium.connectOverCDP('http://localhost:9222')
  16 |       await browser.close()
  17 |       return
  18 |     } catch (e) {
  19 |       lastErr = e as Error
  20 |       console.error(`CDP 连接重试失败: ${lastErr.message}`)
  21 |       await new Promise((r) => setTimeout(r, 500))
  22 |     }
  23 |   }
  24 |   throw new Error(
  25 |     `CDP 端口 9222 未就绪。请先运行 "cargo tauri dev"。最后错误: ${lastErr?.message}`,
  26 |   )
  27 | })
  28 | 
  29 | test('login and create agent flow', async () => {
  30 |   const browser = await chromium.connectOverCDP('http://localhost:9222')
  31 |   const context = browser.contexts()[0]
  32 |   const page = context.pages()[0]
  33 | 
  34 |   // 1. 等待登录页面出现
  35 |   await expect(page.locator('[data-testid="login-button"]')).toBeVisible({
  36 |     timeout: 10000,
  37 |   })
  38 | 
  39 |   // 2. 输入 API Key 并登录
  40 |   await page.fill('[data-testid="api-key-input"]', 'sk-test-playwright-key')
  41 |   await page.click('[data-testid="login-button"]')
  42 | 
  43 |   // 3. 验证进入 Dashboard（新建 Agent 按钮出现）
  44 |   await expect(page.locator('[data-testid="create-agent-button"]')).toBeVisible({
  45 |     timeout: 10000,
  46 |   })
  47 | 
  48 |   // 4. 点击新建 Agent
  49 |   await page.click('[data-testid="create-agent-button"]')
  50 | 
  51 |   // 5. 填写表单
  52 |   await page.fill('[data-testid="agent-name-input"]', 'E2E 测试 Agent')
  53 |   await page.fill(
  54 |     '[data-testid="agent-repo-url-input"]',
  55 |     'https://github.com/HelloWorldU/Kimi-Code-Swarm',
  56 |   )
  57 |   await page.fill('[data-testid="agent-instruction-input"]', '运行 E2E 冒烟测试')
  58 | 
  59 |   // 6. 提交创建
  60 |   await page.click('[data-testid="agent-create-submit"]')
  61 | 
  62 |   // 7. 验证弹窗关闭、Dashboard 中出现新 Agent
  63 |   await expect(page.locator('[data-testid="agent-create-submit"]')).not.toBeVisible()
  64 |   await expect(page.locator('text=E2E 测试 Agent')).toBeVisible({ timeout: 5000 })
  65 | 
  66 |   await browser.close()
  67 | })
  68 | 
```