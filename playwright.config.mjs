import { defineConfig } from '@playwright/test';
import { createServer } from 'node:net';

// Give each run its own servers; reusing developer servers can test stale bundles.
if (!process.env.BAL_BOT_BROWSER_TEST_PORTS) {
  const reservations = await Promise.all(Array.from({length: 3}, () => new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  // Workers reload this config, so inherit the runner's selected ports.
  process.env.BAL_BOT_BROWSER_TEST_PORTS = JSON.stringify(reservations.map(server => server.address().port));
  await Promise.all(reservations.map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
}
const [developmentPort, productionPort, staticPort] = JSON.parse(process.env.BAL_BOT_BROWSER_TEST_PORTS);

export default defineConfig({
  testDir: './packages/compiler/tests/browser',
  timeout: 90000,
  workers: 1,
  use: { browserName: 'chromium', headless: true },
  projects: [
    { name: 'development', testIgnore: '**/static-host.spec.mjs', use: { baseURL: `http://127.0.0.1:${developmentPort}` } },
    { name: 'production', testIgnore: '**/static-host.spec.mjs', use: { baseURL: `http://127.0.0.1:${productionPort}` } },
    { name: 'static-host', testMatch: '**/static-host.spec.mjs', use: { baseURL: `http://127.0.0.1:${staticPort}/bal-bot/` } },
  ],
  webServer: [
    { reuseExistingServer: false, command: `BASE_PATH=/bal-bot/ npm run build && BASE_PATH=/bal-bot/ npm run preview -- --port ${staticPort} --strictPort`, url: `http://127.0.0.1:${staticPort}/bal-bot/`, timeout: 180000 },
    { reuseExistingServer: false, command: `node scripts/isolated_browser_server.mjs --port ${developmentPort}`, url: `http://127.0.0.1:${developmentPort}/apps/editor/tests/browser/harness.html`, timeout: 120000 },
    { reuseExistingServer: false, command: `node scripts/isolated_browser_server.mjs --production --port ${productionPort}`, url: `http://127.0.0.1:${productionPort}/apps/editor/tests/browser/harness.html`, timeout: 120000 },
  ],
});
