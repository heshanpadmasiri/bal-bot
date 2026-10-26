// Independent feature-test server. Frozen baseline infrastructure stays unchanged.
import {createServer as httpServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build, createServer} from 'vite';
import sirv from 'sirv';

const root = path.resolve(import.meta.dirname, '../..');
const production = process.argv.includes('--production');
const index = process.argv.indexOf('--port');
const port = index < 0 ? (production ? 5282 : 5281) : Number(process.argv[index + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
if (production) {
  const outDir = await mkdtemp(path.join(tmpdir(), 'variable-hover-browser-'));
  await build({root, publicDir: 'apps/editor/public', logLevel: 'warn', build: {
    outDir, emptyOutDir: true,
    rollupOptions: {input: ['apps/editor/tests/browser/harness.html', 'apps/editor/tests/browser/app.html']},
  }});
  const server = httpServer(sirv(outDir, {dev: true}));
  server.listen(port, '127.0.0.1');
  const stop = () => server.close(async () => {await rm(outDir, {recursive: true, force: true}); process.exit(0);});
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} else {
  const server = await createServer({root, publicDir: 'apps/editor/public', server: {host: '127.0.0.1', port, strictPort: true}});
  await server.listen();
}
