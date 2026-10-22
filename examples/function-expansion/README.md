# Inline calls and recursion

Open from the repository root:

```sh
npm run dev -- examples/function-expansion
```

This package is input for the flow feature specified in [spec.md](../../spec.md). The current editor may not yet provide these interactions. Source inspection and compilation must not run the program or start a listener.

## Scenario and expected result

Expand each shared call independently; both bodies refer to helpers.bal, while headers refer to their separate caller ranges. Expand countdown and evenStep/oddStep until recursive ancestry is reached. Stop expansion there with an explanation. Returns rejoin the correct call continuation, not main's exit. Preserve expansion choices when resizing the panel.
