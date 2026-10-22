import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/apps/editor/tests/browser/harness.html');
  await page.waitForFunction(() => window.ready);
});
test('real Go WASM checks starter and invalid source while browser stays responsive', async ({ page, request }) => {
  const asset = await request.get('/compiler/ballerina-compiler.wasm');
  expect(asset.headers()['content-type']).toContain('application/wasm');
  const result = await page.evaluate(async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    try {
      const valid = await compiler.check(initialFiles);
      const invalid = await compiler.check({ ...initialFiles, 'main.bal': 'public function main() { int x = "bad"; }' });
      const restored = await compiler.check(initialFiles);
      return { valid, invalid, restored, ticks };
    } finally { clearInterval(timer); }
  });
  expect(result.valid.diagnostics).toEqual([]);
  expect(result.restored.diagnostics).toEqual([]);
  expect(result.invalid.diagnostics.some(d => d.severity === 'error' && d.file === 'main.bal' && d.range)).toBe(true);
  expect(result.ticks).toBeGreaterThan(5);
});
test('pre-abort and active cancellation leave independent checks working', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const pre = await compiler.check(initialFiles, AbortSignal.abort()).catch(e => e.name);
    const controller = new AbortController();
    const cancelled = compiler.check(initialFiles, controller.signal).catch(e => e.name);
    const independent = compiler.check(initialFiles);
    setTimeout(() => controller.abort(), 30);
    return { pre, cancelled: await cancelled, independent: await independent };
  });
  expect(result.pre).toBe('AbortError');
  expect(result.cancelled).toBe('AbortError');
  expect(result.independent.diagnostics).toEqual([]);
});
test('cancellation during bridge compilation terminates its worker', async ({ page }) => {
  await page.route('**/compiler/wasm_exec.js', async route => {
    const response = await route.fetch();
    const instrumentation = `
      let check;
      Object.defineProperty(globalThis, 'balBotCheck', {
        get() { return check; },
        set(fn) { check = request => { postMessage({ compilerStarted: true }); return fn(request); }; }
      });`;
    await route.fulfill({ response, body: await response.text() + instrumentation });
  });
  const result = await page.evaluate(async () => {
    window.controller = new AbortController();
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options);
        this.addEventListener('message', event => {
          if (event.data.compilerStarted) { event.stopImmediatePropagation(); controller.abort(); }
        });
      }
    };
    try {
      const source = Array.from({length: 15000}, (_, i) => `public int value${i} = ${i};`).join('\n');
      return await compiler.check({ ...initialFiles, 'main.bal': source }, controller.signal).catch(e => e.name);
    } finally { window.Worker = OriginalWorker; }
  });
  expect(result).toBe('AbortError');
});
for (const failure of ['missing wasm', 'invalid wasm', 'runtime exit', 'missing bridge', 'malformed bridge']) {
  test(`recovers on a fresh request after ${failure}`, async ({ page }) => {
    if (failure.includes('wasm')) {
      await page.route('**/compiler/ballerina-compiler.wasm', route => route.fulfill({ status: failure === 'missing wasm' ? 404 : 200, body: 'broken' }));
    } else {
      const body = failure === 'runtime exit'
        ? 'globalThis.Go = class { importObject = {}; async run() { throw Error("runtime crashed"); } };'
        : failure === 'missing bridge'
          ? 'globalThis.Go = class { importObject = {}; async run() { globalThis.balBotReady(); await new Promise(() => {}); } };'
          : 'globalThis.Go = class { importObject = {}; async run() { globalThis.balBotCheck = () => "{}"; globalThis.balBotReady(); await new Promise(() => {}); } };';
      await page.route('**/compiler/wasm_exec.js', route => route.fulfill({ contentType: 'text/javascript', body }));
      // Tiny valid WASM avoids requiring the fake runtime's import object.
      await page.route('**/compiler/ballerina-compiler.wasm', route => route.fulfill({ body: Buffer.from([0,97,115,109,1,0,0,0]) }));
    }
    const failed = await page.evaluate(() => compiler.check(initialFiles).then(() => false, e => e.message));
    expect(typeof failed).toBe('string');
    await page.unrouteAll();
    expect(await page.evaluate(() => compiler.check(initialFiles))).toEqual({ diagnostics: [] });
  });
}
