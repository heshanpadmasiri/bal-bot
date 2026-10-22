import { mkdir, readdir, readFile, writeFile, rename, unlink, lstat, realpath } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { initialFiles, isSyncPath, validatePath, validateOperation, applyChange } from '@bal-bot/workspace/sync';

export function parseProjectDirectory(args, cwd = process.cwd()) {
  const paths = args.filter(arg => arg !== '--production');
  if (paths.length !== 1 || paths[0].startsWith('-')) throw new Error('Usage: npm run dev -- /path/to/service (or npm start -- /path/to/service)');
  return resolve(cwd, paths[0]);
}

async function atomicWrite(path, content) {
  const temporary = join(dirname(path), `.bal-bot-${randomUUID()}.tmp`);
  try {
    let mode;
    try { mode = (await lstat(path)).mode & 0o777; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(temporary, content, { flag: 'wx', mode });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function initializeProject(directory) {
  await mkdir(directory, { recursive: true });
  directory = await realpath(directory);
  if ((await readdir(directory)).length === 0) {
    for (const [path, content] of Object.entries(initialFiles)) await writeFile(join(directory, path), content, { flag: 'wx' });
  }
  return directory;
}

// Inspect every path component. Never follow a project symlink for a read or write.
async function confinedPath(directory, path, createParents = false) {
  validatePath(path);
  let current = directory;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    let info;
    try { info = await lstat(current); }
    catch (error) { if (!createParents && error.code === 'ENOENT') return join(directory, path); throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Workspace path traverses a symbolic link or a file.');
    current = join(current, parts[i]);
    if (createParents && i < parts.length - 1) await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  try {
    const info = await lstat(current);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Workspace path is not a regular file.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return current;
}

export async function scanProject(directory) {
  const files = Object.create(null);
  async function visit(relative = '') {
    const absolute = relative ? join(directory, relative) : directory;
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Project directory is no longer a regular directory.');
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      try {
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && isSyncPath(path)) {
          const filename = await confinedPath(directory, path);
          const bytes = await readFile(filename);
          try { files[path] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
          catch { throw new Error(`Invalid UTF-8 text in ${path}. Fix or remove this file to resume syncing.`); }
        }
      } catch (error) {
        // Editors often replace a file or directory between enumeration and reading.
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  await visit();
  return files;
}

export async function openProject(directory, { stateDirectory, installationId = '', pollIntervalMs = 500 } = {}) {
  directory = await initializeProject(directory);
  const projectId = createHash('sha256').update(`${installationId}\0${directory}`).digest('hex');
  const receiptsDirectory = join(stateDirectory, 'sync', projectId);
  await mkdir(receiptsDirectory, { recursive: true, mode: 0o700 });
  let files = await scanProject(directory);
  const applied = new Set((await readdir(receiptsDirectory)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)));
  const epoch = randomUUID();
  let revision = 0;
  let queue = Promise.resolve();
  let closed = false;
  let polling = false;
  let scanError;
  const listeners = new Set();
  const publish = message => { for (const listener of listeners) listener(message); };
  const serialize = action => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  async function reconcile() {
    let next;
    try { next = await scanProject(directory); }
    catch (error) { scanError = error.message; publish({ type: 'error', message: error.message }); throw error; }
    for (const path of new Set([...Object.keys(files), ...Object.keys(next)])) {
      if (Object.hasOwn(next, path) && Object.hasOwn(files, path) && next[path] === files[path]) continue;
      const change = Object.hasOwn(next, path) ? { kind: 'write', path, content: next[path] } : { kind: 'delete', path };
      files = applyChange(files, change);
      publish({ type: 'committed', epoch, revision: ++revision, change });
    }
    if (scanError) { scanError = undefined; publish({ type: 'healthy' }); }
  }
  const timer = setInterval(() => {
    if (closed || polling) return;
    polling = true;
    void serialize(reconcile).catch(() => {}).finally(() => { polling = false; });
  }, pollIntervalMs);
  timer.unref();
  return {
    id: projectId,
    name: directory.split(/[\\/]/).at(-1),
    snapshot: () => ({ type: 'snapshot', projectId, epoch, revision, files }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // Subscribe and send the snapshot within the same serialized action, avoiding a gap.
    connect(listener) { return serialize(async () => { await reconcile(); listeners.add(listener); listener(this.snapshot()); return () => listeners.delete(listener); }); },
    apply(operation) {
      return serialize(async () => {
        validateOperation(operation);
        await reconcile();
        if (applied.has(operation.operationId)) return;
        const change = operation.change;
        const filename = await confinedPath(directory, change.path, change.kind === 'write');
        if (change.kind === 'write') await atomicWrite(filename, change.content);
        else await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
        // Persist receipts before acknowledging: lost acknowledgments survive restart.
        await atomicWrite(join(receiptsDirectory, `${operation.operationId}.json`), JSON.stringify(operation));
        applied.add(operation.operationId);
        files = applyChange(files, change);
        publish({ type: 'committed', epoch, revision: ++revision, change, operationId: operation.operationId });
      });
    },
    async close() { closed = true; clearInterval(timer); await queue; listeners.clear(); },
  };
}
