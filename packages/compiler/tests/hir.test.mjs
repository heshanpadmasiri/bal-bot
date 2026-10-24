import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateHIR } from '../src/protocol.ts';

// Share exact JSON bytes and expectations with TestHIRSharedContract in Go.
// Node's native TS loader is also used by the adjacent compiler client tests.
const root = new URL('../../../tests/fixtures/hir-contract/', import.meta.url);
const corpus = JSON.parse(await readFile(new URL('cases.json', root), 'utf8'));
assert.ok(corpus.cases.length > 0, 'empty HIR corpus');

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// A wall-clock guard makes accidental 2^24 expansion enumeration visible. This
// generous limit is not a microbenchmark; symbolic validation takes milliseconds.
test('HIR symbolic coverage: 24 independent references', { timeout: 10_000 }, async () => {
  const value = JSON.parse(await readFile(new URL('symbolic-24-independent-references.json', root), 'utf8'));
  const graph = value.functions.main;
  assert.equal(graph.nodes.length, 24);
  assert.ok(graph.nodes.every(node => node.body.kind === 'reference' && node.body.reference.graphId === 'target'));
  const condition = graph.edges[0].when;
  graph.edges[0].when = { kind: 'constant', value: true };
  const partition = { kind: 'local', itemId: 'all-expanded', when: { kind: 'not', operand: condition } };
  for (const mode of ['root', 'inline']) graph.emission[mode].edges.push(structuredClone(partition));
  validateHIR(freeze(structuredClone(value)));

  const original = graph.emission.root.edges;
  // Leave all child splices intact; only the all-expanded assignment is uncovered.
  graph.emission.root.edges = [...original.slice(0, -2), partition];
  assert.throws(() => validateHIR(freeze(structuredClone(value))), /Invalid compiler/);
  // Exactly that same rare assignment now emits the edge twice.
  graph.emission.root.edges = [...original, original.at(-2)];
  assert.throws(() => validateHIR(freeze(structuredClone(value))), /Invalid compiler/);
});

for (const fixture of corpus.cases) {
  test(`HIR shared contract: ${fixture.name} (${fixture.accept ? 'accept' : 'reject'})`, async () => {
    const value = JSON.parse(await readFile(new URL(fixture.file, root), 'utf8'));
    const before = JSON.stringify(value);
    freeze(value);
    if (!fixture.accept) {
      assert.throws(() => validateHIR(value), /Invalid compiler/, 'accepted malformed fixture or unexpected runtime failure');
    } else {
      const validated = validateHIR(value);
      assert.deepEqual(validated, value, 'validator changed wire data');
      assert.deepEqual(validateHIR(JSON.parse(JSON.stringify(validated))), value, 'round trip changed wire data');
      // Keyed-record insertion order cannot affect acceptance; ordered arrays are preserved.
      const reversed = structuredClone(value);
      for (const key of ['sources', 'functions']) {
        reversed[key] = Object.fromEntries(Object.entries(reversed[key]).reverse());
      }
      assert.deepEqual(validateHIR(freeze(reversed)), value);
    }
    assert.equal(JSON.stringify(value), before, 'validator mutated its input');
  });
}
