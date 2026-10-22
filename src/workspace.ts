export type Files = Record<string, string>;
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = 'bal-bot.workspace.v1';
export const initialFiles: Files = {
  'Ballerina.toml': '[package]\norg = "browser"\nname = "http_service"\nversion = "0.1.0"\n',
  'main.bal': 'import ballerina/http;\n\nservice / on new http:Listener(8080) {\n}\n',
};

export function validatePath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(path)) {
    throw new Error('Use a relative workspace file path without empty, . or .. segments.');
  }
  return path;
}

export class BrowserWorkspace {
  private files: Files;
  private listeners = new Set<() => void>();
  readonly loadError?: string;
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
    this.files = { ...initialFiles };
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid workspace');
        for (const [path, content] of Object.entries(parsed)) {
          validatePath(path);
          if (typeof content !== 'string') throw new Error('Invalid file contents');
        }
        this.files = { ...parsed } as Files;
      }
    } catch {
      this.loadError = 'Could not restore browser files. Starter files are shown; saved storage has not been overwritten.';
    }
  }

  snapshot = (): Files => this.files;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
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
    this.commit({ ...this.files, [path]: content });
  }
  edit(path: string, oldText: string, newText: string): void {
    const content = this.read(path);
    if (!oldText || content.split(oldText).length !== 2) throw new Error('oldText must match exactly once. Read the file and try again.');
    this.write(path, content.replace(oldText, () => newText));
  }
  remove(path: string): void {
    this.read(path);
    const next = { ...this.files };
    delete next[path];
    this.commit(next);
  }
  private commit(next: Files): void {
    // Persist first: a quota or storage error must never report a successful edit.
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.files = next;
    for (const listener of this.listeners) listener();
  }
}
