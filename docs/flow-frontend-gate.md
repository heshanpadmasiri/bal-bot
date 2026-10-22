# Flow frontend gate: supported inputs pass

The user narrowed runnable test inputs to language features supported by the pinned Nutcracker compiler. Configurable declarations and unused module variables are excluded from the baselines. Unreferenced functions and types remain covered. The native gate passes, and the analysis model, browser worker, revisioned workspace, flow inspection, and source references are implemented. See [validation and browser critiques](flow-validation.md) for current completion evidence.

## Public API composition

The prototype in `packages/compiler/frontend.go` uses the pinned modules without upstream changes, local replacements, internal-package imports, private fields, or compiler workarounds:

1. `projects.Load` with embedded language and standard-library repositories; public package/module dependency graphs, package cache, and documents provide loading and order.
2. Request-local compiler/module contexts hold AST and symbol state. Implicit bundled language modules are processed before workspace modules and seeded as implicit imports. Explicit dependencies and named modules use dependency order.
3. `parser.GetSyntaxTree` and `nodebuilder.GetCompilationUnit` build original compilation units. `semantics.ResolveSymbols`, package assembly, and `ResolvePublicNodeTypes` run per module in dependency order. `ResolvePrivateNodesTypes` runs after public types resolve.
4. No `Package.Compilation`, semantic analysis, compiler CFG, desugaring, or backend generation runs on this path. Structural assertions inspect original while/foreach nodes and resolved source calls.

The configurable source/AST adaptation was removed. The original source is passed directly to the pinned parser and nodebuilder, and diagnostics are retained. The adapter is exercised by native integration tests and published through isolated browser workers. Shared input validation preserves Check behavior.

## Supported fixture coverage

`TestResolvedFrontendExamples` validates each of the eleven standalone packages with native `Check`, resolves it through the public frontend pipeline, then repeats `Check` and compares results. It rejects baseline compiler errors and requires a resolved program. This proves compiler compatibility of the source inputs. Separate browser tests exercise discovery, diagrams, references, stale states, and editor interactions.

The fixtures cover service/Automation discovery inputs, module-wide definitions and connectors, same-name functions in named modules, branches/loops/abrupt exits, recursive/cross-file calls, Unicode/CRLF ranges, analysis recovery inputs, reference/panel inputs, and compiler-supported constructs with deferred visualization semantics.

In `definitions-and-calls`, minimumAmount/upstream are ordinary final variables. unusedHelper reads upstream and invokes upstreamClient; the helper and UnusedRecord remain unreferenced. In `design-critique`, minimum is an ordinary final variable read by the loop condition. None is described as a configurable. The helper's source call is inspected without executing it or starting listeners.

## Validation

From the repository root:

```sh
npm run test:compiler
```

For the fixture gate alone:

```sh
cd packages/compiler
GOWORK=off go test -run TestResolvedFrontendExamples -v
```

Both pass for all eleven examples. Existing native checking tests also pass. Native/WASM parity, browser interactions, and production assets are covered by the full validation commands recorded in [the validation report](flow-validation.md). Local resolution intentionally stops before full semantic diagnostics; a valid analysis is not a successful Check.
