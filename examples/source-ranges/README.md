# Unicode and newline source ranges

Open from the repository root:

```sh
npm run dev -- examples/source-ranges
```

This package is input for the flow feature specified in [spec.md](../../spec.md). The current editor may not yet provide these interactions. Source inspection and compilation must not run the program or start a listener.

## Scenario and expected result

Select the multiline decorate call: include all occupied rows and the exact text. Verify code-point columns after the astral character, Unicode text, and cross-file windowsValue expansion. windows.bal deliberately uses actual CRLF. For normalization-only exclusive-end-at-column-one checks, use the same captured source with a synthetic boundary at the next row's column 1; the displayed inclusive end row is the preceding row. Do not require the parser to emit that boundary itself.
