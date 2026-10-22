import type { Files, CompilationResult, Diagnostic, Position } from '@bal-bot/workspace';

export interface CheckRequest { readonly files: Files; }
export type CheckResponse =
  | { readonly kind: 'result'; readonly result: CompilationResult }
  | { readonly kind: 'failure'; readonly message: string };
export interface CompilerBridge { check(request: string): string; }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const position = (value: unknown): value is Position => record(value) && Number.isSafeInteger(value.line) && Number(value.line) > 0 && Number.isSafeInteger(value.column) && Number(value.column) > 0;
const diagnostic = (value: unknown): value is Diagnostic => {
  if (!record(value) || !['internal', 'hint', 'info', 'warning', 'error', 'fatal'].includes(String(value.severity)) || typeof value.message !== 'string') return false;
  if (value.file !== undefined && typeof value.file !== 'string' || value.code !== undefined && typeof value.code !== 'string') return false;
  if (value.range === undefined) return true;
  if (!record(value.range) || !position(value.range.start) || !position(value.range.end) || !value.file) return false;
  const { start, end } = value.range;
  return end.line > start.line || end.line === start.line && end.column >= start.column;
};
export function validateResponse(value: unknown): CheckResponse {
  if (record(value)) {
    if (value.kind === 'failure' && typeof value.message === 'string') return { kind: 'failure', message: value.message };
    if (value.kind === 'result' && record(value.result) && Array.isArray(value.result.diagnostics) && value.result.diagnostics.every(diagnostic)) {
      return { kind: 'result', result: { diagnostics: value.result.diagnostics } };
    }
  }
  throw new Error('Invalid compiler response.');
}
export function validateRequest(value: unknown): CheckRequest {
  if (!record(value) || !record(value.files) || !Object.values(value.files).every(v => typeof v === 'string')) throw new Error('Invalid compiler request.');
  return value as unknown as CheckRequest;
}
