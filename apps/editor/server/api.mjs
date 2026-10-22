import { randomBytes, randomUUID } from 'node:crypto';
import { getSelectedModels } from './model-selection.mjs';

const PROVIDERS = ['openai', 'anthropic'];
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function createApi({ models, credentials, deviceId, project, loginTimeoutMs = 5 * 60_000 }) {
  const sessions = new Map();
  const tickets = new Map();
  const localRequest = req => {
    const host = req.headers.host;
    return !!host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && (!req.headers.origin || req.headers.origin === `http://${host}`);
  };
  const logins = new Map();
  const active = new Map();
  const safeLogin = login => ({ id: login.id, provider: login.provider, status: login.status, events: login.events, prompt: login.prompt, error: login.error });
  const cancel = login => { login.controller.abort(); login.reject?.(new Error('Login cancelled')); };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    // This is a local single-user application, including in production mode.
    if (!localRequest(req)) {
      json(res, 403, { error: 'Same-origin localhost requests only' }); return true;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/api/session' && req.method === 'GET') {
      for (const [token, expires] of sessions) if (expires < Date.now()) sessions.delete(token);
      if (sessions.size >= 1024) { json(res, 429, { error: 'Too many sessions' }); return true; }
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + 24 * 60 * 60_000);
      json(res, 200, { token }); return true;
    }
    const token = req.headers['x-bal-bot-session'];
    if (!token || (sessions.get(token) ?? 0) < Date.now()) { json(res, 401, { error: 'Reload the page to reconnect to the local server.' }); return true; }
    try {
      if (url.pathname === '/api/project' && req.method === 'GET' && project) {
        json(res, 200, { id: project.id, name: project.name });
      } else if (url.pathname === '/api/sync-ticket' && req.method === 'POST' && project) {
        for (const [ticket, expires] of tickets) if (expires < Date.now()) tickets.delete(ticket);
        if (tickets.size >= 1024) { json(res, 429, { error: 'Too many sync connections' }); return true; }
        const ticket = randomBytes(32).toString('hex');
        tickets.set(ticket, Date.now() + 30_000);
        json(res, 200, { ticket });
      } else if (url.pathname === '/api/providers' && req.method === 'GET') {
        const stored = await credentials.list();
        json(res, 200, PROVIDERS.map(id => ({ id, connected: stored.some(c => c.providerId === id), models: getSelectedModels(models, id) })));
      } else if (url.pathname === '/api/login' && req.method === 'POST') {
        const { provider } = await body(req);
        if (!PROVIDERS.includes(provider)) { json(res, 400, { error: 'Unknown provider' }); return true; }
        if (active.has(provider)) { json(res, 409, { error: 'A login for this provider is already running. Cancel it or wait for it to finish.' }); return true; }
        for (const [id, previous] of logins) if (previous.status !== 'pending') logins.delete(id);
        const login = { id: randomUUID(), provider, token, status: 'pending', controller: new AbortController(), events: [] };
        logins.set(login.id, login);
        active.set(provider, login);
        const timer = setTimeout(() => cancel(login), loginTimeoutMs);
        timer.unref();
        void models.login(provider, 'oauth', {
          signal: login.controller.signal,
          notify(event) { login.events.push(event); },
          prompt(prompt) {
            return new Promise((resolve, reject) => {
              const id = randomUUID();
              const { signal, ...fields } = prompt;
              login.prompt = { ...fields, id };
              const abort = () => { cleanup(); reject(new Error('Login cancelled')); };
              const signals = [signal, login.controller.signal].filter(Boolean);
              const cleanup = () => {
                for (const s of signals) s.removeEventListener('abort', abort);
                if (login.prompt?.id === id) { login.prompt = undefined; login.answer = undefined; login.reject = undefined; }
              };
              login.answer = value => { cleanup(); resolve(value); };
              login.reject = reason => { cleanup(); reject(reason); };
              for (const s of signals) s.addEventListener('abort', abort, { once: true });
              if (signals.some(s => s.aborted)) abort();
            });
          },
        }, { getDeviceId: () => deviceId, agentName: 'bal-bot' })
          .then(() => { login.status = 'complete'; })
          .catch(error => {
            login.status = login.controller.signal.aborted ? 'cancelled' : 'error';
            // Provider errors can contain token endpoint response bodies. Never forward them.
            login.error = login.status === 'cancelled' ? 'Login cancelled or timed out.' : /Port \d+ is in use/.test(error.message) ? 'The login callback port is in use. Cancel other PI/Codex login attempts and retry.' : 'Sign-in failed. Retry the login; if needed, use the manual redirect URL or code.';
          })
          .finally(() => { clearTimeout(timer); login.prompt = undefined; active.delete(provider); });
        json(res, 200, safeLogin(login));
      } else if (url.pathname.startsWith('/api/login/')) {
        const id = url.pathname.slice('/api/login/'.length);
        const login = logins.get(id);
        if (!login || login.token !== token) { json(res, 404, { error: 'Login not found' }); return true; }
        if (req.method === 'GET') json(res, 200, safeLogin(login));
        else if (req.method === 'DELETE') { cancel(login); json(res, 200, { ok: true }); }
        else if (req.method === 'POST') {
          const { promptId, value } = await body(req);
          if (login.status !== 'pending' || !login.answer || login.prompt?.id !== promptId || typeof value !== 'string' || (login.prompt.type === 'select' && !login.prompt.options.some(o => o.id === value))) {
            json(res, 409, { error: 'This login prompt is no longer active.' });
          } else { login.answer(value); json(res, 200, { ok: true }); }
        } else json(res, 405, { error: 'Method not allowed' });
      } else if (url.pathname === '/api/logout' && req.method === 'POST') {
        const { provider } = await body(req);
        if (!PROVIDERS.includes(provider)) { json(res, 400, { error: 'Unknown provider' }); return true; }
        if (active.has(provider)) { json(res, 409, { error: 'Cancel the active login before signing out.' }); return true; }
        await models.logout(provider);
        json(res, 200, { ok: true });
      } else if (url.pathname === '/api/stream' && req.method === 'POST') {
        const input = await body(req);
        const model = PROVIDERS.includes(input.provider) && models.getModel(input.provider, input.modelId);
        if (!model || !Array.isArray(input.context?.messages)) { json(res, 400, { error: 'Invalid model or conversation' }); return true; }
        if (!await credentials.read(input.provider)) { json(res, 401, { error: 'Sign in to the selected provider first.' }); return true; }
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        // Resolve the model and auth on the server. Never accept client endpoints, headers or keys.
        for await (const event of models.streamSimple(model, { messages: input.context.messages }, { signal: controller.signal, sessionId: input.sessionId, transport: 'sse' })) {
          if (controller.signal.aborted) break;
          const output = event.type === 'error' ? { ...event, error: { ...event.error, errorMessage: event.reason === 'aborted' ? 'Request stopped.' : 'The provider request failed. Check your login and try again.' } } : event;
          if (!res.write(JSON.stringify(output) + '\n')) await new Promise(resolve => {
            const finish = () => { res.off('drain', finish); res.off('close', finish); resolve(); };
            res.once('drain', finish); res.once('close', finish);
          });
        }
        res.end();
      } else json(res, 404, { error: 'Unknown API endpoint' });
    } catch {
      if (!res.headersSent) json(res, 400, { error: 'The request failed. Check your input and provider connection.' });
      else res.end();
    }
    return true;
  }
  return {
    handle,
    authorizeUpgrade(req, ticket) {
      const expires = tickets.get(ticket) ?? 0;
      if (!localRequest(req) || !req.headers.origin || expires < Date.now()) return false;
      tickets.delete(ticket);
      return true;
    },
    close() { tickets.clear(); for (const login of active.values()) cancel(login); },
  };
}
