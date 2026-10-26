# Focused production SVG snapshots

```sh
npm install
npx playwright install chromium # once, if not already installed
npm run test:svg                # verify; never updates expected files
npm run update:svg              # explicitly generate/update locally; blocked in CI
npm run test:all                # includes test:svg
```

Review the `.bal` input and both `.svg` changes before accepting an update. These
are new focused baselines, not regenerated legacy frozen parity artifacts.

## What is captured

`fixtures/branch-call.bal` is a complete program. Two fresh Chromium pages compile
it using the real production WASM compiler, `FlowView`, layout, and SVG renderer in
the built playground: `demo`, once collapsed and once with `nextValue` expanded.
There are no test mounts or changes to production rendering. The test uses the
ordinary source editor and disclosure button. Add a small source/state case in
`render.spec.mjs` when new coverage is useful; do not snapshot unrelated projects.

The browser environment is 1440 × 1000 CSS pixels, device scale factor 1, en-US,
UTC, light theme, reduced motion, one worker. Chromium comes from the installed
Playwright version. Rendering uses locally committed Roboto/Roboto Mono Latin
WOFF2 fonts (Google Fonts, SIL OFL licenses alongside them). External Google Fonts
requests are blocked. Named app faces and Chromium generic font families resolve
to these fonts, loaded before analyzing the fixture. Host font hashes are not used.

SVGs keep the production renderer's intrinsic width/height and viewBox, so the
vector canvas follows the diagram's bounds, **not** the browser viewport. Only the
outer SVG's responsive fit width/height/max-width/margins are omitted on export:
these belong to the playground shell. Applicable production CSS declarations are
materialized from computed values, including inherited typography, on the SVG's
actual elements. Font faces are embedded and generic font names materialized for
standalone viewing. XHTML `foreignObject` labels remain intact. Open in a browser
rather than an SVG viewer without `foreignObject` support.

Comparison is exact serialized SVG text. No rounding, ID stripping, label
truncation, path rewriting, pixel tolerances, file/environment hashes, or HTML
shell snapshots. Current renderer IDs are deterministic and remain in the SVG.
Each page is captured twice to check stability, and independent verify runs check
the committed result. Unrelated code or styles that do not affect this diagram
are not a reason to update it.

## Inspect a failure

A failure names its fixture and writes ignored files to:

```
test-results/svg/<fixture>/source.bal
test-results/svg/<fixture>/expected.svg
test-results/svg/<fixture>/actual.svg
test-results/svg/<fixture>/diff.patch
test-results/svg/<fixture>/diff.html
```

Open `diff.html` for three columns: **Ballerina source | Expected SVG | Actual
SVG**, followed by the exact text diff. Each pane scrolls independently; the SVG
links open at native vector size. The source is also available as `source.bal`.
To view reports over HTTP, run:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory test-results/svg
```

Then open `http://127.0.0.1:8766/<fixture>/diff.html`. A missing baseline is a failure,
with an explicitly labelled placeholder expected SVG, never silent approval.
Matching verification or an explicit update clears that fixture's stale report.
`test:scripts` exercises matching, a changed fill, missing baselines, artifact
contents, explicit create/replace updates, and CI rejection.

To explore the input interactively, run `npm run dev:playground`, paste the `.bal`
file or use a prefilled demo link, and expand **+ nextValue**. Analysis updates as
you edit; the playground does not execute the Ballerina program.
