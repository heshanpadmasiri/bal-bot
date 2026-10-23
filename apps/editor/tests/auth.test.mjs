import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createApi } from '../server/api.mjs';
import { installationId } from '../server/installation.mjs';

test('installation ID is stable and private without reading or writing credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bal-bot-installation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = await installationId(directory);
  assert.match(id, /^[\da-f-]{36}$/);
  assert.equal(await installationId(directory), id);
  assert.equal((await stat(join(directory, 'device-id'))).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(directory), ['device-id']);
  // Even a malformed legacy credential file must be ignored and left untouched.
  await writeFile(join(directory, 'auth.json'), 'legacy credentials');
  assert.equal(await installationId(directory), id);
  assert.equal(await readFile(join(directory, 'auth.json'), 'utf8'), 'legacy credentials');
});

async function apiFixture(t) {
  const api = createApi();
  const server = createServer((req, res) => { void api.handle(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { api.close(); server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', data, token, origin, host } = {}) => {
    const headers = { ...(token ? { 'X-Bal-Bot-Session': token } : {}), ...(origin ? { Origin: origin } : {}) };
    // Fetch normalizes Host; use HTTP directly to exercise DNS-rebinding defenses.
    if (host) return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}/api/${path}`, { method, headers: { ...headers, Host: host } }, res => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.on('error', reject);
      req.end(data ? JSON.stringify(data) : undefined);
    });
    return fetch(`${base}/api/${path}`, { method, headers, ...(data ? { body: JSON.stringify(data) } : {}) });
  };
  const token = (await (await request('session')).json()).token;
  const call = (path, options) => request(path, { token, ...options });
  return { request, call, api, base };
}

test('provider, OAuth, inference, project and sync endpoints no longer exist', async t => {
  const { call } = await apiFixture(t);
  for (const [path, methods] of [
    ['providers', ['GET']],
    ['login', ['POST']],
    ['login/old-login-id', ['GET', 'POST', 'DELETE']],
    ['logout', ['POST']],
    ['stream', ['POST']],
    ['project', ['GET', 'POST']],
    ['sync-ticket', ['GET', 'POST']],
    ['workspace-sync', ['GET']],
  ]) {
    for (const method of methods) {
      const response = await call(path, { method, ...(method === 'POST' ? { data: { provider: 'openai', context: { messages: [] } } } : {}) });
      assert.equal(response.status, 404, `${method} /api/${path}`);
      assert.deepEqual(await response.json(), { error: 'Unknown API endpoint' });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
});

test('startup rejects local directories and unsupported arguments before starting the server', () => {
  const entry = new URL('../server/index.mjs', import.meta.url);
  for (const args of [['./service'], ['/tmp/service'], ['--unknown'], ['--production', './service'], ['--production', '--production']]) {
    const result = spawnSync(process.execPath, [entry.pathname, ...args], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:.*local directory arguments are not supported/);
    assert.doesNotMatch(result.stdout, /bal-bot: http/);
  }
});

test('API access still requires a same-origin localhost session', async t => {
  const { request, call, base } = await apiFixture(t);
  for (const [path, method] of [['project', 'GET'], ['sync-ticket', 'POST']]) {
    assert.equal((await request(path, { method })).status, 401);
    assert.equal((await request(path, { method, token: 'invalid' })).status, 401);
    assert.equal((await call(path, { method, origin: 'https://evil.example' })).status, 403);
    assert.equal((await call(path, { method, host: 'evil.example' })).status, 403);
  }
  assert.equal((await request('session', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('session', { host: 'evil.example' })).status, 403);
  const response = await call('project', { origin: base });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Unknown API endpoint' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('sessions expire and are cleared on close', async t => {
  const { call, api } = await apiFixture(t);
  const now = Date.now;
  try {
    Date.now = () => now() + 25 * 60 * 60_000;
    assert.equal((await call('project')).status, 401);
    assert.equal((await call('sync-ticket', { method: 'POST' })).status, 401);
  } finally { Date.now = now; }
  api.close();
  assert.equal((await call('project')).status, 401);
});
