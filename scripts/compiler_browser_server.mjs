import { createServer as httpServer } from 'node:http';
import { createServer, build } from 'vite';
import sirv from 'sirv';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const production = process.argv.includes('--production');
const port = production ? 5182 : 5181;
if (production) {
  await build({ root, publicDir: 'apps/editor/public', logLevel: 'warn', build: { outDir: '.compiler-browser-test', rollupOptions: { input: ['apps/editor/tests/browser/harness.html', 'apps/editor/tests/browser/app.html'] } } });
  httpServer(sirv(path.join(root, '.compiler-browser-test'), { dev: true })).listen(port, '127.0.0.1');
} else {
  const server = await createServer({ root, publicDir: 'apps/editor/public', server: { host: '127.0.0.1', port, strictPort: true } });
  await server.listen();
}
