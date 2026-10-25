import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateRenderCoverage, validateInfrastructure} from './hir-suite-registry.mjs';
import {collectBrowserInventory} from './update_hir_goldens.mjs';

test('post-baseline flow suites require separately registered executable render scenarios', () => {
  const root = mkdtempSync(join(tmpdir(), 'hir-registry-'));
  try {
    mkdirSync(join(root, 'apps/editor/tests'), {recursive:true});
    const file = 'apps/editor/tests/hir-sample.test.mjs';
    writeFileSync(join(root, file), "test('renders operand', async () => {});\n");
    const registry = {
      suites:[{file:'packages/compiler/hir_sample_test.go', rendering:true, coverage:['sample']}, {file, rendering:true, coverage:['sample']}],
      renderCoverage:[{id:'sample', file, scenarios:['renders operand']}],
    };
    assert.equal(validateRenderCoverage(registry, root).size, 1);
    for (const mutate of [
      r => {r.suites[0].coverage = [];},
      r => {r.suites[0].coverage = ['unknown'];},
      r => {r.suites[0].rendering = false;},
      r => {r.suites.pop();},
      r => {r.renderCoverage[0].scenarios = ['not an executable test'];},
      r => {r.renderCoverage[0].scenarios = [];},
      r => {r.renderCoverage[0].scenarios = ['renders operand', 'renders operand'];},
      r => {r.renderCoverage[0].file = 'apps/editor/tests/post-baseline/unknown.test.mjs';},
      r => {r.renderCoverage[0].file = '../outside.test.mjs';},
      r => {r.renderCoverage.push({...r.renderCoverage[0]});},
    ]) {
      const invalid = structuredClone(registry);
      mutate(invalid);
      assert.throws(() => validateRenderCoverage(invalid, root));
    }
    writeFileSync(join(root, file), "// test('renders operand', async () => {});\n");
    assert.throws(() => validateRenderCoverage(registry, root), /Missing executable render scenario/);
  } finally {rmSync(root, {recursive:true, force:true});}
});

test('explicit nested template renderer coverage requires executable scenarios and an existing file', () => {
  const root = mkdtempSync(join(tmpdir(), 'hir-template-registry-'));
  try {
    const file = 'apps/editor/tests/post-baseline/template-rendering.test.mjs';
    mkdirSync(dirname(join(root, file)), {recursive:true});
    const registry = {
      suites:[{file, rendering:true, coverage:['template-flow']}],
      renderCoverage:[{id:'template-flow', file, scenarios:['renders template']}],
    };
    const write = source => writeFileSync(join(root, file), source);
    write("test('renders template', () => {});\n");
    assert.equal(validateRenderCoverage(registry, root).size, 1);
    write("// test('renders template', () => {});\n");
    assert.throws(() => validateRenderCoverage(registry, root), /Missing executable render scenario/);
    write("test('renders template', () => {}); test('renders template', () => {});\n");
    assert.throws(() => validateRenderCoverage(registry, root), /Missing executable render scenario/);
    rmSync(join(root, file));
    assert.throws(() => validateRenderCoverage(registry, root), /ENOENT/);
  } finally {rmSync(root, {recursive:true, force:true});}
});

test('infrastructure requires explicit paths, purpose, exact hashes and unique non-baseline ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'hir-infrastructure-'));
  try {
    const file = 'packages/browser-workspace/tests/compaction.test.mjs';
    const source = "test('compaction', () => {});\n";
    mkdirSync(dirname(join(root, file)), {recursive:true});
    writeFileSync(join(root, file), source);
    const registry = {suites:[], infrastructure:[{file, rendering:false, purpose:'Agent lifecycle, not flow coverage', sha256:createHash('sha256').update(source).digest('hex')}]};
    assert.deepEqual([...validateInfrastructure(registry, root)], [file]);
    assert.throws(() => validateInfrastructure(registry, root, [file]), /Invalid post-baseline infrastructure/);
    for (const mutate of [
      r => {r.infrastructure[0].file = '../outside.test.mjs';},
      r => {r.infrastructure[0].file = 'apps/editor/tests/flow.test.mjs';},
      r => {r.infrastructure[0].file = 'packages/browser-workspace/tests/missing.test.mjs';},
      r => {r.infrastructure[0].purpose = '';},
      r => {r.infrastructure[0].rendering = true;},
      r => {r.infrastructure[0].coverage = ['flow'];},
      r => {r.infrastructure[0].sha256 = '0'.repeat(64);},
      r => {r.infrastructure.push({...r.infrastructure[0]});},
      r => {r.suites.push({file});},
      r => {r.helpers = [{file}];},
      r => {r.postBaselineRenderingSuites = [{file}];},
      r => {r.infrastructure[0].file = 'apps/flow-playground/tests/unknown.test.mjs';},
      r => {r.infrastructure[0].file = 'apps/flow-playground/tests/browser/playground.spec.mjs';},
    ]) {
      const invalid = structuredClone(registry);
      mutate(invalid);
      assert.throws(() => validateInfrastructure(invalid, root));
    }
    writeFileSync(join(root, file), source + '// changed\n');
    assert.throws(() => validateInfrastructure(registry, root), /hash audit/);
  } finally {rmSync(root, {recursive:true, force:true});}
});

const root = fileURLToPath(new URL('../', import.meta.url));
test('template suites retain independently registered executable render coverage', () => {
  const templates = [
    'packages/compiler/hir_template_test.go',
    'packages/compiler/hir_template_source_test.go',
    'apps/editor/tests/post-baseline/template-rendering.test.mjs',
  ];
  const registry = JSON.parse(readFileSync(join(root, 'tests/hir-suite-inventory.json')));
  for (const file of templates) {
    const suite = registry.suites.find(entry => entry.file === file);
    assert.equal(suite?.rendering, true);
    assert.deepEqual(suite.coverage, ['template-flow']);
  }
  const coverage = validateRenderCoverage(registry, root);
  assert.equal(coverage.get('template-flow')?.file, templates[2]);
  const invalid = structuredClone(registry);
  invalid.renderCoverage.find(entry => entry.id === 'template-flow').file = 'apps/editor/tests/post-baseline/unknown.test.mjs';
  assert.throws(() => validateRenderCoverage(invalid, root), /Invalid post-baseline render coverage/);
});

test('browser collector excludes only audited infrastructure and checks mutation-repository bytes', () => {
  const repository = mkdtempSync(join(tmpdir(), 'hir-browser-infrastructure-'));
  try {
    for (const file of ['packages/compiler/tests/browser', 'packages/workspace/src/files.ts']) {
      mkdirSync(dirname(join(repository, file)), {recursive:true});
      cpSync(join(root, file), join(repository, file), {recursive:true});
    }
    symlinkSync(join(root, 'examples'), join(repository, 'examples'), 'dir');
    const collect = () => collectBrowserInventory(false, new Map(), repository);
    assert.ok(!collect().some(entry => entry.file.endsWith('/compaction.spec.mjs')));
    const file = join(repository, 'packages/compiler/tests/browser/compaction.spec.mjs');
    const source = readFileSync(file, 'utf8');
    writeFileSync(file, source + '\n// unreviewed change\n');
    assert.throws(collect, /hash audit/);
    writeFileSync(file, source);
    writeFileSync(join(repository, 'packages/compiler/tests/browser/unknown.spec.mjs'), source);
    // An unregistered copy remains in source inventory (and consequently
    // fails the immutable inventory comparison), never inheriting exclusion.
    assert.ok(collect().some(entry => entry.file.endsWith('/unknown.spec.mjs')));
  } finally {rmSync(repository, {recursive:true, force:true});}
});
