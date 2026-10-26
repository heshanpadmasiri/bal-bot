# Agent instructions

## Commits and validation

- Commits must be atomic: each commit contains one logical change, including its
  tests and necessary documentation. Split unrelated changes into separate commits;
  do not include unrelated working-tree changes.
- Before committing, run `npm run test:all`. The tracked `.githooks/pre-commit`
  hook runs the same full suite and rejects the commit if any check fails.
- Install the hooks with `npm install` (or `npm run hooks:install` for an existing
  checkout). Do not bypass hooks or skip failing tests to make a commit succeed.
- Hooks test the working tree; ensure the staged changes match what was tested.
  Never regenerate frozen baselines merely to make tests pass.

## Review SVG snapshot differences

- Run `npm run test:svg` to verify focused SVG snapshots without changing baselines.
  Failures generate `test-results/svg/<fixture>/diff.html` with three columns:
  **Ballerina source | Expected SVG | Actual SVG**, plus an exact text diff.
  Keep this comparison tool and pass the complete fixture source to `verifySvg`.
- Serve the reports locally, reusing an existing server when available:
  `python3 -m http.server 8766 --bind 127.0.0.1 --directory test-results/svg`.
  Give the user a clickable link to
  `http://127.0.0.1:8766/<fixture>/diff.html` (use the actual server port), and keep
  the server running while they review. Reports also include `source.bal`,
  `expected.svg`, `actual.svg`, and `diff.patch` for direct inspection.
- SVG comparison is exact markup comparison, not a pixel comparison. Inspect the
  text diff as well as both previews: metadata or wrapper elements can change
  without a visible difference. Explain whether the mismatch affects appearance
  or only markup; do not assume every mismatch is a visual regression.
- Get explicit approval before accepting changed focused snapshots. After review,
  run `npm run update:svg` locally, then `npm run test:all`. Updates and matching
  verification clear the fixture's stale reports. Never regenerate legacy frozen
  parity baselines merely to make tests pass. See `tests/svg/README.md` for details.

## Get feedback on flow rendering

Use the standalone flow playground to show users how Ballerina constructs render
and get their feedback. When discussing a rendering change, a questionable layout,
or alternative presentations, provide a prefilled demo link and ask the user to
inspect the flow. Do not rely on source snippets or a prose description alone.

### Start the playground

From the repository root:

```sh
npm install
npm run dev:playground
```

The default address is <http://127.0.0.1:5174>. Check the server output for the
actual port, and reuse an existing playground server when available. Local
examples require the server to remain running while the user views them. For a
hosted playground, use its deployed URL instead.

### Make a demo link

Supply one complete, valid `.bal` file. Include imports and required declarations;
wrap statements in a function. The playground supplies its package manifest, so
users do not need to provide `Ballerina.toml`. Keep examples small and focused,
but include enough context for the existing analyzer to accept them.

Generate a link with a percent-encoded JSON URL fragment:

```js
const source = `function demo() returns int {
    int count = nextValue(1);
    count = nextValue(count);
    return count;
}

function nextValue(int value) returns int {
    return value + 1;
}
`;
const baseUrl = 'http://127.0.0.1:5174/';
const link = baseUrl + '#' + encodeURIComponent(JSON.stringify({version: 1, source}));
console.log(link);
```

Put the function you want to demonstrate first in source order. The optional
`functionId` field can select a known compiler function identity; do not guess an
identity. Alternatively, choose the entry in the UI and use **Copy demo link** to
capture the current source and selection.

Source is embedded in the link, not uploaded to a backend. Anyone with the link
can read it: never include secrets. Keep links short enough for browsers and the
sharing channel. Expansion state is not included.

### Ask for actionable feedback

- Give the user a clickable prefilled link and state what it demonstrates.
- Identify the relevant function/endpoint and any **+** controls to expand.
- Ask a focused question about the presentation, for example: “Does the expanded
  function call make the declaration and subsequent assignment clear?”
- Let the user edit the source; analysis updates after a 300 ms typing pause.
- If diagnostics appear, fix the example before asking the user to judge its
  rendering. Invalid edits retain the last valid flow with a stale indicator;
  do not mistake that stale diagram for the current source.
- Use feedback to guide the requested changes. A demo or user approval is not a
  replacement for automated tests or permission to change frozen baselines.

The playground reuses the production browser compiler and flow renderer. It does
not execute Ballerina programs and requires no model credentials or chat setup.
Its files live under `apps/flow-playground/`; see `README.md` for build, hosting,
and test commands.
