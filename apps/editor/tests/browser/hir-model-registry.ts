// Test-only lookup. Production rendering receives only deserialized direct HIR.
// Neither the legacy snapshot nor the project source is converted into HIR here.
import type {HIRProgram} from '../../../../packages/workspace/src/flow';
const synthetic = import.meta.glob('/tests/fixtures/hir-synthetic/*/fixture.json', {eager: true, import: 'default'}) as Record<string, {legacyProgram: unknown; hir: HIRProgram; graphOnly: boolean}>;
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const entries = new Map<string, {program: HIRProgram; graphOnly: boolean}>();
for (const fixture of Object.values(synthetic)) entries.set(canonical(fixture.legacyProgram), {program: fixture.hir, graphOnly: fixture.graphOnly});
export function lookupHIR(model: unknown) {
  // Actual compiler payloads are already HIR. Only archived synthetic replay
  // inputs pass through the exact fixture lookup below; never project a model.
  if (model && typeof model === 'object' && Object.hasOwn(model, 'sources')) return {program: model as HIRProgram, graphOnly: false};
  const result = entries.get(canonical(model));
  if (!result) throw Error('No precomputed HIR fixture matches this legacy parity input; update test-only fixture metadata explicitly.');
  return result;
}
export function hirFlow(flow: any) {
  const state = flow.state;
  const model = state.kind === 'ready' ? state.program : state.previous;
  const fixture = model ? lookupHIR(model) : undefined;
  return {flow: {...flow, state: {...state, ...(state.kind === 'ready' ? {program: fixture?.program} : model ? {previous: fixture?.program} : {})}}, graphOnly: fixture?.graphOnly ?? false};
}
