import {test, expect} from '@playwright/test';

const files = {'Ballerina.toml': '[package]\norg = "examples"\nname = "compaction"\nversion = "0.1.0"\n', 'main.bal': `import ballerina/http;
service /notes on new http:Listener(8080) {
 resource function get first() returns string { return "first"; }
 resource function get second() returns string { return "second"; }
}`};
const oldText = `Original goal: preserve this entire transcript. ${'old context '.repeat(3000)}`;
const failure = 'Conversation compaction failed. This conversation can no longer accept messages.';
const input = page => page.getByRole('textbox', {name: 'Message', exact: true});
const send = page => page.getByRole('button', {name: 'Send message', exact: true});
const status = page => page.getByRole('status').filter({hasText: 'Compacting conversation…'});

async function open(page) {
  await page.goto('/apps/editor/tests/browser/harness.html');
  await page.waitForFunction(() => window.ready && window.mountEditor);
  await page.evaluate(async files => {
    await window.loginProvider('openai', 'sk-browser-test-key');
    window.mountEditor(files);
  }, files);
  await page.waitForFunction(() => window.workspace.analysisSnapshot().kind === 'ready');
  await page.locator('.endpoint').first().click();
  await expect(page.getByRole('combobox', {name: 'Model', exact: true})).not.toHaveValue('');
  // Build history through the real composer and real workspace agent, not a mock agent.
  await input(page).fill(oldText);
  await send(page).click();
  await expect(page.locator('.message.assistant')).toHaveText('bal-botMock response');
  await expect(page.getByRole('button', {name: 'Stop ■', exact: true})).toHaveCount(0);
  await page.evaluate(() => {
    window.setTestContextWindow(12000);
    window.holdSummaries = true;
  });
}
async function trigger(page) {
  await input(page).fill('Continue with the next change.');
  await send(page).click();
  await expect(status(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.pendingSummaries.length)).toBe(1);
}
async function release(page, fail = false) {
  await page.evaluate(fail => {
    window.holdSummaries = false;
    window.failSummaries = fail;
    window.pendingSummaries.shift()();
  }, fail);
}
async function switchAway(page) {
  await page.locator('.endpoint').last().click();
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator('.message')).toHaveCount(0);
  await expect(input(page)).toBeEnabled();
  await input(page).fill('Independent endpoint draft');
  await expect(send(page)).toBeEnabled();
}

test('real compaction reports status, restores in-flight scope and retains the full transcript after success', async ({page}) => {
  await open(page);
  const original = await page.locator('.message').allTextContents();
  await trigger(page);
  await expect(page.getByRole('button', {name: 'Stop ■', exact: true})).toBeVisible();
  await switchAway(page);
  await page.locator('.endpoint').first().click();
  await expect(status(page)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Stop ■', exact: true})).toBeVisible();
  await release(page);
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  expect((await page.locator('.message').allTextContents()).slice(0, original.length)).toEqual(original);
  await expect(page.locator('.message.user').first()).toContainText(oldText);
  await expect(page.locator('.conversation')).not.toContainText('Earlier conversation summary');
  expect(await page.evaluate(() => window.summaryRequests.length)).toBeGreaterThan(0);
  await input(page).fill('A later message');
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  await expect(page.locator('.message.assistant')).toHaveCount(3);
});

test('Stop cancels the summary and a later send can compact and complete', async ({page}) => {
  await open(page);
  await trigger(page);
  await page.getByRole('button', {name: 'Stop ■', exact: true}).click();
  await expect(status(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.cancelledSummaries)).toBe(1);
  await expect(input(page)).toBeEnabled();
  await expect(page.locator('.message.user').first()).toContainText(oldText);
  await page.evaluate(() => {
    window.holdSummaries = false;
    // Even a late completion from the cancelled request must be harmless.
    window.pendingSummaries.shift()();
  });
  await input(page).fill('Try again after stopping');
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  await expect(page.locator('.message.assistant').last()).toContainText('Mock response');
  await expect(page.getByRole('button', {name: 'Stop ■', exact: true})).toHaveCount(0);
  await expect(status(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.prompts.length)).toBe(2);
});

test('summary failure stays in history, disables sends and is restored on returning to the endpoint', async ({page}) => {
  await open(page);
  await trigger(page);
  await release(page, true);
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator('.message-error')).toHaveText(failure);
  await expect(input(page)).toBeDisabled();
  await expect(send(page)).toBeDisabled();
  await expect(page.locator('.message.user').first()).toContainText(oldText);
  await switchAway(page);
  await page.locator('.endpoint').first().click();
  await expect(page.locator('.message-error')).toHaveText(failure);
  await expect(input(page)).toBeDisabled();
  await expect(send(page)).toBeDisabled();
  await expect(status(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.prompts.length)).toBe(1);
});
