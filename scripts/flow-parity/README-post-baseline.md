# Post-baseline flow scenarios

New flow-producing suites belong in `tests/hir-suite-inventory.json`, not the frozen input catalog. Set `rendering: true` and supply `coverage` IDs. Each ID resolves through `renderCoverage` to a separately executable browser suite and its exact literal `test(...)` scenario names. The loader and source-inventory checker validate these references and reject missing scenarios, unregistered render suites, unsafe paths, and non-rendering suites claiming coverage. This registry does not authorize editing any frozen sources, hashes, captures, or golden files. Static registration proves coverage wiring, not the assertions themselves; run and review the referenced suite.

Type-cast coverage compiles all new operand/control-flow forms through the native compiler, then feeds actual HIR into production `FlowView` in headless Chromium. It checks SVG rendering and expands unconditional call operands, including nested casts and error operators. No browser compiler mocks, legacy graph conversion, or baseline writes are involved.

## Audited non-flow infrastructure

The separate `infrastructure` registrations pin exact SHA-256 bytes and a reviewed purpose. The node compaction suite tests workspace-agent budgeting, summaries, cancellation and failure isolation. The browser compaction suite tests chat lifecycle/status, transcript retention, endpoint switching, stop/retry and disabled sends after failure. Its Ballerina service only mounts endpoint conversations; this is not new flow-rendering coverage.

These registrations exclude only those exact files from frozen source discovery. Both inventory loaders reject duplicate ownership, baseline overlap, unsafe paths, missing purposes, coverage claims and hash drift. New/unregistered suites remain errors; changing an audited file requires explicit review and hash update, never refreshing immutable inventory. The static browser collector also checks the browser bytes in its supplied repository, so mutation fixtures cannot silently skip tampered infrastructure. Its registration authority remains this checkout's registry, not an untrusted mutation fixture.

Run:

```sh
node --test scripts/hir-suite-registry.test.mjs
node --test apps/editor/tests/hir-type-cast-render.test.mjs
node scripts/update_hir_goldens.mjs --check-inventory
(cd packages/compiler && GOWORK=off go test . -run '^TestHIR(TypeCast.*|SourceInventory)$' -count=1)
```

The browser uses the repository's existing headless Playwright Chromium launch configuration. The Vite server is ephemeral and shut down after the test.
