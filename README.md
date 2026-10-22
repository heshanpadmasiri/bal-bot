# bal-bot

A browser workspace for editing Ballerina HTTP services with PI.

The model dropdown shows a curated set: GPT-6.1 Sol (default), GPT-6 Astra, and GPT-6 Luna for OpenAI; Claude Sonnet 5.5 (default), Opus 5.5, and Haiku 5.5 for Anthropic. The list lives in `apps/editor/server/model-selection.mjs` and was checked against the official provider catalogs on October 22, 2026.

```sh
npm install
npm run dev -- /path/to/service
```

Open http://127.0.0.1:5173. Use the provider dropdown in the top-right corner to choose **OpenAI / ChatGPT** or **Claude / Anthropic**. Selecting a disconnected provider starts its login flow; selecting a connected provider switches to that account. Choose the model from the dropdown at the bottom-left of the chat composer. Follow PI's login prompts and open the provider authorization link. Complete sign-in on the provider's website. PI handles the local callback; manual redirect URL/code entry is also available. Claude offers browser and copy-code login methods. Select a model and describe a change in chat.

A directory argument is required; without it, the server prints usage and exits. Relative paths resolve from the directory where you invoked npm. A missing or empty project directory is initialized with `Ballerina.toml` and an empty HTTP service in `main.bal`. Existing nonempty directories are loaded without adding starter files. PI reads and edits the same files shown in the expandable file tree on the left. Select a file to inspect or edit its source in the main area; select **Chat** or **HTTP service** to return to the conversation. File tools support listing, reading, writing, exact text replacement, and deletion. The browser keeps a project-specific localStorage cache; chat lasts for the current tab. The previous browser-only storage entry is left untouched.

Eligible files are regular UTF-8 text files with the exact lowercase extensions `.md`, `.bal`, and `.toml`, recursively, including dotfiles. Other extensions remain on disk and do not appear in the browser; creating them through the UI or agent is rejected. Symbolic links are skipped and cannot be written through. Invalid UTF-8 produces an error without rewriting the offending file.

An authenticated WebSocket synchronizes creates, edits, and deletes in the background. The server scans disk every 500 ms and serializes browser mutations with observed disk changes. The last change processed by the server wins; client clocks are not used. Pending browser mutations persist with the cache and are retried after reconnecting. Operation receipts in `.bal-bot/sync` prevent an already-applied retry from overwriting a later change, including across server restarts.

The sidebar footer shows Connecting, Syncing, Synced, Disconnected, or Sync error. Files stay readable during a disconnect, but editing and new chat turns pause and any running agent turn is aborted. Reconnection reconciles disk state and acknowledges pending changes before enabling editing. Agent turns do not resume automatically. Unsaved source-editor drafts are retained in the tab; saving one later submits a new change.

One Node.js process serves the website, project synchronization, PI login endpoints, and streamed model requests. The agent loop and file tools execute in the browser. The server uses PI's provider-owned OAuth login, refresh, and logout implementations, shared with the coding harness. Credentials are stored in the git-ignored `.bal-bot/auth.json` with owner-only permissions and are never sent to the browser. This is a separate credential store from the PI CLI's own login. **Sign out** removes the selected provider's local credentials. Provider authorization and model access depend on your account and subscription.

The server binds to loopback and is intended for one local user. API requests require a server-issued session token; cross-origin requests and non-local hostnames are rejected. Login attempts time out after five minutes. Keep the browser and server on the same machine for automatic OAuth callbacks. This version is not a shared, multi-user hosted service.

This version edits source only. It has no compiler, service runtime, flow view, diff view, or right panel. Navigation contains a single HTTP service and a file list; automatic service/endpoint discovery is not implemented. PI uses the browser-compatible `Agent` from `@earendil-works/pi-agent-core` rather than the Node-oriented coding-agent `AgentSession` described in the longer-term architecture docs.

```sh
npm test
npm run build
npm start -- /path/to/service
```

`npm run dev` serves the website through Vite middleware. `npm start` serves the production build through the same API server. Use `PORT` to change the default 5173 port.

Tests cover directory startup, filtering, path confinement, bidirectional WebSocket sync, reconnects, lost acknowledgments, disk/storage errors, filesystem operations, credential persistence and refresh, login prompts and cancellation, API access checks, streaming, browser tool execution, and aborts. Provider interactions are mocked in automated tests. Completing a real OAuth login and live model call requires your account.

## Code layout

This repository uses npm workspaces:

- `packages/workspace` (`@bal-bot/workspace`): workspace, service, endpoint, and anchor interfaces, plus shared sync messages and starter files.
- `packages/browser-workspace` (`@bal-bot/browser-workspace`): browser filesystem, background sync client, HTTP service anchor, and agent tools.
- `apps/editor` (`@bal-bot/editor`): React editor, local API/WebSocket server, and disk project store. The entry point injects the concrete workspace into the editor.
- `vendor/nutcracker`: source snapshot of Nutcracker upstream `main`, recorded in `vendor/nutcracker.json`. Runtime integration is deferred.

Run the commands above from the repository root. The production build lives in `apps/editor/dist`; the existing `.bal-bot` credential directory and browser storage key are preserved.
