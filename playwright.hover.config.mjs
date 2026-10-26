import {defineConfig} from '@playwright/test';

// Post-baseline feature coverage; never records or changes frozen render cases.
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  workers: 1,
  use: {browserName: 'chromium', headless: true, viewport: {width: 1500, height: 1100}},
  projects: [
    {name: 'development', use: {baseURL: 'http://127.0.0.1:5281'}},
    {name: 'production', use: {baseURL: 'http://127.0.0.1:5282'}},
  ],
  webServer: [
    {reuseExistingServer: !process.env.CI, command: 'node tests/browser/server.mjs --port 5281', url: 'http://127.0.0.1:5281/apps/editor/tests/browser/harness.html', timeout: 120000},
    {reuseExistingServer: !process.env.CI, command: 'node tests/browser/server.mjs --production --port 5282', url: 'http://127.0.0.1:5282/apps/editor/tests/browser/harness.html', timeout: 120000},
  ],
});
