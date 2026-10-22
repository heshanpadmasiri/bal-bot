import type { Agent } from '@earendil-works/pi-agent-core';

export type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
export type { Files, SyncState, SyncStatus } from './sync-protocol.ts';
import type { Files, SyncState } from './sync-protocol.ts';

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
