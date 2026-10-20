# UI overview

bal-bot is a web development environment for Ballerina services. Developers describe changes in chat and inspect the resulting code or flow.

## Workspace

![Workspace layout](images/workspace.svg)

- **Left, 20%:** projects → services → endpoints. The selected item identifies the working scope; do not repeat the endpoint name elsewhere.
- **Center, 60%:** chat. Selecting a service allows work across the whole service. Selecting an endpoint narrows the context without replacing the conversation.
- **Right, 20%:** flow or code diff. Small, right-aligned icons in the top bar switch views and expand/collapse the panel.

Expanded inspection fills the workspace below the top bar, taking over both the navigation and chat areas. Chat becomes a floating window that the developer can drag around the canvas. Collapsing inspection restores the 20/60/20 layout, preserving the conversation, selected scope, and expanded flow nodes.

At service scope, the right panel lists **functions, type definitions, connectors, and configurables**. Endpoints appear only in the left navigation. Omit redundant headings, explanatory labels, and status footers.

## Exploring an endpoint

**Normal view:** select an endpoint on the left; chat stays in the center and its flow appears on the right.

![Endpoint in the normal 20/60/20 layout](images/endpoint-normal.svg)

**Expanded view:** the same flow fills the workspace. Drag the floating chat by its header to move it out of the way. Collapse using the top-right control to restore the normal layout.

![Endpoint expanded to the full workspace with floating chat](images/endpoint-expanded.svg)

### Flow details

![Endpoint flow and inline expansion](images/endpoint-flow.svg)

Selecting an endpoint shows its connected control-flow graph. Keep execution paths visible; reveal implementation details progressively.

- **Sequence:** solid arrows connect steps in execution order.
- **Condition:** show the expression, its branches, and their join when execution continues. Support early exits without assuming every branch terminates.
- **While:** show the condition expression, body, back edge, and exit.
- **Foreach:** show a container headed by the iteration binding and collection. Its body runs per item; execution leaves the container after iteration. No routine back arrow is needed. Explicit `continue` and `break` indicate next iteration and exit.
- **Function call:** click to expand the function's flow in place, preserving entry and exit connections. Shared functions remain one implementation; show affected callers in change details.
- **Async:** dotted arrows connect the launch to the asynchronous work and its result to the wait. Execution inside each path uses solid arrows. Identify the future without a “runs async” label.

Allow the graph to pan and zoom, and expand inspection to the full workspace for detailed exploration. Function and mapping expansion must preserve the surrounding flow.

## Data mappings

![Grouped record mapping](images/record-mapping.svg)

A mapping starts as one node. Click to expand its container:

- Group referenced source fields inside their record, retaining nested-record grouping.
- Connect source fields to fields in the target record. Put transformations on the arrows; direct assignments need no label.
- Expand function calls in place. Inputs to a multi-field expression converge before connecting to the target.
- Expand nested target records as mapping containers.
- For list queries, show the actual query expression. The projected record may optionally open as a record mapping. Preserve literals, calls, and other array expressions as written.

Arrows inside mappings describe data relationships; arrows between flow nodes describe execution.

## Reviewing changes

Use subtle, distinct container shades: functions blue, loops purple, mappings amber, and async sections teal. **Green highlights changed logic**, including collapsed containers with changes inside. Do not add add/remove markers to flow nodes.

Selecting changed logic reveals its change details and corresponding code diff. The diff uses green additions and red removals with `+`/`−` markers. Both views compare against the same checkpoint.
