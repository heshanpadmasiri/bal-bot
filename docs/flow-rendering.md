# Flow rendering validation

The legacy frozen SVG/HTML parity gate has been removed, along with its capture,
comparison, environment-pinning, and historical review tools and output artifacts.
There is no replacement snapshot gate, and `npm run test:all` does not run one.

## Automated coverage

```sh
npm ci
npx playwright install chromium
npm run test:all
```

The full suite retains normal unit and script tests, native Go compiler tests,
compiler/editor browser tests in development and production, and standalone
playground browser tests. These exercise the production HIR compiler and
`FlowView`/`FlowEntry` renderer, including flow interactions and call expansion.
String/XML template rendering has separate executable coverage in
`apps/editor/tests/post-baseline/template-rendering.test.mjs`, registered alongside
the native template suites in `tests/hir-suite-inventory.json`. These checks do
not restore or extend the deleted frozen parity gate.
No ordinary test regenerates AST/HIR/diagnostic goldens; updates require an
explicit `npm run test:hir:update` invocation and review.

## Retained shared test inputs

Some historical files remain dependencies of regular compiler and unit tests,
not a frozen rendering gate:

- `tests/fixtures/flow-rendering/inputs/catalog.json` supplies compiler corpus
  and synthetic HIR inputs.
- `tests/fixtures/flow-rendering/inventory.json` supplies source provenance and
  synthetic scenario mappings used by migration validation and source discovery.
- `tests/hir-baseline-migrations.json`, `tests/legacy-baseline-sources/`, and the
  migration validation scripts preserve compiler request/source proofs.
- `tests/hir-suite-inventory.json` and its validation helpers classify compiler
  source suites and feature coverage for AST/HIR inventory checks.
- `scripts/flow-parity/post-baseline.{html,tsx}` is the standalone production
  renderer mount used by the regular type-cast rendering test. Despite its
  historical directory name, it does not compare frozen output.

The source inventory no longer registers the deleted render-parity harness.
Other compiler inputs, source archives, and golden expectations are unchanged.
Run `node scripts/update_hir_goldens.mjs --check-inventory` for browser input
validation; native corpus and provenance checks run in `npm run test:compiler`.

## Query expressions

Query expressions render as ordinary source-backed expressions, preserving their
text and the existing function-name links and resolved-variable highlighting.
Query clauses do not introduce flow nodes, filtering branches, or per-row
execution paths. Calls inside clauses use the normal function-card interaction;
opening a card does not simulate query execution. Supported query syntax is
limited to what the compiler accepts.

## Interactive inspection

Use `npm run dev:playground` and the actual server URL (normally
<http://127.0.0.1:5174>). Enter a complete valid Ballerina file, select the relevant
function or endpoint, and use **Copy demo link** to share it. Expand **+** controls
when assessing calls. Diagnostics must be resolved before judging the current
flow; invalid edits retain the last valid rendering with a stale indicator.

The playground reuses the production compiler and renderer without executing
Ballerina programs or requiring model credentials. See the [README](../README.md)
for setup and the [HIR wire contract](hir-wire.md) for the production data model.
