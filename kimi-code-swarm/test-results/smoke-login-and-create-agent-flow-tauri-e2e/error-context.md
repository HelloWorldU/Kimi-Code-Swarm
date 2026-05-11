# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> login and create agent flow
- Location: tests\e2e\smoke.spec.ts:52:1

# Error details

```
TimeoutError: browserContext.waitForEvent: Timeout 10000ms exceeded while waiting for event "page"
```

# Test source

```ts
  1   | import { test, expect, chromium } from '@playwright/test'
  2   | import http from 'http'
  3   | 
  4   | /**
  5   |  * Smoke Test: 核心流程快速验证
  6   |  * 前置条件: Tauri 应用已通过 `cargo tauri dev` 启动
  7   |  */
  8   | 
  9   | /** 从 WebView2 CDP HTTP 端点获取 WebSocket URL */
  10  | function getWebSocketDebuggerUrl(port: number): Promise<string> {
  11  |   return new Promise((resolve, reject) => {
  12  |     const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
  13  |       let data = ''
  14  |       res.on('data', (chunk) => { data += chunk })
  15  |       res.on('end', () => {
  16  |         try {
  17  |           const pages = JSON.parse(data) as Array<{ webSocketDebuggerUrl?: string }>
  18  |           const wsUrl = pages[0]?.webSocketDebuggerUrl
  19  |           if (wsUrl) resolve(wsUrl)
  20  |           else reject(new Error('CDP /json/list 返回空列表'))
  21  |         } catch (e) {
  22  |           console.error('解析 CDP 响应失败:', e)
  23  |           reject(new Error(`解析 CDP 响应失败: ${String(e)}`))
  24  |         }
  25  |       })
  26  |     })
  27  |     req.on('error', (err) => reject(new Error(`CDP HTTP 请求失败: ${err.message}`)))
  28  |     req.setTimeout(5000, () => reject(new Error('CDP HTTP 请求超时')))
  29  |   })
  30  | }
  31  | 
  32  | /** 等待 CDP 端口就绪 */
  33  | async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  34  |   const deadline = Date.now() + timeoutMs
  35  |   while (Date.now() < deadline) {
  36  |     try {
  37  |       await getWebSocketDebuggerUrl(port)
  38  |       return
  39  |     } catch (e) {
  40  |       const msg = e instanceof Error ? e.message : String(e)
  41  |       console.error(`CDP 连接重试失败: ${msg}`)
  42  |       await new Promise((r) => setTimeout(r, 1000))
  43  |     }
  44  |   }
  45  |   throw new Error(`CDP 端口 ${port} 在 ${timeoutMs}ms 内未就绪`)
  46  | }
  47  | 
  48  | test.beforeEach(async () => {
  49  |   await waitForCdp(9222, 30000)
  50  | })
  51  | 
  52  | test('login and create agent flow', async () => {
  53  |   const wsUrl = await getWebSocketDebuggerUrl(9222)
  54  |   const browser = await chromium.connectOverCDP(wsUrl)
  55  | 
  56  |   // WebView2 连接后页面可能还没创建，等待一下
  57  |   let context = browser.contexts()[0]
  58  |   if (!context) {
  59  |     context = await browser.waitForEvent('context', { timeout: 10000 })
  60  |   }
  61  |   let page = context.pages()[0]
  62  |   if (!page) {
> 63  |     page = await context.waitForEvent('page', { timeout: 10000 })
      |                          ^ TimeoutError: browserContext.waitForEvent: Timeout 10000ms exceeded while waiting for event "page"
  64  |   }
  65  | 
  66  |   // 如果 keyring 中有 API key，应用会自动登录，跳过登录页
  67  |   const isLoggedIn = await page.locator('[data-testid="create-agent-button"]').isVisible()
  68  |     .catch(() => false)
  69  | 
  70  |   if (!isLoggedIn) {
  71  |     // 1. 等待登录页面出现
  72  |     await expect(page.locator('[data-testid="login-button"]')).toBeVisible({
  73  |       timeout: 10000,
  74  |     })
  75  | 
  76  |     // 2. 输入 API Key 并登录
  77  |     await page.fill('[data-testid="api-key-input"]', 'sk-test-playwright-key')
  78  |     await page.click('[data-testid="login-button"]')
  79  |   }
  80  | 
  81  |   // 3. 验证进入 Dashboard（新建 Agent 按钮出现）
  82  |   await expect(page.locator('[data-testid="create-agent-button"]')).toBeVisible({
  83  |     timeout: 10000,
  84  |   })
  85  | 
  86  |   // 4. 点击新建 Agent
  87  |   await page.click('[data-testid="create-agent-button"]')
  88  | 
  89  |   // 5. 填写表单
  90  |   await page.fill('[data-testid="agent-name-input"]', 'E2E 测试 Agent')
  91  |   await page.fill(
  92  |     '[data-testid="agent-repo-url-input"]',
  93  |     'https://github.com/HelloWorldU/Kimi-Code-Swarm',
  94  |   )
  95  |   await page.fill('[data-testid="agent-instruction-input"]', '运行 E2E 冒烟测试')
  96  | 
  97  |   // 6. 提交创建
  98  |   await page.click('[data-testid="agent-create-submit"]')
  99  | 
  100 |   // 7. 验证弹窗关闭、Dashboard 中出现新 Agent
  101 |   await expect(page.locator('[data-testid="agent-create-submit"]')).not.toBeVisible()
  102 |   await expect(page.locator('text=E2E 测试 Agent')).toBeVisible({ timeout: 5000 })
  103 | 
  104 |   await browser.close()
  105 | })
  106 | 
```