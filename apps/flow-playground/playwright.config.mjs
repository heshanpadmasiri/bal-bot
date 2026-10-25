import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  expect: {timeout: 30000},
  workers: 1,
  use: {browserName: 'chromium', headless: true},
  projects: [
    {name: 'development', use: {baseURL: 'http://127.0.0.1:5191/'}},
    {name: 'production', use: {baseURL: 'http://127.0.0.1:5192/flow-playground/'}},
  ],
  webServer: [
    {cwd, command: 'npm exec --workspace @bal-bot/flow-playground -- vite --host 127.0.0.1 --port 5191 --strictPort', url: 'http://127.0.0.1:5191', timeout: 120000},
    {cwd, command: 'BASE_PATH=/flow-playground/ npm run build:playground && BASE_PATH=/flow-playground/ npm run preview:playground -- --port 5192 --strictPort', url: 'http://127.0.0.1:5192/flow-playground/', timeout: 180000},
  ],
});
