# Architecture

The editor discovers services through a workspace. Services and endpoints are distinct types implementing `Anchor`, the common interface for everything the editor can render and interact with.

An anchor exposes its agent, diff, and flow UI. The editor uses PI's existing browser-compatible `Agent` API directly for conversation state, prompting, subscriptions, and cancellation. Diff and flow UI shapes remain opaque for now.

## Editor-facing API

```ts
import type { Agent } from '@earendil-works/pi-agent-core';

export type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
export type Files = Readonly<Record<string, string>>;
export type DiagnosticSeverity = 'internal' | 'hint' | 'info' | 'warning' | 'error' | 'fatal';
export interface Position { readonly line: number; readonly column: number; }
export interface SourceRange { readonly start: Position; readonly end: Position; }
export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code?: string;
  readonly message: string;
  readonly file?: string;
  readonly range?: SourceRange;
}
export interface CompilationResult { readonly diagnostics: readonly Diagnostic[]; }
export interface DiagnosticsResult extends CompilationResult { readonly stale: boolean; }

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

// File operations already used by the source editor and workspace tools.
export interface Workspace {
  readonly loadError?: string;
  getServices(): Promise<readonly Service[]>;
  getDiagnostics(signal?: AbortSignal): Promise<DiagnosticsResult>;
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

The workspace abstracts saved files and compilation diagnostics. Its agent tools list, read, write, edit, delete, and check files. Running a service and runtime testing remain unavailable.

An anchor acts as an enriching proxy over its workspace. It holds an internal workspace reference, adds a target-specific system prompt, and maintains its own agent instance. This relationship, agent construction, tools, and skills are implementation details, not part of the editor-facing interfaces. The design does not require a common implementation base class.

All agents share the same underlying workspace filesystem and can edit any file. An anchor's scope is guidance through its system prompt, not an enforced editing boundary.

Multiple agents may run concurrently without special handling. There is no required serialization, locking, conflict detection, or automatic reconciliation between agents. Users handle interference.

Every anchor delegates diff access to its workspace and returns the same workspace diff. Anchors do not own separate diff checkpoints. Flow changes and code diffs compare against the same checkpoint; the mechanism and payload shapes remain deferred.

Conversation persistence across closing and reopening a workspace is a workspace implementation choice, not an interface requirement. There is no rename operation in this API.

## Deferred details

- Additional service kinds and endpoint kinds.
- Diff and flow UI payload shapes.
- Concrete workspace implementations, including filesystem and runtime access, agent construction, and persistence.

## References

- [UI overview](ui/overview.md)
- [PI SDK](https://pi.dev/docs/latest/sdk)

## Repository layout

- `packages/workspace`: shared contracts, including the existing source editor's file operations. No browser storage, transport, or agent construction.
- `packages/browser-workspace`: localStorage files, the single HTTP service anchor, and PI agent/tool construction. Its model stream transport is injected at construction.
- `apps/editor`: runnable React editor and local OAuth/streaming server. `src/main.tsx` constructs the concrete workspace; `src/editor.tsx` consumes only the shared workspace contracts.
- `packages/compiler`: standalone Go module and browser compiler package. It consumes remote Nutcracker modules pinned to commit `f7c4c58d4691085b57f0c2634c8bb597f3ccaaea`, with checksums and remote replacements aligning the nested modules. No local source replacements or vendored compiler sources are used.

The contract exposes the PI `Agent` already used by the application, rather than adding a new agent interface or introducing the Node-oriented `AgentSession`. The service retains its agent across calls. Automatic discovery, diff, and flow remain deferred; their accessors reject explicitly until implemented.

## Browser diagnostics

The editor injects `createCompiler()` into `BrowserWorkspace` beside its model stream function. The agent invokes `get_diagnostics` with `{}`. `getDiagnostics` captures the immutable saved files object, passes it and the abort signal to the compiler, and compares snapshot identity afterward. Successful mutations make `stale` true even when text is restored. Checking publishes no file notifications and makes no storage writes.

Each check owns a dedicated module Web Worker. It lazily loads the matching Go JavaScript runtime and WASM asset, waits for explicit bridge readiness, and calls the JSON bridge. The Go library loads one root package through Nutcracker's existing package compilation API, using only workspace sources and bundled language/standard libraries. It performs frontend analysis and desugaring without invoking the BIR backend, native implementations, or Ballerina execution runtime. No compiler server or package download service is involved.

Root `.bal` files and `modules/<module>/*.bal` are supported. Ballerina test sources anywhere under root or named-module `tests/`, workspace manifests, nested packages, and unsupported source layouts produce explicit project-input diagnostics. Resources are not source documents. Source errors are normal tool results; WASM, worker, bridge, and compiler infrastructure failures reject the tool call. Cancellation terminates its request worker without affecting independent checks. Success, failure, and cancellation all clean up workers and listeners.

Diagnostics preserve upstream categories (`internal`, `hint`, `info`, `warning`, `error`, `fatal`), optional codes, messages, and file identities. Workspace files use full relative paths; dependency documents keep package-qualified identities. Valid UTF-8 byte offsets are converted against the compiled document into one-based lines and Unicode code-point columns, with exclusive ends and CRLF as one line break. Synthetic manifest locations have no fabricated ranges. Diagnostics are sorted deterministically and empty results serialize as `[]`. The tool exposes both JSON text and structured details in the existing conversation; no additional compilation UI or automatic checks are introduced.

Builds require Go 1.27.1 or newer and Python 3. Editor `predev` and `prebuild` run `scripts/build_compiler.py` with `GOWORK=off`, `GOOS=js`, and `GOARCH=wasm`, generating ignored assets under `apps/editor/public/compiler/`. Vite builds the worker URL and copies the public assets for production. `npm start` serves these previously built assets. Run `npm run test:compiler`, `npm test`, and `npm run test:browser` for wrapper, workspace, and real-browser verification; install Chromium with `npx playwright install chromium` first. `scripts/verify_compiler_dependencies.py` repeats the isolated empty-module-cache build without access to repository-local compiler sources.
