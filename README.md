# bal-bot

An experimental coding agent for people who want to build simple integrations without knowing—or needing to learn—Ballerina. The agent is currently a thin wrapper around [pi](https://github.com/earendil-works/pi).

The workspace, coding agent loop, file tools, and compiler run client-side in your browser. A local server only serves the app assets; workspace files persist only in browser storage. Authentication and model requests run directly in the browser using pi and your own API keys. Model inference uses your selected provider, not your browser.

## Run

Install Node.js with TypeScript source support, Python 3, and Go 1.27.1 or newer. You do not need a local Ballerina installation.

```sh
git clone https://github.com/heshanpadmasiri/bal-bot.git
cd bal-bot
npm install
npm run dev
```

Open <http://127.0.0.1:5173>, choose Anthropic, OpenAI, Gemini, or OpenRouter in the top-right dropdown, enter your API key, select a model, and describe the integration or change you want. Subscription sign-ins are not supported. Keys are held only in pi's in-memory browser credential store: refresh or close the tab to forget them, or choose **Forget API key** in the provider controls. Keys are never sent to the local server or saved in browser storage.

A fresh browser workspace starts with a Hello World Ballerina HTTP service and its `Ballerina.toml`. The agent works on the files shown in the browser. Saved files persist in browser storage across reloads; clearing that storage removes them. Unsaved editor drafts are not saved workspace files. Only `.bal`, `.toml`, and `.md` text files are supported.

There is no local-directory argument, file synchronization, or filesystem access. Files are not imported from or written back to a source repository. The [example packages](examples/README.md) are reference fixtures, not directories that the server can open. This is an experimental, single-user local tool; it does not run your services.

## Current limitations

A local server is still required to serve the app assets. It does not handle authentication, store credentials, proxy model requests, run the agent loop, execute its file tools, or persist workspace files. Agent file tools operate only on the browser workspace, not your local filesystem. This is currently a single-user local application, not a standalone browser app or a shared hosted service.

Provider requests require browser-compatible APIs and CORS policies; there is no backend proxy fallback. API keys are accessible to code running in the page, so use only your own keys in a trusted browser environment. Configuring a key does not validate it; authentication and quota errors appear when a request is made.

Previous versions saved OAuth credentials in `.bal-bot/auth.json`. This version does not read, migrate, or use that file. Remove it manually and revoke the old credentials with the provider if they are no longer needed.

## License

[MIT](LICENSE).
