// Test-only provenance bridge. No frozen inventory or input is rewritten.
import {readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {babelParse} = require(path.join(path.dirname(require.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'));
export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const digest = value => createHash('sha256').update(value).digest('hex');
// Registration may refresh live assertion digests, never historical bytes.
export function preserveBaselineArchive(archivePath, original, registered) {
  if (existsSync(archivePath)) {
    if (!readFileSync(archivePath).equals(original)) throw Error(`Immutable baseline archive changed: ${archivePath}`);
    return;
  }
  if (registered) throw Error(`Missing immutable baseline archive: ${archivePath}`);
  mkdirSync(path.dirname(archivePath), {recursive:true});
  writeFileSync(archivePath, original, {flag:'wx'});
}
const read = (root, file) => readFileSync(path.join(root, file));
const json = (root, file) => JSON.parse(read(root, file));
const canonical = value => JSON.stringify(value);
function walk(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(value => walk(value, callback)); return; }
  if (!node.type) return;
  callback(node);
  for (const [key, value] of Object.entries(node)) if (!['loc', 'tokens', 'comments'].includes(key)) walk(value, callback);
}
// Stubbed infrastructure has no completed frontend corpus. Preserve its actual
// request argument ASTs, not obsolete DTO response/assertion literals. Browser
// compiler suites additionally use the full static request interpreter.
export function infrastructureProjection(text, file) {
  const ast = babelParse(text, file), scenarios = [];
  const clean = node => JSON.parse(JSON.stringify(node, (key, value) => ['start','end','loc','extra','comments'].includes(key) ? undefined : value));
  walk(ast, node => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'test') return;
    if (node.arguments[0]?.type !== 'StringLiteral') throw Error(`Non-static test title: ${file}`);
    const scenario = {name:node.arguments[0].value, requests:[], bindings:[], syntheticFixtures:[]};
    const inputNames = new Set(), definitions = [];
    const addNames = expression => walk(expression, child => { if (child.type === 'Identifier') inputNames.add(child.name); });
    walk(node.arguments.at(-1), call => {
      if (['VariableDeclarator','AssignmentExpression','UpdateExpression'].includes(call.type)) definitions.push(call);
      if (call.type !== 'CallExpression') return;
      if (call.callee.type === 'MemberExpression' && ['check','analyze','write'].includes(call.callee.property.name)) {
        scenario.requests.push({target:text.slice(call.callee.start,call.callee.end), input:clean(call.arguments[0]), ...(call.callee.property.name === 'write' ? {source:clean(call.arguments[1])} : {})});
        addNames(call.arguments[0]);
        if (call.callee.property.name === 'write') addNames(call.arguments[1]);
      }
      if (call.callee.type === 'Identifier' && call.callee.name === 'syntheticHIR') {
        if (call.arguments[0]?.type !== 'StringLiteral') throw Error(`Non-static synthetic fixture: ${file}`);
        scenario.syntheticFixtures.push(call.arguments[0].value);
      }
    });
    const selected = new Set();
    for (let changed = true; changed;) {
      changed = false;
      for (const definition of definitions) {
        if (selected.has(definition)) continue;
        const target = definition.id ?? definition.left ?? definition.argument;
        let relevant = false;
        walk(target, id => { if (id.type === 'Identifier' && inputNames.has(id.name)) relevant = true; });
        if (!relevant) continue;
        selected.add(definition); changed = true; addNames(definition.init ?? definition.right);
      }
    }
    scenario.bindings = definitions.filter(d => selected.has(d)).map(clean);
    scenarios.push(scenario);
  });
  return scenarios;
}
export const dtoInfrastructure = new Set(['packages/compiler/tests/client.test.mjs','apps/editor/tests/flow.test.mjs','apps/editor/tests/references.test.mjs','packages/browser-workspace/tests/fixtures.mjs','packages/browser-workspace/tests/analysis.test.mjs','packages/browser-workspace/tests/workspace.test.mjs']);
export function loadMigrations(root = repositoryRoot) {
  const registry = json(root, 'tests/hir-baseline-migrations.json');
  if (registry.version !== 1 || registry.baselineCommit !== '280850fd' || !Array.isArray(registry.files)) throw Error('Invalid baseline migration registry');
  const frozen = json(root, 'tests/fixtures/flow-rendering/inventory.json');
  const inventory = json(root, 'tests/fixtures/hir-projects/source-inventory.json');
  // These are the legacy DTO consumers being migrated, not an escape hatch for
  // unrelated infrastructure (native bridge, connection/tool/storage tests).
  const eligible = new Map([...inventory.native.map(e => [e.file, 'go']), ...inventory.browser.filter(e => e.file.endsWith('.spec.mjs')).map(e => [e.file, 'browser']), ...inventory.infrastructure.filter(e => dtoInfrastructure.has(e.file)).map(e => [e.file, 'infrastructure'])]);
  const entries = new Map();
  for (const entry of registry.files) {
    if (entries.has(entry.file) || eligible.get(entry.file) !== entry.kind || entry.archive !== `tests/legacy-baseline-sources/${entry.file}.txt`) throw Error(`Ineligible/duplicate baseline migration: ${entry.file}`);
    const authority = [...inventory.native, ...inventory.browser, ...inventory.infrastructure].find(e => e.file === entry.file);
    if (entry.originalSHA256 !== authority.sha256 || (frozen.sourceHashes[entry.file] && frozen.sourceHashes[entry.file] !== entry.originalSHA256)) throw Error(`Original migration authority mismatch: ${entry.file}`);
    const original = read(root, entry.archive), current = read(root, entry.file);
    if (digest(original) !== entry.originalSHA256) throw Error(`Baseline archive tamper: ${entry.file}`);
    if (digest(current) !== entry.currentSHA256 || entry.currentSHA256 === entry.originalSHA256) throw Error(`Current migration digest mismatch/unused migration: ${entry.file}`);
    if (entry.extraction?.mode !== ({go:'go-ast-semantic-literal-anchors', browser:'babel-static-requests', infrastructure:'babel-infrastructure-inputs'})[entry.kind]) throw Error(`Missing current extraction proof: ${entry.file}`);
    const originalProjection = entry.kind === 'infrastructure' ? infrastructureProjection(original.toString(), entry.file) : null;
    const names = (originalProjection ?? authority.scenarios ?? []).map(s => s.name);
    if (canonical(entry.extraction.scenarios) !== canonical(names.map(name => ({original:name, current:name})))) throw Error(`Migration scenario mapping mismatch: ${entry.file}`);
    if (entry.kind === 'infrastructure') {
      const live = infrastructureProjection(current.toString(), entry.file);
      const additions = live.filter(s => !names.includes(s.name)).map(s => s.name);
      if (canonical(additions) !== canonical(entry.extraction.additionalScenarios ?? [])) throw Error(`Unregistered new infrastructure scenario: ${entry.file}`);
      if (canonical(live.filter(s => names.includes(s.name)).map(s => s.name)) !== canonical(names)) throw Error(`Removed/reordered infrastructure scenario: ${entry.file}`);
      for (const scenario of originalProjection) {
        const actual = live.find(s => s.name === scenario.name);
        if (canonical({requests:actual.requests,bindings:actual.bindings}) !== canonical({requests:scenario.requests,bindings:scenario.bindings})) throw Error(`Current infrastructure compiler input changed: ${entry.file}/${scenario.name}`);
      }
      const synthetic = Object.fromEntries(live.filter(s => s.syntheticFixtures.length).map(s => [s.name,s.syntheticFixtures]));
      if (canonical(synthetic) !== canonical(entry.extraction.syntheticFixtures ?? {})) throw Error(`Current synthetic mapping changed: ${entry.file}`);
      for (const [name, prefixes] of Object.entries(synthetic)) {
        const suite = frozen.suites.find(s => s.file === entry.file);
        const scenario = suite?.scenarios.find(s => s.name === name);
        const refs = scenario?.caseIds.map(id => frozen.cases.find(c => c.id === id)?.inputRef) ?? [];
        if (prefixes.some(prefix => refs.filter(ref => ref?.startsWith(prefix)).length === 0)) throw Error(`Synthetic fixture is not an original scenario input: ${entry.file}/${name}`);
      }
    }
    entries.set(entry.file, {...entry, original, current});
  }
  const archiveRoot = path.join(root,'tests/legacy-baseline-sources');
  const archives = existsSync(archiveRoot) ? readdirSync(archiveRoot,{recursive:true,withFileTypes:true}).filter(e => e.isFile()).map(e => path.relative(root,path.join(e.parentPath,e.name)).split(path.sep).join('/')).sort() : [];
  if (canonical(archives) !== canonical([...entries.values()].map(e => e.archive).sort())) throw Error('Unused or missing baseline archives');
  return entries;
}
export function baselineSource(file, expected, root = repositoryRoot, migrations = loadMigrations(root)) {
  const entry = migrations.get(file);
  const source = entry ? entry.original : read(root, file);
  if (digest(source) !== expected) throw Error(`Original source drift: ${file}`);
  return source;
}
