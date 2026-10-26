// New executable render coverage, not a frozen-baseline update. Run with node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const browserLaunchOptions = {headless: true};
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('type casts render transparent operands and expandable calls', async () => {
  const bodies = [
    'int n = <int>1; return n;',
    'int n = 0; n = <int>1; return n;',
    'return <int>1;',
    'var n = <int>input; _ = n; return 1;',
    'return <int><any>value();',
    'int n = <int>value(); return n;',
    'int n = 0; n = <int>value(); return n;',
    'return <int>(check fallible());',
    'return <int>(checkpanic fallible());',
    'var n = <int|error>(trap checkpanic fallible()); _ = n; return 1;',
    'return check <int|error>fallible();',
    'return checkpanic <int|error>fallible();',
    'var n = trap <int>(checkpanic fallible()); _ = n; return 1;',
    'var n = flag ? <int>(check fallible()) : 1; _ = n; return 1;',
    'var n = flag && (<int>(check fallible()) > 0); _ = n; return 1;',
    ...['<int>value()', '<int><any>value()', '<int>(check fallible())', '<int>(checkpanic fallible())', '<int|error>(trap checkpanic fallible())'].map(expression => `var n = ${expression}; _ = n; return 1;`),
  ];
  const inputs = bodies.map(body => ({
    'Ballerina.toml':'[package]\norg = "preview"\nname = "typecast"\nversion = "0.1.0"\n',
    'main.bal':`function value() returns int { return 1; }
function fallible() returns int|error { return 1; }
function main(any input, boolean flag) returns int|error { _ = input; _ = flag; ${body} }`,
  }));
  const native = spawnSync('go', ['run', './tests/native'], {cwd:`${root}/packages/compiler`, env:{...process.env, GOWORK:'off'}, input:JSON.stringify(inputs), encoding:'utf8', maxBuffer:32*1024*1024});
  assert.equal(native.status, 0, native.stderr);
  const results = JSON.parse(native.stdout);
  assert.equal(results.length, bodies.length);
  const server = await createServer({root, configFile:false, server:{host:'127.0.0.1', port:0}});
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch(browserLaunchOptions);
    const page = await browser.newPage({viewport:{width:1440,height:1180}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let result;
    await page.route('**/post-baseline-analysis.json', route => route.fulfill({json:result}));
    for (const [index, body] of bodies.entries()) {
      result = results[index];
      assert.equal(result.kind, 'valid', JSON.stringify(result));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/flow-parity/post-baseline.html`);
      await page.locator('svg.diagram').waitFor();
      const flow = page.locator('.flow-view');
      assert.match(await flow.innerText(), /main/, body);
      assert.doesNotMatch(await flow.innerText(), /Unsupported expression/, body);
      assert.ok(await page.locator('svg.diagram path').count(), body);
      // All unconditional call scenarios expose shared function cards.
      if (/value\(\)|fallible\(\)/.test(body) && !body.includes('flag')) {
        const expand = page.getByRole('button', {name:/^Open (value|fallible)$/});
        assert.ok(await expand.count(), `Missing call disclosure: ${body}`);
        await expand.first().click();
        await page.getByRole('button', {name:/^Close (value|fallible)$/}).first().waitFor();
        assert.match(await page.locator('.function-card').innerText(), /return 1/, body);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
