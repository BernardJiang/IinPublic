import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests sequentially for multi-user scenarios
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for controlled test execution
  reporter: 'html',
  timeout: 300000, // 5 minutes timeout for multi-user e2e tests (Gun.js sync can be slow)

  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: false, // Show browser windows for multi-user tests
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run dev servers before tests
  webServer: [
    {
      command: 'npm run dev:server',
      port: 8080,
      timeout: 120 * 1000,
      reuseExistingServer: false, // Force fresh server to pick up code changes
    },
    {
      command: 'npm run dev:web:e2e',
      port: 3001,
      timeout: 120 * 1000,
      reuseExistingServer: false, // Force fresh server to pick up code changes
    },
  ],
});
