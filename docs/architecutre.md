# Architecture

The editor discovers services through a workspace. Services and endpoints are distinct types implementing `Anchor`, the common interface for everything the editor can render and interact with.

An anchor exposes its agent, diff, and flow UI. The editor uses PI's existing browser-compatible `Agent` API directly for conversation state, prompting, subscriptions, and cancellation. Diff and flow UI shapes remain opaque for now.

## Editor-facing API

```ts
import type { Agent } from '@earendil-works/pi-agent-core';

export type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
export type Files = Readonly<Record<string, string>>;

export const ServiceKind = { HTTP: 'http' } as const;
export type ServiceKind = typeof ServiceKind[keyof typeof ServiceKind];
export const EndpointKind = {} as const;
export type EndpointKind = never;

declare const opaque: unique symbol;
export type Diff = { readonly [opaque]: 'Diff' };
export type FlowUI = { readonly [opaque]: 'FlowUI' };

export interface Anchor {
  getAgent(): Promise<Agent>;
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

export interface SyncState {
  readonly status: 'connecting' | 'syncing' | 'synced' | 'disconnected' | 'error';
  readonly writable: boolean;
  readonly pendingCount: number;
  readonly error?: string;
}

// File operations already used by the source editor and workspace tools.
export interface Workspace {
  readonly loadError?: string;
  readonly projectName?: string;
  syncSnapshot(): SyncState;
  subscribeSync(listener: () => void): () => void;
  getServices(): Promise<readonly Service[]>;
  snapshot(): Files;
  subscribe(listener: () => void): () => void;
  list(): string[];
  read(path: string): string;
  write(path: string, content: string): void;
  edit(path: string, oldText: string, newText: string): void;
  remove(path: string): void;
}
```

The kind types describe the kind of service or endpoint. An endpoint's title is used for rendering. Service discovery and anchor accessors are asynchronous; a service exposes its endpoints synchronously.

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

- Additional service kinds and endpoint kinds.
- Diff and flow UI payload shapes.
- Runtime access and additional concrete workspace implementations.

## References

- [UI overview](ui/overview.md)
- [PI SDK](https://pi.dev/docs/latest/sdk)

## Repository layout

- `packages/workspace`: shared contracts, including the existing source editor's file operations. No browser storage, transport, or agent construction.
- `packages/browser-workspace`: project-scoped localStorage files and pending mutations, background WebSocket synchronization, the single HTTP service anchor, and PI agent/tool construction. Its model stream transport is injected at construction.
- `apps/editor`: runnable React editor and local OAuth/streaming server and directory synchronization. `src/main.tsx` constructs the concrete workspace; `src/editor.tsx` consumes only the shared workspace contracts.
- `vendor/nutcracker`: unmodified upstream source snapshot. Provenance is recorded in `vendor/nutcracker.json`; it is not compiled or bundled into the editor.

The contract exposes the PI `Agent` already used by the application, rather than adding a new agent interface or introducing the Node-oriented `AgentSession`. The service retains its agent across calls. Automatic discovery, diff, and flow remain deferred; their accessors reject explicitly until implemented.

## Directory synchronization

The server requires a project-directory argument. It creates starter files only when that directory is missing or empty. It recursively reads regular `.md`, `.bal`, and `.toml` files as UTF-8, skipping symbolic links. The agent continues to use browser file tools, and unsupported file extensions are rejected there.

`packages/workspace/src/sync-protocol.ts` holds the shared messages, file validation, and initial project. `apps/editor/server/project.mjs` owns disk access, a serialized change queue, server revisions, durable operation receipts, and a 500 ms asynchronous scan. `server/sync.mjs` broadcasts changes through an authenticated WebSocket alongside Vite's development connection. Connections use short-lived, single-use tickets issued through the existing session-authenticated API and checked against the request origin.

`packages/browser-workspace/src/sync.ts` reconciles server snapshots with a persisted browser outbox and transmits one operation at a time. Files and the outbox persist together before tools or the editor observe a successful mutation. Remote updates do not create new local operations. Server revisions detect missed updates; each server startup gets a new epoch. Last processed changes win; operation receipts make acknowledgment retries idempotent across restart.

The editor observes `SyncState` separately from files. A disconnected or failed sync makes mutations and new chat turns unavailable, while file reads remain available. All retained workspace agents are aborted when writing becomes unavailable. On reconnect, pending operations finish before editing becomes available, without automatically resuming an agent. Draft text remains local until an explicit Save.
