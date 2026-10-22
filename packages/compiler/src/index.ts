import type { Files, CompilationResult } from '@bal-bot/workspace';
import { validateResponse } from './protocol.ts';

export interface Compiler { check(files: Files, signal?: AbortSignal): Promise<CompilationResult>; }

export function createCompiler(): Compiler {
  return {
    async check(files, signal) {
      signal?.throwIfAborted();
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      return new Promise<CompilationResult>((resolve, reject) => {
        let settled = false;
        const finish = (result?: CompilationResult, error?: unknown) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abort);
          worker.removeEventListener('message', message);
          worker.removeEventListener('error', failure);
          worker.removeEventListener('messageerror', failure);
          worker.terminate();
          if (error !== undefined) reject(error); else resolve(result!);
        };
        const abort = () => finish(undefined, new DOMException('Compilation aborted.', 'AbortError'));
        const failure = (event: Event) => finish(undefined, new Error('Compiler worker failed.' + ('message' in event ? ` ${event.message}` : '')));
        const message = (event: MessageEvent<unknown>) => {
          try {
            const response = validateResponse(event.data);
            if (response.kind === 'failure') finish(undefined, new Error(response.message));
            else finish(response.result);
          } catch (error) { finish(undefined, error); }
        };
        worker.addEventListener('message', message);
        worker.addEventListener('error', failure);
        worker.addEventListener('messageerror', failure);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        try { worker.postMessage({ files }); } catch (error) { finish(undefined, error); }
      });
    },
  };
}
