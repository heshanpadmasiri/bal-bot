# Flow implementation validation

The implementation covers plan Stages 1–9: resolved source discovery, immutable models, isolated WASM analysis, revisioned workspace publication, retained scope conversations, custom flow construction/layout, source references, and both panel modes. Stage 10 documentation and independent browser critique are complete, with evidence below.

## Supported scope

All eleven standalone example packages pass the pinned Nutcracker checker and analysis adapter. Runnable inputs exclude configurables and unused module variables. Ordinary final variables are referenced; unreferenced functions/types remain covered. No source adaptation or upstream compiler changes are used.

Analyze runs public project/parser/nodebuilder/symbol/public-type/private-type resolution before semantic analysis, CFG and desugaring. It does not replace Check: some assignment/argument/return errors belong to later checking stages. Unsupported control effects retain exact source and explicit limitations. Conditional calls stay collapsed. No runtime execution, manual zoom, diff/checkpoints, dedicated mapping diagrams or async dependency edges are included.

## Automated evidence

- `npm test`: 52 passing JavaScript tests. Includes revision/edit-back races, initial invalid/infrastructure failure, removed/recreated scope identity, all retained service/endpoint/Automation aborts, protocol validation, isolated cancellation, reference freshness and graph routing.
- `npm run test:compiler`: native frontend/model integration; all eleven supported baselines checked before and after local resolution. Exact Unicode/CRLF ranges, symbol targets, original loop structure, unsupported effects and invalid input are covered.
- `npm run test:browser`: 40 browser tests across development and served production builds. Real WASM/native normalized models match for all eleven fixtures. Mocked-provider editor tests cover definitions/navigation, independent/recursive expansion, chips-only submission, stale/repair/failure states, obsolete completions, synchronous Send race, panel measurements, drag/resize, unsaved drafts and removal fallback.
- `npm run build`: TypeScript and Vite production build pass.

Graph tests assert distinct foreach next-iteration and exit ports/positions, abrupt exits and callee continuations, independent occurrence expansion, finite recursion, and routes avoiding unrelated source boxes. Browser label geometry checks ensure measured text fits its source header. Source packages alone are not used as evidence of UI state behavior.

## Independent live-browser critique

Both reviewers operated their own live browser with the four SVG references and explicit first-iteration exclusions. HMR resets were followed by reopening the affected fixture. Reviews are item-specific and limited to five rounds.

| Item | Reviewer one, round 1 | Reviewer two, round 1 | Fix and subsequent outcome |
| --- | --- | --- | --- |
| Service inspection | Pass: functions/types, navigation ownership and references | Pass: unreferenced definitions, connector and exact chip | Both agree. |
| Normal endpoint layout | Round 1 pass with scrolling limitation; round 2 confirms readable headers | Initial viewport clips source starts and wide containers leave excess padding | Initial horizontal alignment now targets the actual source header rather than container border. Round 2 fixed blank alignment; round 3 confirmed complete source starts within scrolling scope. |
| Expanded layout/floating chat | Pass: full workspace, header drag and collapse preservation | Pass: graph scrolling and chat dragging | Both agree. |
| Branching/loops | Round 1 pass; round 2 confirms separate iteration marker and exit | Foreach continue visually appears to merge with exit | Model ports were distinct; layout coordinates were identical. Separated next-iteration from exit, added explicit nonselectable marker, and asserted distinct positions. Reviewer two round 2 confirmed separate next-iteration and exit paths in native Chrome. |
| Inline expansion | Pass: nested body and returns join continuation | Pass: independent occurrences and nested bodies; viewport concern belongs to normal layout | Both agree on expansion behavior. |
| References/stale interaction | Pass: owning draft retained, stale chips disable Send, repair restores | Pass: saved invalid edit disables old source; repair enables references | Both agree. |

The initial reviews used natural-size horizontal scrolling. The subsequent user request supersedes that choice: flow now scales down to panel width with 20px margins, preserving vertical scrolling. Floating chat can obscure graph content until moved.

Reviewer two's initial follow-up attempts could not access its IAB surface; those attempts did not count as completed visual rounds. Native Chrome fallback allowed live reinspection. Item 2 completed at round 3 and item 4 at round 2, within the five-round limit. Reviewer one independently confirmed final header alignment and distinct iteration/exit paths in round 2 using native Chrome. Both reviewers agree on all six items; there are no unresolved critique discrepancies. No item exceeded three rounds.

A focused development/production parity rerun also asserts that the main thread's timer continues during every real WASM Analyze request. The final alignment regression asserts that foreach and condition header starts lie inside the initial normal viewport.

## Browser feedback follow-up

Centered source labels, made return boxes green, and removed top-level return-to-root exit arrows. Expanded callee returns still reach their call continuation. Branch conditions now emit true on the left and false on the right; foreach body entry stays centered. Routing uses straight aligned segments and orthogonal bends, including loop-back paths. Regression assertions cover side-port coordinates, orthogonal segments, terminal returns, centered text and return color. The running design-critique sample was visually checked after these changes.

## Panel-width fitting follow-up

The user requested automatic panel-width scaling, superseding the initial no-fit exclusion. Source diagrams now use a content-bounded SVG viewBox and responsive dimensions with 20px side margins, scaling down while preserving aspect ratio. Natural-size rendering remains the upper limit in expanded panels. Vertical scrolling remains available; horizontal clipping and initial scroll offsets are removed. Development and production regression tests cover function flow, resizing, normal/expanded modes, call expansion and reference selection after scaling. All 38 browser tests and the production build pass.

## Prompt selection borders

Flow nodes whose source identity, text and range match a reference in the current draft use a blue border while retaining their semantic fill. Highlighting follows the selected scope and clears when the chip is removed or the prompt is sent. Repeated displays of the same attached source share the highlight. Focused browser tests pass in development and production, covering chip deduplication, removal, scope switching and send clearing; the production build passes.

## Branch routing refinement

Conditions now size to their measured labels and reserve enough lateral spacing for branch destinations. Unobstructed side branches use one right-angle bend directly to the destination axis, avoiding the former outward/down/back detour. Obstacle-avoiding routes remain for bypasses and nested flows. Layout tests assert one-bend unobstructed branches and continued obstacle clearance; the design-critique true branch is checked in the browser. All 40 development/production browser tests and the production build pass.

## Loop label and disclosure placement

Foreach headers include the foreach keyword while their reference still attaches the original captured header source. Call disclosure controls sit 8 layout pixels from the box top-left in both collapsed and expanded states, independently of centered source text. Five graph tests, six focused development/production browser checks (placement, expansion, label fit and panel scaling), and the production build pass.
