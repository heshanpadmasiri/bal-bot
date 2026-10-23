import { test, expect } from '@playwright/test';

const providers = [
  ['OpenAI', 'openai'], ['Anthropic', 'anthropic'], ['Gemini', 'google'], ['OpenRouter', 'openrouter'],
];
const panel = page => page.getByRole('region', { name: 'Provider API key' });
async function select(page, name) {
  await page.getByRole('button', { name: /^Provider:/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(panel(page)).toBeVisible();
}
async function dismiss(page) {
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
}
async function setup(page) {
  const requests = [];
  page.on('request', request => requests.push({ url: request.url(), body: request.postData() ?? '' }));
  await page.route('**/api/session', route => route.fulfill({ json: { token: 'auth-ui-test' } }));
  await page.route('**/api/project', route => route.fulfill({ json: { id: 'auth-ui-test', name: 'Auth test' } }));
  await page.route('**/api/sync-ticket', route => route.fulfill({ json: { ticket: 'test' } }));
  await page.routeWebSocket('**/api/workspace-sync?*', socket => {
    socket.send(JSON.stringify({ type: 'snapshot', projectId: 'auth-ui-test', epoch: 'auth-test', revision: 0, files: {
      'main.bal': 'public function main() {}',
    } }));
  });
  await page.goto('/apps/editor/tests/browser/app.html');
  await expect(page.getByRole('button', { name: /^Provider:/ })).toBeEnabled();
  return requests;
}

test('all four API keys are independent, forgotten explicitly and on refresh, and never sent to a backend', async ({ page }) => {
  const requests = await setup(page);
  const secrets = providers.map(([, id]) => `secret-browser-${id}`);
  for (const [index, [name]] of providers.entries()) {
    await select(page, name);
    await expect(panel(page).getByRole('button', { name: 'Use API key', exact: true })).toBeDisabled();
    await panel(page).getByLabel('API key', { exact: true }).fill('   ');
    await expect(panel(page).getByRole('button', { name: 'Use API key', exact: true })).toBeDisabled();
    await expect(panel(page).getByLabel('API key', { exact: true })).toHaveAttribute('type', 'password');
    await panel(page).getByLabel('API key', { exact: true }).fill(secrets[index]);
    await panel(page).getByRole('button', { name: 'Use API key', exact: true }).click();
    await expect(panel(page)).toBeHidden();
  }
  for (const [name] of providers) {
    await select(page, name);
    await expect(panel(page).getByRole('status')).toContainText('API key configured');
    await expect(panel(page).getByLabel('API key', { exact: true })).toHaveValue('');
    await dismiss(page);
  }
  const second = await page.context().newPage();
  await setup(second);
  for (const [name] of providers) {
    await select(second, name);
    await expect(panel(second).getByRole('status')).toHaveCount(0);
    await dismiss(second);
  }
  await second.close();
  await select(page, 'Anthropic');
  await panel(page).getByRole('button', { name: 'Forget API key', exact: true }).click();
  await expect(panel(page)).toBeHidden();
  await select(page, 'Anthropic');
  await expect(panel(page).getByRole('status')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Forget API key', exact: true })).toHaveCount(0);
  await dismiss(page);
  await select(page, 'OpenAI');
  await expect(panel(page).getByRole('status')).toContainText('API key configured');
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
  for (const secret of secrets) expect(storage).not.toContain(secret);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Provider:/ })).toBeEnabled();
  for (const [name] of providers) {
    await select(page, name);
    await expect(panel(page).getByRole('status')).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: 'Use API key', exact: true })).toBeDisabled();
    await expect(panel(page).getByLabel('API key', { exact: true })).toHaveValue('');
    await dismiss(page);
  }
  const backendAuth = requests.filter(({ url }) => /\/api\/(providers|auth|login|logout|oauth)(?:[/?]|$)/.test(url));
  expect(backendAuth).toEqual([]);
  for (const secret of secrets) expect(JSON.stringify(requests)).not.toContain(secret);
});

test('all four providers issue browser requests directly and redact rejected credentials', async ({ page }) => {
  const sent = [];
  const endpoints = {
    openai: 'api.openai.com', anthropic: 'api.anthropic.com',
    google: 'generativelanguage.googleapis.com', openrouter: 'openrouter.ai',
  };
  await page.route(/https:\/\/(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai)\//, async route => {
    const request = route.request();
    sent.push({ url: request.url(), headers: await request.allHeaders() });
    await route.fulfill({ status: 401, json: { error: { message: 'secret-direct-request rejected' } } });
  });
  await page.goto('/apps/editor/tests/browser/harness.html');
  await page.waitForFunction(() => window.testProviderRequest);
  for (const [, id] of providers) {
    const result = await page.evaluate(async id => {
      await window.loginProvider(id, 'secret-direct-request');
      return window.testProviderRequest(id);
    }, id);
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).not.toContain('secret-direct-request');
    const request = sent.find(request => new URL(request.url).hostname === endpoints[id]);
    expect(request).toBeTruthy();
    expect(JSON.stringify(request)).toContain('secret-direct-request');
    expect(request.headers['x-bal-bot-session']).toBeUndefined();
  }
});

test('dismissing or switching provider discards an unsaved key', async ({ page }) => {
  await setup(page);
  await select(page, 'OpenAI');
  await panel(page).getByLabel('API key', { exact: true }).fill('unsaved-sensitive-key');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await select(page, 'OpenAI');
  await expect(panel(page).getByLabel('API key', { exact: true })).toHaveValue('');
  await panel(page).getByLabel('API key', { exact: true }).fill('second-unsaved-key');
  await select(page, 'Gemini');
  await expect(panel(page).getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(panel(page).getByRole('status')).toHaveCount(0);
});
