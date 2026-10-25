# Frozen flow rendering gate

The frozen Stage 1 tools replay the **current production HIR renderer**. Isolated headless SVG is the primary image-parity gate; surrounding HTML, styles, wrappers and interactions have separate integration coverage. Screenshots are optional human-review aids, never acceptance artifacts.

## Current gate status

The revised isolated-SVG/separate-HTML baseline is recorded, frozen, and verified for all 663 cases in both development and production. Recording passed two fresh-context runs per case/mode; verification replayed the frozen artifacts successfully. The required artifact set contains no PNGs. Earlier partial recordings remain non-authoritative. Earlier raster differences do not block this gate, and no GPU/raster stability is required.

The baseline authority is `tests/fixtures/flow-rendering/frozen-manifest.json` (schema version 2, pipeline `isolated-svg+editor-integration`), with the original Git revision, working-tree hashes, pinned environment, and artifact hashes. The baseline/tooling commit is `280850fd`. This is the committed Stage 1 authority for subsequent migration; its recorded pre-commit revision and working-tree hashes remain unchanged in the manifest. The default harness now uses the canonical production `FlowView` and shared `FlowSvg`; `--hir` is only a verify/smoke compatibility no-op, not a second renderer or baseline.

## Frozen inventory and post-baseline suites

`loadRenderCases()` retains strict discovery and original byte-hash checks for every Stage 1 suite. The frozen inventory, source archives, case metadata and artifacts must not be updated to accommodate new tests. Assertion-only HIR migrations use the separate, test-only provenance bridge below; they do not change a case or its `provenanceHashes`.

`tests/hir-suite-inventory.json` separately allows the planned non-rendering HIR suites `packages/compiler/hir_test.go` and `packages/compiler/tests/hir.test.mjs`. Entries may be registered before their files exist. Each entry explicitly declares `rendering: false` and its purpose; duplicate entries, overlap with baseline suites, malformed entries and all unregistered discovered suites fail loading. Registered suites do not bypass the original baseline suite presence or source-hash checks.

The registry also explicitly classifies `hir-synthetic-fixtures.mjs` and `testDataBuilder.mjs` test-data helpers, `legacy-flow.ts`, and the native `hir_legacy_model_test.go` comparison oracle under `helpers`; they must exist, cannot masquerade as suites, and claim no new frozen coverage. A native helper containing a runnable Test/Benchmark/Fuzz/Example entry point fails classification.

The separate `postBaselineRenderingSuites` field explicitly classifies new flow-producing feature tests with `rendering: true`, a purpose and a `coverageCommand`. It currently registers the native `hir_error_constructor_postbaseline_test.go` suite and browser `error-constructor.spec.mjs` suite. These files must exist; only compiler `hir_*_postbaseline_test.go` and compiler browser `*.spec.mjs` paths are permitted. Duplicates across registry categories, baseline overlap and unknown discovered suites still fail. Run their recorded commands for independent feature coverage: registration does not execute tests or claim frozen coverage.

This registry is an explicit, reviewable classification, not automatic detection of whether test code renders. Non-rendering entries remain limited to contract validation, printing, serialization and AST/HIR corpus checks. New flow-producing suites must receive separate post-baseline scenario/render coverage, not be labeled non-rendering or claimed as part of the original 663 cases. Adding such coverage must not regenerate or extend the frozen inventory or expected artifacts. Review any additional registry names and their classification explicitly.

## Legacy assertion provenance

`tests/hir-baseline-migrations.json` explicitly records each **actually changed** legacy DTO consumer, its original SHA-256, archive path, exact current SHA-256, and current extraction/scenario mapping. Archives under `tests/legacy-baseline-sources/**.txt` are the original **bytes from `280850fd`**, not snapshots of migrated tests. Their hashes must agree with the immutable render/source inventories. Unused registrations and orphan archives fail. Unregistered files remain direct-hash strict; examples, catalog/frozen input trees, the native bridge and unrelated infrastructure cannot use archive fallback.

Both arms are mandatory:

- Historical Go AST literal recipes and Babel request extraction reconstruct the same corpus/project inputs from verified original definitions. The original inventory hashes and all 663 case fingerprints stay authoritative.
- Current files are independently pinned byte-for-byte. Native recipes resolve historical literal ordinals to live literals by decoded value **and containing AST input expression**, not by shifted assertion indices. Ordered compiler/source-builder calls and a conservative closure over their variable definitions/mutations/range inputs must match, preventing an original literal left as dead code from standing in for changed compiler inputs. Every original scenario must remain. Explicit additional HIR-only native scenarios cannot introduce compilation requests or claim frozen coverage.
- Browser Babel extraction still reads the active files statically, never imports/evaluates tests, and compares project bytes, request order, scenarios and exclusions with both historical extraction and the original corpus. The excluded cancellation stress input additionally pins its actual generator AST (including 15,000 size, template, index expression and separator), not just its exclusion label.
- Stubbed infrastructure preserves original scenario presence/order and actual compiler/workspace request argument ASTs rather than obsolete DTO **response** literals. Additional scenarios are explicitly classified in the migration registry. Migrated synthetic flow assertions name HIR fixtures that must map to that original scenario's frozen catalog inputs.

After reviewing an assertion-only migration, register or refresh only its explicit paths with `node scripts/register_hir_migrations.mjs <path> ...`. This command archives originals from the baseline commit and records current digests; existing original digests and archives are immutable (a missing or altered registered archive fails rather than being repaired). It is **not** proof or authorization to change inputs. Never bulk-refresh digests to silence failures. Run both semantic checks and review the registry/archive diff:

```sh
node --test scripts/hir-baseline-migrations.test.mjs
node scripts/update_hir_goldens.mjs --check-inventory
(cd packages/compiler && GOWORK=off go test . -run '^TestHIR(MigrationASTProof|SourceInventory|CorpusCoverage)$' -count=1)
```

The negative tests cover archive tampering, active Ballerina input edits, removed scenarios, changed stress generator size/expression, and unknown suite/migration paths. These commands do not record or rewrite any frozen artifact.

## Rendering boundary

Prepare selected function/graph input, occurrence-local expansion and reference state, presentation flags (including source-selection availability), and viewport/panel/rendering parameters explicitly. Image generation must not infer this state from the editor DOM. Wait for fonts, React updates where applicable, and settled layout before serializing exact SVG bytes or explicit SVG absence.

Both default editor integration and isolated mounts import canonical `src/flow-view.tsx` and `src/flow-entry.tsx`. Production receives direct deserialized HIR and explicit state; `instantiateGraph(program, functionId, expanded)` instantiates it without AST/compiler access or a legacy UI conversion path. `FlowView` composes entry/definition/diagnostic HTML, wrappers and callbacks around shared `FlowSvg` presentation.

Archived synthetic inputs still use a **test-only exact fixture lookup** in `tests/browser/hir-model-registry.ts`: legacy JSON identifies a precomputed HIR fixture, never runs a converter. Graph-only fixtures explicitly omit the `FlowEntry` component for historically missing metadata and have no invented entry or AST expectations. Original DTO JSON, source archives, test-only legacy graph comparison helpers, and native `_test.go` models are historical fossils, not production exports. The isolated mount takes only captured HIR/state; it imports no registry, workspace or compiler.

Preserve SVG markup exactly, including inner `foreignObject` label/control HTML, attributes, identities, ordering and stylesheet-dependent appearance. Isolation from surrounding editor HTML is not permission to replace SVG content, inline new styles/fonts, or normalize output. Keep the original styles and fonts available in the isolated harness.

Independently replay editor integration actions and wait for the requested analysis/revision and settled React/layout. Capture exact `.flow-view.outerHTML`, wrapper mode/size and relevant computed styles. Where integration has an SVG, its bytes must equal isolated output for the same effective input/state/parameters. Definition/empty/error cases must retain explicit absence rather than fabricated diagrams. Callback/interaction tests remain necessary: matching markup does not prove behavior.

## Commands

```sh
npm ci
npx playwright install chromium
node scripts/capture_flow_baselines.mjs --self-test
node scripts/capture_flow_baselines.mjs --smoke
# Optional: --smoke --case <exact inventory case ID>

# Only before the gate is frozen, outside CI:
node scripts/capture_flow_baselines.mjs --prepare-fonts
node scripts/capture_flow_baselines.mjs --record --concurrency 1
node scripts/capture_flow_baselines.mjs --freeze

# After freezing; read-only for expected files, default production HIR path:
npm run test:flow-parity
# Optional compatibility spelling, identical pipeline:
node scripts/capture_flow_baselines.mjs --verify --hir
```

`--prepare-fonts` is unnecessary when the committed archive is present. It explicitly downloads the original Google Fonts stylesheet and every referenced font subset, retaining their original bytes and URLs under `tests/fixtures/flow-rendering/environment/fonts/`. Review the archive before recording. Every fresh context fulfills browser requests from it; unarchived external requests fail. This is test-only routing, not replacement CSS or a production font change. Font/stylesheet SHA-256 values are in `lock.json`; production retains its existing stylesheet import.

`--smoke` exercises the first case (or requested ID) twice in each mode without writing expected artifacts. Requested panel mode, width and height must match the actual wrapper, not be silently corrected. `--self-test` must detect test-only label, edge, coordinate, class/style and disclosure perturbations using the exact comparator, without editing production sources or baselines. Tests must also prove that absent or differing optional PNGs cannot fail recording, freezing, verification, normal tests or CI.

## Reproducing the environment

The initial supported environment is the retained local macOS installation: exact OS build/architecture, Node/Python/Go versions, npm lockfile, Playwright version, Chromium binary, and system/user/web fonts. Use the same retained machine or restore an image. `npm ci` and Playwright's locked browser reproduce dependencies, not system fonts. Do not substitute a new browser/font baseline mid-refactor. Other operating systems have font inventory support but no cross-platform equivalence guarantee; a new machine must pass the frozen environment check.

The manifest records OS version/release, runtime versions, Node executable SHA-256, host locale, browser version/binary SHA-256 and launch parameters, compiler pin, lockfile SHA-256, system/local/user font hashes, archived web-font responses, rendering CSS hashes, and context settings. Contexts use `en-US`, UTC, device scale factor 1, light color scheme, no reduced motion and blocked service workers; each case supplies its viewport. Git revision and relevant working-tree hashes are separate provenance: later production code may change, frozen output may not. CSS, fonts, case inputs and environment stay locked for exact SVG measurement and HTML/style assertions.

Existing software-rendering launch flags remain recorded browser parameters. They do not certify raster stability; GPU availability, PNG generation, PNG byte/pixel equality and antialiasing differences are not acceptance checks. Missing fonts/browser installations or pinned-environment drift remain failures independently of screenshots.

## Human SVG review (separate from acceptance)

Run `npm run review:flow` and open the loopback URL. Use **Capture + repeat**
for fresh isolated SVGs in development and production; old cached previews alone
do not establish parity. Save feedback with canonical case ID, mode, observed
issue and disposition, and export feedback when handing review off. Captures and
notes live under ignored `.bal-bot/flow-review/`, never in frozen artifacts.
Report what was actually inspected, unresolved findings and any environment
limitations separately from automated results. Screenshots are optional aids.
See [the review tool guide](../scripts/flow-review/README.md) for smoke checks.

## Recording and freezing (historical Stage 1 procedure)

The read-only `loadRenderCases()` validates filesystem discovery, original input/provenance hashes and scenario inventory before replay. Recording traverses the complete catalog independently for development and production. Generate SVG twice in fresh isolated contexts and require byte equality. Independently repeat HTML/style/wrapper integration captures in fresh contexts and require exact assertions, including isolated/integration SVG agreement. There is no normalization, tolerance, attribute sorting or geometry rounding. Optional screenshot differences require no tolerance policy because they are excluded from acceptance entirely.

The compiler uses `scripts/build_compiler.py`. Isolated servers use the Vite root, public directory and harness entry points of `scripts/compiler_browser_server.mjs`, with ephemeral loopback ports and temporary production output. They do not reuse developer servers, shared Playwright ports or `.compiler-browser-test`. Default concurrency is one; `--concurrency 1..8` is available. Each context closes after capture. Concurrency must not change required SVG/HTML/style/state output; raster variability does not constrain it.

Recording writes only new required artifacts (`wx`), then `recording.json` after all cases and both modes pass. An interrupted recording is not automatically resumed or overwritten: inspect the failure and explicitly remove only uncommitted partial artifacts before retrying. Never remove an established frozen manifest to bypass its guard.

`--freeze` does not recapture. It validates required case/environment/artifact hashes, the two-run recording marker, and the recording's Git revision/relevant working-tree content, then exclusively creates `frozen-manifest.json`. Freeze before committing; commit tooling, inventory, fonts, environment and original required artifacts together. Identify that baseline commit in migration review. Recording, font replacement and refreezing are rejected thereafter; recording/freezing are prohibited in CI. Optional PNG availability or contents must not affect any of these operations.

## Verification and artifacts

`npm run test:flow-parity` invokes `--verify` only. It requires the frozen manifest, validates the complete case list, inputs, environment and required artifact hashes, then replays both modes without writing expected files. Missing or modified required artifacts and unexpected registered required paths fail. Normal tests and browser suites never invoke record/freeze; CI is barred from writer commands.

Required artifacts per case/mode are exact isolated SVG (or explicit absence), integration HTML and JSON assertions for styles/wrappers/state. SVG absence is `svgAbsent: true` with a registered zero-byte SVG file, not an unnoticed missing artifact. Screenshots may be saved separately for review, but are excluded from required frozen-artifact inventories, hashes and comparisons. Missing, extra or different optional PNGs cannot fail the gate. Screenshot preparation must not mutate required output.

`fixtureInputs()` fingerprints source inventory/provenance and archived inputs, not generated artifacts or manifests. An optional screenshot path in case metadata can remain part of the inventory hash; that records a path, not a requirement that a PNG exist or match. Do not put generated raster contents in source-input archives or hash them as required artifacts.

Input/case drift, missing coverage, pinned-environment mismatch, unexplained SVG/HTML/style/state nondeterminism, isolated/integration SVG disagreement, required-output changes and unsupported fixture actions are failures. Diagnostics should identify mode, case and differing field. Report failures rather than regenerating expected output. AST/HIR golden updates must never write frozen render artifacts.
