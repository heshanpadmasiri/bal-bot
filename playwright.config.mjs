import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './packages/compiler/tests/browser',
  timeout: 90000,
  workers: 1,
  use: { browserName: 'chromium', headless: true },
  projects: [
    { name: 'development', use: { baseURL: 'http://127.0.0.1:5181' } },
    { name: 'production', use: { baseURL: 'http://127.0.0.1:5182' } },
  ],
  webServer: [
    { reuseExistingServer: !process.env.CI, command: 'node scripts/compiler_browser_server.mjs', url: 'http://127.0.0.1:5181/apps/editor/tests/browser/harness.html', timeout: 120000 },
    { reuseExistingServer: !process.env.CI, command: 'node scripts/compiler_browser_server.mjs --production', url: 'http://127.0.0.1:5182/apps/editor/tests/browser/harness.html', timeout: 120000 },
  ],
});
