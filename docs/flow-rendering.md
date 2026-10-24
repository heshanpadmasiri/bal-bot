# Frozen flow rendering gate

Stage 1 tools replay the **current production renderer**. The contract below follows `spec.md` and `plan.md`: isolated headless SVG is the primary image-parity gate; surrounding HTML, styles, wrappers and interactions have separate integration coverage. Screenshots are optional human-review aids, never acceptance artifacts.

## Current gate status

The revised isolated-SVG/separate-HTML baseline is recorded, frozen, and verified for all 663 cases in both development and production. Recording passed two fresh-context runs per case/mode; verification replayed the frozen artifacts successfully. The required artifact set contains no PNGs. Earlier partial recordings remain non-authoritative. Earlier raster differences do not block this gate, and no GPU/raster stability is required.

The baseline authority is `tests/fixtures/flow-rendering/frozen-manifest.json` (schema version 2, pipeline `isolated-svg+editor-integration`), with the original Git revision, working-tree hashes, pinned environment, and artifact hashes. The baseline/tooling commit is `280850fd`. This is the committed Stage 1 authority for subsequent migration; its recorded pre-commit revision and working-tree hashes remain unchanged in the manifest. No shared production SVG extraction has been performed.

## Frozen inventory and post-baseline suites

`loadRenderCases()` retains strict discovery and original byte-hash checks for every Stage 1 suite. The frozen inventory, source archives, case metadata and artifacts must not be updated to accommodate new tests.

`tests/hir-suite-inventory.json` separately allows the planned non-rendering HIR suites `packages/compiler/hir_test.go` and `packages/compiler/tests/hir.test.mjs`. Entries may be registered before their files exist. Each entry explicitly declares `rendering: false` and its purpose; duplicate entries, overlap with baseline suites, malformed entries and all unregistered discovered suites fail loading. Registered suites do not bypass the original baseline suite presence or source-hash checks.

This registry is an explicit, reviewable classification, not automatic detection of whether test code renders. Keep it limited to contract validation, printing and serialization (and later non-rendering AST/HIR corpus checks). A new flow-producing suite must receive separate post-baseline scenario/render coverage, not be labeled non-rendering or claimed as part of the original 663 cases. Adding such coverage must not regenerate or extend the frozen inventory or expected artifacts. Review any additional registry names and their classification explicitly.

## Rendering boundary

Prepare selected function/graph input, occurrence-local expansion and reference state, presentation flags (including source-selection availability), and viewport/panel/rendering parameters explicitly. Image generation must not infer this state from the editor DOM. Wait for fonts, React updates where applicable, and settled layout before serializing exact SVG bytes or explicit SVG absence.

Before Stage 5, a minimal **test-only legacy FlowView adapter** reuses production graph construction, font measurement, layout and SVG presentation. It does not mount the full editor or scrape the editor's diagram as its primary SVG source. It must not duplicate SVG markup/layout, invent missing graph metadata or change production rendering before the baseline gate. Synthetic graph-only fixtures explicitly inventory missing entry metadata and lack AST expectations.

At Stage 5, extract shared production image/SVG rendering support for both FlowView and the isolated harness; remove or migrate the temporary legacy adapter with the old model. The migrated image path consumes only HIR plus explicit state/parameters, without AST, compiler or legacy-model access. FlowView separately composes existing entry/definition/diagnostic HTML, wrappers and callbacks around that shared image output.

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

# After freezing; read-only for expected files:
npm run test:flow-parity
```

`--prepare-fonts` is unnecessary when the committed archive is present. It explicitly downloads the original Google Fonts stylesheet and every referenced font subset, retaining their original bytes and URLs under `tests/fixtures/flow-rendering/environment/fonts/`. Review the archive before recording. Every fresh context fulfills browser requests from it; unarchived external requests fail. This is test-only routing, not replacement CSS or a production font change. Font/stylesheet SHA-256 values are in `lock.json`; production retains its existing stylesheet import.

`--smoke` exercises the first case (or requested ID) twice in each mode without writing expected artifacts. Requested panel mode, width and height must match the actual wrapper, not be silently corrected. `--self-test` must detect test-only label, edge, coordinate, class/style and disclosure perturbations using the exact comparator, without editing production sources or baselines. Tests must also prove that absent or differing optional PNGs cannot fail recording, freezing, verification, normal tests or CI.

## Reproducing the environment

The initial supported environment is the retained local macOS installation: exact OS build/architecture, Node/Python/Go versions, npm lockfile, Playwright version, Chromium binary, and system/user/web fonts. Use the same retained machine or restore an image. `npm ci` and Playwright's locked browser reproduce dependencies, not system fonts. Do not substitute a new browser/font baseline mid-refactor. Other operating systems have font inventory support but no cross-platform equivalence guarantee; a new machine must pass the frozen environment check.

The manifest records OS version/release, runtime versions, Node executable SHA-256, host locale, browser version/binary SHA-256 and launch parameters, compiler pin, lockfile SHA-256, system/local/user font hashes, archived web-font responses, rendering CSS hashes, and context settings. Contexts use `en-US`, UTC, device scale factor 1, light color scheme, no reduced motion and blocked service workers; each case supplies its viewport. Git revision and relevant working-tree hashes are separate provenance: later production code may change, frozen output may not. CSS, fonts, case inputs and environment stay locked for exact SVG measurement and HTML/style assertions.

Existing software-rendering launch flags remain recorded browser parameters. They do not certify raster stability; GPU availability, PNG generation, PNG byte/pixel equality and antialiasing differences are not acceptance checks. Missing fonts/browser installations or pinned-environment drift remain failures independently of screenshots.

## Recording and freezing

The read-only `loadRenderCases()` validates filesystem discovery, original input/provenance hashes and scenario inventory before replay. Recording traverses the complete catalog independently for development and production. Generate SVG twice in fresh isolated contexts and require byte equality. Independently repeat HTML/style/wrapper integration captures in fresh contexts and require exact assertions, including isolated/integration SVG agreement. There is no normalization, tolerance, attribute sorting or geometry rounding. Optional screenshot differences require no tolerance policy because they are excluded from acceptance entirely.

The compiler uses `scripts/build_compiler.py`. Isolated servers use the Vite root, public directory and harness entry points of `scripts/compiler_browser_server.mjs`, with ephemeral loopback ports and temporary production output. They do not reuse developer servers, shared Playwright ports or `.compiler-browser-test`. Default concurrency is one; `--concurrency 1..8` is available. Each context closes after capture. Concurrency must not change required SVG/HTML/style/state output; raster variability does not constrain it.

Recording writes only new required artifacts (`wx`), then `recording.json` after all cases and both modes pass. An interrupted recording is not automatically resumed or overwritten: inspect the failure and explicitly remove only uncommitted partial artifacts before retrying. Never remove an established frozen manifest to bypass its guard.

`--freeze` does not recapture. It validates required case/environment/artifact hashes, the two-run recording marker, and the recording's Git revision/relevant working-tree content, then exclusively creates `frozen-manifest.json`. Freeze before committing; commit tooling, inventory, fonts, environment and original required artifacts together. Identify that baseline commit in migration review. Recording, font replacement and refreezing are rejected thereafter; recording/freezing are prohibited in CI. Optional PNG availability or contents must not affect any of these operations.

## Verification and artifacts

`npm run test:flow-parity` invokes `--verify` only. It requires the frozen manifest, validates the complete case list, inputs, environment and required artifact hashes, then replays both modes without writing expected files. Missing or modified required artifacts and unexpected registered required paths fail. Normal tests and browser suites never invoke record/freeze; CI is barred from writer commands.

Required artifacts per case/mode are exact isolated SVG (or explicit absence), integration HTML and JSON assertions for styles/wrappers/state. SVG absence is `svgAbsent: true` with a registered zero-byte SVG file, not an unnoticed missing artifact. Screenshots may be saved separately for review, but are excluded from required frozen-artifact inventories, hashes and comparisons. Missing, extra or different optional PNGs cannot fail the gate. Screenshot preparation must not mutate required output.

`fixtureInputs()` fingerprints source inventory/provenance and archived inputs, not generated artifacts or manifests. An optional screenshot path in case metadata can remain part of the inventory hash; that records a path, not a requirement that a PNG exist or match. Do not put generated raster contents in source-input archives or hash them as required artifacts.

Input/case drift, missing coverage, pinned-environment mismatch, unexplained SVG/HTML/style/state nondeterminism, isolated/integration SVG disagreement, required-output changes and unsupported fixture actions are failures. Diagnostics should identify mode, case and differing field. Report failures rather than regenerating expected output. AST/HIR golden updates must never write frozen render artifacts.
