# Architecture

- Bal bot have fallowing key parts.

1. Editor
    1. Flow visualization
    2. Diff viewer
2. Workspace
    1. Runtime
    2. Platform
        1. File system
    3. Agent harness

- As far as editor is concerned workspace is an interface. Actual implementation could be running in browser or over the network in a different machine/container.

## Editor

- UI of this is described in [UI overview](ui/overview.md). Both components need information about user's code that exists only within the workspace. So we will provide APIs to access that information.

### Flow visualization

- We need to keep complete control over this. So we'll implement this from the scratch.
- This will use the AST (provided by the workspace) to build the diagram.

### Diff viewer

- **We don't want to ship a full fat editor experience, to users.**
- We can use a lightweight third party library for this.
- User should still be able to select a line or range and we should then pass that selection to agent.

## Workspace

- Workspace is where work is actually happening. Workspace is responsible for providing
    1. File system
    2. Ballerina interpreter frontend (need to support flow visualizations)
    3. Ballerina runtime
    4. Agent harness
