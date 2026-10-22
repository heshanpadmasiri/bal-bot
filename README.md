# bal-bot

A browser workspace for editing Ballerina HTTP services with PI.

The model dropdown shows a curated set: GPT-6.1 Sol (default), GPT-6 Astra, and GPT-6 Luna for OpenAI; Claude Sonnet 5.5 (default), Opus 5.5, and Haiku 5.5 for Anthropic. The list lives in `apps/editor/server/model-selection.mjs` and was checked against the official provider catalogs on October 22, 2026.

Install Node.js (with TypeScript source support), Python 3, and Go 1.27.1 or newer. No local Ballerina installation is needed.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Use the provider dropdown in the top-right corner to choose **OpenAI / ChatGPT** or **Claude / Anthropic**. Selecting a disconnected provider starts its login flow; selecting a connected provider switches to that account. Choose the model from the dropdown at the bottom-left of the chat composer. Follow PI's login prompts and open the provider authorization link. Complete sign-in on the provider's website. PI handles the local callback; manual redirect URL/code entry is also available. Claude offers browser and copy-code login methods. Select a model and describe a change in chat.

The initial project contains `Ballerina.toml` and an empty HTTP service in `main.bal`. PI reads and edits the same files shown in the expandable file tree on the left. Select a file to inspect or edit its source in the main area; select **Chat** or **HTTP service** to return to the conversation. File tools support listing, reading, writing, exact text replacement, and deletion. The `get_diagnostics` tool checks the saved root Ballerina package and named modules on demand in a browser worker. Results include structured compiler diagnostics and a `stale` flag if files changed during the check; a stale result needs an explicit recheck. Unsaved editor drafts are excluded. Files persist in localStorage on the current origin; chat lasts for the current tab.

One Node.js process serves the website, PI login endpoints, and streamed model requests. The agent loop and file tools execute in the browser. The server uses PI's provider-owned OAuth login, refresh, and logout implementations, shared with the coding harness. Credentials are stored in the git-ignored `.bal-bot/auth.json` with owner-only permissions and are never sent to the browser. This is a separate credential store from the PI CLI's own login. **Sign out** removes the selected provider's local credentials. Provider authorization and model access depend on your account and subscription.

The server binds to loopback and is intended for one local user. API requests require a server-issued session token; cross-origin requests and non-local hostnames are rejected. Login attempts time out after five minutes. Keep the browser and server on the same machine for automatic OAuth callbacks. This version is not a shared, multi-user hosted service.

This version edits and checks source. It has no service runtime, flow view, diff view, or right panel. Compilation stops at the Nutcracker frontend and desugaring; it does not generate executable artifacts or run services. Test sources and unsupported project layouts return explicit diagnostics. Navigation contains a single HTTP service and a file list; automatic service/endpoint discovery is not implemented. PI uses the browser-compatible `Agent` from `@earendil-works/pi-agent-core` rather than the Node-oriented coding-agent `AgentSession` described in the longer-term architecture docs.

```sh
npm test
npm run test:compiler
npx playwright install chromium
npm run test:browser
npm run build
npm start
```

`npm run dev` and `npm run build` first generate WASM and the matching Go JavaScript runtime in `apps/editor/public/compiler/`, including when invoked directly in the editor workspace. These generated assets are ignored by Git. `npm run dev` serves the website through Vite middleware. `npm start` serves the production build through the same API server. Production startup uses the existing built assets and does not compile Go. Use `PORT` to change the default 5173 port.

Compiler tests exercise the real Go wrapper and browser WASM workers in development and production, including cancellation, independent requests, responsiveness, infrastructure failures, and fresh retries. No provider account is needed. `python3 scripts/verify_compiler_dependencies.py` verifies a remote-only WASM build from an isolated copy with an empty module cache.

Other tests cover filesystem operations, credential persistence and refresh, login prompts and cancellation, API access checks, streaming, browser tool execution, and aborts. Provider interactions are mocked in automated tests. Completing a real OAuth login and live model call requires your account.

## Code layout

This repository uses npm workspaces:

- `packages/workspace` (`@bal-bot/workspace`): workspace, service, endpoint, and anchor interfaces.
- `packages/browser-workspace` (`@bal-bot/browser-workspace`): browser filesystem, HTTP service anchor, and agent tools.
- `apps/editor` (`@bal-bot/editor`): React editor and local API server. The entry point injects the concrete workspace into the editor.
- `packages/compiler` (`@bal-bot/compiler`, Go module `balbot/compiler`): reusable frontend wrapper, WASM bridge, and per-request browser workers. Nutcracker modules are remote dependencies pinned to commit `f7c4c58d4691085b57f0c2634c8bb597f3ccaaea` in `go.mod` and `go.sum`. Remote-to-remote replacements align upstream unpublished submodule requirements; no local compiler sources are used.

Run the commands above from the repository root. The production build lives in `apps/editor/dist`; the existing `.bal-bot` credential directory and browser storage key are preserved.
