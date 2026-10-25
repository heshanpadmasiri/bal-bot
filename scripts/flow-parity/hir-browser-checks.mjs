#!/usr/bin/env node
// Read-only behavioral checks. Never writes baseline/dependency/compiler outputs.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {loadRenderCases} from '../../apps/editor/tests/render-cases.mjs';
import {captureIntegrationFlow, generateIsolatedSVG, settleFlow} from '../../packages/compiler/tests/browser/render-parity.spec.mjs';
import {loadFonts, browserLaunchOptions, digest, json} from './environment.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
assert.equal(process.argv.length, 2, 'Usage: node scripts/flow-parity/hir-browser-checks.mjs');
const temporary = await mkdtemp(join(tmpdir(), 'hir-browser-checks-'));
let child, browser;
try {
  const origin = await new Promise((accept, reject) => {
    child = fork(resolve('scripts/flow-parity/server.mjs'), ['development', temporary], {stdio: ['ignore', 'inherit', 'inherit', 'ipc']});
    const timer = setTimeout(() => reject(Error('HIR server startup timed out')), 180000);
    child.once('message', ({port}) => {clearTimeout(timer); accept(`http://127.0.0.1:${port}`);});
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', code => {clearTimeout(timer); reject(Error(`HIR server exited ${code}`));});
  });
  const fonts = await loadFonts();
  browser = await chromium.launch(browserLaunchOptions);
  async function fresh() {
    const context = await browser.newContext({baseURL: origin, locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference', serviceWorkers: 'block'});
    await fonts.install(context, origin);
    const requests = [], errors = [];
    context.on('request', request => requests.push(request.url()));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // Observe the real compiler transport; analysisRequests only covers the
    // harness's controlled-failure branch, not successful compiler.analyze.
    await page.addInitScript(() => {
      window.hirChecks = {analyze: 0, workers: 0, programs: [], initial: undefined};
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {super(...args); window.hirChecks.workers++;}
        postMessage(message, ...rest) {
          if (message?.operation === 'analyze') window.hirChecks.analyze++;
          return super.postMessage(message, ...rest);
        }
      };
      // replayRenderCase supplies the observer. Retain actual program identity
      // BEFORE its JSON capture so a mutation cannot hide behind a later clone.
      let record;
      Object.defineProperty(window, 'flowParityRecord', {
        configurable: true,
        get: () => record,
        set(fn) {record = input => {
          const program = input.flow.state.program ?? input.flow.state.previous;
          if (program && !window.hirChecks.programs.some(item => item.program === program)) {
            window.hirChecks.programs.push({program, before: JSON.stringify(program)});
          }
          if (input.flow.state.kind === 'ready' && !window.hirChecks.initial) {
            window.hirChecks.initial = {analyze: window.hirChecks.analyze, revision: input.flow.state.revision};
          }
          return fn(input);
        };},
      });
    });
    return {context, page, requests, errors};
  }
  async function assertIntegration(probe) {
    assert.deepEqual(probe.errors, [], 'Browser errors');
    const state = await probe.page.evaluate(() => ({
      component: window.flowParityComponent?.name,
      analyze: window.hirChecks.analyze, initial: window.hirChecks.initial,
      revision: window.workspace.analysisSnapshot().revision,
      immutable: window.hirChecks.programs.length > 0 && window.hirChecks.programs.every(item => item.before === JSON.stringify(item.program)),
      hirOnly: window.hirChecks.programs.every(item => item.program.sources && Object.values(item.program.functions).every(fn => Array.isArray(fn.ports))),
      control: window.controlAnalysis, controlledRequests: window.analysisRequests.length,
    }));
    assert.equal(state.component, 'FlowView');
    assert.ok(state.hirOnly && state.immutable, 'Actual stored HIR programs must remain unchanged');
    assert.ok(state.initial.analyze > 0, 'Compiler spy must observe initial real analysis');
    assert.equal(state.analyze, state.initial.analyze, 'UI expansion/selection must not analyze again');
    assert.equal(state.revision, state.initial.revision);
    assert.equal(state.control, false);
    assert.equal(state.controlledRequests, 0);
  }
  async function isolated(case_, capture) {
    const probe = await fresh();
    try {
      assert.equal(await generateIsolatedSVG(probe.page, case_, capture.renderInput), capture.svg, `${case_.id}: exact isolated SVG`);
      const globals = await probe.page.evaluate(() => ({workspace: !!window.workspace, editor: !!window.editorRoot, compiler: !!window.compiler, workers: window.hirChecks.workers, analyze: window.hirChecks.analyze}));
      assert.deepEqual(globals, {workspace: false, editor: false, compiler: false, workers: 0, analyze: 0});
      assert.deepEqual(probe.errors, []);
      assert.deepEqual(probe.requests.filter(url => /\.wasm(?:\?|$)|\/worker\.|\/mount\.tsx|\/hir-model-registry|\/compiler\/src|\/browser-workspace\/|\/editor\.tsx/.test(url)), [], 'Isolated renderer imported compiler/editor/legacy registry or requested WASM');
    } finally {await probe.context.close();}
  }
  const located = ({id, text, source}) => ({id, text, source});
  const cases = await loadRenderCases();
  const ids = [
    'example-function-expansion-fn-b9ac77aab0-expand-7',
    'example-function-expansion-fn-b9ac77aab0-expanded-panel',
    'example-panel-state-scope-1-definitions',
    'example-panel-state-fn-8851f4804a-expanded-panel',
    'example-panel-state-fn-40d5a155b2-reference',
    'example-client-calls-fn-a208dc4c53-expanded-panel',
    'example-client-calls-fn-4683679e5d-expand-2',
    'example-client-calls-fn-4683679e5d-reference',
  ];
  for (const id of ids) {
    const case_ = cases.find(item => item.id === id);
    assert.ok(case_, `Missing frozen input ${id}`);
    const probe = await fresh();
    try {
      const capture = await captureIntegrationFlow(probe.page, case_);
      await assertIntegration(probe);
      await isolated(case_, capture);
      if (capture.renderInput.flow.selection.kind === 'definitions') {
        const {program} = capture.renderInput.flow.state;
        const scope = program.scopes.find(scope => scope.id === capture.renderInput.flow.selection.scopeId);
        const definition = scope.definitions.find(definition => definition.kind === 'function');
        assert.ok(definition, 'Definitions fixture must contain a function');
        await probe.page.locator('.definitions').getByRole('button', {name: definition.label, exact: true}).click();
        await settleFlow(probe.page);
        assert.deepEqual(await probe.page.evaluate(() => window.flowParityRenderInput.flow.selection), {kind: 'function', functionId: definition.functionId}, 'Definition callback must open the definition graph, not select a call source');
        await assertIntegration(probe);
      }
      // Reference callbacks must return the source record, not expanded path IDs.
      if (capture.renderInput.references.length) {
        for (const reference of capture.renderInput.references) assert.deepEqual(located(reference), capture.renderInput.flow.state.program.sources[reference.id]);
      }
      console.log(`PASS ${id}: HIR marker, immutable program, no reanalysis, exact isolated SVG`);
    } finally {await probe.context.close();}
  }
  // Additional callback replay, independent of SVG equality assertions.
  const case_ = cases.find(item => item.id === ids[0]);
  const probe = await fresh();
  try {
    const capture = await captureIntegrationFlow(probe.page, case_);
    const beforeWasm = probe.requests.filter(url => /\.wasm(?:\?|$)/.test(url)).length;
    const page = probe.page;
    const repeated = await page.locator('g[data-node-id]').evaluateAll(nodes => {
      const counts = new Map();
      for (const node of nodes) {const id = node.getAttribute('data-node-id'); counts.set(id, (counts.get(id) ?? 0) + 1);}
      return [...counts].find(([, count]) => count > 1)?.[0];
    });
    assert.ok(repeated, 'Fixture must display repeated expanded source occurrences');
    const occurrences = page.locator(`g[data-node-id=${JSON.stringify(repeated)}] .node-select`);
    await occurrences.nth(0).click(); await settleFlow(page);
    await occurrences.nth(1).click(); await settleFlow(page);
    const selected = await page.evaluate(() => window.flowParityRenderInput.references);
    assert.deepEqual(selected.map(located), [capture.renderInput.flow.state.program.sources[repeated]], 'Repeated source highlights must deduplicate and preserve exact Located');
    assert.ok((await occurrences.evaluateAll(buttons => buttons.every(button => button.getAttribute('aria-pressed') === 'true'))));
    const header = page.getByRole('button', {name: 'Reference shared(2)', exact: true});
    const callId = await header.evaluate(button => button.closest('g').getAttribute('data-node-id'));
    await header.click(); await settleFlow(page);
    const refs = await page.evaluate(() => window.flowParityRenderInput.references);
    assert.deepEqual(located(refs.at(-1)), capture.renderInput.flow.state.program.sources[callId], 'Expanded call header must select caller, not callee definition');
    assert.notEqual(callId, repeated);
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', {name: 'Collapse shared(2)', exact: true}).click(); await settleFlow(page);
      await page.getByRole('button', {name: 'Expand shared(2)', exact: true}).click(); await settleFlow(page);
    }
    await assertIntegration(probe);
    assert.equal(probe.requests.filter(url => /\.wasm(?:\?|$)/.test(url)).length, beforeWasm);
    console.log('PASS repeated/nested expansion, caller-vs-definition source callbacks, deduplicated highlights, stable WASM requests');
  } finally {await probe.context.close();}

  // Explicit direct-JSON HIR presentation fixture (not an AST or a baseline).
  // Lone high surrogate is deliberately a JavaScript UTF-16 code unit.
  const program = await json('tests/fixtures/hir-projects/example-function-expansion/hir.golden.json');
  const fn = Object.values(program.functions).find(fn => fn.nodes.some(node => node.presentation.kind === 'plain' && node.presentation.label));
  const node = fn.nodes.find(node => node.presentation.kind === 'plain' && node.presentation.label);
  const label = 'HIR \ud83d…';
  node.presentation.label = label;
  const input = JSON.parse(JSON.stringify({flow: {state: {kind: 'ready', revision: 1, diagnostics: [], program}, selection: {kind: 'function', functionId: fn.id}}, references: [], expanded: []}));
  const utf = await fresh();
  try {
    const hash = digest(JSON.stringify(input));
    await generateIsolatedSVG(utf.page, {id: 'direct-json-utf16'}, input);
    const units = await utf.page.locator('.node-select').first().evaluate(button => ({text: Array.from({length: button.textContent.length}, (_, i) => button.textContent.charCodeAt(i)), aria: Array.from({length: button.getAttribute('aria-label').length}, (_, i) => button.getAttribute('aria-label').charCodeAt(i))}));
    const codeUnits = text => Array.from({length: text.length}, (_, i) => text.charCodeAt(i));
    assert.deepEqual(units.text, codeUnits(label));
    assert.deepEqual(units.aria, codeUnits(`Reference ${label}`));
    assert.equal(digest(JSON.stringify(input)), hash);
    assert.deepEqual(utf.errors, []);
    assert.equal(await utf.page.evaluate(() => window.hirChecks.workers), 0);
    assert.deepEqual(utf.requests.filter(url => /\.wasm(?:\?|$)/.test(url)), []);
    console.log('PASS direct JSON HIR lone-D83D DOM text/ARIA UTF-16 code units');
  } finally {await utf.context.close();}
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM'); await exited;
  }
  await rm(temporary, {recursive: true, force: true});
}
