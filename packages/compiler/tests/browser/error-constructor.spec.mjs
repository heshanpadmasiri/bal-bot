import {test, expect} from '@playwright/test';

const files = {
  'Ballerina.toml': '[package]\norg = "demo"\nname = "errors"\nversion = "0.1.0"\n',
  'main.bal': `public function main() returns error {
    return error("Order submission failed",
        error("Payment provider unavailable", code = "TIMEOUT"),
        orderId = "ORD-1042", retryable = true);
}
`,
};

test('error constructors show message, recursive cause and ordered details with source selection', async ({page}) => {
  await page.goto('/apps/editor/tests/browser/harness.html');
  await page.waitForFunction(() => window.ready && window.mountEditor);
  await page.evaluate(files => window.mountEditor(files), files);
  await page.waitForFunction(() => window.workspace.analysisSnapshot().kind === 'ready');
  // The cause belongs inside the outer card, not on a preceding flow edge.
  await expect(page.locator('[data-node-kind="error-constructor"]')).toHaveCount(1);
  const node = page.locator('[data-node-kind="error-constructor"]').filter({hasText: 'Order submission failed'});
  await expect(node).toHaveCount(1);
  await expect(node.locator('.error-message').first()).toHaveText('Error: "Order submission failed"');
  await expect(node.locator('.error-cause')).toHaveText('Cause:');
  await expect(node.locator('.error-message').nth(1)).toHaveText('Error: "Payment provider unavailable"');
  await expect(node.locator('.error-detail')).toHaveText(['Details: code: "TIMEOUT"', 'Details: orderId: "ORD-1042"', 'retryable: true']);
  await expect(node.locator('.node-disclosure')).toHaveCount(0);
  await expect(page.locator('.node-limitation')).toHaveCount(0);
  const appearance = await node.evaluate(element => {
    const message = getComputedStyle(element.querySelector('.error-message'));
    const cause = getComputedStyle(element.querySelector('.error-cause'));
    const detail = getComputedStyle(element.querySelector('.error-detail'));
    const button = element.querySelector('.node-select');
    return {messageWeight: message.fontWeight, causeWeight: cause.fontWeight, colors: [message.color, cause.color, detail.color], fits: button.scrollHeight <= button.closest('foreignObject').height.baseVal.value};
  });
  expect(Number(appearance.messageWeight)).toBeGreaterThan(Number(appearance.causeWeight));
  expect(new Set(appearance.colors).size).toBe(3);
  expect(appearance.fits).toBe(true);
  await node.locator('.node-select').click();
  await expect(page.locator('.reference-chip')).toHaveCount(1);
  await expect(page.locator('.reference-chip')).toContainText('main.bal:2');
  await expect(node.locator('.node-select')).toHaveAttribute('aria-pressed', 'true');
});

test('message-only, nil cause and long Unicode details remain visible', async ({page}) => {
  await page.goto('/apps/editor/tests/browser/harness.html');
  await page.waitForFunction(() => window.ready && window.mountEditor);
  await page.evaluate(files => window.mountEditor({...files, 'main.bal': `public function main() {
    error first = error("Only a message");
    error second = error("Delivery failed 😀", (), context = "A long delivery description with Unicode café and enough words to wrap onto several lines without clipping the final value");
    _ = first; _ = second;
}`}), files);
  await page.waitForFunction(() => window.workspace.analysisSnapshot().kind === 'ready');
  const nodes = page.locator('[data-node-kind="error-constructor"]');
  await expect(nodes).toHaveCount(2);
  await expect(nodes.first().locator('.error-message')).toHaveText('Error: "Only a message"');
  await expect(nodes.first().locator('.error-cause,.error-detail')).toHaveCount(0);
  await expect(nodes.nth(1).locator('.error-cause')).toHaveText('Cause: ()');
  await expect(nodes.nth(1).locator('.error-detail')).toContainText('final value');
  for (const node of await nodes.all()) {
    expect(await node.locator('.node-select').evaluate(button => button.scrollHeight <= button.closest('foreignObject').height.baseVal.value)).toBe(true);
  }
});
