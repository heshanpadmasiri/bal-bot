import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validatePostBaselineRenderingSuites} from './hir-suite-inventory.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const registry = () => JSON.parse(readFileSync(new URL('../tests/hir-suite-inventory.json', import.meta.url), 'utf8'));

test('explicit feature suites validate without claiming frozen coverage', () => {
  const input = registry();
  assert.deepEqual([...validatePostBaselineRenderingSuites(input, new Set(), root)], input.postBaselineRenderingSuites.map(suite => suite.file));
});
for (const [name, mutate, expected] of [
  ['duplicate feature', input => input.postBaselineRenderingSuites.push(input.postBaselineRenderingSuites[0]), /Invalid post-baseline rendering/],
  ['cross-category duplicate', input => input.suites.push({...input.postBaselineRenderingSuites[0], rendering: false}), /Invalid post-baseline rendering/],
  ['infrastructure overlap', input => input.infrastructure.push({...input.postBaselineRenderingSuites[0], rendering: false}), /Invalid post-baseline rendering/],
  ['suite and infrastructure overlap', input => input.infrastructure.push({...input.suites[0]}), /Overlapping post-baseline registry entry/],
  ['helper and infrastructure overlap', input => input.infrastructure.push({...input.helpers[0]}), /Overlapping post-baseline registry entry/],
  ['unapproved playground browser path', input => { input.postBaselineRenderingSuites[0].file = 'apps/flow-playground/tests/browser/unknown.spec.mjs'; }, /Invalid post-baseline rendering/],
  ['playground node suite as rendering', input => { input.postBaselineRenderingSuites[0].file = 'apps/flow-playground/tests/controller.test.mjs'; }, /Invalid post-baseline rendering/],
  ['missing feature file', input => { input.postBaselineRenderingSuites[0].file = 'packages/compiler/hir_missing_postbaseline_test.go'; }, /ENOENT/],
  ['missing coverage command', input => { delete input.postBaselineRenderingSuites[0].coverageCommand; }, /Invalid post-baseline rendering/],
  ['non-rendering feature', input => { input.postBaselineRenderingSuites[0].rendering = false; }, /Invalid post-baseline rendering/],
]) test(`registry rejects ${name}`, () => {
  const input = registry();
  mutate(input);
  assert.throws(() => validatePostBaselineRenderingSuites(input, new Set(), root), expected);
});
test('registry rejects overlap with frozen baseline', () => {
  const input = registry();
  assert.throws(() => validatePostBaselineRenderingSuites(input, new Set([input.postBaselineRenderingSuites[0].file]), root), /Invalid post-baseline rendering/);
});
