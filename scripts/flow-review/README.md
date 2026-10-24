# Human flow review

Run `npm run review:flow`, then open <http://127.0.0.1:4318>. This is a loopback-only, dependency-free review UI using the existing Playwright/Vite dependencies. It does not modify production behavior, source fixtures, the spec, or frozen baselines.

Every catalog case has its original canonical ID and a stable short `FR-…` ID derived from that ID (collisions are checked on startup). Both source and SVG preview captions display it. **Copy link** produces a case/mode deep link; either ID can be searched. Feedback is stored against the canonical ID, so ordering and filters cannot change its identity.

- **Historical screenshot mismatches**: the same three historical fresh-context screenshot failures remain flagged. They are not demonstrated flow regressions. The displayed SVG previews are not the original failed PNG pair, and do not establish current screenshot parity; a subsequent match does not erase historical failure.
- **Coverage limitations**: graph-only, state-only, and invalid-input cases needing interpretation. Synthetic cases show original model JSON, never fabricated Ballerina source.
- **All cases** (default): all 663 inputs and presentation/interaction variants. Existing cached development SVG previews are available for all cases, but older captures were not rendered in isolation; regenerate with **Capture + repeat** to obtain isolated SVG captures. Production captures can be queued separately.
- Source is associated with the final rendered entry, including endpoint/function switches during replay. Ambiguous signatures or definition/error views show full project files with an explicit explanation rather than an assumed function.
- **Capture + repeat** renders isolated SVG twice in fresh contexts. First/repeat, side-by-side and blink modes support inspection. SVG previews use HTML iframes sandboxed with `allow-same-origin` only (no scripts), with titled frames and associated captions. Raw SVG remains downloadable. Origin and exact SVG/HTML/style comparison fields are displayed as reported, without normalization or tolerance; PNG generation or equality is not required. Legacy image captures can still be displayed when explicitly returned by an older server.
- **Capture all missing** populates the selected development/production mode serially. Errors and progress appear in the UI; capture completion refreshes the selected case.
- Save **Looks good**, **Needs work**, or **Unreviewed**, plus notes. **Export feedback** downloads all case IDs/statuses/notes as JSON. Feedback is per case, shared between modes; identify a mode in the note when relevant.

Local captures and feedback survive restarts under ignored `.bal-bot/flow-review/`; `reviews.json` contains notes. They are exploratory, not accepted baselines. The review server is not intended for public exposure or concurrent multi-user collaboration.

## Optional capture/import

```sh
npm run review:flow -- --capture-all
npm run review:flow -- --port 4319
# Import a partial run's artifact directory (development/production children):
npm run review:flow -- --import /absolute/path/to/partial/artifacts --capture-all
```

Imported captures are clearly marked as partial, uncertified captures from potentially different rendering environments. The three known historical-failure cases automatically get current first/repeat captures if missing. Capturing needs the existing Go/Python toolchain, archived fonts and installed Playwright Chromium; source lookup builds the existing native analyzer.

## Checks

`node scripts/flow-review/smoke.mjs` tests a running server at `http://127.0.0.1:4318` (or `FLOW_REVIEW_URL`). It validates case identity, SVG/source availability, sandboxed HTML preview loading and raw SVG content types, accessible frame captions, deep links, filters, safe feedback persistence and final-selection source matching. It expects the SVG-capable server (restart after updating); no PNG artifacts are required. It does not certify render parity or freeze baselines.
