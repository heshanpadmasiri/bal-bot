import assert from 'node:assert/strict';

export const PARITY_HARNESS = '/apps/editor/tests/browser/harness.html';
export const STYLE_PROPERTIES = [
  'display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'overflow', 'overflow-x', 'overflow-y', 'padding', 'margin', 'box-sizing',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'color', 'background-color', 'border', 'border-radius', 'fill', 'stroke', 'stroke-width',
  'text-align', 'text-transform', 'white-space', 'transform', 'zoom',
];

/** A locator descriptor is {selector,index?} or {role,name,exact?,index?}. */
function locate(page, target) {
  assert.ok(target && (target.selector || target.role), 'Action/selection requires a locator descriptor');
  const locator = target.selector ? page.locator(target.selector) : page.getByRole(target.role, {name: target.name, exact: target.exact ?? true});
  return target.index === undefined ? locator : locator.nth(target.index);
}

async function waitAnalysis(page, {kind = 'ready', revision} = {}) {
  await page.waitForFunction(({kind, revision}) => {
    const state = window.workspace?.analysisSnapshot();
    return state?.kind === kind && (revision === undefined || state.revision === revision);
  }, {kind, revision});
  await page.locator('.flow-view').waitFor();
  await page.waitForFunction(kind => document.querySelector('.flow-view')?.getAttribute('data-analysis') === kind, kind);
}

/** Explicit fonts + React frames + identical DOM/geometry across consecutive frames.
 * No rounding, normalization, style injection, or fixed sleeps are used. */
export async function settleFlow(page) {
  await page.locator('.flow-view').waitFor({state: 'visible'});
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : image.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sample = () => {
      const flow = document.querySelector('.flow-view');
      const elements = [flow, ...flow.querySelectorAll('*'), ...document.querySelectorAll('.inspection,.flow-workspace')];
      return JSON.stringify(elements.map(element => {
        const box = element.getBoundingClientRect();
        return [element.outerHTML, box.x, box.y, box.width, box.height, element.scrollWidth, element.scrollHeight];
      }));
    };
    let previous, stable = 0;
    for (let frame = 0; frame < 180; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const current = sample();
      stable = current === previous ? stable + 1 : 0;
      if (stable >= 3 && document.fonts.status === 'loaded') return;
      previous = current;
    }
    throw Error('Flow DOM/layout did not settle within 180 animation frames');
  });
}

async function selectView(page, selection) {
  if (!selection) return;
  if (selection.selector || selection.role) { await locate(page, selection).click(); return; }
  const target = await page.evaluate(selection => {
    const program = window.workspace.analysisSnapshot().program;
    if (selection.kind === 'definitions') {
      const index = program.scopes.findIndex(scope => scope.id === selection.scopeId);
      if (index < 0) throw Error(`Unknown scope ${selection.scopeId}`);
      return {scope: index};
    }
    for (const [index, scope] of program.scopes.entries()) {
      const endpoint = scope.endpoints?.find(item => item.functionId === selection.functionId);
      if (endpoint) return {scope: index, endpointIndex: program.scopes.slice(0, index).reduce((count, item) => count + (item.endpoints?.length ?? 0), 0) + scope.endpoints.indexOf(endpoint)};
      const definition = scope.definitions?.find(item => item.functionId === selection.functionId);
      if (definition) return {scope: index, name: definition.label};
      if (scope.functionId === selection.functionId) return {scope: index};
    }
    throw Error(`No selectable view for ${JSON.stringify(selection)}`);
  }, selection);
  await page.locator('.service').nth(target.scope).click();
  if (target.endpointIndex !== undefined) await page.locator('.endpoint').nth(target.endpointIndex).click();
  else if (target.name) await page.locator('.definitions').getByRole('button', {name: target.name, exact: true}).click();
}

/** Replay from original inputs, never from expected output. Each caller must use a
 * fresh browser context. See render-parity-schema.md for the case contract. */
export async function replayRenderCase(page, case_) {
  // Installed before React loads. Observe committed props of the exact FlowView
  // function exported by the test harness, never the editor's DOM/labels.
  await page.addInitScript(() => {
    let renderer = 0;
    window.flowParityCommits = [];
    window.flowParityRecord = input => {
      const value = JSON.parse(JSON.stringify(input));
      window.flowParityRenderInput = value;
      const commits = window.flowParityCommits;
      if (JSON.stringify(commits.at(-1)) !== JSON.stringify(value)) commits.push(value);
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      inject: () => ++renderer,
      onCommitFiberUnmount() {},
      onCommitFiberRoot(_id, root) {
        const visit = fiber => {
          if (!fiber) return;
          if (fiber.type === window.flowParityComponent && window.flowParityComponent) {
            const {flow, references, expanded} = fiber.memoizedProps;
            window.flowParityRecord({flow, references, expanded: [...expanded], graphOnly: false});
          }
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(root.current);
      },
    };
  });
  await page.setViewportSize(case_.viewport ?? {width: 1500, height: 950});
  await page.goto(case_.url ?? PARITY_HARNESS);
  await page.waitForFunction(() => window.ready && window.mountEditor && window.mountRenderParity);
  const input = case_.input ?? {};
  const synthetic = input.kind === 'synthetic' || !!input.program;
  if (synthetic) {
    // New-only opt-in: existing normal synthetic cases keep their exact wrapper.
    // There is no editor inspection toggle in a graph-only mount; apply the same
    // production expanded-panel class instead, without manufacturing graph data.
    await page.evaluate(input => window.mountRenderParity(input), {...input, selection: case_.selection ?? input.selection,
      ...(case_.panel?.mode === 'expanded' ? {panelMode: 'expanded'} : {})});
  } else {
    const files = input.files ?? case_.files;
    assert.ok(files && Object.keys(files).length, `${case_.id}: missing original project files`);
    await page.evaluate(async files => {
      await window.loginProvider('openai', 'sk-browser-test-key');
      window.mountEditor(files);
    }, files);
    await waitAnalysis(page, case_.initialAnalysis);
    await selectView(page, case_.selection);
  }
  if (!synthetic && case_.panel?.mode === 'expanded') await page.getByRole('button', {name: 'Expand inspection', exact: true}).click();
  for (const action of case_.actions ?? []) {
    switch (action.type) {
      case 'click': await locate(page, action.target ?? action).click(); break;
      case 'resize': await page.setViewportSize(action.viewport ?? {width: action.width, height: action.height}); break;
      case 'fill': await locate(page, action.target).fill(action.value); break;
      case 'press': await locate(page, action.target).press(action.key); break;
      case 'drag': {
        const box = await locate(page, action.target).boundingBox();
        assert.ok(box, `${case_.id}: missing drag target`);
        await page.mouse.move(box.x + action.offset.x, box.y + action.offset.y);
        await page.mouse.down();
        await page.mouse.move(action.to.x, action.to.y);
        await page.mouse.up();
        break;
      }
      case 'write': {
        const revision = await page.evaluate(({file, text}) => {
          window.workspace.write(file, text);
          return window.workspace.analysisSnapshot().revision;
        }, action);
        await waitAnalysis(page, {kind: action.analysisKind ?? 'ready', revision});
        break;
      }
      case 'analysis': await waitAnalysis(page, action); break;
      case 'failAnalysis':
        await page.evaluate(message => {
          window.controlAnalysis = true;
          const file = window.workspace.list().find(name => name.endsWith('.bal'));
          window.workspace.write(file, window.workspace.read(file) + '\n// controlled parity failure');
          window.analysisRequests.at(-1).reject(Error(message));
        }, action.message ?? 'controlled runtime failure');
        await waitAnalysis(page, {kind: 'failed'});
        break;
      default: throw Error(`${case_.id}: unsupported replay action ${action.type}`);
    }
    await settleFlow(page);
  }
  if (case_.analysis) await waitAnalysis(page, case_.analysis);
  await settleFlow(page);
}

/** Independent UI replay and integration capture, with explicit committed state. */
export async function captureIntegrationFlow(page, case_) {
  await replayRenderCase(page, case_);
  const capture = await page.evaluate(({properties, selectors}) => {
    const flow = document.querySelector('.flow-view');
    if (!flow) throw Error('Missing .flow-view');
    const diagrams = flow.querySelectorAll('.diagram');
    if (diagrams.length > 1) throw Error('Expected at most one flow SVG');
    const rect = element => {
      const box = element.getBoundingClientRect();
      return {x: box.x, y: box.y, width: box.width, height: box.height};
    };
    const styles = Object.fromEntries(selectors.map(selector => [selector, [...document.querySelectorAll(selector)].map(element => {
      const computed = getComputedStyle(element);
      return {rect: rect(element), properties: Object.fromEntries(properties.map(property => [property, computed.getPropertyValue(property)]))};
    })]));
    const workspace = document.querySelector('.flow-workspace');
    const inspection = document.querySelector('.inspection');
    return {
      svg: diagrams[0]?.outerHTML ?? null,
      flowHTML: flow.outerHTML,
      wrapper: {
        mode: workspace?.classList.contains('inspection-expanded') ? 'expanded' : 'normal',
        workspace: workspace ? {className: workspace.className, style: workspace.getAttribute('style'), rect: rect(workspace)} : null,
        inspection: inspection ? {className: inspection.className, style: inspection.getAttribute('style'), rect: rect(inspection)} : null,
        analysis: flow.getAttribute('data-analysis'),
      },
      styles,
      renderInput: window.flowParityRenderInput && {...window.flowParityRenderInput, commits: window.flowParityCommits},
    };
  }, {properties: STYLE_PROPERTIES, selectors: case_.styleSelectors ?? [
    '.flow-workspace', '.inspection', '.flow-view', '.diagram-scroll', '.diagram', '.flow-entry',
    '.flow-entry-owner', '.flow-empty', '.flow-notice', '.flow-diagnostics', '.definitions',
    '.flow-node', '.container', '.node-select', '.node-disclosure', '.node-limitation', '.edge-label',
    '.client-receiver', '.client-context', '.client-method',
  ]});
  if (case_.svg === 'absent') assert.equal(capture.svg, null, `${case_.id}: SVG must be absent`);
  if (case_.svg === 'present') assert.equal(typeof capture.svg, 'string', `${case_.id}: SVG must be present`);
  assert.ok(capture.renderInput, `${case_.id}: missing committed FlowView render input`);
  return capture;
}

/** Fresh-context image generation. This page must have the same pinned browser,
 * fonts and context settings as integration; the caller owns its lifecycle. */
export async function generateIsolatedSVG(page, case_, renderInput) {
  assert.ok(renderInput?.flow && Array.isArray(renderInput.expanded) && Array.isArray(renderInput.references), `${case_.id}: invalid explicit render input`);
  await page.setViewportSize(case_.viewport ?? {width: 1500, height: 950});
  await page.goto('/apps/editor/tests/browser/isolated-flow.html');
  await page.waitForFunction(() => window.isolatedFlowReady && window.mountIsolatedFlow);
  await page.evaluate(async input => {
    await document.fonts.ready;
    window.mountIsolatedFlow(input);
  }, renderInput);
  await settleFlow(page);
  return page.evaluate(() => {
    const diagrams = document.querySelectorAll('.flow-view .diagram');
    if (diagrams.length > 1) throw Error('Expected at most one isolated flow SVG');
    return diagrams[0]?.outerHTML ?? null;
  });
}

/** UI replay runs once; primary SVG comes only from a second, isolated context.
 * createIsolatedPage returns a fresh pinned page; captureFlow closes its context. */
export async function captureFlow(page, case_, {createIsolatedPage} = {}) {
  assert.equal(typeof createIsolatedPage, 'function', 'captureFlow requires createIsolatedPage with identical pinned fonts/settings');
  const integration = await captureIntegrationFlow(page, case_);
  const isolatedPage = await createIsolatedPage();
  assert.notEqual(isolatedPage.context(), page.context(), 'Isolated SVG requires a fresh browser context');
  let isolatedSVG;
  try { isolatedSVG = await generateIsolatedSVG(isolatedPage, case_, integration.renderInput); }
  finally { await isolatedPage.context().close(); }
  assert.equal(integration.svg, isolatedSVG, `${case_.id}: integration SVG differs from isolated SVG`);
  return {...integration, integrationSVG: integration.svg, svg: isolatedSVG, isolatedSVG};
}

/** Representation-neutral final state. Full programs and commit history remain
 * replay/provenance data, not a contract on the renderer's internal model or batching. */
export function renderStateSnapshot(renderInput) {
  assert.ok(renderInput?.flow?.state && renderInput.flow.selection
    && Array.isArray(renderInput.expanded) && Array.isArray(renderInput.references), 'Invalid explicit render input');
  const {state, selection} = renderInput.flow;
  const analysis = {kind: state.kind, revision: state.revision};
  if (state.kind === 'ready' || state.kind === 'invalid') analysis.diagnostics = state.diagnostics;
  if (state.kind === 'failed') analysis.message = state.message;
  assert.ok(selection.kind === 'function' || selection.kind === 'definitions', 'Invalid render selection');
  return {
    analysis,
    selection: selection.kind === 'function'
      ? {kind: selection.kind, functionId: selection.functionId}
      : {kind: selection.kind, scopeId: selection.scopeId},
    expanded: [...renderInput.expanded].sort(),
    references: renderInput.references.map(({id, text, source}) => ({id, text, source})),
  };
}

export function assertRenderCapture(actual, expected, label = 'flow render capture') {
  for (const key of ['svg', 'isolatedSVG', 'flowHTML', 'wrapper', 'styles']) {
    assert.ok(Object.hasOwn(expected, key), `${label}: missing expected ${key}`);
    assert.ok(Object.hasOwn(actual, key), `${label}: missing actual ${key}`);
    assert.notEqual(expected[key], undefined, `${label}: undefined expected ${key}`);
    assert.deepEqual(actual[key], expected[key], `${label}: ${key} differs`);
  }
  assert.ok(actual.isolatedSVG === null || typeof actual.isolatedSVG === 'string', `${label}: invalid isolated SVG result`);
  assert.deepEqual(renderStateSnapshot(actual.renderInput), renderStateSnapshot(expected.renderInput), `${label}: final render state differs`);
  // Optional screenshots are review aids, never acceptance artifacts.
  assert.equal(actual.svg, actual.isolatedSVG, `${label}: primary SVG must be isolated`);
  if (Object.hasOwn(actual, 'integrationSVG')) assert.equal(actual.integrationSVG, actual.isolatedSVG, `${label}: integration SVG differs`);
}

// This module is also imported by the standalone recorder. It deliberately has
// no top-level test registration or artifact writes; the verify-only CLI owns
// manifest validation, case loading, environment pinning and fresh contexts.
