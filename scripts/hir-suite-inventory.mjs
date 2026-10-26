// Shared read-only registry validation; never imports render or capture tooling.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function validatePostBaselineRenderingSuites(registry, baseline, repository) {
  if (registry.version !== 1 || registry.stage !== 'post-baseline' || !Array.isArray(registry.suites) ||
      !Array.isArray(registry.postBaselineRenderingSuites)) throw Error('Invalid post-baseline HIR suite registry');
  const registered = new Set();
  for (const entry of [...registry.suites, ...(registry.helpers ?? []), ...(registry.infrastructure ?? [])]) {
    if (baseline.has(entry.file) || registered.has(entry.file)) throw Error(`Overlapping post-baseline registry entry: ${entry.file}`);
    registered.add(entry.file);
  }
  const rendering = new Set();
  for (const suite of registry.postBaselineRenderingSuites) {
    if (typeof suite.file !== 'string' ||
        !/^(?:packages\/compiler\/hir_[a-z0-9_]+_postbaseline_test\.go|packages\/compiler\/tests\/browser\/[a-z0-9_-]+\.spec\.mjs|apps\/flow-playground\/tests\/browser\/(?:playground|function-cards)\.spec\.mjs)$/.test(suite.file) ||
        suite.rendering !== true || typeof suite.purpose !== 'string' || !suite.purpose.trim() ||
        typeof suite.coverageCommand !== 'string' || !suite.coverageCommand.trim() ||
        baseline.has(suite.file) || registered.has(suite.file)) {
      throw Error(`Invalid post-baseline rendering suite: ${suite.file}`);
    }
    registered.add(suite.file);
    readFileSync(resolve(repository, suite.file));
    rendering.add(suite.file);
  }
  return rendering;
}
