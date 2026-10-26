import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 30000 },
  outputDir: '../../test-results/svg-browser',
  use: {
    browserName: 'chromium', headless: true,
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce',
    baseURL: 'http://127.0.0.1:5193/',
  },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: 'npm run build:playground && npm run preview:playground -- --host 127.0.0.1 --port 5193 --strictPort',
    url: 'http://127.0.0.1:5193/', timeout: 180000,
  },
});
