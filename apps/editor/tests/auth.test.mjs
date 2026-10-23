import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createModels, createProvider } from '@earendil-works/pi-ai';
import { createApi } from '../server/api.mjs';
import { FileCredentials, installationId } from '../server/credentials.mjs';

const secret = { type: 'oauth', access: 'private-access', refresh: 'private-refresh', expires: Date.now() + 3_600_000 };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bal-bot-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, credentials: new FileCredentials(directory) };
}

test('credentials persist privately, serialize changes and logout; installation ID is stable', async t => {
  const { directory, credentials } = await fixture(t);
  await credentials.modify('openai', async () => secret);
  assert.equal((await stat(join(directory, 'auth.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  const restored = new FileCredentials(directory);
  assert.deepEqual(await restored.read('openai'), secret);
  await Promise.all(Array.from({ length: 5 }, () => credentials.modify('openai', async value => ({ ...value, count: (value.count ?? 0) + 1 }))));
  assert.equal((await credentials.read('openai')).count, 5);
  assert.deepEqual(await credentials.list(), [{ providerId: 'openai', type: 'oauth' }]);
  assert.equal(await installationId(directory), await installationId(directory));
  await credentials.delete('openai');
  assert.equal(await credentials.read('openai'), undefined);
});

test('PI refresh uses the persistent store and serializes concurrent refreshes', async t => {
  const { credentials } = await fixture(t);
  await credentials.modify('openai', async () => ({ ...secret, expires: 0 }));
  let refreshes = 0;
  const models = createModels({ credentials });
  models.setProvider(createProvider({ id: 'openai', models: [], api: { stream() {}, streamSimple() {} }, auth: { oauth: {
    name: 'test', login: async () => secret,
    refresh: async credential => { refreshes++; return { ...credential, access: 'rotated-access', refresh: 'rotated-refresh', expires: Date.now() + 3_600_000 }; },
    toAuth: async credential => ({ apiKey: credential.access }),
  } } }));
  const auth = await Promise.all([models.getAuth('openai'), models.getAuth('openai')]);
  assert.equal(refreshes, 1);
  assert.equal(auth[0].auth.apiKey, 'rotated-access');
  assert.equal(auth[1].auth.apiKey, 'rotated-access');
  assert.equal((await credentials.read('openai')).refresh, 'rotated-refresh');
});

async function apiFixture(t) {
  const { credentials } = await fixture(t);
  const models = {
    getModels: provider => [{ provider, id: 'test-model', name: 'Test model', api: 'openai-responses' }],
    getModel: (provider, id) => id === 'test-model' ? { provider, id, api: 'openai-responses' } : undefined,
    async login(provider, _, interaction) {
      interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/test' });
      const code = await interaction.prompt({ type: 'manual_code', message: 'Paste code', signal: interaction.signal });
      if (code !== 'valid-code') throw new Error('Failed private-access private-refresh');
      await credentials.modify(provider, async () => secret);
    },
    async logout(provider) { await credentials.delete(provider); },
    async *streamSimple(model, context, options) {
      assert.equal(model.id, 'test-model');
      assert.equal(options.transport, 'sse');
      assert.equal(options.headers, undefined);
      yield { type: 'done', reason: 'stop', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } };
    },
  };
  const api = createApi({ models, credentials, deviceId: 'test-device' });
  const server = createServer((req, res) => { void api.handle(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { api.close(); server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', data, token, origin } = {}) => fetch(`${base}/api/${path}`, {
    method, headers: { ...(token ? { 'X-Bal-Bot-Session': token } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const token = (await (await request('session')).json()).token;
  const call = (path, options) => request(path, { token, ...options });
  return { request, call, credentials, models, base };
}

test('startup rejects local directories and unsupported arguments before starting the server', () => {
  const entry = new URL('../server/index.mjs', import.meta.url);
  for (const args of [['./service'], ['/tmp/service'], ['--unknown'], ['--production', './service'], ['--production', '--production']]) {
    const result = spawnSync(process.execPath, [entry.pathname, ...args], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:.*local directory arguments are not supported/);
    assert.doesNotMatch(result.stdout, /bal-bot: http/);
  }
});

test('removed project and sync endpoints are unavailable to authenticated clients', async t => {
  const { call } = await apiFixture(t);
  for (const [path, method] of [['project', 'GET'], ['sync-ticket', 'POST'], ['workspace-sync', 'GET']]) {
    const response = await call(path, { method });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Unknown API endpoint' });
  }
});

test('API rejects cross-origin and unauthenticated access without exposing credentials', async t => {
  const { request, call, credentials } = await apiFixture(t);
  assert.equal((await request('providers')).status, 401);
  assert.equal((await request('session', { origin: 'https://evil.example' })).status, 403);
  await credentials.modify('openai', async () => secret);
  const status = await (await call('providers')).text();
  assert.equal(JSON.parse(status)[0].connected, true);
  assert.ok(!status.includes(secret.access));
  assert.ok(!status.includes(secret.refresh));
  assert.equal((await call('login', { method: 'POST', data: { provider: 'unknown' } })).status, 400);
});

test('login prompts complete for both providers, persist credentials and support logout', async t => {
  const { call, request, credentials } = await apiFixture(t);
  for (const provider of ['openai', 'anthropic']) {
    const login = await (await call('login', { method: 'POST', data: { provider } })).json();
    assert.equal(login.status, 'pending');
    assert.equal((await request(`login/${login.id}`)).status, 401);
    assert.equal((await call('login', { method: 'POST', data: { provider } })).status, 409);
    assert.equal((await call(`login/${login.id}`, { method: 'POST', data: { promptId: 'stale', value: 'valid-code' } })).status, 409);
    assert.equal((await call(`login/${login.id}`, { method: 'POST', data: { promptId: login.prompt.id, value: 'valid-code' } })).status, 200);
    // Reading credentials queues behind the login write.
    assert.equal((await credentials.read(provider)).access, secret.access);
    const status = await (await call(`login/${login.id}`)).json();
    assert.equal(status.status, 'complete');
    assert.ok(!JSON.stringify(status).includes(secret.access));
    await call('logout', { method: 'POST', data: { provider } });
    assert.equal(await credentials.read(provider), undefined);
  }
});

test('cancelled and failed login do not save tokens or reveal provider error bodies', async t => {
  const { call, credentials } = await apiFixture(t);
  let login = await (await call('login', { method: 'POST', data: { provider: 'openai' } })).json();
  await call(`login/${login.id}`, { method: 'DELETE' });
  assert.equal((await (await call(`login/${login.id}`)).json()).status, 'cancelled');
  assert.equal(await credentials.read('openai'), undefined);
  login = await (await call('login', { method: 'POST', data: { provider: 'openai' } })).json();
  await call(`login/${login.id}`, { method: 'POST', data: { promptId: login.prompt.id, value: 'bad-code' } });
  const status = await (await call(`login/${login.id}`)).json();
  assert.equal(status.status, 'error');
  assert.ok(!JSON.stringify(status).includes(secret.access));
});

test('streaming requires login and rejects client-controlled models/endpoints', async t => {
  const { call, credentials } = await apiFixture(t);
  const data = { provider: 'openai', modelId: 'test-model', context: { messages: [] }, headers: { Authorization: 'evil' } };
  assert.equal((await call('stream', { method: 'POST', data })).status, 401);
  await credentials.modify('openai', async () => secret);
  assert.equal((await call('stream', { method: 'POST', data: { ...data, modelId: 'unknown' } })).status, 400);
  const result = await call('stream', { method: 'POST', data });
  assert.equal(result.headers.get('content-type'), 'application/x-ndjson');
  assert.equal(JSON.parse((await result.text()).trim()).message.content[0].text, 'Hello');
});
