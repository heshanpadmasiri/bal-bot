# Milestones

## M1

- We will not support flow view only diff viewer.
  - This should allow us to implement everything with what we already have.
- We'll run the workspace entirely in user machine and communicate over websocket.
  - Native workspace

- [ ] Editor without flow support.
- [ ] Design on structuring services in storage.
- [ ] Lightweight agent harness build using pi
  - [ ] Support custom skills, system prompt, tools
  - [ ] Ability for Editor to show chat history and render diffs.
- [ ] Run code in the workspace and stream std out/error back to editor.

## M2

- Support client side workspaces.
- We should be able to run most of the workspace work in the client side in the browser without the need for communicating with the backend. This would be a new workspace implementation, so users can pick one.

- [ ] Running agent harness in the browser
  - [ ] Model the file system in client side in browser.
    - [ ] We'll still synchronize file system between browser and server side.
  - [ ] We can run ballerina code in the browser using nutcracker wasm build

## M3

- Support flow visualizations
- [ ] Library that takes the frontend and build the AST then convert that to a "representation" based around statements.
- [ ] Using the "representation" to build visualizations.
