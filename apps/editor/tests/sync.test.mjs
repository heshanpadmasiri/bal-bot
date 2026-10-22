import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import WebSocket from 'ws';
import { openProject, initializeProject, scanProject, parseProjectDirectory } from '../server/project.mjs';
import { attachWorkspaceSync } from '../server/sync.mjs';
import { createApi } from '../server/api.mjs';
import { BrowserWorkspace, createWorkspaceSync, projectStorageKey, STORAGE_KEY, workspaceTools } from '@bal-bot/browser-workspace';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description = 'condition') {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await check()) return; await sleep(10); }
  assert.fail(`Timed out waiting for ${description}`);
}
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
};
const operation = (path, content) => ({ operationId: randomUUID(), change: content === undefined ? { kind: 'delete', path } : { kind: 'write', path, content } });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bal-bot-sync-'));
  const directory = join(root, 'service');
  const stateDirectory = join(root, 'state');
  const options = { stateDirectory, pollIntervalMs: 20, installationId: 'test-installation' };
  let project = await openProject(directory, options);
  const api = createApi({ models: {}, credentials: {}, deviceId: 'test', project });
  const server = createServer((req, res) => { void api.handle(req, res); });
  let sync = attachWorkspaceSync({ server, project, authorizeUpgrade: api.authorizeUpgrade, heartbeatMs: 100 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const sockets = [];
  let token = (await (await fetch(`${base}/api/session`)).json()).token;
  const request = (path, method = 'GET') => fetch(`${base}/api/${path}`, { method, headers: { 'X-Bal-Bot-Session': token } });
  async function ticket() { return (await (await request('sync-ticket', 'POST')).json()).ticket; }
  async function connect() {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/workspace-sync?ticket=${await ticket()}`, { origin: base });
    sockets.push(ws);
    return ws;
  }
  function browser(store = storage(), connector = connect) {
    const workspace = new BrowserWorkspace(store, { projectId: project.id, projectName: project.name, streamFn() { throw new Error('Unexpected model request'); } });
    const controller = createWorkspaceSync({ workspace, connect: connector, retryMs: 20, timeoutMs: 1000 });
    clients.push(controller);
    controller.start();
    return { workspace, controller, store };
  }
  t.after(async () => {
    for (const client of clients) client.close();
    for (const socket of sockets) socket.terminate();
    await sync.close(); api.close(); await project.close();
    server.close(); server.closeAllConnections();
    await rm(root, { recursive: true, force: true });
  });
  return {
    directory, stateDirectory, options, base, request, ticket, connect, browser,
    get project() { return project; },
    async restart() {
      await sync.close(); await project.close();
      project = await openProject(directory, options);
      sync = attachWorkspaceSync({ server, project, authorizeUpgrade: api.authorizeUpgrade, heartbeatMs: 100 });
    },
    disconnect() { for (const socket of sockets) socket.terminate(); },
  };
}

test('startup requires exactly one directory before starting a server', () => {
  assert.throws(() => parseProjectDirectory([]), /Usage/);
  assert.throws(() => parseProjectDirectory(['--production']), /Usage/);
  assert.throws(() => parseProjectDirectory(['a', 'b']), /Usage/);
  assert.equal(parseProjectDirectory(['--production', './service'], '/tmp'), '/tmp/service');
  for (const command of ['dev', 'start']) {
    const result = spawnSync('npm', ['run', command], { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stdout, /bal-bot: http/);
  }
});

test('seeds missing or empty directories, leaves existing projects intact and filters recursively', async t => {
  const f = await fixture(t);
  assert.deepEqual((await readdir(f.directory)).sort(), ['Ballerina.toml', 'main.bal']);
  await rm(join(f.directory, 'main.bal'));
  await initializeProject(f.directory);
  assert.deepEqual(await readdir(f.directory), ['Ballerina.toml']);
  await mkdir(join(f.directory, 'nested'));
  await writeFile(join(f.directory, 'nested', '.notes.md'), '\ufeffHello ✓');
  await writeFile(join(f.directory, 'nested', 'picture.png'), Buffer.from([0xff, 0x00]));
  await writeFile(join(f.directory, 'nested', 'ignored.txt'), 'ignored');
  await writeFile(join(f.directory, 'nested', 'upper.BAL'), 'ignored');
  const files = await scanProject(f.directory);
  assert.deepEqual(Object.keys(files).sort(), ['Ballerina.toml', 'nested/.notes.md']);
  assert.equal(files['nested/.notes.md'], '\ufeffHello ✓');
});

test('disk writes are serialized, last received change wins, and retry receipts survive restart', async t => {
  const f = await fixture(t);
  const first = operation('main.bal', 'first');
  await f.project.apply(first);
  await writeFile(join(f.directory, 'main.bal'), 'external');
  await f.project.apply(operation('main.bal', 'last received'));
  assert.equal(await readFile(join(f.directory, 'main.bal'), 'utf8'), 'last received');
  await f.restart();
  await f.project.apply(first);
  assert.equal(await readFile(join(f.directory, 'main.bal'), 'utf8'), 'last received');
  const second = operation('main.bal', 'second');
  const third = operation('main.bal', 'third');
  await Promise.all([f.project.apply(second), f.project.apply(third)]);
  assert.equal(await readFile(join(f.directory, 'main.bal'), 'utf8'), 'third');
  const deletion = operation('main.bal');
  await f.project.apply(deletion);
  await f.project.apply(operation('main.bal', 'recreated'));
  await f.project.apply(deletion);
  assert.equal(await readFile(join(f.directory, 'main.bal'), 'utf8'), 'recreated');
  await f.project.apply(operation('missing/folder/deleted.bal'));
});

test('rejects invalid paths, unsupported extensions, symlinks, collisions and invalid UTF-8', async t => {
  const f = await fixture(t);
  await writeFile(join(f.stateDirectory, 'outside.bal'), 'outside');
  await symlink(f.stateDirectory, join(f.directory, 'linked'));
  await symlink(join(f.stateDirectory, 'outside.bal'), join(f.directory, 'linked.bal'));
  for (const path of ['../outside.bal', '/tmp/outside.bal', 'a/../x.bal', 'file.png', 'a\\x.bal', 'linked/outside.bal', 'linked.bal', 'main.bal/nested.bal']) {
    await assert.rejects(f.project.apply(operation(path, 'bad')));
  }
  assert.equal(await readFile(join(f.stateDirectory, 'outside.bal'), 'utf8'), 'outside');
  assert.ok(!Object.hasOwn(await scanProject(f.directory), 'linked.bal'));
  await writeFile(join(f.directory, 'invalid.bal'), Buffer.from([0xff]));
  await assert.rejects(scanProject(f.directory), /Invalid UTF-8.*invalid.bal/);
  assert.deepEqual(await readFile(join(f.directory, 'invalid.bal')), Buffer.from([0xff]));
});

test('real WebSocket sync propagates agent and editor changes, external changes, renames and deletions', async t => {
  const f = await fixture(t);
  const a = f.browser().workspace;
  const b = f.browser().workspace;
  await until(() => a.syncSnapshot().writable && b.syncSnapshot().writable, 'initial snapshots');
  a.write('docs/readme.md', 'hello ✓');
  await until(() => b.snapshot()['docs/readme.md'] === 'hello ✓' && a.syncSnapshot().status === 'synced', 'browser write');
  assert.equal(await readFile(join(f.directory, 'docs/readme.md'), 'utf8'), 'hello ✓');
  const tools = workspaceTools(a);
  await tools.find(tool => tool.name === 'edit_file').execute('test', { path: 'docs/readme.md', oldText: 'hello', newText: 'updated' });
  await until(() => b.snapshot()['docs/readme.md'] === 'updated ✓', 'agent edit');
  await writeFile(join(f.directory, 'main.bal'), 'external disk edit');
  await until(() => a.read('main.bal') === 'external disk edit' && b.read('main.bal') === 'external disk edit', 'external edit');
  a.remove('docs/readme.md');
  await until(() => !Object.hasOwn(b.snapshot(), 'docs/readme.md'), 'browser deletion');
  await writeFile(join(f.directory, 'renamed.bal'), await readFile(join(f.directory, 'main.bal')));
  await rm(join(f.directory, 'main.bal'));
  await until(() => Object.hasOwn(a.snapshot(), 'renamed.bal') && !Object.hasOwn(a.snapshot(), 'main.bal'), 'external rename');
  assert.throws(() => a.write('asset.png', 'no'), /Only .md/);
  await sleep(100);
  assert.equal(a.pendingOperations().length, 0);
  assert.equal(b.pendingOperations().length, 0);
});

test('disconnect freezes mutations, aborts active agents and reconnects without resuming a turn', async t => {
  const f = await fixture(t);
  const { workspace } = f.browser();
  await until(() => workspace.syncSnapshot().writable);
  const [service] = await workspace.getServices();
  const agent = await service.getAgent();
  const messagesBefore = [...agent.state.messages];
  let aborts = 0;
  agent.abort = () => { aborts++; };
  f.disconnect();
  await until(() => !workspace.syncSnapshot().writable, 'disconnect');
  assert.throws(() => workspace.write('main.bal', 'offline'), /read-only/);
  assert.match(workspace.read('main.bal'), /service/);
  assert.ok(aborts > 0);
  await until(() => workspace.syncSnapshot().writable, 'reconnect');
  assert.deepEqual(agent.state.messages, messagesBefore);
});

test('project caches isolate files and retain pending operations across reload until disk acknowledges', async t => {
  const f = await fixture(t);
  const store = storage();
  store.setItem(STORAGE_KEY, JSON.stringify({ 'old.bal': 'old browser workspace' }));
  const cached = new BrowserWorkspace(store, { projectId: f.project.id, streamFn() {} });
  cached.applyServerSnapshot({ 'main.bal': 'cached' });
  cached.setSyncState({ status: 'synced', writable: true });
  cached.write('main.bal', 'unacknowledged');
  await writeFile(join(f.directory, 'main.bal'), 'disk changed while offline');
  const other = new BrowserWorkspace(store, { projectId: 'other-project', streamFn() {} });
  assert.deepEqual(other.snapshot(), {});
  const { workspace } = f.browser(store);
  assert.equal(workspace.read('main.bal'), 'unacknowledged');
  assert.equal(workspace.syncSnapshot().writable, false);
  await until(() => workspace.syncSnapshot().status === 'synced', 'outbox replay');
  assert.equal(await readFile(join(f.directory, 'main.bal'), 'utf8'), 'unacknowledged');
  assert.equal(workspace.pendingOperations().length, 0);
  assert.equal(JSON.parse(store.getItem(STORAGE_KEY))['old.bal'], 'old browser workspace');
});

test('a stalled acknowledgment reconnects and replays the persisted operation', async t => {
  const f = await fixture(t);
  let connections = 0;
  const { workspace } = f.browser(storage(), async () => {
    const ws = await f.connect();
    if (++connections === 1) ws.send = () => {}; // Heartbeats arrive, but the operation is lost.
    return ws;
  });
  const states = [];
  workspace.subscribeSync(() => states.push(workspace.syncSnapshot().status));
  await until(() => workspace.syncSnapshot().writable);
  workspace.write('main.bal', 'retried after timeout');
  await until(() => connections > 1 && workspace.syncSnapshot().status === 'synced', 'acknowledgment timeout');
  assert.ok(states.includes('disconnected'));
  assert.equal(await readFile(join(f.directory, 'main.bal'), 'utf8'), 'retried after timeout');
});

test('lost acknowledgment followed by server restart does not replay an old write over newer disk data', async t => {
  const f = await fixture(t);
  const store = storage();
  const cached = new BrowserWorkspace(store, { projectId: f.project.id, streamFn() {} });
  cached.applyServerSnapshot(f.project.snapshot().files);
  cached.setSyncState({ status: 'synced', writable: true });
  cached.write('main.bal', 'already applied');
  await f.project.apply(cached.pendingOperations()[0]);
  await writeFile(join(f.directory, 'main.bal'), 'newer external edit');
  await f.restart();
  const { workspace } = f.browser(store);
  await until(() => workspace.syncSnapshot().status === 'synced');
  assert.equal(workspace.read('main.bal'), 'newer external edit');
  assert.equal(await readFile(join(f.directory, 'main.bal'), 'utf8'), 'newer external edit');
});

test('disk scan errors freeze editing and recover after invalid text is fixed', async t => {
  const f = await fixture(t);
  const { workspace } = f.browser();
  await until(() => workspace.syncSnapshot().writable);
  await writeFile(join(f.directory, 'invalid.bal'), Buffer.from([0xff]));
  await until(() => workspace.syncSnapshot().status === 'error');
  assert.equal(workspace.syncSnapshot().writable, false);
  assert.match(workspace.syncSnapshot().error, /Invalid UTF-8/);
  await writeFile(join(f.directory, 'invalid.bal'), 'fixed');
  await until(() => workspace.syncSnapshot().writable && workspace.snapshot()['invalid.bal'] === 'fixed');
});

test('failed disk writes retain the outbox and retry before editing resumes', async t => {
  const f = await fixture(t);
  const { workspace, store } = f.browser();
  await until(() => workspace.syncSnapshot().writable);
  await mkdir(join(f.directory, 'blocked.bal'));
  workspace.write('blocked.bal', 'queued content');
  await until(() => workspace.syncSnapshot().status === 'error', 'failed disk write');
  assert.equal(workspace.syncSnapshot().writable, false);
  assert.equal(workspace.pendingOperations().length, 1);
  assert.equal(JSON.parse(store.getItem(projectStorageKey(f.project.id))).pending.length, 1);
  await rm(join(f.directory, 'blocked.bal'), { recursive: true });
  await until(() => workspace.syncSnapshot().status === 'synced', 'write retry');
  assert.equal(await readFile(join(f.directory, 'blocked.bal'), 'utf8'), 'queued content');
  assert.equal(workspace.pendingOperations().length, 0);
});

test('storage errors never report an acknowledged browser edit or overwrite corrupted saved data', async t => {
  const f = await fixture(t);
  const store = storage();
  const key = projectStorageKey(f.project.id);
  store.setItem(key, 'corrupted');
  const corrupted = f.browser(store).workspace;
  assert.equal(corrupted.syncSnapshot().status, 'error');
  assert.equal(store.getItem(key), 'corrupted');
  const writableStore = storage();
  const { workspace } = f.browser(writableStore);
  await until(() => workspace.syncSnapshot().writable);
  const before = workspace.snapshot();
  writableStore.setItem = () => { throw new Error('Quota exceeded'); };
  assert.throws(() => workspace.write('main.bal', 'lost'), /Quota/);
  assert.equal(workspace.snapshot(), before);
  assert.equal(workspace.pendingOperations().length, 0);
  await writeFile(join(f.directory, 'main.bal'), 'external');
  await until(() => workspace.syncSnapshot().status === 'error');
  assert.equal(workspace.syncSnapshot().writable, false);
});

test('WebSocket upgrades require an authenticated, single-use, same-origin ticket', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.base}/api/project`)).status, 401);
  assert.equal((await fetch(`${f.base}/api/sync-ticket`, { method: 'POST' })).status, 401);
  assert.equal((await f.request('project')).status, 200);
  async function reject(ticket, origin) {
    const ws = new WebSocket(`${f.base.replace('http:', 'ws:')}/api/workspace-sync?ticket=${ticket}`, { origin });
    const response = await new Promise(resolve => {
      ws.on('unexpected-response', (req, res) => { resolve(res.statusCode); res.resume(); ws.terminate(); });
      ws.on('error', () => {});
    });
    assert.equal(response, 403);
  }
  await reject('invalid', f.base);
  await reject(await f.ticket(), 'https://evil.example');
  await reject(await f.ticket(), undefined);
  const ticket = await f.ticket();
  const ws = new WebSocket(`${f.base.replace('http:', 'ws:')}/api/workspace-sync?ticket=${ticket}`, { origin: f.base });
  await once(ws, 'open');
  const message = once(ws, 'message');
  await message;
  await reject(ticket, f.base);
  ws.send('invalid JSON');
  const [bytes] = await once(ws, 'message');
  assert.equal(JSON.parse(String(bytes)).type, 'error');
  ws.close();
});
