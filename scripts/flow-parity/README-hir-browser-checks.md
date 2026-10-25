# HIR browser behavior checks

From the repository root:

```sh
node scripts/flow-parity/hir-browser-checks.mjs
```

Requires installed project dependencies, the pinned Playwright Chromium binary,
existing compiler browser build artifacts, direct-HIR/legacy lookup fixtures, and
the archived fonts under `tests/fixtures/flow-rendering/environment/fonts`.
Missing prerequisites fail rather than downloading fonts or rewriting baselines.

The script starts its own ephemeral development server with
`server.mjs development <temporary-directory> --hir`, and always closes its server,
browser contexts and temporary directory. It does not reuse a shared server or
write fixtures, baselines, dependencies, compiler outputs, screenshots or commits.

Checks:

- Replays eight original project render cases through `captureIntegrationFlow`
  (which uses `replayRenderCase`): repeated/nested function expansion, normal and
  expanded panels, definitions and client context/call disclosures.
- Observes the actual `HIRFlowView` marker and actual program identities before
  the capture observer serializes them. Their original JSON must remain unchanged.
- Instruments real `Worker.postMessage` analysis requests before mount, verifies
  the spy saw initial analysis, then requires unchanged counts and workspace
  revision across UI actions. Controlled analysis remains disabled. A separate
  repeated collapse/expand replay also requires no additional WASM request.
- Checks function-definition navigation, exact source records returned by call
  headers versus expanded child definitions, repeated-source reference
  deduplication, and pressed/highlight state across occurrences.
- Generates exact-equality isolated SVG in a fresh context for every captured
  case, with identical archived fonts, viewport, locale, timezone, DPR, color
  scheme and motion settings. Isolated contexts must have no editor/workspace/
  compiler globals, workers, compiler/editor/legacy-registry imports, or WASM
  requests. No expected SVG is supplied to a renderer and no PNG is compared.
- Round-trips an explicitly declared JSON HIR presentation containing lone
  `D83D` through the isolated renderer and checks DOM text and ARIA UTF-16 code
  units, without lossy code-point/UTF-8 conversion. This is a presentation
  fixture based on an existing direct-HIR graph, not a fabricated AST or a claim
  to exercise native compiler lowering. The real valid-Ballerina client-cutoff
  lowering is independently covered by
  `packages/compiler/hir_test.go:TestHIRClientPresentationUTF16Cutoff` (that test
  currently does not export its generated HIR for browser consumption).

This is a behavioral supplement, not full frozen-corpus parity certification.
The existing read-only parity command remains:

```sh
node scripts/capture_flow_baselines.mjs --verify --hir
```
