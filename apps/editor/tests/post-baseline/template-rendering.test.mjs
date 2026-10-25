import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { instantiateGraph } from '../../src/hir-flow.ts';
import { validateHIR } from '../../../../packages/compiler/src/protocol.ts';
import { layoutDiagram } from '../../src/flow.ts';

test('template columns measure expression wrapping, render literal text, and select the whole source', async t => {
  const server = await createServer({ root: fileURLToPath(new URL('../../../../', import.meta.url)), configFile: false, server: { host: '127.0.0.1', port: 0 } });
  t.after(() => server.close());
  await server.listen();
  const svg = await server.ssrLoadModule(fileURLToPath(new URL('../../src/flow-svg.tsx', import.meta.url)));
  const { FlowView } = await server.ssrLoadModule(fileURLToPath(new URL('../../src/flow-view.tsx', import.meta.url)));
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: text => ({ width: [...text].length * 8 }) }) }) };
  t.after(() => { if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; });
  const program = JSON.parse(await readFile(new URL('../../../../tests/fixtures/hir-contract/minimal.json', import.meta.url), 'utf8'));
  const expressions = ['`' + 'x'.repeat(90) + '${name}`', '`<root>\n<script>alert("unsafe")</script> & ${value}\n</root>`'];
  for (const [i, node] of program.functions.main.nodes.entries()) {
    const type = i ? 'xml' : 'string', expression = expressions[i];
    node.presentation = { kind: 'plain', style: 'template', label: `${type} ${expression}`, sections: [
      { kind: 'template-type', text: type }, { kind: 'template-expression', text: expression },
    ], disclosure: { kind: 'none' }, limitation: null };
    program.sources[node.sourceId].text = node.presentation.label;
  }
  assert.equal(validateHIR(program), program);
  for (const sections of [
    [{kind: 'template-type', text: 'xml'}],
    [{kind: 'template-expression', text: '`x`'}, {kind: 'template-type', text: 'xml'}],
    [{kind: 'template-type', text: 'raw'}, {kind: 'template-expression', text: '`x`'}],
  ]) {
    const invalid = structuredClone(program);
    invalid.functions.main.nodes[0].presentation.sections = sections;
    assert.throws(() => validateHIR(invalid), /invalid template sections/);
  }
  const diagram = instantiateGraph(program, 'main', new Set());
  const layout = layoutDiagram(diagram, svg.nodeLabelSize);
  for (const [i, node] of diagram.nodes.entries()) {
    const sections = svg.templateSections(node);
    assert.equal(sections[0].text, i ? 'xml' : 'string');
    assert.equal(sections[1].text.replaceAll('\n', ''), expressions[i].replaceAll('\n', ''));
    assert.ok(sections[1].text.split('\n').every(line => [...line].length * 8 <= svg.templateColumns.expression));
    const size = svg.nodeLabelSize(node.label, node);
    assert.equal(size.width, 340);
    assert.equal(size.height, sections[1].text.split('\n').length * 19);
    assert.equal(layout.boxes[node.id].height, size.height + 28);
  }
  assert.ok(layout.boxes[diagram.nodes[1].id].y >= layout.boxes[diagram.nodes[0].id].y + layout.boxes[diagram.nodes[0].id].height + 52);
  const props = { flow: { state: { kind: 'ready', revision: 1, program, diagnostics: [] }, selection: { kind: 'function', functionId: 'main' } }, references: [diagram.nodes[1].selection], expanded: new Set(), onToggle() {}, onSelect() {}, onOpenFunction() {} };
  const html = renderToStaticMarkup(React.createElement(FlowView, props));
  assert.equal((html.match(/template-header/g) ?? []).length, 2);
  assert.match(html, /class="template-type">string/);
  assert.match(html, /class="template-type">xml/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /flow-node template referenced/);
  assert.match(html, /aria-label="Reference xml/);

  const node = diagram.nodes[1];
  const data = { bounds: { x: 0, y: 0, width: 440, height: 300 }, nodes: [{ ...node, box: layout.boxes[node.id], height: 120, selected: false, container: false, client: false, template: true, sections: svg.templateSections(node), text: node.label }], edges: [], iterations: [] };
  const browser = await chromium.launch({headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/template-selection.json', route => route.fulfill({json: data}));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/apps/editor/tests/post-baseline/template-selection.html`);
  const button = page.getByRole('button', {name: `Reference ${node.label}`, exact: true});
  await button.waitFor();
  assert.equal(await page.locator('button').count(), 1, 'one selection target spans both columns');
  await button.click();
  const selected = await page.evaluate(() => window.selectedTemplate);
  assert.deepEqual(selected, program.sources['source-b']);
  assert.equal(selected.text, 'xml ' + expressions[1]);

  const ordinary = structuredClone(diagram.nodes[0]);
  ordinary.presentation = { ...ordinary.presentation, style: 'step' };
  assert.equal(svg.templateSections(ordinary), undefined);
  assert.deepEqual(svg.nodeLabelSize(ordinary.label, ordinary), svg.labelSize(ordinary.label));
  ordinary.presentation = { ...ordinary.presentation, style: 'template', sections: [{ kind: 'text', text: ordinary.label }] };
  assert.equal(svg.templateSections(ordinary), undefined, 'legacy single-label templates keep their rendering');
  assert.deepEqual(svg.nodeLabelSize(ordinary.label, ordinary), svg.labelSize(ordinary.label));
});
