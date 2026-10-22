# Architecture

The editor discovers services through a workspace. Services and endpoints are distinct types implementing `Anchor`, the common interface for everything the editor can render and interact with.

An anchor exposes its agent, diff, and flow UI. The editor uses PI's `AgentSession` API directly for conversation state, prompting, subscriptions, and cancellation. Diff and flow UI shapes remain opaque for now.

## Editor-facing API

```ts
import type { AgentSession } from "@earendil-works/pi-coding-agent";

// Members to be defined.
export enum ServiceKind {}
export enum EndpointKind {}

// Opaque placeholders; shapes deferred.
declare const opaque: unique symbol;
export type Diff = { readonly [opaque]: "Diff" };
export type FlowUI = { readonly [opaque]: "FlowUI" };

export interface Anchor {
  getAgent(): Promise<AgentSession>;
  getDiff(): Promise<Diff>;
  getFlowUI(): Promise<FlowUI>;
}

export interface Service extends Anchor {
  readonly kind: ServiceKind;

  getEndpoints(): readonly Endpoint[];
}

export interface Endpoint extends Anchor {
  readonly kind: EndpointKind;
  readonly title: string;
}

export interface Workspace {
  getServices(): Promise<readonly Service[]>;
}
```

The kind enums describe the kind of service or endpoint. An endpoint's title is used for rendering. Service discovery and anchor accessors are asynchronous; a service exposes its endpoints synchronously.

## Control flow

1. The editor calls `workspace.getServices()` to discover services.
2. It calls `service.getEndpoints()` to populate endpoint navigation.
3. Selecting a service or endpoint selects an anchor.
4. The editor obtains that anchor's agent, diff, and flow UI through its accessors.
5. The editor interacts with the returned PI session directly.

Each anchor owns its agent instance and conversation. `getAgent()` returns that anchor's retained session. Switching selection switches conversations; returning restores the selected anchor's conversation. Switching selection does not stop another anchor's running agent.

## Implementation boundaries

The workspace abstracts the filesystem and Ballerina runtime. Internally, it provides the basis for agents through tools and skills, including tools to read, write, and edit files and run a service.

An anchor acts as an enriching proxy over its workspace. It holds an internal workspace reference, adds a target-specific system prompt, and maintains its own agent instance. This relationship, agent construction, tools, and skills are implementation details, not part of the editor-facing interfaces. The design does not require a common implementation base class.

All agents share the same underlying workspace filesystem and can edit any file. An anchor's scope is guidance through its system prompt, not an enforced editing boundary.

Multiple agents may run concurrently without special handling. There is no required serialization, locking, conflict detection, or automatic reconciliation between agents. Users handle interference.

Every anchor delegates diff access to its workspace and returns the same workspace diff. Anchors do not own separate diff checkpoints. Flow changes and code diffs compare against the same checkpoint; the mechanism and payload shapes remain deferred.

Conversation persistence across closing and reopening a workspace is a workspace implementation choice, not an interface requirement. There is no rename operation in this API.

## Deferred details

- Service-kind and endpoint-kind enum members.
- Diff and flow UI payload shapes.
- Concrete workspace implementations, including filesystem and runtime access, agent construction, and persistence.

## References

- [UI overview](ui/overview.md)
- [PI SDK](https://pi.dev/docs/latest/sdk)
