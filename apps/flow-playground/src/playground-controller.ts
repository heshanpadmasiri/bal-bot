import type { Compiler } from '@bal-bot/compiler';
import type { AnalysisState, Id } from '@bal-bot/workspace';
import type { ExpansionPath } from '../../editor/src/hir-diagram';
import type { Demo } from './demo-link';
import { listEntries, resolveEntry, type PlaygroundEntry } from './entries.ts';

export interface PlaygroundSnapshot {
  readonly source: string;
  readonly analysis: AnalysisState;
  readonly entries: readonly PlaygroundEntry[];
  readonly selectedFunction?: Id;
  readonly expanded: ReadonlySet<ExpansionPath>;
}

/** Owns analysis independently of React so cancellation/races can be tested directly. */
export class PlaygroundController {
  private state: PlaygroundSnapshot;
  private readonly listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private revision = 0;

  private readonly compiler: Compiler;
  constructor(compiler: Compiler, initial: Demo) {
    this.compiler = compiler;
    this.state = {source: initial.source, analysis: {kind: 'pending', revision: 0}, entries: [],
      selectedFunction: initial.functionId, expanded: new Set()};
  }
  snapshot = (): PlaygroundSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: PlaygroundSnapshot): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  start = (): void => { this.setSource(this.state.source); };
  stop = (): void => {
    clearTimeout(this.timer);
    this.request?.abort();
    ++this.revision;
  };
  setSource = (source: string): void => {
    this.stop();
    const revision = this.revision;
    const analysis = this.state.analysis;
    const previous = analysis.kind === 'ready' ? analysis.program : analysis.previous;
    this.publish({...this.state, source, analysis: {kind: 'pending', revision, previous}});
    this.timer = setTimeout(() => { void this.analyze(source, revision); }, 300);
  };
  private async analyze(source: string, revision: number): Promise<void> {
    const request = new AbortController();
    this.request = request;
    const analysis = this.state.analysis;
    const previous = analysis.kind === 'ready' ? analysis.program : analysis.previous;
    try {
      // The analyzer resolves a package even though the UI exposes only one source file.
      const result = await this.compiler.analyze({
        'Ballerina.toml': '[package]\norg = "playground"\nname = "demo"\nversion = "0.1.0"\n',
        'main.bal': source,
      }, request.signal);
      if (request.signal.aborted || revision !== this.revision) return;
      if (result.kind === 'valid') {
        const entries = listEntries(result.program);
        this.publish({...this.state, entries, selectedFunction: resolveEntry(entries, this.state.selectedFunction)?.id,
          expanded: new Set(), analysis: {kind: 'ready', revision, program: result.program, diagnostics: result.diagnostics}});
      } else {
        this.publish({...this.state, analysis: {kind: 'invalid', revision, previous, diagnostics: result.diagnostics}});
      }
    } catch (error) {
      if (request.signal.aborted || revision !== this.revision) return;
      this.publish({...this.state, analysis: {kind: 'failed', revision, previous,
        message: error instanceof Error ? error.message : String(error)}});
    }
  }
  selectFunction = (id: Id): void => {
    if (this.state.entries.some(entry => entry.id === id)) {
      this.publish({...this.state, selectedFunction: id, expanded: new Set()});
    }
  };
  toggleExpansion = (path: ExpansionPath): void => {
    const expanded = new Set(this.state.expanded);
    if (expanded.has(path)) expanded.delete(path); else expanded.add(path);
    this.publish({...this.state, expanded});
  };
}
