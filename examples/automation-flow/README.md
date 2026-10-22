# Automation entry point

Open from the repository root:

```sh
npm run dev -- examples/automation-flow
```

This package is input for the flow feature specified in [spec.md](../../spec.md). The current editor may not yet provide these interactions. Source inspection and compilation must not run the program or start a listener.

## Scenario and expected result

There are no services. Navigation shows Automation. Its flow starts with main's count declaration, contains a while condition/body/back edge/exit, then finish. Select a node to attach a source reference. Agent guidance identifies main and this package, without assuming an HTTP service.
