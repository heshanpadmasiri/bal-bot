# bal-bot

An experimental coding agent for people who want to build simple integrations without knowing—or needing to learn—Ballerina. The agent is currently a thin wrapper around [pi](https://github.com/earendil-works/pi).

The workspace, coding agent loop, file tools, and compiler run client-side in your browser. The app is a static bundle with no application backend; workspace files live only in memory and reset on refresh. Authentication and model requests run directly in the browser using pi and your own API keys. Model inference uses your selected provider, not your browser.

## Run

For local development or building, install Node.js 24 or newer, Python 3, and Go 1.27.1 or newer. You do not need a local Ballerina installation.

```sh
git clone https://github.com/heshanpadmasiri/bal-bot.git
cd bal-bot
npm install
npm run dev
```

Open <http://127.0.0.1:5173>, choose Anthropic, OpenAI, Gemini, or OpenRouter in the top-right dropdown, enter your API key, select a model, and describe the integration or change you want. Subscription sign-ins are not supported. Keys are held only in pi's in-memory browser credential store: refresh or close the tab to forget them, or choose **Forget API key** in the provider controls. Keys are never sent to the local server or saved in browser storage.

A fresh browser workspace starts with a Hello World Ballerina HTTP service and its `Ballerina.toml`. The agent works on the files shown in the browser. Saved files remain in memory for the current page only; refreshing or closing the page discards all changes. Unsaved editor drafts are not saved workspace files. Only `.bal`, `.toml`, and `.md` text files are supported.

There is no local-directory argument, file synchronization, or filesystem access. Files are not imported from or written back to a source repository. The [example packages](examples/README.md) are reference fixtures, not directories that the server can open. This is an experimental, single-user browser tool; it does not run your services.

## Commits and Git hooks

Keep commits atomic: one logical change per commit, with its tests and docs.
`npm install` configures Git to use the tracked `.githooks` directory. For an
existing checkout, run `npm run hooks:install`. Installation refuses to overwrite
an existing custom `core.hooksPath`; reconcile those hooks first.

The pre-commit hook runs `npm run test:all`: Node tests, script tests, Go compiler
tests, compiler/editor browser tests, and playground browser tests.
Any failure blocks the commit. You can run the same command
manually. It tests the working tree, so stage the changes you actually tested.

In addition to the development tools above, install Playwright Chromium with
`npx playwright install chromium` (`--with-deps` on Linux if needed). Do not
bypass the hook or skip failing tests.

## Standalone flow playground

```sh
npm run dev:playground
```

Open <http://127.0.0.1:5174>. Edit a complete `.bal` file on the left and inspect
its interactive flow on the right. Statements must be wrapped in a function;
include required imports and declarations. The app supplies a fixed package
manifest internally. Choose a function or endpoint with the **Entry** selector.
Analysis runs after a 300 ms typing pause. Invalid edits show diagnostics and
retain the last valid flow, explicitly marked stale. This uses the existing flow
analyzer, not service execution or a guarantee of full semantic compilation.

**Copy demo link** shares the current source and selected entry. Source is stored
in the URL fragment (not sent to the hosting server); anyone with the link can
read it, so do not include secrets. Edits are otherwise in memory only. No chat,
API keys, backend, or source persistence is required. Links are intended for small
examples; browser and messaging-app URL-length limits still apply.

An agent can generate a prefilled link directly, without opening the app:

```js
const source = 'function demo() returns int { return 42; }';
const link = 'http://127.0.0.1:5174/#' +
  encodeURIComponent(JSON.stringify({version: 1, source}));
```

The optional `functionId` field selects a compiler function identity; omit it to
select the first entry in source order. Expansion state is not included.
Malformed or unsupported links show an error and load the default example.

Build and host this app independently of the editor:

```sh
npm run build:playground
npm run preview:playground  # http://127.0.0.1:4174
# For a subpath, use the same BASE_PATH for build and preview:
BASE_PATH=/flow-playground/ npm run build:playground
BASE_PATH=/flow-playground/ npm run preview:playground
```

Deploy `apps/flow-playground/dist` to a static HTTP(S) host. The existing editor
and its GitHub Pages deployment are unchanged. Both apps use the same production
renderer and generated compiler assets; the playground build generates its own
static bundle without the chat application.

```sh
npm run test:playground
npm run test:playground:browser  # requires Playwright Chromium
```

## Static hosting and GitHub Pages

```sh
npm run build
npm run preview
```

Deploy the contents of `apps/editor/dist` to a static HTTP(S) host. Node.js, Python, and Go are needed only to build, not to host or use the app. `npm run preview` (also available as `npm start`) is a local preview, not a production server.

For a subpath deployment, build with the matching absolute base path, including a trailing slash:

```sh
BASE_PATH=/bal-bot/ npm run build
```

The GitHub Pages workflow builds and deploys on pushes to `main`, or manually via Actions. In the repository's **Settings → Pages**, select **GitHub Actions** as the source. The workflow obtains the base path from Pages, supporting project sites and custom domains. Only the built assets are uploaded; API keys and workspace files are not part of the deployment.

## Current limitations

Agent file tools operate only on the browser workspace, not your local filesystem. Hosted instances still have no shared accounts, server-side storage, or backend API. Workspace files are never saved to browser storage or restored from previous visits.

Provider requests require browser-compatible APIs and CORS policies; there is no backend proxy fallback. API keys are accessible to code running in the page, so use only your own keys in a trusted browser environment. Configuring a key does not validate it; authentication and quota errors appear when a request is made.

Previous versions saved OAuth credentials in `.bal-bot/auth.json`. This version does not read, migrate, or use that file. Remove it manually and revoke the old credentials with the provider if they are no longer needed.

## Flow renderer validation

Production analysis returns direct HIR, rendered by canonical `FlowView`/`FlowEntry`
and `instantiateGraph(program, functionId, expanded)`. Legacy DTO snapshots and
adapters are test-only historical proof, not a second production pipeline.

Run `npm run test:all` for unit, script, compiler, editor/browser, playground,
and focused SVG snapshot coverage. `npm run test:svg` compiles a committed `.bal`
fixture through the production playground and compares standalone SVGs (collapsed
and expanded calls). See [SVG snapshot recipes](tests/svg/README.md) for generating,
explicitly updating, and inspecting differences. The legacy frozen SVG/HTML parity
gate remains removed.
See [flow rendering](docs/flow-rendering.md) and the
[HIR wire/API contract](docs/hir-wire.md).

AST/HIR golden changes require an explicit `npm run test:hir:update` invocation
and review. For interactive rendering inspection, use the standalone flow playground.

## License

[MIT](LICENSE).
