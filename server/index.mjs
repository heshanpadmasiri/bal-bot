import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { FileCredentials, installationId } from './credentials.mjs';
import { createApi } from './api.mjs';

const directory = resolve('.bal-bot');
const credentials = new FileCredentials(directory);
const models = createModels({ credentials });
models.setProvider(openaiProvider());
models.setProvider(anthropicProvider());
const api = createApi({ models, credentials, deviceId: await installationId(directory) });
const production = process.argv.includes('--production');
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
