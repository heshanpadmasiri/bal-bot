import { test, expect } from '@playwright/test';

function trackBackendRequests(page) {
  const requests = [];
  const track = url => {
    if (new URL(url).pathname.startsWith('/api/')) requests.push(url);
  };
  page.on('request', request => track(request.url()));
  page.on('websocket', socket => track(socket.url()));
  return requests;
}
const open = page => page.goto('/apps/editor/tests/browser/app.html');

async function editSource(page) {
  await page.getByRole('button', { name: 'main.bal', exact: true }).click();
  await expect(page.getByLabel('Contents of main.bal', { exact: true })).toContainText('Hello, World!');
  await page.getByRole('button', { name: 'Edit file', exact: true }).click();
  const draft = 'import ballerina/http;\nservice / on new http:Listener(8080) {}\n// in-memory edit';
  await page.getByRole('textbox', { name: 'Edit main.bal', exact: true }).fill(draft);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Contents of main.bal', { exact: true })).toHaveText(draft);
}

test('source edits stay in memory and reset on reload without server workspace access', async ({ page }) => {
  const requests = trackBackendRequests(page);
  await open(page);
  await expect(page.locator('.aside-bottom')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'File sync', exact: true })).toHaveCount(0);
  await editSource(page);
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual({ local: {}, session: {} });
  await page.reload();
  await page.getByRole('button', { name: 'main.bal', exact: true }).click();
  await expect(page.getByLabel('Contents of main.bal', { exact: true })).toContainText('Hello, World!');
  expect(requests).toEqual([]);
});

test('browser storage is never accessed, even when unavailable', async ({ page }) => {
  const requests = trackBackendRequests(page);
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, name, { get() { throw new Error('Storage unavailable'); } });
    }
  });
  await open(page);
  await expect(page.locator('.aside-bottom')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeEnabled();
  await editSource(page);
  expect(requests).toEqual([]);
});

test('previously stored source is not restored or overwritten', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bal-bot.workspace.v1', JSON.stringify({ 'old.bal': '// old source' }));
  });
  await open(page);
  await expect(page.getByRole('button', { name: 'old.bal', exact: true })).toHaveCount(0);
  await editSource(page);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bal-bot.workspace.v1')))).toEqual({ 'old.bal': '// old source' });
});
