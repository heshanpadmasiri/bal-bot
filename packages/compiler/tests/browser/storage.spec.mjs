import { test, expect } from '@playwright/test';

async function server(page) {
  const workspaceRequests = [];
  page.on('request', request => {
    if (/\/api\/(project|sync-ticket|workspace-sync)/.test(request.url())) workspaceRequests.push(request.url());
  });
  await page.route('**/api/session', route => route.fulfill({ json: { token: 'test' } }));
  await page.route('**/api/providers', route => route.fulfill({ json: [{ id: 'openai', connected: false, models: [] }] }));
  return workspaceRequests;
}
const status = page => page.locator('.aside-bottom [role="status"]');
const open = page => page.goto('/apps/editor/tests/browser/app.html');

test('starts with Hello World and persists edits without server workspace access', async ({ page }) => {
  const requests = await server(page);
  await open(page);
  await expect(status(page)).toHaveText('Saved in this browser');
  await expect(page.getByRole('switch', { name: 'File sync', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'main.bal', exact: true }).click();
  await expect(page.getByLabel('Contents of main.bal', { exact: true })).toContainText('Hello, World!');
  await page.getByRole('button', { name: 'Edit file', exact: true }).click();
  const draft = 'import ballerina/http;\nservice / on new http:Listener(8080) {}\n// retained edit';
  await page.getByRole('textbox', { name: 'Edit main.bal', exact: true }).fill(draft);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'main.bal', exact: true }).click();
  await expect(page.getByLabel('Contents of main.bal', { exact: true })).toHaveText(draft);
  expect(requests).toEqual([]);
});

test('unavailable browser storage is read-only and reported', async ({ page }) => {
  await server(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = function() { throw new Error('Storage unavailable'); };
  });
  await open(page);
  await expect(status(page)).toHaveText('Storage unavailable');
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Could not restore or initialize browser files');
});
