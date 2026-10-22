# Flow-view example packages

Each directory is a separate Ballerina package with its own manifest and main function or service. Open one package at a time with `npm run dev -- examples/<name>` from the repository root. Do not open this parent directory as a Ballerina package.

These are source fixtures for [the flow specification](../spec.md), not Ballerina unit tests and not proof that the future UI is implemented. Each README supplies browser steps and expected results. Invalid edits are applied to valid baselines and then restored. No provider account or running Ballerina service is needed for compiler or mocked-browser validation.

| Package | Scenario |
| --- | --- |
| [service-discovery](service-discovery/) | Service and endpoint discovery |
| [automation-flow](automation-flow/) | Automation entry point |
| [definitions-and-calls](definitions-and-calls/) | Definitions and resolved call targets |
| [control-flow](control-flow/) | Branches, loops, and abrupt exits |
| [function-expansion](function-expansion/) | Inline calls and recursion |
| [source-ranges](source-ranges/) | Unicode and newline source ranges |
| [analysis-recovery](analysis-recovery/) | Invalid edits and analysis races |
| [chat-references](chat-references/) | Source references in chat drafts |
| [panel-state](panel-state/) | Panel expansion and conversation state |
| [unsupported-constructs](unsupported-constructs/) | Visible limitations without false flow |
| [design-critique](design-critique/) | Representative browser design comparison |

Runnable baselines stay within the pinned Nutcracker compiler's supported scope. They contain no configurable declarations or unused module variables. Unreferenced functions and types remain covered. `TestResolvedFrontendExamples` checks all eleven packages through both native `Check` and the public frontend pipeline; visualization limitations in unsupported-constructs are supported compiler syntax, not intentionally uncompilable source.
