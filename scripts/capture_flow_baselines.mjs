#!/usr/bin/env node
// Explicit Stage-1 writer. Ordinary tests and CI enter only through --verify.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp, rm, access} from 'node:fs/promises';
import {fork, spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {loadRenderCases} from '../apps/editor/tests/render-cases.mjs';
import {captureIntegrationFlow, generateIsolatedSVG, assertRenderCapture as assertCaptureArtifacts} from '../packages/compiler/tests/browser/render-parity.spec.mjs';
import {digest, canonical, json, prepareFonts, loadFonts, environment, browserLaunchOptions, fixtureInputs} from './flow-parity/environment.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const root = 'tests/fixtures/flow-rendering';
const manifestPath = `${root}/frozen-manifest.json`;
const pipeline = 'isolated-svg+editor-integration';
// Optional review images are never read, generated, hashed or required by this CLI.
const requiredPaths = paths => [paths.capture, paths.svg, paths.html];
const artifactInventory = cases => cases.flatMap(case_ => Object.values(case_.artifacts).flatMap(requiredPaths)).sort();
const args = process.argv.slice(2);
const operations = ['--record', '--freeze', '--verify', '--smoke', '--self-test', '--prepare-fonts'];
const modes = operations.filter(mode => args.includes(mode));
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
if (modes.length !== 1 || args.some((arg,index) => !operations.includes(arg) && !['--case','--concurrency'].includes(arg) && !['--case','--concurrency'].includes(args[index-1]))) {
  throw Error('Usage: capture_flow_baselines.mjs --record|--freeze|--verify|--smoke|--self-test|--prepare-fonts [--case ID] [--concurrency 2]');
}
const operation = modes[0];
if (process.env.CI && operation !== '--verify' && operation !== '--self-test') throw Error('CI may verify only; baseline writes/smoke are forbidden');
const exists = async path => { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const frozen = await exists(manifestPath);
if (frozen && ['--record','--freeze','--prepare-fonts'].includes(operation)) throw Error('Baseline gate is frozen: recording, replacing fonts and refreezing are prohibited');
if (args.includes('--case') && operation !== '--smoke') throw Error('--case is smoke-only: a partial run cannot certify parity');
const concurrency = Number(option('--concurrency', '1'));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw Error('Concurrency must be 1..8');
const temporary = await mkdtemp(join(tmpdir(), 'flow-parity-'));
const children = new Set();
let browser;
const run = (command, args) => new Promise((accept,reject) => {
  const child = spawn(command, args, {stdio: 'inherit'}); children.add(child);
  child.once('error', reject); child.once('exit', code => { children.delete(child); code === 0 ? accept() : reject(Error(`${command} exited ${code}`)); });
});
const server = mode => new Promise((accept,reject) => {
  const child = fork(resolve('scripts/flow-parity/server.mjs'), [mode, join(temporary, mode)], {stdio: ['ignore', 'inherit', 'inherit', 'ipc']});
  children.add(child);
  const timer = setTimeout(() => reject(Error(`${mode} server startup timed out`)), 180000);
  child.once('message', message => {clearTimeout(timer); accept(`http://127.0.0.1:${message.port}`);});
  child.once('error', error => {clearTimeout(timer); reject(error);});
  child.once('exit', code => {clearTimeout(timer); reject(Error(`${mode} server exited ${code}`));});
});
const saveJSON = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const fingerprints = cases => Object.fromEntries(cases.map(case_ => [case_.id, digest(canonical(case_))]));
function assertRenderCapture(actual, expected, label) {
  assertCaptureArtifacts(actual, expected, label);
  // Full renderInput (including programs/commits) is hashed per artifact, not
  // compared across executions. assertCaptureArtifacts checks neutral final state.
}
async function writeCapture(case_, mode, capture, outputs) {
  const paths = case_.artifacts[mode];
  const {screenshot: _optionalScreenshot, svg, flowHTML, ...metadata} = capture;
  assert.ok(Object.hasOwn(metadata, 'renderInput'), `${case_.id}: missing effective render input`);
  metadata.renderInputHash = digest(canonical(metadata.renderInput));
  const files = {
    [paths.capture]: Buffer.from(JSON.stringify({...metadata, svgAbsent: svg === null}, null, 2) + '\n'),
    [paths.svg]: Buffer.from(svg === null ? '' : svg),
    [paths.html]: Buffer.from(flowHTML),
  };
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(path), {recursive: true});
    // Never replace existing expected output, even before freeze.
    await writeFile(path, body, {flag: 'wx'});
    outputs[path] = digest(body);
  }
}
async function readCapture(case_, mode, manifest) {
  const paths = case_.artifacts[mode];
  const files = {};
  for (const path of requiredPaths(paths)) {
    if (!Object.hasOwn(manifest.artifacts, path)) throw Error(`Unregistered artifact: ${path}`);
    const body = await readFile(path);
    if (digest(body) !== manifest.artifacts[path]) throw Error(`Artifact hash mismatch: ${path}`);
    files[path] = body;
  }
  const metadata = JSON.parse(files[paths.capture].toString());
  assert.equal(typeof metadata.svgAbsent, 'boolean', `${case_.id}: missing explicit SVG presence`);
  if (metadata.svgAbsent) assert.equal(files[paths.svg].length, 0, 'Absent SVG artifact must be empty');
  assert.ok(Object.hasOwn(metadata, 'renderInput'), `${case_.id}: missing effective render input`);
  assert.equal(metadata.renderInputHash, digest(canonical(metadata.renderInput)), `${case_.id}: render input hash differs`);
  return {...metadata, svg: metadata.svgAbsent ? null : files[paths.svg].toString(), flowHTML: files[paths.html].toString()};
}
async function selfTest() {
  const fixtureRoot = join(temporary, 'fingerprint-fixture');
  await mkdir(join(fixtureRoot, 'inputs'), {recursive: true});
  await mkdir(join(fixtureRoot, 'artifacts'), {recursive: true});
  const inventory = join(fixtureRoot, 'inventory.json');
  const archive = join(fixtureRoot, 'inputs', 'browser.json');
  await writeFile(inventory, '{"mappings":["original"]}');
  await writeFile(archive, '{"provenance":"original"}');
  const originalInputs = await fixtureInputs(fixtureRoot);
  for (const path of [inventory, archive]) {
    const original = await readFile(path);
    await writeFile(path, '{"changed":true}');
    assert.notDeepEqual(await fixtureInputs(fixtureRoot), originalInputs, `${path}: mutation escaped fingerprint`);
    await writeFile(path, original);
  }
  const added = join(fixtureRoot, 'inputs', 'added.json');
  await writeFile(added, '{}');
  assert.notDeepEqual(await fixtureInputs(fixtureRoot), originalInputs, 'Added archive escaped fingerprint');
  await rm(added);
  await rm(archive);
  assert.notDeepEqual(await fixtureInputs(fixtureRoot), originalInputs, 'Deleted archive escaped fingerprint');
  await writeFile(archive, '{"provenance":"original"}');
  await writeFile(join(fixtureRoot, 'artifacts', 'capture.json'), '{}');
  await writeFile(join(fixtureRoot, 'recording.json'), '{}');
  await writeFile(join(fixtureRoot, 'frozen-manifest.json'), '{}');
  assert.deepEqual(await fixtureInputs(fixtureRoot), originalInputs, 'Generated outputs must not affect input fingerprint');
  console.log('Input fingerprint self-tests detected inventory/archive edits, additions and deletions; generated outputs excluded.');
  const page = await browser.newPage();
  await page.setContent('<div class="flow-view"><svg class="diagram"><text>label</text><path d="M0 0L20 20"/><rect x="2"/></svg><details><summary>Details</summary>signature</details></div>');
  const snapshot = async () => {
    const svg = await page.locator('svg').evaluate(e=>e.outerHTML);
    return {svg, isolatedSVG: svg, integrationSVG: svg, flowHTML: await page.locator('.flow-view').evaluate(e=>e.outerHTML), wrapper: {}, styles: {}, renderInput: {flow: {state: {kind: 'pending', revision: 1}, selection: {kind: 'function', functionId: 'test'}}, expanded: [], references: [], parameters: {width: 800}}};
  };
  const original = await snapshot();
  const html = await page.content();
  const mutations = {
    label: () => document.querySelector('text').textContent = 'changed',
    edge: () => document.querySelector('path').remove(),
    coordinate: () => document.querySelector('rect').setAttribute('x','3'),
    class: () => document.querySelector('svg').classList.add('changed'),
    style: () => document.querySelector('svg').style.color = 'red',
    disclosure: () => document.querySelector('details').open = true,
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await page.setContent(html); await page.evaluate(mutate);
    const changed = await snapshot();
    assert.throws(() => assertRenderCapture(changed, original, name), undefined, `${name} perturbation escaped detection`);
  }
  assert.throws(() => assertRenderCapture({...original, styles: {color: 'red'}}, original, 'computed styles'));
  assert.throws(() => assertRenderCapture({...original, wrapper: {mode: 'expanded'}}, original, 'wrapper'));
  assert.throws(() => assertRenderCapture({...original, renderInput: {state: {expanded: ['node']}}}, original, 'render state'));
  const clone = value => JSON.parse(JSON.stringify(value));
  const legacy = clone(original);
  legacy.renderInput.flow.state = {kind: 'ready', revision: 1, diagnostics: [], program: {legacyProgram: {scopes: [], functions: {}}}};
  legacy.renderInput.commits = [clone(legacy.renderInput)];
  const hir = clone(legacy);
  hir.renderInput.flow.state.program = {kind: 'hir', nodes: [{id: 'test'}]};
  hir.renderInput.commits = [
    {...clone(original.renderInput), expanded: ['transient']},
    {...clone(hir.renderInput), commits: undefined},
  ];
  assertRenderCapture(hir, legacy, 'different program representation and transient commit');
  for (const [name, mutate] of Object.entries({
    selection: input => input.flow.selection.functionId = 'different',
    expanded: input => input.expanded.push('node'),
    references: input => input.references.push({id: 'node', text: 'source', source: {file: 'main.bal', range: {start: 0, end: 1}}}),
    analysisKind: input => input.flow.state.kind = 'pending',
    revision: input => input.flow.state.revision++,
    diagnostics: input => input.flow.state.diagnostics.push({message: 'changed'}),
  })) {
    const changed = clone(hir);
    mutate(changed.renderInput);
    assert.throws(() => assertRenderCapture(changed, legacy, name), /final render state differs/, `${name} final-state change escaped detection`);
  }
  const referenced = clone(hir);
  referenced.renderInput.references = [{id: 'node', text: 'source', source: {file: 'main.bal', range: {start: 0, end: 1}}, revision: 1}];
  for (const field of ['id', 'text', 'source']) {
    const changed = clone(referenced);
    changed.renderInput.references[0][field] = field === 'source' ? {file: 'other.bal', range: {start: 0, end: 1}} : 'changed';
    assert.throws(() => assertRenderCapture(changed, referenced, `reference ${field}`), /final render state differs/);
  }
  const reordered = clone(referenced);
  referenced.renderInput.expanded = ['a', 'b'];
  reordered.renderInput.expanded = ['b', 'a'];
  reordered.renderInput.references[0].revision = 2;
  assertRenderCapture(reordered, referenced, 'expanded set order and incidental reference metadata');
  const failed = clone(original);
  failed.renderInput.flow.state = {kind: 'failed', revision: 1, message: 'original'};
  const changedFailure = clone(failed);
  changedFailure.renderInput.flow.state.message = 'changed';
  assert.throws(() => assertRenderCapture(changedFailure, failed, 'failure message'), /final render state differs/);
  assertRenderCapture({...original, screenshot: Buffer.from('different optional PNG')}, original, 'optional PNG ignored');
  assertRenderCapture(original, {...original, screenshot: Buffer.from('missing optional PNG')}, 'missing optional PNG ignored');
  await page.close();
  // Exercise the same persistence and required-path logic used by record/verify.
  const paths = Object.fromEntries(['capture', 'svg', 'html', 'screenshot'].map(key => [key, join(fixtureRoot, 'artifacts', `optional-test.${key}`)]));
  const case_ = {id: 'optional-png', artifacts: {development: paths}};
  const artifacts = {};
  await writeCapture(case_, 'development', original, artifacts);
  assert.deepEqual(Object.keys(artifacts).sort(), artifactInventory([case_]));
  assert.equal(await exists(paths.screenshot), false, 'Recording must not generate PNG');
  const manifest = {artifacts};
  assertRenderCapture(await readCapture(case_, 'development', manifest), original, 'missing PNG read');
  await writeFile(paths.screenshot, 'optional review image');
  assertRenderCapture(await readCapture(case_, 'development', manifest), original, 'added PNG read');
  await writeFile(paths.screenshot, 'changed optional review image');
  assertRenderCapture(await readCapture(case_, 'development', manifest), original, 'changed PNG read');
  await rm(paths.screenshot);
  assertRenderCapture(await readCapture(case_, 'development', manifest), original, 'deleted PNG read');
  for (const path of requiredPaths(paths)) {
    const body = await readFile(path);
    await rm(path);
    await assert.rejects(() => readCapture(case_, 'development', manifest), undefined, `Missing required ${path} accepted`);
    await writeFile(path, body);
    await writeFile(path, 'changed required artifact');
    await assert.rejects(() => readCapture(case_, 'development', manifest), /Artifact hash mismatch/, `Changed required ${path} accepted`);
    await writeFile(path, body);
  }
  console.log('Parity self-tests detected label, edge, geometry, class, styles, disclosure, wrapper and neutral final-state perturbations; representation/commit-history differences accepted; optional PNG absence/changes ignored; missing/changed required artifacts rejected.');
}
try {
  // Playwright's default headless launch may select headless-shell instead of
  // chromium.executablePath(), whose bytes the environment manifest hashes.
  browser = await chromium.launch({...browserLaunchOptions, executablePath: chromium.executablePath()});
  if (operation === '--self-test') { await selfTest(); }
  else if (operation === '--prepare-fonts') { await prepareFonts(browser); console.log('Font responses archived; inspect and retain the archive before recording.'); }
  else {
    const cases = await loadRenderCases();
    const fonts = await loadFonts();
    const current = await environment(browser, chromium, fonts);
    const caseHashes = fingerprints(cases);
    let manifest;
    if (operation === '--verify' || operation === '--freeze') {
      manifest = await json(operation === '--verify' ? manifestPath : `${root}/recording.json`);
      assert.equal(manifest.version, 2, 'Unsupported baseline manifest');
      assert.equal(manifest.pipeline, pipeline, 'Unsupported baseline capture pipeline');
      assert.equal(manifest.repeatRuns, 2, 'Baseline lacks two fresh-context recordings');
      assert.deepEqual(current.lock, manifest.environment, 'Pinned rendering environment drift');
      assert.deepEqual(caseHashes, manifest.cases, 'Render case/input/provenance drift');
      const expectedPaths = artifactInventory(cases);
      assert.deepEqual(manifest.requiredArtifacts, expectedPaths, 'Missing/extra required artifact inventory');
      assert.deepEqual(Object.keys(manifest.artifacts).sort(), expectedPaths, 'Missing/extra artifact hash inventory');
      for (const [path, hash] of Object.entries(manifest.artifacts)) assert.equal(digest(await readFile(path)), hash, `Artifact drift: ${path}`);
      if (operation === '--freeze') {
        // Freeze only the original production working tree, not a later refactor.
        assert.deepEqual(current.baseline, manifest.baseline, 'Production tree changed since recording');
        await saveJSON(manifestPath, {...manifest, frozen: true});
        console.log('Frozen original baseline manifest. Commit it and its artifacts before production edits.');
      } else assert.equal(manifest.frozen, true, 'Verification requires frozen baselines');
    }
    if (operation !== '--freeze') {
      const selected = operation === '--smoke' ? cases.filter(case_ => case_.id === option('--case', cases[0].id)) : cases;
      if (!selected.length) throw Error('Unknown smoke case');
      if (operation === '--record' && await exists(`${root}/recording.json`)) throw Error('Recording already exists; refusing to overwrite');
      await run('python3', ['scripts/build_compiler.py']);
      const outputs = {};
      for (const mode of ['development', 'production']) {
        const origin = await server(mode);
        let cursor = 0;
        await Promise.all(Array.from({length: concurrency}, async () => {
          while (cursor < selected.length) {
            const case_ = selected[cursor++];
            const capture = async () => {
              // Each leg gets its own fresh context with identical pinned settings
              // and fonts. The isolated leg never mounts/replays the editor.
              const inFreshContext = async task => {
                const context = await browser.newContext({baseURL: origin, viewport: case_.viewport, locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference', serviceWorkers: 'block'});
                try {
                  await fonts.install(context, origin);
                  const page = await context.newPage();
                  page.setDefaultTimeout(90000);
                  return await task(page);
                } finally { await context.close(); }
              };
              const integration = await inFreshContext(page => captureIntegrationFlow(page, case_));
              assert.ok(Object.hasOwn(integration, 'renderInput'), `${case_.id}: missing effective render input`);
              const svg = await inFreshContext(page => generateIsolatedSVG(page, case_, integration.renderInput));
              assert.equal(svg, integration.svg, `${case_.id}: isolated/integration SVG differs`);
              return {...integration, integrationSVG: integration.svg, svg, isolatedSVG: svg};
            };
            try {
              const first = await capture();
              assert.deepEqual({mode: first.wrapper.mode, width: first.wrapper.inspection?.rect.width, height: first.wrapper.inspection?.rect.height}, case_.panel, `${case_.id}: requested panel mode/size`);
              if (operation !== '--verify') assertRenderCapture(await capture(), first, `${mode}/${case_.id}: fresh-context repeat`);
              if (operation === '--record') await writeCapture(case_, mode, first, outputs);
              if (operation === '--verify') assertRenderCapture(first, await readCapture(case_, mode, manifest), `${mode}/${case_.id}`);
              console.log(`${mode}: ${case_.id} OK`);
            } catch (error) { throw Error(`${mode}/${case_.id}: ${error.message}`, {cause: error}); }
          }
        }));
      }
      if (operation === '--record') await saveJSON(`${root}/recording.json`, {version: 2, pipeline, frozen: false, repeatRuns: 2, environment: current.lock, baseline: current.baseline, cases: caseHashes, requiredArtifacts: artifactInventory(cases), artifacts: outputs});
    }
  }
} finally {
  for (const child of children) child.kill('SIGTERM');
  await browser?.close();
  await rm(temporary, {recursive: true, force: true});
}
