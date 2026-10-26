import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotMode, verifySvg } from './svg-snapshot.mjs';

const oldSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" fill="red"/></svg>\n';
const newSvg = oldSvg.replace('red', 'blue');
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'svg-snapshot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { name: 'example', expectedPath: join(dir, 'example.svg'), resultsDir: join(dir, 'results'), actual: oldSvg };
}

test('exact match passes without artifacts or baseline mutation', async t => {
  const options = await setup(t);
  await writeFile(options.expectedPath, oldSvg);
  await verifySvg(options);
  assert.equal(await readFile(options.expectedPath, 'utf8'), oldSvg);
  await assert.rejects(access(join(options.resultsDir, 'example')));
});

test('real visual difference includes source, both SVGs and an escaped three-column report', async t => {
  const options = await setup(t);
  await writeFile(options.expectedPath, oldSvg);
  const source = 'function demo() { string text = "<script>alert(1)</script>&"; }\n';
  await assert.rejects(verifySvg({ ...options, actual: newSvg, source }), /example.*rendering differs.*diff.html.*npm run update:svg/);
  const dir = join(options.resultsDir, options.name);
  assert.equal(await readFile(join(dir, 'expected.svg'), 'utf8'), oldSvg);
  assert.equal(await readFile(join(dir, 'actual.svg'), 'utf8'), newSvg);
  assert.match(await readFile(join(dir, 'diff.patch'), 'utf8'), /-.*red.*\n\+.*blue/);
  const html = await readFile(join(dir, 'diff.html'), 'utf8');
  assert.equal(await readFile(join(dir, 'source.bal'), 'utf8'), source);
  assert.match(html, /grid-template-columns:repeat\(3,/);
  assert.match(html, /<h2>Ballerina source<\/h2>.*<h2>Expected<\/h2>.*<h2>Actual<\/h2>/s);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="source.bal"/);
  assert.match(html, /title="Expected SVG"/);
  assert.match(html, /title="Actual SVG"/);
  assert.match(html, /<h2>Expected<\/h2>.*iframe/);
  assert.match(html, /<h2>Actual<\/h2>.*iframe/);
  assert.match(html, /&lt;rect/);
  assert.equal(await readFile(options.expectedPath, 'utf8'), oldSvg);
});

test('missing expected fails, never creates a baseline, and labels missing artifact', async t => {
  const options = await setup(t);
  await assert.rejects(verifySvg(options), /example.*missing expected baseline/);
  await assert.rejects(access(options.expectedPath));
  const dir = join(options.resultsDir, options.name);
  assert.match(await readFile(join(dir, 'expected.svg'), 'utf8'), /Missing expected SVG/);
  assert.equal(await readFile(join(dir, 'actual.svg'), 'utf8'), oldSvg);
  assert.match(await readFile(join(dir, 'diff.patch'), 'utf8'), /Missing expected baseline/);
});

test('omitted source is labelled and removes any stale source artifact', async t => {
  const options = await setup(t);
  await assert.rejects(verifySvg({ ...options, source: 'function demo() {}' }));
  await assert.rejects(verifySvg(options));
  const dir = join(options.resultsDir, options.name);
  const html = await readFile(join(dir, 'diff.html'), 'utf8');
  assert.match(html, /Source not supplied\./);
  assert.doesNotMatch(html, /href="source.bal"/);
  await assert.rejects(access(join(dir, 'source.bal')));
});

test('explicit local update creates then replaces baseline and clears stale mismatch artifacts', async t => {
  const options = await setup(t);
  await assert.rejects(verifySvg(options));
  await verifySvg({ ...options, update: true, env: {} });
  assert.equal(await readFile(options.expectedPath, 'utf8'), oldSvg);
  await assert.rejects(access(join(options.resultsDir, options.name)));
  await verifySvg({ ...options, actual: newSvg, update: true, env: {} });
  assert.equal(await readFile(options.expectedPath, 'utf8'), newSvg);
  await verifySvg({ ...options, actual: newSvg });
});

test('CI update is rejected before any write; CLI defaults to verify and rejects unknown flags', async t => {
  const options = await setup(t);
  assert.equal(snapshotMode([], { SVG_SNAPSHOT_UPDATE: '1' }), false);
  assert.equal(snapshotMode(['--update'], {}), true);
  assert.throws(() => snapshotMode(['--anything'], {}), /Usage/);
  for (const CI of ['true', '1']) {
    assert.throws(() => snapshotMode(['--update'], { CI }), /blocked in CI/);
    await assert.rejects(verifySvg({ ...options, update: true, env: { CI } }), /blocked in CI/);
  }
  await assert.rejects(access(options.expectedPath));
});
