import type { Files, CompilationResult, Diagnostic, Position, ProgramModel, AnalysisResult, Located } from '@bal-bot/workspace';
import { sourceText } from '@bal-bot/workspace';

export type CompilerRequest = { readonly operation: 'check' | 'analyze'; readonly files: Files };
export type CompilerResponse =
  | { readonly kind: 'result'; readonly operation: 'check'; readonly result: CompilationResult }
  | { readonly kind: 'result'; readonly operation: 'analyze'; readonly result: AnalysisResult }
  | { readonly kind: 'failure'; readonly message: string };
export interface CompilerBridge { request(json: string): string; }
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const position = (v: unknown): v is Position => record(v) && Number.isSafeInteger(v.line) && Number(v.line) > 0 && Number.isSafeInteger(v.column) && Number(v.column) > 0;
const range = (v: unknown) => record(v) && position(v.start) && position(v.end) && (v.end.line > v.start.line || v.end.line === v.start.line && v.end.column >= v.start.column);
const diagnostic = (v: unknown): v is Diagnostic => record(v) && ['internal', 'hint', 'info', 'warning', 'error', 'fatal'].includes(String(v.severity)) && typeof v.message === 'string' && (v.code === undefined || typeof v.code === 'string') && (v.file === undefined || typeof v.file === 'string') && (v.range === undefined || typeof v.file === 'string' && !!v.file && range(v.range));
function fail(): never { throw new Error('Invalid compiler response.'); }
function object(v: unknown): Record<string, unknown> { if (!record(v)) fail(); return v; }
function array(v: unknown): unknown[] { if (!Array.isArray(v)) fail(); return v; }
function string(v: unknown): string { if (typeof v !== 'string' || !v) fail(); return v; }
function located(value: unknown): Record<string, unknown> {
  const v = object(value), source = object(v.source); string(v.id); string(source.file);
  if (!range(source.range) || typeof v.text !== 'string') fail();
  return v;
}
function unique(values: unknown[]): void { const ids = values.map(v => string(object(v).id)); if (new Set(ids).size !== ids.length) fail(); }
export function validateProgram(value: unknown): ProgramModel {
  const p = object(value), functions = object(p.functions), scopes = array(p.scopes);
  const functionId = (id: unknown) => { if (!Object.hasOwn(functions, string(id))) fail(); };
  const reserve = (value: unknown, seen: Set<string>) => { const id = string(object(value).id); if (seen.has(id)) fail(); seen.add(id); };
  const calls = (value: unknown, seen: Set<string>) => {
    const items = array(value); unique(items);
    for (const item of items) {
      const call = located(item), target = object(call.target); reserve(call, seen);
      if (target.kind === 'workspace') functionId(target.functionId);
      else if (target.kind === 'external') { string(target.label); if (target.functionId !== undefined) fail(); } else fail();
      if (call.expansion === 'supported') { if (target.kind !== 'workspace' || call.reason !== undefined) fail(); }
      else if (call.expansion === 'unavailable') string(call.reason); else fail();
    }
  };
  const expression = (value: unknown, seen: Set<string>) => { const expr = located(value); reserve(expr, seen); calls(expr.calls, seen); };
  const statements = (value: unknown, seen: Set<string>) => {
    for (const item of array(value)) {
      const s = located(item), id = string(s.id); if (seen.has(id)) fail(); seen.add(id);
      switch (s.kind) {
        case 'simple': if (!['declare', 'assign', 'expression'].includes(String(s.operation)) || !['step', 'mapping'].includes(String(s.presentation))) fail(); calls(s.calls, seen); break;
        case 'return': calls(s.calls, seen); break;
        case 'if': expression(s.condition, seen); statements(s.thenBody, seen); statements(s.elseBody, seen); break;
        case 'while': expression(s.condition, seen); statements(s.body, seen); break;
        case 'foreach': expression(s.header, seen); statements(s.body, seen); break;
        case 'break': case 'continue': break;
        case 'unsupported': string(s.reason); break;
        default: fail();
      }
    }
  };
  for (const [id, value] of Object.entries(functions)) {
    const fn = located(value); if (fn.id !== id) fail(); string(fn.moduleId);
    const entry = object(fn.entry);
    if (!['resource', 'remote', 'function', 'method'].includes(String(entry.kind))) fail();
    string(entry.name); string(entry.signature); string(entry.returnType);
    for (const value of array(entry.parameters)) {
      const parameter = object(value);
      if (!['input', 'path'].includes(String(parameter.kind))) fail();
      string(parameter.text);
    }
    statements(fn.body, new Set([id]));
  }
  unique(scopes);
  const endpoints = new Set<string>();
  for (const value of scopes) {
    const scope = located(value); string(scope.title); string(scope.moduleId);
    if (scope.kind === 'automation') { if (scope.title !== 'Automation') fail(); functionId(scope.functionId); }
    else if (scope.kind === 'service') {
      if (scope.serviceType !== null && typeof scope.serviceType !== 'string' || scope.functionId !== undefined) fail();
      const eps = array(scope.endpoints); unique(eps);
      for (const value of eps) { const ep = located(value); if (endpoints.has(string(ep.id))) fail(); endpoints.add(string(ep.id)); if (!['resource', 'remote'].includes(String(ep.kind))) fail(); string(ep.title); functionId(ep.functionId); }
      const defs = array(scope.definitions); unique(defs);
      for (const value of defs) { const def = located(value); string(def.label); if (def.kind === 'function') functionId(def.functionId); else if (!['type', 'connector', 'configurable'].includes(String(def.kind)) || def.functionId !== undefined) fail(); }
    } else fail();
  }
  return value as ProgramModel;
}
// Walk serialized model data, not ASTs, to validate every source-backed element.
export function programLocations(program: ProgramModel): Located[] {
  const result: Located[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!record(v)) return;
    if ('id' in v && 'source' in v && 'text' in v) result.push(v as unknown as Located);
    Object.values(v).forEach(visit);
  };
  visit(program); return result;
}
export function validateAnalysisFiles(result: AnalysisResult, files: Files): void {
  if (result.kind !== 'valid') return;
  for (const node of programLocations(result.program)) if (sourceText(files, node.source) !== node.text) throw new Error('Compiler source text does not match its captured range.');
}
export function validateResponse(value: unknown): CompilerResponse {
  const v = object(value);
  if (v.kind === 'failure' && typeof v.message === 'string') return { kind: 'failure', message: v.message };
  if (v.kind !== 'result' || !['check', 'analyze'].includes(String(v.operation))) fail();
  const r = object(v.result); if (!array(r.diagnostics).every(diagnostic)) fail();
  if (v.operation === 'analyze') {
    if (r.kind === 'valid') { validateProgram(r.program); if ((r.diagnostics as Diagnostic[]).some(d => ['error', 'fatal', 'internal'].includes(d.severity))) fail(); }
    else if (r.kind !== 'invalid' || r.program !== undefined) fail();
  }
  return value as CompilerResponse;
}
export function validateRequest(value: unknown): CompilerRequest {
  if (!record(value) || !['check', 'analyze'].includes(String(value.operation)) || !record(value.files) || !Object.values(value.files).every(v => typeof v === 'string')) throw new Error('Invalid compiler request.');
  return value as CompilerRequest;
}
