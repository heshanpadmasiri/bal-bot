import type { Compiler } from '@bal-bot/compiler';
import type { DiagnosticsResult } from '@bal-bot/workspace';
import { ServiceKind, type Workspace, type Service, type Endpoint, type Diff, type FlowUI, type Files } from '@bal-bot/workspace';
import type { Agent, StreamFn } from '@earendil-works/pi-agent-core';
import { createWorkspaceAgent } from './agent.ts';
export type { Files } from '@bal-bot/workspace';

export interface BrowserWorkspaceOptions { streamFn: StreamFn; compiler?: Compiler; projectId?: string; projectName?: string; }
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export { initialFiles, validatePath } from '@bal-bot/workspace/sync';
import { initialFiles, validatePath, validateFiles, validateChange, validateOperation, applyChange,
  type PendingOperation, type FileChange, type SyncState } from '@bal-bot/workspace/sync';

export const STORAGE_KEY = 'bal-bot.workspace.v1';
export const projectStorageKey = (projectId: string): string => `bal-bot.project.v1.${projectId}`;

export class BrowserWorkspace implements Workspace {
  private readonly services: readonly BrowserService[];
  private files: Files;
  private serverFiles: Files = {};
  private pending: readonly PendingOperation[] = [];
  private listeners = new Set<() => void>();
  private syncListeners = new Set<() => void>();
  private sync: SyncState;
  readonly loadError?: string;
  readonly projectId?: string;
  readonly projectName?: string;
  private key: string;
  private storage: Storage;
  private readonly compiler?: Compiler;

  constructor(storage: Storage, options?: BrowserWorkspaceOptions) {
    this.services = [new BrowserService(this, options)];
    this.storage = storage;
    this.compiler = options?.compiler;
    this.projectId = options?.projectId;
    this.projectName = options?.projectName;
    this.key = this.projectId ? projectStorageKey(this.projectId) : STORAGE_KEY;
    this.sync = { status: this.projectId ? 'connecting' : 'synced', writable: !this.projectId, pendingCount: 0 };
    this.files = this.projectId ? {} : { ...initialFiles };
    try {
      const saved = storage.getItem(this.key);
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (this.projectId) {
          const state = parsed as { files: Files; pending: PendingOperation[] };
          if (!state || !Array.isArray(state.pending)) throw new Error('Invalid workspace');
          validateFiles(state.files);
          state.pending.forEach(validateOperation);
          this.files = state.files;
          this.pending = state.pending;
          this.sync = { ...this.sync, pendingCount: this.pending.length };
        } else {
          validateFiles(parsed, false);
          this.files = { ...parsed };
        }
      }
    } catch {
      this.loadError = 'Could not restore browser files. Saved storage has not been overwritten.';
      this.sync = { ...this.sync, status: 'error', writable: false, error: this.loadError };
    }
  }

  async getServices(): Promise<readonly Service[]> { return this.services; }

  async getDiagnostics(signal?: AbortSignal): Promise<DiagnosticsResult> {
    signal?.throwIfAborted();
    if (!this.compiler) throw new Error('A compiler is required to request workspace diagnostics.');
    const files = this.snapshot();
    const result = await this.compiler.check(files, signal);
    return { diagnostics: result.diagnostics, stale: this.snapshot() !== files };
  }

  snapshot = (): Files => this.files;
  syncSnapshot = (): SyncState => this.sync;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  subscribeSync = (listener: () => void): (() => void) => {
    this.syncListeners.add(listener);
    return () => { this.syncListeners.delete(listener); };
  };
  list(): string[] { return Object.keys(this.files).sort(); }
  read(path: string): string {
    validatePath(path);
    if (!Object.hasOwn(this.files, path)) throw new Error(`File not found: ${path}`);
    return this.files[path];
  }
  write(path: string, content: string): void {
    validatePath(path);
    if (this.list().some(p => p.startsWith(path + '/') || path.startsWith(p + '/'))) throw new Error('A file conflicts with this directory path.');
    this.mutate({ kind: 'write', path, content });
  }
  edit(path: string, oldText: string, newText: string): void {
    const content = this.read(path);
    if (!oldText || content.split(oldText).length !== 2) throw new Error('oldText must match exactly once. Read the file and try again.');
    this.write(path, content.replace(oldText, () => newText));
  }
  remove(path: string): void {
    this.read(path);
    this.mutate({ kind: 'delete', path });
  }
  private mutate(change: FileChange): void {
    if (!this.sync.writable) throw new Error('Workspace is read-only until synchronization reconnects.');
    if (this.projectId) validateChange(change);
    const pending = this.projectId ? [...this.pending, { operationId: crypto.randomUUID(), change }] : [];
    this.commit(applyChange(this.files, change), pending);
    if (this.projectId) this.setSyncState({ ...this.sync, status: 'syncing' });
  }
  pendingOperations(): readonly PendingOperation[] { return this.pending; }
  applyServerSnapshot(files: Files): void {
    validateFiles(files);
    this.commit(this.overlay(files), this.pending);
    this.serverFiles = files;
  }
  applyServerChange(change: FileChange): void {
    validateChange(change);
    const next = applyChange(this.serverFiles, change);
    this.commit(this.overlay(next), this.pending);
    this.serverFiles = next;
  }
  acknowledge(operationId: string): void {
    const pending = this.pending.filter(operation => operation.operationId !== operationId);
    this.commit(this.overlay(this.serverFiles, pending), pending);
  }
  setSyncState(state: Omit<SyncState, 'pendingCount'>): void {
    const next = { ...state, pendingCount: this.pending.length };
    if (JSON.stringify(next) === JSON.stringify(this.sync)) return;
    this.sync = next;
    if (!next.writable) {
      // All retained anchor agents must stop, including an unselected conversation.
      for (const service of this.services) service.abort();
    }
    for (const listener of this.syncListeners) listener();
  }
  private overlay(files: Files, pending = this.pending): Files {
    return pending.reduce((result, operation) => applyChange(result, operation.change), files);
  }
  private commit(next: Files, pending: readonly PendingOperation[]): void {
    if (this.loadError) throw new Error(this.loadError);
    // Persist files and the outbox together before exposing any successful change.
    this.storage.setItem(this.key, JSON.stringify(this.projectId ? { files: next, pending } : next));
    this.files = next;
    this.pending = pending;
    this.sync = { ...this.sync, pendingCount: pending.length };
    for (const listener of this.listeners) listener();
    for (const listener of this.syncListeners) listener();
  }
}

class BrowserService implements Service {
  readonly kind = ServiceKind.HTTP;
  private agent?: Agent;
  private workspace: Workspace;
  private options?: BrowserWorkspaceOptions;
  constructor(workspace: Workspace, options?: BrowserWorkspaceOptions) {
    this.workspace = workspace;
    this.options = options;
  }
  abort(): void { this.agent?.abort(); }
  getEndpoints(): readonly Endpoint[] { return []; }
  async getAgent(): Promise<Agent> {
    if (!this.options) throw new Error('A model stream transport is required to use the workspace agent.');
    return this.agent ??= createWorkspaceAgent(this.workspace, undefined, this.options.streamFn);
  }
  async getDiff(): Promise<Diff> { throw new Error('Diff is not implemented yet.'); }
  async getFlowUI(): Promise<FlowUI> { throw new Error('Flow UI is not implemented yet.'); }
}
