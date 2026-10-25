import { test, expect } from '@playwright/test';
import { encodeDemo } from '../../src/demo-link.ts';

const source = `function helper(int value) returns int {
    return value + 1;
}

function demo() {
    int count = helper(3);
    if count > 0 {
        count -= 1;
    }
}
`;
async function ready(page) {
  await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
}
function url(baseURL, demo) { return encodeDemo(baseURL, {version: 1, source, ...demo}); }

test('default example renders without credentials; edits show stale flow and diagnostics then recover', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await ready(page);
  await expect(page.locator('svg.diagram')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Flow playground'})).toBeVisible();
  await expect(page.getByLabel('Ballerina source')).toHaveValue(/function main\(\)/);
  await expect(page.getByRole('button', {name: /API key|Send message/})).toHaveCount(0);
  await page.getByLabel('Ballerina source').fill('function main() { int x = ;');
  await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis', 'pending');
  await expect(page.getByRole('status')).toContainText('stale');
  await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis', 'invalid');
  await expect(page.locator('.flow-diagnostics')).not.toBeEmpty();
  await expect(page.locator('svg.diagram')).toBeVisible();
  await page.getByLabel('Ballerina source').fill('function recovered() returns int { int number = 7; return number; }');
  await ready(page);
  await expect(page.locator('.flow-entry h2')).toHaveText('recovered');
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('prefilled demo, all functions, call expansion and copy-link selection round trip', async ({page, context, baseURL}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url(baseURL));
  await ready(page);
  await expect(page.getByLabel('Ballerina source')).toHaveValue(source);
  await expect(page.getByLabel('Flow entry').locator('option')).toHaveCount(2);
  await expect(page.locator('.flow-entry h2')).toHaveText('helper');
  const id = await page.getByLabel('Flow entry').locator('option').nth(1).getAttribute('value');
  await page.getByLabel('Flow entry').selectOption(id);
  await expect(page.locator('.flow-entry h2')).toHaveText('demo');
  const expand = page.getByRole('button', {name: /^Expand .*helper/});
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(page.getByRole('button', {name: /^Collapse .*helper/})).toBeVisible();
  await page.getByRole('button', {name: 'Copy demo link'}).click();
  await expect(page.getByRole('status')).toContainText('Demo link copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).pathname).toBe(new URL(baseURL).pathname);
  await page.goto(copied);
  await ready(page);
  await expect(page.getByLabel('Flow entry')).toHaveValue(id);
  await expect(page.locator('.flow-entry h2')).toHaveText('demo');
  await expect(page.getByRole('button', {name: /^Expand .*helper/})).toBeVisible();
});

test('malformed link, no entries, initial invalid input and safe source text', async ({page, baseURL}) => {
  await page.goto(`${baseURL}#not-json`);
  await expect(page.getByRole('alert')).toContainText('Showing the default example');
  await ready(page);
  await page.goto(url(baseURL, {source: 'function broken() { int x = ;'}));
  await expect(page.getByRole('status')).toContainText('Fix the source errors');
  await expect(page.locator('.flow-diagnostics')).not.toBeEmpty();
  await page.getByLabel('Ballerina source').fill('');
  await expect(page.getByRole('status')).toHaveText('No functions or endpoints in this source.');
  await expect(page.getByLabel('Flow entry')).toBeDisabled();
  const inert = 'function main() returns string { string text = "<img src=x onerror=alert(1)>"; return text; }';
  await page.getByLabel('Ballerina source').fill(inert);
  await ready(page);
  await expect(page.getByLabel('Ballerina source')).toHaveValue(inert);
  await expect(page.locator('.playground-panes img')).toHaveCount(0);
});

test('HTTP resource endpoints are selectable through the real compiler and renderer', async ({page, baseURL}) => {
  const service = `import ballerina/http;
service / on new http:Listener(8080) {
    resource function get first() returns string { return "first"; }
    resource function get second() returns string { return "second"; }
}
`;
  await page.goto(url(baseURL, {source: service}));
  await ready(page);
  const entries = page.getByLabel('Flow entry');
  await expect(entries.locator('option')).toHaveCount(2);
  await expect(page.locator('.flow-entry-kind')).toHaveText('resource');
  await expect(page.locator('.flow-entry h2')).toContainText('first');
  await entries.selectOption(await entries.locator('option').nth(1).getAttribute('value'));
  await expect(page.locator('.flow-entry h2')).toContainText('second');
  await expect(page.locator('svg.diagram')).toBeVisible();
});

test('clipboard failure is visible and narrow screens keep both panes accessible', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: async () => { throw new Error('denied'); }}});
  });
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('./');
  await ready(page);
  await page.getByRole('button', {name: 'Copy demo link'}).click();
  await expect(page.getByRole('status')).toContainText('Could not copy');
  await expect(page.getByLabel('Ballerina source')).toBeVisible();
  await expect(page.locator('svg.diagram')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
