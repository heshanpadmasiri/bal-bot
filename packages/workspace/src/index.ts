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
