import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 配置
 * 通过 CDP 连接 Tauri WebView2（Windows）
 *
 * 用法:
 *   1. 先启动 Tauri 应用: cargo tauri dev
 *   2. 运行测试: npx playwright test
 */

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Tauri 只有一个窗口，串行执行
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    // Tauri WebView2 CDP 连接参数
    connectOptions: {
      wsEndpoint: 'ws://localhost:9222/devtools/browser',
    },
    viewport: { width: 1400, height: 900 },
  },
  projects: [
    {
      name: 'tauri-e2e',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
