import type { Compiler } from '@bal-bot/compiler';
import type { DiagnosticsResult } from '@bal-bot/workspace';
import { type Workspace, type Service, type Endpoint, type Diff, type FlowUI, type Files, type Id, type Revision, type AnalysisState, type ProgramModel, type ScopeModel, type EndpointModel, type WorkspaceScope, type Automation } from '@bal-bot/workspace';
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
  private readonly anchors = new Map<Id, BrowserAnchor>();
  private readonly retainedAnchors = new Set<BrowserAnchor>();
  private readonly metadata = new Map<Id, ScopeModel | (EndpointModel & {serviceId: Id})>();
  private program?: ProgramModel;
  private analysis: AnalysisState = {kind: 'pending', revision: 0};
  private revision = 0;
  private analysisController?: AbortController;
  private analysisListeners = new Set<() => void>();
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
  private readonly options?: BrowserWorkspaceOptions;

  constructor(storage: Storage, options?: BrowserWorkspaceOptions) {
    this.options = options;
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
    queueMicrotask(() => this.scheduleAnalysis());
  }

  async getServices(): Promise<readonly Service[]> { return (await this.getScopes()).filter((scope): scope is Service => scope.scopeKind === 'service'); }
  async getScopes(): Promise<readonly WorkspaceScope[]> {
    if (!this.program && this.analysis.kind === 'pending') await new Promise<void>(resolve => {
      const unsubscribe = this.subscribeAnalysis(() => { if (this.program || this.analysis.kind !== 'pending') { unsubscribe(); resolve(); } });
      if (this.program || this.analysis.kind !== 'pending') { unsubscribe(); resolve(); }
    });
    return (this.program?.scopes ?? []).map(scope => this.anchors.get(scope.id) as BrowserService | BrowserAutomation);
  }
  analysisSnapshot = (): AnalysisState => this.analysis;
  subscribeAnalysis = (listener: () => void): (() => void) => { this.analysisListeners.add(listener); return () => { this.analysisListeners.delete(listener); }; };
  private publishAnalysis(state: AnalysisState): void { this.analysis = state; for (const listener of this.analysisListeners) listener(); }
  private scheduleAnalysis(): void {
    this.analysisController?.abort();
    const controller = new AbortController(); this.analysisController = controller;
    const revision = ++this.revision, files = this.files;
    this.publishAnalysis({kind: 'pending', revision, ...(this.program ? {previous: this.program} : {})});
    void this.runAnalysis(files, revision, controller.signal);
  }
  private async runAnalysis(files: Files, revision: Revision, signal: AbortSignal): Promise<void> {
    try {
      if (!this.compiler) throw new Error('A compiler is required to analyze saved source.');
      const result = await this.compiler.analyze(files, signal);
      if (signal.aborted || revision !== this.revision) return;
      if (result.kind === 'valid') {
        this.reconcileAnchors(result.program); this.program = result.program;
        this.publishAnalysis({kind: 'ready', revision, program: result.program, diagnostics: result.diagnostics});
      } else this.publishAnalysis({kind: 'invalid', revision, previous: this.program, diagnostics: result.diagnostics});
    } catch (error) {
      if (signal.aborted || revision !== this.revision) return;
      this.publishAnalysis({kind: 'failed', revision, previous: this.program, message: error instanceof Error ? error.message : String(error)});
    }
  }
  private reconcileAnchors(program: ProgramModel): void {
    const active = new Set((this.program?.scopes ?? []).flatMap(scope => scope.kind === 'service' ? [scope.id, ...scope.endpoints.map(e => e.id)] : [scope.id]));
    // Source order disambiguates identical service signatures. An ambiguous edit
    // retires those sessions instead of assigning one declaration another's chat.
    const groups = new Map<string, ScopeModel[]>();
    for (const scope of program.scopes) if (scope.kind === 'service') { const key = scope.id.slice(0, scope.id.lastIndexOf('/')); groups.set(key, [...(groups.get(key) ?? []), scope]); }
    for (const [key, scopes] of groups) {
      const previous = (this.program?.scopes ?? []).filter(s => s.kind === 'service' && s.id.slice(0, s.id.lastIndexOf('/')) === key);
      if (Math.max(scopes.length, previous.length) > 1 && JSON.stringify(scopes.map(s => s.text)) !== JSON.stringify(previous.map(s => s.text))) {
        for (const scope of scopes) { active.delete(scope.id); if (scope.kind === 'service') for (const endpoint of scope.endpoints) active.delete(endpoint.id); }
      }
    }
    const retain = (id: Id, make: () => BrowserAnchor) => {
      if (!active.has(id) || !this.anchors.has(id)) { const anchor = make(); this.anchors.set(id, anchor); this.retainedAnchors.add(anchor); }
    };
    for (const scope of program.scopes) {
      this.metadata.set(scope.id, scope);
      retain(scope.id, () => scope.kind === 'service' ? new BrowserService(this, scope.id, this.options) : new BrowserAutomation(this, scope.id, this.options));
      if (scope.kind === 'service') for (const ep of scope.endpoints) {
        this.metadata.set(ep.id, {...ep, serviceId: scope.id});
        retain(ep.id, () => new BrowserEndpoint(this, ep.id, this.options));
      }
    }
  }
  anchorMetadata(id: Id): ScopeModel | (EndpointModel & {serviceId: Id}) { const meta = this.metadata.get(id); if (!meta) throw new Error('Anchor metadata is unavailable.'); return meta; }
  anchorEndpoints(id: Id): readonly Endpoint[] { const scope = this.program?.scopes.find(s => s.id === id); return scope?.kind === 'service' ? scope.endpoints.map(e => this.anchors.get(e.id) as BrowserEndpoint) : []; }
  async flowFor(id: Id, signal?: AbortSignal): Promise<FlowUI> {
    signal?.throwIfAborted(); const meta = this.anchorMetadata(id);
    return {state: this.analysis, selection: meta.kind === 'service' ? {kind: 'definitions', scopeId: id} : {kind: 'function', functionId: meta.functionId}};
  }

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
      for (const anchor of this.retainedAnchors) anchor.abort();
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
    const changed = Object.keys(next).length !== Object.keys(this.files).length || Object.keys(next).some(path => this.files[path] !== next[path]);
    this.files = next;
    this.pending = pending;
    if (changed) this.scheduleAnalysis();
    this.sync = { ...this.sync, pendingCount: pending.length };
    for (const listener of this.listeners) listener();
    for (const listener of this.syncListeners) listener();
  }
}

class BrowserAnchor {
  private agent?: Agent;
  protected workspace: BrowserWorkspace;
  readonly id: Id;
  private options?: BrowserWorkspaceOptions;
  constructor(workspace: BrowserWorkspace, id: Id, options?: BrowserWorkspaceOptions) { this.workspace = workspace; this.id = id; this.options = options; }
  get title(): string { return this.workspace.anchorMetadata(this.id).title; }
  abort(): void { this.agent?.abort(); }
  async getAgent(): Promise<Agent> {
    if (!this.options) throw new Error('A model stream transport is required to use the workspace agent.');
    const meta = this.workspace.anchorMetadata(this.id);
    return this.agent ??= createWorkspaceAgent(this.workspace, undefined, this.options.streamFn, {id: this.id, title: meta.title, kind: meta.kind === 'service' || meta.kind === 'automation' ? meta.kind : 'endpoint', source: meta.source});
  }
  async getDiff(): Promise<Diff> { throw new Error('Diff is not implemented yet.'); }
  getFlowUI(signal?: AbortSignal): Promise<FlowUI> { return this.workspace.flowFor(this.id, signal); }
}
class BrowserService extends BrowserAnchor implements Service {
  readonly scopeKind = 'service';
  get kind(): string | null { const meta = this.workspace.anchorMetadata(this.id); return meta.kind === 'service' ? meta.serviceType : null; }
  getEndpoints(): readonly Endpoint[] { return this.workspace.anchorEndpoints(this.id); }
}
class BrowserEndpoint extends BrowserAnchor implements Endpoint {
  get kind(): 'resource' | 'remote' { const meta = this.workspace.anchorMetadata(this.id); if (meta.kind !== 'resource' && meta.kind !== 'remote') throw new Error('Invalid endpoint metadata.'); return meta.kind; }
  get serviceId(): Id { const meta = this.workspace.anchorMetadata(this.id); if (!('serviceId' in meta)) throw new Error('Invalid endpoint metadata.'); return meta.serviceId; }
}
class BrowserAutomation extends BrowserAnchor implements Automation { readonly scopeKind = 'automation'; }
