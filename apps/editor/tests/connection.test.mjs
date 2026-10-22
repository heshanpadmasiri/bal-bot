import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { createWorkspaceAgent } from '@bal-bot/browser-workspace';
import { BrowserWorkspace } from '@bal-bot/browser-workspace';
import { streamServer } from '../src/connection.ts';

const models = createModels();
models.setProvider(openaiProvider());
const model = models.getModels('openai')[0];
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = content => ({ role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: Date.now() });
const response = events => {
  const bytes = new TextEncoder().encode(events.map(e => JSON.stringify(e) + '\n').join(''));
  return new Response(new ReadableStream({ start(controller) {
    // Split inside JSON and a UTF-8 character to exercise incremental parsing.
    for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17));
    controller.close();
  } }));
};

test('browser PI executes streamed file tools and sends results back through the server', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/session') return Response.json({ token: 'local-session' });
    assert.equal(url, '/api/stream');
    assert.equal(options.headers['X-Bal-Bot-Session'], 'local-session');
    const input = JSON.parse(options.body);
    assert.equal(input.provider, 'openai');
    assert.equal(input.apiKey, undefined);
    requests.push(input);
    const output = requests.length === 1
      ? { ...message([{ type: 'toolCall', id: 'write-1', name: 'write_file', arguments: { path: 'generated.bal', content: '// hello from PI' } }]), stopReason: 'toolUse' }
      : message([{ type: 'text', text: 'Created your file. ✓' }]);
    return response([{ type: 'done', reason: output.stopReason, message: output }]);
  };
  const workspace = new BrowserWorkspace({ getItem: () => null, setItem() {} });
  const agent = createWorkspaceAgent(workspace, model, streamServer);
  await agent.prompt('Create generated.bal');
  assert.equal(workspace.read('generated.bal'), '// hello from PI');
  assert.equal(requests.length, 2);
  assert.ok(requests[1].context.messages.some(m => m.role === 'toolResult' && m.toolName === 'write_file'));
  assert.equal(agent.state.messages.at(-1).content[0].text, 'Created your file. ✓');
});

test('proxy forwards streaming text and converts premature EOF into a settled error', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const partial = message([{ type: 'text', text: 'Hello ✓' }]);
  globalThis.fetch = async () => response([{ type: 'text_delta', contentIndex: 0, delta: 'Hello ✓', partial }, { type: 'done', reason: 'stop', message: partial }]);
  const events = [];
  for await (const event of streamServer(model, { messages: [] })) events.push(event);
  assert.equal(events[0].delta, 'Hello ✓');
  assert.equal(events.at(-1).type, 'done');
  globalThis.fetch = async () => response([]);
  const failed = await streamServer(model, { messages: [] }).result();
  assert.equal(failed.stopReason, 'error');
  assert.match(failed.errorMessage, /ended before/);
});

test('stopping a browser agent aborts the proxied request and settles the turn', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let began;
  const started = new Promise(resolve => { began = resolve; });
  let requestSignal;
  globalThis.fetch = async (_, options) => new Promise((_, reject) => {
    requestSignal = options.signal;
    began();
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const workspace = new BrowserWorkspace({ getItem: () => null, setItem() {} });
  const agent = createWorkspaceAgent(workspace, model, streamServer);
  const pending = agent.prompt('Wait');
  await started;
  agent.abort();
  await pending;
  assert.equal(requestSignal.aborted, true);
  assert.equal(agent.state.isStreaming, false);
  assert.equal(agent.state.messages.at(-1).stopReason, 'aborted');
});
