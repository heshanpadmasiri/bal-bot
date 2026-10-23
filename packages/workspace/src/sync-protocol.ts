export type Files = Readonly<Record<string, string>>;
export type FileChange = { kind: 'write'; path: string; content: string } | { kind: 'delete'; path: string };
export interface PendingOperation { operationId: string; change: FileChange; }
export type SyncStatus = 'connecting' | 'syncing' | 'synced' | 'paused' | 'disconnected' | 'error';
export interface SyncState {
  readonly status: SyncStatus;
  readonly writable: boolean;
  readonly pendingCount: number;
  readonly error?: string;
}
export type ClientMessage = { type: 'mutate'; operation: PendingOperation };
export type ServerMessage =
  | { type: 'snapshot'; projectId: string; epoch: string; revision: number; files: Files }
  | { type: 'committed'; epoch: string; revision: number; change: FileChange; operationId?: string }
  | { type: 'ack'; operationId: string }
  | { type: 'error'; message: string; operationId?: string }
  | { type: 'healthy' }
  | { type: 'heartbeat' };

export const initialFiles: Files = {
  'Ballerina.toml': '[package]\norg = "browser"\nname = "http_service"\nversion = "0.1.0"\n',
  'main.bal': 'import ballerina/http;\n\nservice / on new http:Listener(8080) {\n}\n',
};

export function validatePath(path: string): string {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(path)) {
    throw new Error('Use a relative workspace file path without empty, . or .. segments.');
  }
  return path;
}
export function isSyncPath(path: string): boolean { return /\.(md|bal|toml)$/.test(path); }
export function validateChange(value: unknown): asserts value is FileChange {
  const change = value as FileChange;
  if (!change || (change.kind !== 'write' && change.kind !== 'delete')) throw new Error('Invalid file change.');
  validatePath(change.path);
  if (!isSyncPath(change.path)) throw new Error('Only .md, .bal and .toml files are supported.');
  if (change.kind === 'write' && (typeof change.content !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(change.content))) throw new Error('File contents must be valid UTF-8 text.');
}
export function validateOperation(value: unknown): asserts value is PendingOperation {
  const operation = value as PendingOperation;
  if (!operation || typeof operation.operationId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(operation.operationId)) throw new Error('Invalid operation ID.');
  validateChange(operation.change);
}
export function validateFiles(value: unknown, filtered = true): asserts value is Files {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace files.');
  for (const [path, content] of Object.entries(value)) {
    validatePath(path);
    if (typeof content !== 'string') throw new Error('Invalid file contents.');
    if (filtered) validateChange({ kind: 'write', path, content });
    if (path.split('/').slice(0, -1).some((_, i, parts) => Object.hasOwn(value, parts.slice(0, i + 1).join('/')))) throw new Error('A file conflicts with this directory path.');
  }
}
export function applyChange(files: Files, change: FileChange): Files {
  if (change.kind === 'write') return { ...files, [change.path]: change.content };
  const next = { ...files };
  delete next[change.path];
  return next;
}
