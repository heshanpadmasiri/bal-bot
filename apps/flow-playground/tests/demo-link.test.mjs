import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDemo, encodeDemo } from '../src/demo-link.ts';

test('empty fragments are absent, not invalid', () => {
  assert.deepEqual(decodeDemo(''), { kind: 'absent' });
  assert.deepEqual(decodeDemo('#'), { kind: 'absent' });
});

test('demo links preserve exact source, Unicode and optional function identity', () => {
  for (const source of ['', '  function main() {\r\n\t// සිංහල 日本語 😀 + % # & ?\r\n}\n', '\u0000\ud800']) {
    for (const functionId of [undefined, '', 'module/😀#main']) {
      const demo = { version: 1, source, ...(functionId === undefined ? {} : { functionId }) };
      const url = new URL(encodeDemo('https://example.test/playground/?mode=flow#old', demo));
      assert.equal(url.pathname, '/playground/');
      assert.equal(url.search, '?mode=flow');
      assert.ok(url.hash.startsWith('#%7B'));
      assert.deepEqual(JSON.parse(decodeURIComponent(url.hash.slice(1))), demo);
      assert.deepEqual(decodeDemo(url.hash), { kind: 'valid', demo });
      assert.deepEqual(decodeDemo(url.hash.slice(1)), { kind: 'valid', demo });
    }
  }
});

test('malformed encoding, JSON, versions and field types are invalid', () => {
  for (const fragment of ['#%', '#%E0%A4', '#not-json', '#%7B', '#%25257B']) {
    const result = decodeDemo(fragment);
    assert.equal(result.kind, 'invalid');
    assert.ok(result.message.length > 0);
  }
  for (const value of [null, [], 1, 'source', {}, { version: 2, source: '' },
    { version: '1', source: '' }, { version: 1 }, { version: 1, source: null },
    { version: 1, source: 42 }, { version: 1, source: '', functionId: null },
    { version: 1, source: '', functionId: 1 }]) {
    assert.equal(decodeDemo(`#${encodeURIComponent(JSON.stringify(value))}`).kind, 'invalid');
  }
});

test('encoding does not mutate an input URL or demo and rejects invalid demos', () => {
  const base = new URL('https://example.test/#old');
  const demo = Object.freeze({ version: 1, source: 'text', functionId: 'f' });
  encodeDemo(base, demo);
  assert.equal(base.hash, '#old');
  assert.throws(() => encodeDemo(base, { version: 2, source: '' }), TypeError);
});
