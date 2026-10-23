import { randomBytes } from 'node:crypto';

const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

export function createApi() {
  const sessions = new Map();
  const localRequest = req => {
    const host = req.headers.host;
    return !!host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && (!req.headers.origin || req.headers.origin === `http://${host}`);
  };

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
    json(res, 404, { error: 'Unknown API endpoint' });
    return true;
  }
  return { handle, close() { sessions.clear(); } };
}
