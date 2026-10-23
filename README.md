# bal-bot

An experimental coding agent for people who want to build simple integrations without knowing—or needing to learn—Ballerina. The agent is currently a thin wrapper around [pi](https://github.com/earendil-works/pi).

The workspace, coding agent loop, file tools, and compiler run client-side in your browser. A local server synchronizes workspace files with your filesystem. Authentication and model requests run directly in the browser using pi and your own API keys. Model inference uses your selected provider, not your browser.

## Run against a Ballerina source repository

Install Node.js with TypeScript source support, Python 3, and Go 1.27.1 or newer. You do not need a local Ballerina installation.

```sh
git clone https://github.com/heshanpadmasiri/bal-bot.git
cd bal-bot
npm install
npm run dev -- /absolute/path/to/your/ballerina-project
```

Point it at the Ballerina package directory containing `Ballerina.toml`. Open <http://127.0.0.1:5173>, choose Anthropic, OpenAI, Gemini, or OpenRouter in the top-right dropdown, enter your API key, select a model, and describe the integration or change you want. Subscription sign-ins are not supported. Keys are held only in pi's in-memory browser credential store: refresh or close the tab to forget them, or choose **Forget API key** in the provider controls. Keys are never sent to the local server or saved in browser storage.

The agent works on the files shown in the browser, and changes sync back to your source repository. Only `.bal`, `.toml`, and `.md` text files are synchronized; symbolic links are skipped. Use version control to keep track of changes. A missing or empty directory gets a starter Ballerina HTTP service.

For a quick test, use one of the [example packages](examples/README.md) instead of your own project. This is an experimental, single-user local tool; it does not run your services.

## Current limitations

The agent is not fully serverless. Its loop, tool execution, and compiler run in the browser, but a local server is still required for:

- **File synchronization:** the server reads and writes the selected project directory, keeping browser workspace files synchronized with disk without requiring browser filesystem permissions.
  - This can be turned off

Provider requests require browser-compatible APIs and CORS policies; there is no backend proxy fallback. API keys are accessible to code running in the page, so use only your own keys in a trusted browser environment. Configuring a key does not validate it; authentication and quota errors appear when a request is made.

Previous versions saved OAuth credentials in `.bal-bot/auth.json`. This version does not read, migrate, or use that file. Remove it manually and revoke the old credentials with the provider if they are no longer needed.

The server does not run the agent loop or execute its file tools (ie. agent don't access your local system); it persists the file changes those tools make in the browser. This is currently a single-user local application, not a standalone browser app or a shared hosted service.

## License

[MIT](LICENSE).
