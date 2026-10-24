# Test-only capture contract

`packages/compiler/tests/browser/render-parity.spec.mjs` exports:

- `captureIntegrationFlow(page, case_)`: independently replay original UI inputs once; capture integration SVG/HTML/wrappers/styles and explicit committed FlowView state.
- `generateIsolatedSVG(page, case_, renderInput)`: mount only the existing FlowView in the minimal `isolated-flow.html` harness, returning exact SVG bytes or explicit `null`. No editor, workspace UI, chat, panel actions or compiler requests are involved.
- `captureFlow(page, case_, {createIsolatedPage})`: coordinate the two paths, assert exact integration/isolated SVG equality, and close the isolated page's context. The required callback returns a page in a **fresh context with identical pinned fonts/settings/baseURL**. The caller closes the integration context.
- `assertRenderCapture(actual, expected, label?)`, `renderStateSnapshot(renderInput)`, `replayRenderCase`, `settleFlow`, `STYLE_PROPERTIES`.

Imports register no tests and write no artifacts. Development and production builds must both serve `apps/editor/tests/browser/isolated-flow.html`; include that HTML entry in production build inputs.

## Cases

```js
{
  id: 'stable-case-id',
  input: {kind: 'project', files: {'Ballerina.toml': '...', 'main.bal': '...'}},
  viewport: {width: 1500, height: 950},
  selection: {kind: 'function', functionId: '...'},
  // or {kind:'definitions',scopeId:'...'}, or a locator descriptor
  panel: {mode: 'normal'}, // expanded clicks the actual inspection toggle
  initialAnalysis: {kind: 'ready'}, // optional revision
  actions: [
    {type: 'click', target: {role:'button',name:'Expand shared(2)'}},
    {type: 'resize', viewport: {width:900,height:700}},
    {type: 'write', file:'main.bal',text:'...',analysisKind:'invalid'},
    {type: 'analysis', kind:'invalid'}, // optional revision
    {type: 'failAnalysis',message:'controlled runtime failure'},
  ],
  analysis: {kind:'invalid'}, // optional final state/revision
  svg: 'present', // or 'absent': deliberate absence asserted
}
```

Locators are `{selector,index?}` or `{role,name,exact?,index?}`. Names match exactly by default. Other actions are `fill` (`target,value`), `press` (`target,key`), and `drag` (`target,offset:{x,y},to:{x,y}`); drag offsets are target-relative, destinations viewport-relative. Writes await their exact saved revision. Selection resolves original program metadata and clicks actual UI controls; **effective image selection is never inferred from DOM, labels, or the original case selection**.

Synthetic input is `{kind:'synthetic',program,selection,graphOnly:true,expanded:[],references:[]}`; optional `state` can specify failed/invalid/pending with or without a previous program. `graphOnly` omits only the FlowEntry React element for metadata-incomplete original fixtures; existing production FlowView still builds, measures, lays out and renders every graph element. No entry metadata or AST is fabricated. Synthetic state/reference/disclosure callbacks remain interactive. Optional width/height set the synthetic host dimensions. Expanded synthetic panels apply the existing `inspection-expanded` class, not a fabricated editor toggle.

## Explicit input and results

The pre-React commit observer uses the exact FlowView function identity exposed by the test harness. Synthetic graph-only mounts publish their effective state explicitly after commits. The serialized render input is plain JSON:

```js
{
  flow: {state,selection},
  references: [...],
  expanded: ['occurrence/path'],
  graphOnly: false,
  commits: [{flow,references,expanded,graphOnly}, ...],
}
```

The top-level state is the final effective input after all interactions, including endpoint switches. Consecutive identical commits are omitted. `commits` preserves explicit React prop transitions: ready→failed adds `disabled` at the end of an existing button's attributes, whereas an initially failed mount inserts it before `aria-label`. Replaying these data-only transitions through the same minimal FlowView preserves exact SVG bytes without normalization or editor action replay. History is retained for reproducible attribute order, not compared across runs: incidental React batching is not a semantic contract. Settled SVG/HTML remains authoritative. Callbacks, Sets, fibers and DOM nodes are never serialized. Source text may be empty and definitions absent in graph-only fixtures.

Capture results:

- `svg`: primary isolated SVG, or explicit `null`;
- `isolatedSVG`: same exact isolated result (required acceptance field);
- `integrationSVG`: independently replayed integration SVG, asserted equal;
- `flowHTML`: exact integration `.flow-view.outerHTML`;
- `wrapper`: mode, classes, inline styles, unrounded rectangles and analysis kind;
- `styles`: relevant computed CSS values and unrounded geometry;
- `renderInput`: the complete explicit input above, persisted in capture metadata.

`captureFlow` takes no screenshots. Optional separately generated `screenshot` bytes are ignored by `assertRenderCapture`: missing or different PNGs cannot fail parity. The assertion requires isolated SVG, primary SVG, HTML, wrappers, styles and explicit input. Output comparisons are exact; no attribute sorting, geometry rounding, label rewriting, or markup/style normalization is performed. `renderStateSnapshot` compares final selection kind/stable ID, expanded keys (as a sorted set), Located references (`id`, `text`, `source`), and analysis kind/revision plus diagnostics for ready/invalid or message for failed. Full program DTOs (legacy or HIR), previous programs, incidental reference metadata and commit history are excluded from cross-run equality. Complete `renderInput` and commits remain persisted and hashed per artifact; immutable case/input/provenance fingerprints and artifact hashes are unchanged. Fonts, React frames, requested analysis/revision, and stable DOM/geometry are explicitly awaited.

## Validation

Representative development probes passed exact isolated/integration SVG equality for `browser-stale-invalid`, `browser-failed-previous`, `browser-panel-endpoint-retention`, `browser-definitions-reset-endpoint`, `state-failed-initial`, `state-failed-previous`, and the metadata-incomplete abrupt-exits synthetic reference case. Six representative production cases (all above except `state-failed-previous`) also passed two fresh-context captures each with exact SVG/HTML/wrapper/style/renderInput equality; isolated pages made no compiler/WASM requests. Probes also proved missing/differing optional PNG bytes do not affect the capture assertion. `npx tsc --noEmit -p apps/editor/tsconfig.json` passed. No baseline artifacts were recorded or frozen. Full inventory/environment certification belongs to the parent runner.
