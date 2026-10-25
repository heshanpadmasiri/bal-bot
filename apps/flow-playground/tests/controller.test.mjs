import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaygroundController } from '../src/playground-controller.ts';

function setup(t, preferred) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const requests = [];
  const compiler = {analyze(files, signal) {
    return new Promise((resolve, reject) => { requests.push({files, signal, resolve, reject}); });
  }};
  const controller = new PlaygroundController(compiler, {version: 1, source: 'initial', functionId: preferred});
  t.after(() => controller.stop());
  return {controller, requests};
}
const program = (...ids) => ({scopes: [], sources: {}, functions: Object.fromEntries(ids.map((id, i) => [id, {
  id, source: {file: 'main.bal', range: {start: {line: i + 1, column: 1}, end: {line: i + 1, column: 2}}},
  entry: {kind: 'function', owner: null, signature: `function ${id}()`, name: id},
}]))});
const valid = (...ids) => ({kind: 'valid', program: program(...ids), diagnostics: []});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('analysis is debounced for 300 ms and only receives the latest complete file', async t => {
  const {controller: c, requests} = setup(t);
  c.start();
  t.mock.timers.tick(250);
  c.setSource('second');
  t.mock.timers.tick(250);
  c.setSource('third');
  t.mock.timers.tick(299);
  assert.equal(requests.length, 0);
  t.mock.timers.tick(1);
  assert.equal(requests[0].files['main.bal'], 'third');
  assert.match(requests[0].files['Ballerina.toml'], /\[package\]/);
  assert.equal(Object.keys(requests[0].files).length, 2);
  requests[0].resolve(valid('main'));
  await flush();
  assert.equal(c.snapshot().analysis.kind, 'ready');
});

test('edits immediately mark previous output stale; invalid source and failures retain it; recovery replaces it', async t => {
  const {controller: c, requests} = setup(t);
  c.start(); t.mock.timers.tick(300);
  requests[0].resolve(valid('main')); await flush();
  const previous = c.snapshot().analysis.program;
  c.setSource('broken');
  assert.equal(c.snapshot().analysis.kind, 'pending');
  assert.equal(c.snapshot().analysis.previous, previous);
  t.mock.timers.tick(300);
  const diagnostics = [{severity: 'error', message: 'syntax error'}];
  requests[1].resolve({kind: 'invalid', diagnostics}); await flush();
  assert.equal(c.snapshot().analysis.kind, 'invalid');
  assert.equal(c.snapshot().analysis.previous, previous);
  assert.equal(c.snapshot().analysis.diagnostics, diagnostics);
  c.setSource('failure'); t.mock.timers.tick(300);
  requests[2].reject(new Error('worker failed')); await flush();
  assert.equal(c.snapshot().analysis.kind, 'failed');
  assert.equal(c.snapshot().analysis.message, 'worker failed');
  assert.equal(c.snapshot().analysis.previous, previous);
  c.setSource('fixed'); t.mock.timers.tick(300);
  requests[3].resolve(valid('recovered')); await flush();
  assert.equal(c.snapshot().selectedFunction, 'recovered');
  assert.equal(c.snapshot().analysis.kind, 'ready');
});

test('aborted and out-of-order results never overwrite current edits, even if compiler ignores cancellation', async t => {
  const {controller: c, requests} = setup(t);
  c.start(); t.mock.timers.tick(300);
  c.setSource('new');
  assert.equal(requests[0].signal.aborted, true);
  t.mock.timers.tick(300);
  requests[1].resolve(valid('new')); await flush();
  const expected = c.snapshot();
  requests[0].resolve(valid('old')); await flush();
  assert.equal(c.snapshot(), expected);
  c.setSource('next'); t.mock.timers.tick(300);
  c.setSource('latest');
  requests[2].reject(new Error('old failure')); await flush();
  assert.equal(c.snapshot().analysis.kind, 'pending');
  assert.equal(c.snapshot().source, 'latest');
});

test('preferred entry is restored, selection retained or falls back, and expansion resets', async t => {
  const {controller: c, requests} = setup(t, 'second');
  c.start(); t.mock.timers.tick(300);
  requests[0].resolve(valid('first', 'second')); await flush();
  assert.equal(c.snapshot().selectedFunction, 'second');
  c.toggleExpansion('some/path');
  assert.ok(c.snapshot().expanded.has('some/path'));
  c.toggleExpansion('some/path');
  assert.equal(c.snapshot().expanded.size, 0);
  c.toggleExpansion('some/path');
  c.selectFunction('first');
  assert.equal(c.snapshot().expanded.size, 0);
  c.selectFunction('nonexistent');
  assert.equal(c.snapshot().selectedFunction, 'first');
  c.setSource('edit'); t.mock.timers.tick(300);
  c.toggleExpansion('some/path');
  requests[1].resolve(valid('first', 'renamed')); await flush();
  assert.equal(c.snapshot().selectedFunction, 'first');
  assert.equal(c.snapshot().expanded.size, 0);
  c.setSource('rename'); t.mock.timers.tick(300);
  requests[2].resolve(valid('renamed')); await flush();
  assert.equal(c.snapshot().selectedFunction, 'renamed');
  c.setSource('empty'); t.mock.timers.tick(300);
  requests[3].resolve(valid()); await flush();
  assert.deepEqual(c.snapshot().entries, []);
  assert.equal(c.snapshot().selectedFunction, undefined);
});

test('stop cancels timers and requests; start can restart after cleanup (React Strict Mode)', async t => {
  const {controller: c, requests} = setup(t);
  let notifications = 0;
  const unsubscribe = c.subscribe(() => { notifications++; });
  c.start(); c.stop(); t.mock.timers.tick(300);
  assert.equal(requests.length, 0);
  c.start(); t.mock.timers.tick(300);
  c.stop();
  requests[0].resolve(valid('ignored')); await flush();
  assert.equal(c.snapshot().analysis.kind, 'pending');
  c.start(); t.mock.timers.tick(300);
  requests[1].resolve(valid('accepted')); await flush();
  assert.equal(c.snapshot().analysis.kind, 'ready');
  assert.ok(notifications > 0);
  unsubscribe();
  const before = notifications;
  c.setSource('unsubscribed');
  assert.equal(notifications, before);
});
