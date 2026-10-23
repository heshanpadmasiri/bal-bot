# bal-bot

An experimental coding agent for people who want to build simple integrations without knowing—or needing to learn—Ballerina. The agent is currently a thin wrapper around [pi](https://github.com/earendil-works/pi).

The workspace, coding agent loop, file tools, and compiler run client-side in your browser. The app is a static bundle with no application backend; workspace files persist only in browser storage. Authentication and model requests run directly in the browser using pi and your own API keys. Model inference uses your selected provider, not your browser.

## Run

For local development or building, install Node.js 24 or newer, Python 3, and Go 1.27.1 or newer. You do not need a local Ballerina installation.

```sh
git clone https://github.com/heshanpadmasiri/bal-bot.git
cd bal-bot
npm install
npm run dev
```

Open <http://127.0.0.1:5173>, choose Anthropic, OpenAI, Gemini, or OpenRouter in the top-right dropdown, enter your API key, select a model, and describe the integration or change you want. Subscription sign-ins are not supported. Keys are held only in pi's in-memory browser credential store: refresh or close the tab to forget them, or choose **Forget API key** in the provider controls. Keys are never sent to the local server or saved in browser storage.

A fresh browser workspace starts with a Hello World Ballerina HTTP service and its `Ballerina.toml`. The agent works on the files shown in the browser. Saved files persist in browser storage across reloads; clearing that storage removes them. Unsaved editor drafts are not saved workspace files. Only `.bal`, `.toml`, and `.md` text files are supported.

There is no local-directory argument, file synchronization, or filesystem access. Files are not imported from or written back to a source repository. The [example packages](examples/README.md) are reference fixtures, not directories that the server can open. This is an experimental, single-user browser tool; it does not run your services.

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

Agent file tools operate only on the browser workspace, not your local filesystem. Hosted instances still have no shared accounts, server-side storage, or backend API. Workspace storage is specific to the browser and site origin; moving between localhost and GitHub Pages does not transfer files.

Provider requests require browser-compatible APIs and CORS policies; there is no backend proxy fallback. API keys are accessible to code running in the page, so use only your own keys in a trusted browser environment. Configuring a key does not validate it; authentication and quota errors appear when a request is made.

Previous versions saved OAuth credentials in `.bal-bot/auth.json`. This version does not read, migrate, or use that file. Remove it manually and revoke the old credentials with the provider if they are no longer needed.

## License

[MIT](LICENSE).
