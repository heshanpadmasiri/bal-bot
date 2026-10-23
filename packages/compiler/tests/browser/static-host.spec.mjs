import { test, expect } from '@playwright/test';

test('built app runs under a Pages subpath without backend requests', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const apiRequests = [];
  const failedRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.includes('/api/')) apiRequests.push(request.url());
  });
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(response.url());
  });
  const wasm = page.waitForResponse(response => response.url().endsWith('/bal-bot/compiler/ballerina-compiler.wasm'));
  await page.goto('./');
  expect((await wasm).ok()).toBe(true);
  await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
  await expect.poll(() => page.locator('.brand img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'main.bal', exact: true }).click();
  await expect(page.getByLabel('Contents of main.bal', { exact: true })).toContainText('Hello, World!');
  expect(pageErrors).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
});
