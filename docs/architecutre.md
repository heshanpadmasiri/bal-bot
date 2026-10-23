# Architecture

The editor consumes a saved-file Workspace, discovered Service/Endpoint/Automation anchors, and one revisioned analysis snapshot. It uses PI's browser-compatible Agent API directly for messages, subscriptions, prompting, and cancellation. All file tools remain workspace-wide; selected-scope metadata guides focus without restricting editing.

## Shared contracts

`packages/workspace/src/flow.ts` defines immutable source-backed program, definition, function, statement, expression, and call models. Located values carry deterministic source identities, exact text, and workspace ranges. Positions are one-based Unicode code-point columns with exclusive ends and CRLF counted once. Configurable definitions are reserved for future compiler support and are not produced by this iteration.

`Workspace.getScopes()` resolves to Service or Automation anchors from the latest valid model. `getServices()` filters that result; Automation projects return an empty service list. Initial invalid/failed analysis settles discovery with no invented anchors. `analysisSnapshot()` and `subscribeAnalysis()` expose pending, ready, invalid, and failed states independently from files and synchronization.

Anchors expose `id`, `title`, `getAgent()`, `getFlowUI(signal?)`, and explicitly unimplemented `getDiff()`. Services expose their resolved listener/service type label (or null), `scopeKind: 'service'`, and synchronous endpoint access. Endpoints expose resource/remote kind and owning serviceId. Automation has `scopeKind: 'automation'`. Diff stays opaque and has no nonfunctional UI controls.

## Source analysis and checking

`packages/compiler` is a standalone Go library and browser package pinned to Nutcracker commit `f7c4c58d4691085b57f0c2634c8bb597f3ccaaea`. There are no vendored sources, local replacements, private compiler-field accesses, or upstream changes. The local server has no compiler endpoint.

`Compiler.check(files, signal?)` and native `Check` preserve existing checking through frontend analysis and desugaring. The agent's `get_diagnostics` captures saved files, forwards cancellation, and reports diagnostics plus snapshot staleness without writing storage or notifying file subscribers. This operation does not run Ballerina code or produce executable artifacts.

`Compiler.analyze(files, signal?)` and native `Analyze` use a separate public-API pipeline. Public project loading and dependency graphs provide workspace and embedded source. Per-request contexts run parser/nodebuilder, ResolveSymbols, ResolvePublicNodeTypes, then ResolvePrivateNodesTypes. Analysis stops before compiler semantic analysis, CFG, desugaring, and backend generation. Some compatibility diagnostics occur only in later stages; local resolution is not a substitute for full checking. The recovery fixture uses an invalid operator expression diagnosed at the local-resolution stage.

Extraction exports workspace definitions and resolved symbol targets, never AST pointers, dependency ASTs, symbol spaces, or Go runtime state. Ordinary module functions/types and resolved client-object variables populate service definitions; resource/remote methods appear only as endpoints. Ordinary attached methods stay with their service. Class methods can supply resolved workspace call bodies without entering unrelated services' definition lists. Services take precedence over main; otherwise each module main is an Automation scope.

Each browser operation owns a dedicated worker, lazily loaded Go runtime, readiness handshake, and WASM instance. CompilerRequest/CompilerResponse discriminate check and analyze; the bridge is balBotCompilerRequest. Responses validate operation, schema, IDs, referential integrity, and source text/ranges before publication. Source errors are invalid results; runtime/bridge/WASM/model failures reject. Success, failure, and cancellation clean up listeners/workers; cancelling one request leaves other requests independent.

Both operations retain the root-package and named-module layouts, file validation, diagnostic normalization, and embedded-library-only dependency policy. Test sources, nested/workspace packages, and unsupported dependencies produce explicit diagnostics. Configurables remain unsupported by the pinned compiler and are excluded from runnable inputs; no adapter bypasses that limitation.

## Revisions, identities, and agent lifetimes

Every successful saved-source change immediately publishes pending/stale analysis, increments the browser workspace's revision, cancels superseded work, and analyzes a captured snapshot. Only the current revision can publish. Unsaved source-editor drafts are excluded. Invalid source or infrastructure failure retains the last valid model and exposes diagnostics/error state; valid current analysis clears staleness. Editing text back does not revive an obsolete completion.

Declaration IDs use module/enclosing declaration/name or resource signature; ambiguous unnamed services add file/path/order context. Statement IDs use owning function and structural paths. Call occurrence paths distinguish inline expansions; source IDs identify references. Surviving anchors retain agents across harmless edits. Removed anchors leave current navigation but remain retained for cleanup; recreation after a valid removal gets a new agent. Ambiguous service edits retire the affected sessions. All retained agents, including removed/unselected endpoints and Automations, abort on loss of writable synchronization. Scope selection never aborts another agent.

## Graphs, layout, and editor state

`apps/editor/src/flow.ts` converts structured statements into owned nodes, ports, and edges. Fragments keep normal/return/break/continue exits separate. Expanded callee returns join that call's continuation, and ancestor call stacks prevent recursive expansion. Unsupported effects retain exact source and stop uncertain continuation; later source remains visible without a false incoming edge.

Layout measures wrapped monospace labels, reserves branch/loop lanes, computes container bounds, and routes orthogonal execution arrows around unrelated nodes. A WeakMap carries implementation-local hierarchy hints from diagram conversion to layout/rendering without adding synthetic source nodes to the public model. Entry/exit/join ports and edges are not selectable. Source selection and call disclosure are separate accessible controls. Layout retains natural diagram coordinates; the SVG viewBox scales the rendered graph down to the available panel width, with 20px side margins and vertical scrolling. Panel resize, mode changes and call expansion update the fit automatically.

The editor keeps drafts, references, inspected function, and expansion paths by retained anchor instance. Global panel mode and floating chat position remain separate. Normal columns use 20/60/20; expanded inspection fills the workspace below the top bar, with chat dragged by its header and clamped after resize. File editing, provider selection, and synchronization remain available in normal mode.

Reference helpers preserve prose, deduplicate source-node identity, and show filepath plus inclusive occupied rows. Saved-source changes mark chips stale. Valid analysis refreshes only identical node identity/range/text; moved or changed references require removal/reselection. Submission synchronously checks revision and chip validity immediately before agent.prompt, serializing exact captured text/ranges in a delimited reference list. Visible user messages show prose and chip labels. Prose-only repairs can send while analysis is stale, with scope rows explicitly marked stale and instructions to read current saved files.

## Validation and builds

`npm test` covers workspace/agent/sync behavior, compiler transport, graph structure, and reference helpers. `npm run test:compiler` covers native checking, resolved models, call identity, source ranges, supported fixtures, and the analysis stop point. `npm run test:browser` exercises real Go WASM and editor interactions in development and built production harnesses, including native-model parity, cancellation/retry, panel state, references, races, and stale recovery. Provider transport is mocked; tests need no credentials or listeners.

Builds require Go 1.27.1 or newer and Python 3. Editor predev/prebuild run `scripts/build_compiler.py` with GOWORK=off, GOOS=js, and GOARCH=wasm, generating ignored assets under apps/editor/public/compiler. `npm run build` checks TypeScript and builds Vite assets. `npm start` serves the built application. Install Playwright Chromium before running browser tests. Independent live-browser critiques and their outcomes are recorded in the implementation validation notes.

## Directory synchronization

The server requires a project-directory argument. It creates starter files only when that directory is missing or empty. It recursively reads regular `.md`, `.bal`, and `.toml` files as UTF-8, skipping symbolic links. The agent continues to use browser file tools, and unsupported file extensions are rejected there.

`packages/workspace/src/sync-protocol.ts` holds the shared messages, file validation, and initial project. `apps/editor/server/project.mjs` owns disk access, a serialized change queue, server revisions, durable operation receipts, and a 500 ms asynchronous scan. `server/sync.mjs` broadcasts changes through an authenticated WebSocket alongside Vite's development connection. Connections use short-lived, single-use tickets issued through the existing session-authenticated API and checked against the request origin.

`packages/browser-workspace/src/sync.ts` reconciles server snapshots with a persisted browser outbox and transmits one operation at a time. Files and the outbox persist together before tools or the editor observe a successful mutation. Remote updates do not create new local operations. Server revisions detect missed updates; each server startup gets a new epoch. Last processed changes win; operation receipts make acknowledgment retries idempotent across restart.

The editor observes `SyncState` separately from files. A disconnected or failed sync makes mutations and new chat turns unavailable, while file reads remain available. All retained workspace agents are aborted when writing becomes unavailable. On reconnect, pending operations finish before editing becomes available, without automatically resuming an agent. Draft text remains local until an explicit Save.

The sidebar File sync switch calls `SyncController.setEnabled(boolean)`. An explicit pause closes the transport and cancels retries/watchdogs while keeping the browser workspace writable with status `paused`. Mutations still persist files and pending operations together; they retain paused status. Connection generations and detached listeners prevent obsolete connections, events, or scheduled sends from changing a newer mode. Resuming publishes a read-only connecting state (aborting retained agents), obtains a fresh server snapshot, and drains the existing outbox before enabling writes. Durable receipt handling and server messages are unchanged.

The application stores the switch preference in `sessionStorage` under `bal-bot.file-sync.v1.<projectId>`, separately from the shared localStorage file cache. It restores that preference before starting sync, so a paused reload does not connect or replay operations. Tabs do not broadcast preference changes. Preference writes happen before mode changes; a failed write leaves the previous mode intact and is shown through the editor error message.
