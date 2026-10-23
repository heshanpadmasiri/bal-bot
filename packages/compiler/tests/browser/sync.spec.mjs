import { test, expect } from '@playwright/test';

async function server(page, projectId = 'sync-browser-test') {
  const state = { connections: 0, operations: [], files: {
    'Ballerina.toml': '[package]\norg = "browser"\nname = "http_service"\nversion = "0.1.0"\n',
    'main.bal': 'import ballerina/http;\nservice / on new http:Listener(8080) {}\n',
  } };
  await page.route('**/api/session', route => route.fulfill({ json: { token: 'test' } }));
  await page.route('**/api/project', route => route.fulfill({ json: { id: projectId, name: 'Sync test' } }));
  await page.route('**/api/sync-ticket', route => route.fulfill({ json: { ticket: 'test' } }));
  await page.routeWebSocket('**/api/workspace-sync?*', socket => {
    state.connections++;
    let revision = 0;
    socket.send(JSON.stringify({ type: 'snapshot', projectId, epoch: 'browser-epoch', revision, files: state.files }));
    socket.onMessage(bytes => {
      const { operation } = JSON.parse(String(bytes));
      state.operations.push(operation);
      if (operation.change.kind === 'write') state.files[operation.change.path] = operation.change.content;
      else delete state.files[operation.change.path];
      socket.send(JSON.stringify({ type: 'committed', epoch: 'browser-epoch', revision: ++revision, change: operation.change }));
      socket.send(JSON.stringify({ type: 'ack', operationId: operation.operationId }));
    });
  });
  return state;
}
const toggle = page => page.getByRole('switch', { name: 'File sync', exact: true });
const status = page => page.locator('.aside-bottom [role="status"]');
const open = page => page.goto('/apps/editor/tests/browser/app.html');

test('toggle preserves drafts, queues saves across reload, and resumes synchronization', async ({ page }) => {
  const state = await server(page);
  await open(page);
  await expect(toggle(page)).toBeChecked();
  await expect(status(page)).toHaveText('Synced');
  await page.getByRole('button', { name: 'main.bal', exact: true }).click();
  await page.getByRole('button', { name: 'Edit file', exact: true }).click();
  const draft = 'import ballerina/http;\nservice / on new http:Listener(8080) {}\n// retained draft';
  await page.getByRole('textbox', { name: 'Edit main.bal', exact: true }).fill(draft);
  await toggle(page).uncheck();
  await expect(page.getByRole('textbox', { name: 'Edit main.bal', exact: true })).toHaveValue(draft);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(status(page)).toHaveText('Sync paused · 1 pending');
  expect(state.operations).toHaveLength(0);
  const connections = state.connections;
  await page.reload();
  await expect(toggle(page)).not.toBeChecked();
  await expect(status(page)).toHaveText('Sync paused · 1 pending');
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeEnabled();
  expect(state.connections).toBe(connections);
  await page.getByRole('button', { name: 'main.bal', exact: true }).click();
  await expect(page.getByLabel('Contents of main.bal', { exact: true })).toHaveText(draft);
  await toggle(page).check();
  await expect(status(page)).toHaveText('Synced');
  expect(state.operations).toHaveLength(1);
  expect(state.files['main.bal']).toBe(draft);
  await page.reload();
  await expect(toggle(page)).toBeChecked();
  await expect(status(page)).toHaveText('Synced');
});

test('toggle preferences are independent across tabs and project identities', async ({ page, context }) => {
  await server(page);
  await open(page);
  await expect(status(page)).toHaveText('Synced');
  await toggle(page).uncheck();
  const second = await context.newPage();
  await server(second);
  await open(second);
  await expect(toggle(second)).toBeChecked();
  await expect(status(second)).toHaveText('Synced');
  await expect(toggle(page)).not.toBeChecked();
  await server(page, 'different-project');
  await page.reload();
  await expect(toggle(page)).toBeChecked();
  await expect(status(page)).toHaveText('Synced');
});

test('preference storage failure keeps the previous mode and reports an error', async ({ page }) => {
  await server(page);
  await open(page);
  await expect(status(page)).toHaveText('Synced');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('bal-bot.file-sync.')) throw new Error('Preference storage unavailable');
      return original.call(this, key, value);
    };
  });
  await toggle(page).click();
  await expect(toggle(page)).toBeChecked();
  await expect(status(page)).toHaveText('Synced');
  await expect(page.getByRole('alert')).toContainText('Preference storage unavailable');
});
