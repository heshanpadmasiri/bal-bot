// Isolated variant of compiler_browser_server.mjs: same Vite inputs/publicDir,
// but no shared ports, build directory or server reuse.
import {createServer as httpServer} from 'node:http';
import {createServer, build} from 'vite';
import sirv from 'sirv';
import {resolve} from 'node:path';
const [mode, directory, hirMode] = process.argv.slice(2);
// Test-only module substitution. The actual Editor/panel DOM remains untouched;
// only its FlowView boundary maps legacy analysis to precomputed direct HIR.
const hirPlugin = {
  name: 'flow-parity-hir-only', enforce: 'pre',
  resolveId(source, importer) {
    if (hirMode !== '--hir' || !importer) return;
    const target = source.startsWith('/apps/') ? resolve(`.${source}`) : resolve(importer.split('?')[0], '..', source);
    const browser = resolve('apps/editor/tests/browser');
    if (target === resolve('apps/editor/src/hir-flow-entry')) return `${browser}/hir-entry-alias.tsx`;
    if (target === resolve('apps/editor/src/flow-view')) return `${browser}/hir-flow-alias.tsx`;
    if (target === `${browser}/render-parity`) return `${browser}/hir-render-parity.tsx`;
    if (target === `${browser}/isolated-flow.tsx`) return `${browser}/hir-isolated-flow.tsx`;
  },
};
const plugins = hirMode === '--hir' ? [hirPlugin] : [];
const root = process.cwd();
if (mode === 'production') {
  await build({root, plugins, publicDir: 'apps/editor/public', logLevel: 'warn', build: {outDir: directory, rollupOptions: {input: ['apps/editor/tests/browser/harness.html', 'apps/editor/tests/browser/app.html', 'apps/editor/tests/browser/isolated-flow.html']}}});
  const server = httpServer(sirv(resolve(directory), {dev: true}));
  server.listen(0, '127.0.0.1', () => process.send({port: server.address().port}));
} else {
  // Captures must stay on their loaded document while parallel workers write
  // baseline HTML, flow-review storage or compiler build outputs under root.
  // Disable watching/HMR only here; Vite still serves development modules.
  const server = await createServer({root, plugins, publicDir: 'apps/editor/public', server: {host: '127.0.0.1', port: 0, strictPort: true, watch: null, hmr: false}});
  await server.listen();
  process.send({port: server.httpServer.address().port});
}
