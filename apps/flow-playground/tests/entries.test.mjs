import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listEntries, resolveEntry } from '../src/entries.ts';

function graph(id, file, line, column, entry = {}) {
  return {
    id,
    source: { file, range: { start: { line: line + 1, column: column + 1 }, end: { line: line + 2, column: 1 } } },
    entry: { kind: 'function', owner: null, name: 'main', signature: 'main()', ...entry },
  };
}
function program(...graphs) {
  return { functions: Object.fromEntries(graphs.map(g => [g.id, g])), scopes: [], sources: {} };
}

test('entries enumerate all function graphs, regardless of scopes or entry kind', () => {
  const graphs = [
    graph('f', 'a.bal', 0, 0),
    graph('m', 'a.bal', 1, 0, { kind: 'method', owner: 'Client', signature: 'send(string message)' }),
    graph('r', 'a.bal', 2, 0, { kind: 'resource', owner: '/api', signature: 'get users/[string id]()' }),
    graph('remote', 'a.bal', 3, 0, { kind: 'remote', owner: 'Worker', signature: 'run()' }),
  ];
  const entries = listEntries(program(...graphs));
  assert.deepEqual(entries.map(e => e.id), ['f', 'm', 'r', 'remote']);
  assert.equal(entries[0].label, 'main()');
  assert.ok(entries[1].label.includes('Client'));
  assert.ok(entries[1].label.includes('send(string message)'));
  assert.ok(entries[2].label.includes('/api'));
  for (let i = 0; i < graphs.length; i++) assert.equal(entries[i].source, graphs[i].source);
});

test('entries sort by file, source line, source column, then ID without mutating program', () => {
  const graphs = [graph('z', 'b.bal', 0, 0), graph('c', 'a.bal', 2, 0),
    graph('b', 'a.bal', 1, 2), graph('a', 'a.bal', 1, 2), graph('first', 'a.bal', 1, 0)];
  const p = program(...graphs);
  const before = JSON.stringify(p);
  const ids = ['first', 'a', 'b', 'c', 'z'];
  assert.deepEqual(listEntries(p).map(e => e.id), ids);
  assert.deepEqual(listEntries(program(...graphs.toReversed())).map(e => e.id), ids);
  assert.equal(JSON.stringify(p), before);
});

test('duplicate signatures are disambiguated by file/location and finally ID', () => {
  const entries = listEntries(program(graph('a', 'a.bal', 0, 0), graph('b', 'b.bal', 0, 0),
    graph('c', 'b.bal', 0, 0), graph('d', 'b.bal', 1, 0)));
  assert.equal(new Set(entries.map(e => e.label)).size, entries.length);
  assert.ok(entries[0].label.includes('a.bal:1:1'));
  assert.ok(entries[1].label.includes('[b]'));
  assert.ok(entries[2].label.includes('[c]'));
  assert.ok(entries[3].label.includes('b.bal:2:1'));
});

test('missing signatures fall back to the name', () => {
  assert.equal(listEntries(program(graph('f', 'a.bal', 0, 0, { name: 'fallback', signature: '' })))[0].label, 'fallback');
});

test('resolution retains an existing preferred ID or selects the first entry', () => {
  const entries = listEntries(program(graph('a', 'a.bal', 0, 0), graph('b', 'b.bal', 0, 0)));
  assert.equal(resolveEntry(entries, 'b'), entries[1]);
  assert.equal(resolveEntry(entries, 'missing'), entries[0]);
  assert.equal(resolveEntry(entries), entries[0]);
  assert.equal(resolveEntry([], 'missing'), undefined);
  assert.deepEqual(listEntries(program()), []);
});
