# bal-bot

An experimental coding agent for people who want to build simple integrations without knowing—or needing to learn—Ballerina. The agent is currently a thin wrapper around [pi](https://github.com/earendil-works/pi).

The workspace, coding agent loop, file tools, and compiler run client-side in your browser. A local server handles pi authentication callbacks, keeps credentials, and proxies model requests. Workspace files persist only in browser storage; the server does not read or write a local project directory. Model inference uses your selected provider, not your browser.

## Run

Install Node.js with TypeScript source support, Python 3, and Go 1.27.1 or newer. You do not need a local Ballerina installation.

```sh
git clone https://github.com/heshanpadmasiri/bal-bot.git
cd bal-bot
npm install
npm run dev
```

Open <http://127.0.0.1:5173>, choose a provider in the top-right dropdown, follow pi's sign-in prompts, select a model, and describe the integration or change you want.

A fresh browser workspace starts with a Hello World Ballerina HTTP service and its `Ballerina.toml`. The agent works on the files shown in the browser. Saved files persist in browser storage across reloads; clearing that storage removes them. Unsaved editor drafts are not saved workspace files. Only `.bal`, `.toml`, and `.md` text files are supported.

There is no local-directory argument, file synchronization, or filesystem access. Files are not imported from or written back to a source repository. The [example packages](examples/README.md) are reference fixtures, not directories that the server can open. This is an experimental, single-user local tool; it does not run your services.

## Current limitations

The agent is not fully serverless. Its loop, tool execution, and compiler run in the browser, but a local server is still required for:

- **Authentication and credentials:** pi's login callbacks, token refresh, and credential storage run on the server to keep provider tokens out of the browser.
- **Model requests:** the server authenticates and forwards requests to the provider, then streams responses back. This keeps tokens server-side and avoids provider CORS restrictions; direct browser requests would require browser-compatible provider APIs and client-side credentials. Model inference runs on the provider's infrastructure.

The server does not run the agent loop, execute its file tools, or persist workspace files. Agent file tools operate only on the browser workspace, not your local filesystem. This is currently a single-user local application, not a standalone browser app or a shared hosted service.

## License

[MIT](LICENSE).
