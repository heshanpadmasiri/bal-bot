# Branches, loops, and abrupt exits

Open from the repository root:

```sh
npm run dev -- examples/control-flow
```

This package is input for the flow feature specified in [spec.md](../../spec.md). The current editor may not yet provide these interactions. Source inspection and compilation must not run the program or start a listener.

## Scenario and expected result

Expand process. Verify nearest-loop break/continue routing, while back edge, foreach container without routine back arrow, else-if and empty branch continuation. The early return does not join the continuing branches. final return has no outgoing function-internal edge. Every node selects its own source range.
