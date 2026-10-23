# bal-bot

A browser workspace for editing Ballerina HTTP services with PI.

The model dropdown shows a curated set: GPT-6.1 Sol (default), GPT-6 Astra, and GPT-6 Luna for OpenAI; Claude Sonnet 5.5 (default), Opus 5.5, and Haiku 5.5 for Anthropic. The list lives in `apps/editor/server/model-selection.mjs` and was checked against the official provider catalogs on October 22, 2026.

Install Node.js (with TypeScript source support), Python 3, and Go 1.27.1 or newer. No local Ballerina installation is needed.

```sh
npm install
npm run dev -- /path/to/service
```

Open http://127.0.0.1:5173. Use the provider dropdown in the top-right corner to choose **OpenAI / ChatGPT** or **Claude / Anthropic**. Selecting a disconnected provider starts its login flow; selecting a connected provider switches to that account. Choose the model from the dropdown at the bottom-left of the chat composer. Follow PI's login prompts and open the provider authorization link. Complete sign-in on the provider's website. PI handles the local callback; manual redirect URL/code entry is also available. Claude offers browser and copy-code login methods. Select a model and describe a change in chat.

A directory argument is required; without it, the server prints usage and exits. Relative paths resolve from the directory where you invoked npm. A missing or empty project directory is initialized with `Ballerina.toml` and an empty HTTP service in `main.bal`. Existing nonempty directories are loaded without adding starter files. PI reads and edits the same files shown in the expandable file tree on the left. Select a file to inspect or edit its source in the main area; select **Back to chat** or a discovered scope to return to its conversation. File tools support listing, reading, writing, exact text replacement, and deletion. The `get_diagnostics` tool checks the saved root Ballerina package and named modules on demand in a browser worker. Results include structured compiler diagnostics and a `stale` flag if files changed during the check; a stale result needs an explicit recheck. Unsaved editor drafts are excluded. The browser keeps a project-specific localStorage cache; chat lasts for the current tab. The previous browser-only storage entry is left untouched.

Eligible files are regular UTF-8 text files with the exact lowercase extensions `.md`, `.bal`, and `.toml`, recursively, including dotfiles. Other extensions remain on disk and do not appear in the browser; creating them through the UI or agent is rejected. Symbolic links are skipped and cannot be written through. Invalid UTF-8 produces an error without rewriting the offending file.

An authenticated WebSocket synchronizes creates, edits, and deletes in the background. The server scans disk every 500 ms and serializes browser mutations with observed disk changes. The last change processed by the server wins; client clocks are not used. Pending browser mutations persist with the cache and are retried after reconnecting. Operation receipts in `.bal-bot/sync` prevent an already-applied retry from overwriting a later change, including across server restarts.

The sidebar footer shows Connecting, Syncing, Synced, Disconnected, or Sync error. Files stay readable during a disconnect, but editing and new chat turns pause and any running agent turn is aborted. Reconnection reconciles disk state and acknowledges pending changes before enabling editing. Agent turns do not resume automatically. Unsaved source-editor drafts are retained in the tab; saving one later submits a new change.

Use the **File sync** switch in the sidebar footer to pause synchronization in both directions. Editing, chat, source analysis, and diagnostics continue using browser files while paused; saved edits remain queued in the browser cache. The footer shows **Sync paused** and the number of pending operations. The switch defaults to on and remembers its choice per project in the current tab through reloads, independently of other tabs. Turning sync back on aborts running agents and temporarily blocks editing and new chat turns until the server snapshot and queued operations are reconciled. Queued browser writes and deletions use the existing last-processed-change rule and can replace newer disk changes; untouched files refresh from disk. Already-receipted operations are not applied again. An operation sent before pausing may still finish on disk. Unsaved editor drafts stay in the tab.

One Node.js process serves the website, project synchronization, PI login endpoints, and streamed model requests. The agent loop and file tools execute in the browser. The server uses PI's provider-owned OAuth login, refresh, and logout implementations, shared with the coding harness. Credentials are stored in the git-ignored `.bal-bot/auth.json` with owner-only permissions and are never sent to the browser. This is a separate credential store from the PI CLI's own login. **Sign out** removes the selected provider's local credentials. Provider authorization and model access depend on your account and subscription.

The server binds to loopback and is intended for one local user. API requests require a server-issued session token; cross-origin requests and non-local hostnames are rejected. Login attempts time out after five minutes. Keep the browser and server on the same machine for automatic OAuth callbacks. This version is not a shared, multi-user hosted service.

Saved source discovers services and their resource/remote endpoints across files and named modules. Without services, module main functions appear as Automation scopes. Each scope retains its own agent, conversation, draft, references, and expanded calls for the current tab. Agents still share access to every workspace file.

The right panel lists module functions, types, and connectors for a service, or shows a connected source flow for an endpoint/Automation. Supported branches, while/foreach loops, abrupt exits, and workspace calls retain their source locations. Use the separate disclosure button to expand a workspace call; recursive and external calls stay collapsed. Selecting source adds a removable reference chip without submitting or replacing prose. Nodes attached to the current prompt have a blue border; removing their chips or sending clears the highlight. A draft containing stale chips cannot send until they are removed or reselected. Prose-only repair requests remain available while analysis is stale.

Normal navigation/chat/inspection uses 20/60/20 proportions. Expand inspection from the top bar to fill the workspace and drag chat by its header. Flow automatically scales down to fit the inspection panel width with left and right margins, recalculating on resize and expansion. Tall diagrams scroll vertically; manual zoom controls remain deferred. Diff/checkpoint controls, mapping expansion, async relationships, configurable discovery, and runtime execution are deferred. Unsupported visualization constructs keep their exact source and an explicit limitation; uncertain continuation edges are omitted.

Automatic flow analysis is a separate browser-worker operation that stops after Nutcracker local type resolution, before semantic analysis, CFG construction, and desugaring. It does not prove full frontend correctness: some assignment, argument, and return errors are diagnosed later. The existing `get_diagnostics` tool still uses full frontend checking through desugaring. Test sources and unsupported project layouts return explicit diagnostics; neither operation runs services or generates executables. PI continues to use the browser-compatible `Agent` from `@earendil-works/pi-agent-core`.

See [the eleven runnable example packages](examples/README.md) for compiler-supported inputs and browser interaction expectations.

```sh
npm test
npm run test:compiler
npx playwright install chromium
npm run test:browser
npm run build
npm start -- /path/to/service
```

`npm run dev` and `npm run build` first generate WASM and the matching Go JavaScript runtime in `apps/editor/public/compiler/`, including when invoked directly in the editor workspace. These generated assets are ignored by Git. `npm run dev` serves the website through Vite middleware. `npm start` serves the production build through the same API server. Production startup uses the existing built assets and does not compile Go. Use `PORT` to change the default 5173 port.

Compiler tests exercise the real Go wrapper and browser WASM workers in development and production, including cancellation, independent requests, responsiveness, infrastructure failures, and fresh retries. No provider account is needed. `python3 scripts/verify_compiler_dependencies.py` verifies a remote-only WASM build from an isolated copy with an empty module cache.

Other tests cover directory startup, filtering, path confinement, bidirectional WebSocket sync, reconnects, lost acknowledgments, disk/storage errors, filesystem operations, credential persistence and refresh, login prompts and cancellation, API access checks, streaming, browser tool execution, and aborts. Provider interactions are mocked in automated tests. Completing a real OAuth login and live model call requires your account.

## Code layout

This repository uses npm workspaces:

- `packages/workspace` (`@bal-bot/workspace`): workspace, service, endpoint, and anchor interfaces, plus shared sync messages and starter files.
- `packages/browser-workspace` (`@bal-bot/browser-workspace`): browser filesystem, background sync client, HTTP service anchor, and agent tools.
- `apps/editor` (`@bal-bot/editor`): React editor, local API/WebSocket server, and disk project store. The entry point injects the concrete workspace into the editor.
- `packages/compiler` (`@bal-bot/compiler`, Go module `balbot/compiler`): reusable frontend wrapper, WASM bridge, and per-request browser workers. Nutcracker modules are remote dependencies pinned to commit `f7c4c58d4691085b57f0c2634c8bb597f3ccaaea` in `go.mod` and `go.sum`. Remote-to-remote replacements align upstream unpublished submodule requirements; no local compiler sources are used.

Run the commands above from the repository root. The production build lives in `apps/editor/dist`; the existing `.bal-bot` credential directory and browser storage key are preserved.
