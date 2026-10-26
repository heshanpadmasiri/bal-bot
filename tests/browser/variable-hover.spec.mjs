import {test, expect} from '@playwright/test';

const source = `int shared = 10;
function adjust(int value) returns int {
    int result = value + shared;
    result += value;
    return result;
}
public function main() {
    int total = shared;
    total += shared;
    { int shared = 99; _ = shared; }
    record {| int total; |} item = {total: total};
    _ = item.total;
    _ = "total";
    int first = adjust(total);
    int second = adjust(total);
    _ = first + second;
}`;
const files = {
  'Ballerina.toml': '[package]\norg = "hover"\nname = "demo"\nversion = "0.1.0"\n',
  'main.bal': source,
};

async function open(page, text = source) {
  await page.goto('/apps/editor/tests/browser/harness.html');
  await page.waitForFunction(() => window.ready && window.mountEditor);
  await page.evaluate(files => window.mountEditor(files), {...files, 'main.bal': text});
  await page.waitForFunction(() => window.workspace.analysisSnapshot().kind === 'ready');
  await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', {name: 'Expand inspection', exact: true}).click();
}
const node = (page, text) => page.locator('.node-select').filter({hasText: text});
const variable = (button, name) => button.locator('.variable-occurrence').filter({hasText: new RegExp(`^${name}$`)});

async function expectRelated(page, id) {
  const expected = await page.locator('.diagram g[data-node-id]').evaluateAll((nodes, id) => nodes.filter(n => [...n.querySelectorAll('[data-variable-id]')].some(v => v.dataset.variableId === id)).length, id);
  expect(expected).toBeGreaterThan(0);
  await expect(page.locator('.flow-node.variable-related')).toHaveCount(expected);
  const activeIds = await page.locator('.variable-active').evaluateAll(nodes => [...new Set(nodes.map(n => n.dataset.variableId))]);
  expect(activeIds).toEqual([id]);
}

test('hover distinguishes symbols, preserves clicks and geometry, and clears on leave', async ({page}) => {
  await open(page);
  const declaration = node(page, /^int total = shared;$/);
  const target = variable(declaration, 'total');
  const id = await target.getAttribute('data-variable-id');
  const before = await page.locator('.diagram').evaluate(svg => ({viewBox: svg.getAttribute('viewBox'), boxes: [...svg.querySelectorAll('.node-select')].map(n => {const r = n.getBoundingClientRect(); return [r.x,r.y,r.width,r.height];})}));
  await target.hover();
  await expectRelated(page, id);
  const shared = variable(declaration, 'shared');
  await shared.hover();
  await expectRelated(page, await shared.getAttribute('data-variable-id'));
  await expect(variable(node(page, /^int shared = 99;$/), 'shared')).not.toHaveClass(/variable-active/);
  await target.hover();
  await expect(node(page, /^_ = item.total;$/).locator('.variable-occurrence')).toHaveText('item');
  await expect(node(page, /^_ = "total";$/).locator('.variable-occurrence')).toHaveCount(0);
  const mappingVariables = node(page, /record.*item =/).locator('.variable-occurrence');
  await expect(mappingVariables).toHaveText(['item', /tota\s*l/]);
  await mappingVariables.last().hover();
  await expectRelated(page, id);
  expect(await page.locator('.diagram').evaluate(svg => ({viewBox: svg.getAttribute('viewBox'), boxes: [...svg.querySelectorAll('.node-select')].map(n => {const r = n.getBoundingClientRect(); return [r.x,r.y,r.width,r.height];})}))).toEqual(before);
  await expect(page.locator('.reference-chip')).toHaveCount(0);
  await target.click();
  await expect(page.locator('.reference-chip')).toHaveCount(1);
  await expect(declaration.locator('xpath=ancestor::*[local-name()="g"][1]').locator('.flow-node')).toHaveClass(/referenced/);
  await page.mouse.move(5, 5);
  await expect(page.locator('.variable-active,.variable-related')).toHaveCount(0);
  await expect(page.locator('.flow-node.referenced')).toHaveCount(1);
  await expect(page.locator('.variable-occurrence[tabindex]')).toHaveCount(0);
  // Keyboard focus on the existing source button must not activate variable hover.
  await declaration.focus();
  await expect(page.locator('.variable-active')).toHaveCount(0);
});

test('expanded call instances share variable identity without tracing caller arguments', async ({page}) => {
  await open(page);
  const disclosures = page.getByRole('button', {name: /^Expand adjust\(total\)/});
  await expect(disclosures).toHaveCount(2);
  await disclosures.first().click();
  await disclosures.last().click();
  const declarations = node(page, /^int result = value \+ shared;$/);
  await expect(declarations).toHaveCount(2);
  const target = variable(declarations.first(), 'value');
  await target.hover();
  const id = await target.getAttribute('data-variable-id');
  await expectRelated(page, id);
  await expect(variable(declarations.last(), 'value')).toHaveClass(/variable-active/);
  await expect(page.locator('.variable-occurrence').filter({hasText: /^total$/}).and(page.locator('.variable-active'))).toHaveCount(0);
  await expect(page.locator('.reference-chip')).toHaveCount(0);
});

test('signature and parameter declarations participate; edits clear stale highlighting', async ({page}) => {
  await open(page, `public function main(int value = 3) {
 int result = value;
 _ = result + value;
}`);
  await expect(page.locator('.node-select')).toHaveCount(2);
  await page.locator('.flow-entry summary').click();
  const parameter = page.locator('.flow-entry dd .variable-occurrence').filter({hasText: /^value$/});
  await parameter.hover();
  const id = await parameter.getAttribute('data-variable-id');
  await expectRelated(page, id);
  await expect(page.locator('.flow-entry-signature .variable-active')).toHaveText('value');
  await page.evaluate(() => workspace.write('main.bal', 'public function main() { int other = 1; _ = other; }'));
  await page.waitForFunction(() => workspace.analysisSnapshot().kind === 'ready');
  await expect(page.locator('.variable-active,.variable-related')).toHaveCount(0);
});

test('client label sections and initialization disclosures preserve variable identities', async ({page}) => {
  await open(page, `client class Client {
 function init(string name) { _ = name; }
 remote function send(string text) returns string => text;
}
public function main() {
 string input = "value";
 Client caller = new (input + "${'x'.repeat(100)}");
 string output = caller->send(input);
 _ = output;
}`);
  const client = page.locator('.client-header .node-select');
  const receiver = variable(client, 'caller');
  await receiver.hover();
  await expectRelated(page, await receiver.getAttribute('data-variable-id'));
  const disclosure = page.getByRole('button', {name: 'Expand client initialization', exact: true});
  await disclosure.click();
  const input = variable(client, 'input').last();
  await input.hover();
  await expectRelated(page, await input.getAttribute('data-variable-id'));
  await expect(variable(node(page, /^string input = "value";$/), 'input')).toHaveClass(/variable-active/);
  await expect(page.locator('.reference-chip')).toHaveCount(0);
});
