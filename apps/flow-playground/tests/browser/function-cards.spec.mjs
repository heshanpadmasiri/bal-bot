import {test, expect} from '@playwright/test';
import {encodeDemo} from '../../src/demo-link.ts';

const source = `import ballerina/io;
function demo() returns int {
    var result = add(next(1), next(2)) + next(3);
    io:println(result);
    return result;
}
function add(int a, int b) returns int { return a + b; }
function next(int n) returns int {
    if n <= 0 { return 0; }
    return next(n - 1) + demo();
}
`;
const open = (view, name) => view.getByRole('button', {name: `Open ${name}`, exact: true});
async function load(page, baseURL) {
  await page.goto(encodeDemo(baseURL, {version: 1, source}));
  await expect(page.locator('.function-main .flow-view')).toHaveAttribute('data-analysis', 'ready');
}

test('single statements, shared cards, nested calls, recursion, hover, drag and entry reset', async ({page, baseURL}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, baseURL);
  const main = page.locator('.function-main');
  await expect(main.locator('[data-node-kind]')).toHaveCount(3);
  await expect(open(main, 'next')).toHaveCount(3);
  await expect(open(main, 'add')).toHaveCount(1);
  await expect(main.getByRole('button', {name: 'Open println', exact: true})).toBeDisabled();
  await expect(main.getByRole('button', {name: 'Open println', exact: true})).toHaveAttribute('title', /unavailable/);
  await open(main, 'next').first().hover();
  await expect(page.locator('.function-card')).toHaveCount(0);
  await open(main, 'next').first().click();
  const next = page.getByRole('region', {name: 'Function next', exact: true});
  await expect(next).toBeVisible();
  await open(main, 'next').nth(1).click();
  await expect(page.locator('.function-card')).toHaveCount(1);
  await open(next, 'next').click();
  await expect(page.locator('.function-card')).toHaveCount(1);
  await expect(next).toHaveClass(/function-highlighted/);
  await open(next, 'demo').click();
  await expect(page.locator('.function-card')).toHaveCount(1);
  await expect(main).toHaveClass(/function-highlighted/);
  await open(main, 'next').last().hover();
  await expect(next).toHaveClass(/function-highlighted/);
  await page.getByRole('heading', {name: 'Flow playground'}).hover();
  await expect(next).not.toHaveClass(/function-highlighted/);
  await open(main, 'add').click();
  const add = page.getByRole('region', {name: 'Function add', exact: true});
  await expect(add).toBeVisible();
  await expect(page.locator('.function-card')).toHaveCount(2);
  const before = await add.evaluate(element => ({x: element.style.left, y: element.style.top}));
  const handle = add.locator('.function-card-handle');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 70, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 90, {steps: 5});
  await page.mouse.up();
  const after = await add.evaluate(element => ({x: element.style.left, y: element.style.top}));
  expect(after).not.toEqual(before);
  await add.getByRole('button', {name: 'Close add', exact: true}).click();
  await expect(add).toHaveCount(0);
  await open(main, 'add').click();
  expect(await add.evaluate(element => ({x: element.style.left, y: element.style.top}))).toEqual(after);
  const entries = page.getByLabel('Flow entry');
  await entries.selectOption(await entries.locator('option').nth(2).getAttribute('value'));
  await expect(page.locator('.function-card')).toHaveCount(0);
  await expect(page.locator('.function-main .flow-entry h2')).toHaveText('next');
  await open(page.locator('.function-main'), 'next').click();
  await expect(page.locator('.function-card')).toHaveCount(0);
  await entries.selectOption(await entries.locator('option').first().getAttribute('value'));
  await open(page.locator('.function-main'), 'add').click();
  expect(await page.locator('.function-card').evaluate(element => ({x: element.style.left, y: element.style.top}))).toEqual({x: '464px', y: '0px'});
  expect(errors).toEqual([]);
});

test('queries retain source, variable highlighting and callable names for bound and outer references', async ({page, baseURL}) => {
  const querySource = `function demo() returns int[] {
    int[] values = [1, 2, 3];
    int offset = 1;
    int[] result = from int item in values
        where keep(item, offset)
        select adjust(item, offset);
    return result;
}
function keep(int candidate, int threshold) returns boolean { return candidate > threshold; }
function adjust(int candidate, int increment) returns int { return candidate + increment; }
`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(encodeDemo(baseURL, {version: 1, source: querySource}));
  const main = page.locator('.function-main');
  await expect(main.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
  await expect(page.getByLabel('Ballerina source')).toHaveValue(querySource);
  const query = main.locator('.node-select').filter({hasText: /^int\[\] result = from/});
  await expect(query).toBeVisible();
  await expect(query).toContainText('from int item in values');
  await expect(query).toContainText('where keep(item, offset)');
  await expect(query).toContainText('select adjust(item, offset);');
  await expect(main.locator('[data-node-kind="unsupported"], .node-limitation')).toHaveCount(0);

  const occurrences = (scope, name) => scope.locator('.variable-occurrence').filter({hasText: new RegExp(`^${name}$`)});
  const items = occurrences(query, 'item');
  await expect(items).toHaveCount(3);
  const itemId = await items.first().getAttribute('data-variable-id');
  expect(itemId).toBeTruthy();
  await items.last().hover();
  await expect(query.locator('.variable-active')).toHaveCount(3);
  expect(await items.evaluateAll(elements => elements.map(element => element.dataset.variableId))).toEqual([itemId, itemId, itemId]);

  const offsetDeclaration = main.locator('.node-select').filter({hasText: /^int offset = 1;$/});
  const offsetId = await occurrences(offsetDeclaration, 'offset').getAttribute('data-variable-id');
  expect(offsetId).toBeTruthy();
  expect(offsetId).not.toBe(itemId);
  await occurrences(query, 'offset').first().hover();
  await expect(occurrences(offsetDeclaration, 'offset')).toHaveClass(/variable-active/);
  await expect(query.locator('.variable-active')).toHaveCount(2);
  expect(await occurrences(query, 'offset').evaluateAll(elements => elements.map(element => element.dataset.variableId))).toEqual([offsetId, offsetId]);
  await expect(items.first()).not.toHaveClass(/variable-active/);

  await open(main, 'keep').click();
  const keep = page.getByRole('region', {name: 'Function keep', exact: true});
  await expect(keep).toContainText('return candidate > threshold;');
  await open(main, 'adjust').click();
  const adjust = page.getByRole('region', {name: 'Function adjust', exact: true});
  await expect(adjust).toContainText('return candidate + increment;');
  await expect(page.locator('.function-card')).toHaveCount(2);
  await expect(query).toContainText('select adjust(item, offset);');
  await expect(page.locator('.reference-chip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('same-named methods have distinct cards keyed by resolved function identity', async ({page, baseURL}) => {
  const methods = `function demo() returns int {
    A a = new;
    B b = new;
    return a.value() + b.value();
}
class A { public function value() returns int { return 1; } }
class B { public function value() returns int { return 2; } }`;
  await page.goto(encodeDemo(baseURL, {version: 1, source: methods}));
  const main = page.locator('.function-main');
  await expect(main.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
  await open(main, 'value').first().click();
  await open(main, 'value').last().click();
  const cards = page.locator('.function-card');
  await expect(cards).toHaveCount(2);
  expect(await cards.nth(0).getAttribute('data-function-id')).not.toBe(await cards.nth(1).getAttribute('data-function-id'));
  await expect(cards.nth(0)).toContainText('return 1;');
  await expect(cards.nth(1)).toContainText('return 2;');
});

test('many invocation names remain clickable without clipping multiline statement labels', async ({page, baseURL}) => {
  const expression = Array.from({length: 30}, (_, i) => `next(${i})`).join(' + ');
  const many = `function demo() returns int { var result = ${expression}; return result; }\nfunction next(int n) returns int { return n; }`;
  await page.goto(encodeDemo(baseURL, {version: 1, source: many}));
  const main = page.locator('.function-main');
  await expect(main.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
  await expect(open(main, 'next')).toHaveCount(30);
  expect(await main.locator('.call-label').evaluate(label => label.scrollHeight <= label.closest('foreignObject').height.baseVal.value)).toBe(true);
  await open(main, 'next').last().click();
  await expect(page.locator('.function-card')).toHaveCount(1);
});

test('valid edits refresh cards, invalid edits retain stale cards, removed functions close', async ({page, baseURL}) => {
  await load(page, baseURL);
  await open(page.locator('.function-main'), 'add').click();
  const add = page.getByRole('region', {name: 'Function add', exact: true});
  const position = await add.evaluate(element => element.style.cssText);
  await page.getByLabel('Ballerina source').fill(source.replace('a + b', 'a + b + 10'));
  await expect(add.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
  await expect(add).toContainText('return a + b + 10;');
  expect(await add.evaluate(element => element.style.cssText)).toEqual(position);
  await page.getByLabel('Ballerina source').fill('function demo() { int n = ;');
  await expect(add.locator('.flow-view')).toHaveAttribute('data-analysis', 'invalid');
  await expect(add).toContainText('stale');
  await expect(add).toContainText('return a + b + 10;');
  await page.getByLabel('Ballerina source').fill('function demo() returns int { return 1; }');
  await expect(page.locator('.function-main .flow-view')).toHaveAttribute('data-analysis', 'ready');
  await expect(page.locator('.function-card')).toHaveCount(0);
});
