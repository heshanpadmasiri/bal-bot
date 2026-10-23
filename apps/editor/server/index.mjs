import { createServer } from 'node:http';
import { createApi } from './api.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--production')) {
  console.error('Usage: npm run dev (or npm start); local directory arguments are not supported.');
  process.exit(1);
}
const api = createApi();
const production = args.includes('--production');
const server = createServer();
let vite;
let website;
if (production) {
  const { default: sirv } = await import('sirv');
  website = sirv('dist', { single: true });
} else {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ server: { middlewareMode: true, hmr: { server }, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.bal-bot/**'] } }, appType: 'spa' });
  website = vite.middlewares;
}
server.on('request', async (req, res) => {
  try {
    if (decodeURIComponent(req.url || '').includes('.bal-bot')) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!await api.handle(req, res)) website(req, res, () => { res.writeHead(404); res.end('Not found'); });
  } catch { if (!res.headersSent) res.writeHead(400); res.end('Request failed'); }
});
const port = Number(process.env.PORT || 5173);
server.listen(port, '127.0.0.1', () => console.log(`bal-bot: http://127.0.0.1:${port}`));
async function close() { api.close(); await vite?.close(); server.close(); server.closeAllConnections(); }
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
