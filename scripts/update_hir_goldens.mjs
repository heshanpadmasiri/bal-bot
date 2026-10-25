#!/usr/bin/env node
// Deliberately separate from frozen render capture tooling. Never imports the recorder.
import { spawnSync } from 'node:child_process';
import {validateRenderCoverage, validateInfrastructure} from './hir-suite-registry.mjs';
import {loadMigrations, baselineSource} from './hir-baseline-migrations.mjs';
import {validatePostBaselineRenderingSuites} from './hir-suite-inventory.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
// Playwright already pins Babel's parser for these browser tests.
const require = createRequire(import.meta.url);
const { babelParse } = require(path.join(path.dirname(require.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'));

const root = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = root;
const base = path.join(root, 'tests/fixtures/hir-projects');
const manifest = JSON.parse(readFileSync(path.join(base, 'manifest.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort((a, b) => a.localeCompare(b)).map(key => [key, sort(value[key])]));
  return value;
}
function sources(directory) {
  const files = {};
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else files[path.relative(directory, file).split(path.sep).join('/')] = readFileSync(file, 'utf8');
    }
  }
  walk(directory);
  return files;
}
// This parser only recognizes a small, explicit set of source-building AST
// forms. It never imports test modules or executes project/test source.
export function collectBrowserInventory(historical = false, migrations = loadMigrations(), repository = root) {
  // Keep registration authority in this checkout, but verify the supplied
  // repository's browser bytes too (including isolated mutation fixtures).
  const registry = JSON.parse(readFileSync(path.join(repositoryRoot, 'tests/hir-suite-inventory.json'), 'utf8'));
  const infrastructure = validateInfrastructure(registry, repositoryRoot);
  const root = repository;
  const readSource = file => historical && migrations.has(file) ? migrations.get(file).original : readFileSync(path.join(root, file));
  const frozen = JSON.parse(readFileSync(path.join(repositoryRoot, 'tests/fixtures/flow-rendering/inventory.json'), 'utf8'));
  const postBaselineRendering = validatePostBaselineRenderingSuites(registry, new Set(frozen.suites.map(suite => suite.file)), repositoryRoot);
  const directory = 'packages/compiler/tests/browser';
  const initialPath = 'packages/workspace/src/files.ts';
  const initialAST = babelParse(readFileSync(path.join(root, initialPath), 'utf8'), initialPath);
  let initial;
  function visit(node, fn) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(child => visit(child, fn)); return; }
    if (!node.type) return;
    fn(node);
    for (const [key, child] of Object.entries(node)) if (!['loc', 'comments', 'tokens'].includes(key)) visit(child, fn);
  }
  const isString = node => node?.type === 'StringLiteral' || (node?.type === 'TemplateLiteral' && node.expressions.length === 0);
  const string = node => node.type === 'StringLiteral' ? node.value : node.quasis[0].value.cooked;
  visit(initialAST, node => {
    if (node.type === 'VariableDeclarator' && node.id.name === 'initialFiles') {
      initial = Object.fromEntries(node.init.properties.map(p => [string(p.key), string(p.value)]));
    }
  });
  if (!initial) throw Error('Missing static initialFiles');
  const examples = Object.fromEntries(readdirSync(path.join(root, 'examples'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => [d.name, Object.fromEntries(Object.entries(sources(path.join(root, 'examples', d.name))).filter(([name]) => /\.(bal|toml)$/.test(name)))]));
  const result = [{ file: initialPath, sha256: hash(readFileSync(path.join(root, initialPath))), scenarios: [{ name: 'initialFiles', requests: [initial], exclusions: [] }] }];
  for (const name of readdirSync(path.join(root, directory)).filter(n => n.endsWith('.spec.mjs')).sort()) {
    const file = `${directory}/${name}`;
    // Only validated feature suites are outside the immutable original corpus.
    // Unknown suites remain collected and fail the original inventory checks.
    if (postBaselineRendering.has(file)) continue;
    if (infrastructure.has(file)) {
      const entry = registry.infrastructure.find(entry => entry.file === file);
      if (hash(readFileSync(path.join(root, file))) !== entry.sha256) throw Error(`Post-baseline infrastructure needs hash audit: ${file}`);
      continue;
    }
    const text = readSource(file).toString();
    const ast = babelParse(text, file);
    const expressionText = node => text.slice(node.start, node.end);
    const scenarios = [];
    const globals = new Map();
    visit(ast, node => { if (node.type === 'VariableDeclarator' && isString(node.init)) globals.set(node.id.name, string(node.init)); });
    visit(ast, node => {
      if (node.type !== 'CallExpression' || expressionText(node.callee) !== 'test') return;
      const title = node.arguments[0];
      const scenario = { name: isString(title) ? string(title) : expressionText(title), requests: [], exclusions: [], generators: [], inputEvents: [] };
      scenarios.push(scenario);
      let files = { ...initial };
      const add = value => { if (!scenario.requests.some(r => canonical(r) === canonical(value))) scenario.requests.push({ ...value }); };
      const evaluate = expression => {
        if (isString(expression)) return string(expression);
        if (expression.type === 'Identifier' && globals.has(expression.name)) return globals.get(expression.name);
        if (expression.type === 'BinaryExpression' && expression.operator === '+') return evaluate(expression.left) + evaluate(expression.right);
        if (expression.type === 'MemberExpression' && expression.computed && expressionText(expression.object) === 'inputs') return examples[evaluate(expression.property)];
        if (expression.type === 'CallExpression') {
          const target = expressionText(expression.callee);
          if (target === 'workspace.read') return files[evaluate(expression.arguments[0])];
          if (expression.callee.type === 'MemberExpression' && expression.callee.property.name === 'replace') return evaluate(expression.callee.object).replace(evaluate(expression.arguments[0]), evaluate(expression.arguments[1]));
        }
        throw Error(`Unrecognized source-building expression in ${file}/${scenario.name}: ${expressionText(expression)}`);
      };
      // Every UI/compiler scenario begins with the real initial workspace unless
      // open(page, fixture) replaces it. Capturing both states is intentional.
      add(files);
      scenario.inputEvents.push({kind:'initial-workspace', files:{...files}});
      visit(node.arguments[node.arguments.length - 1], call => {
        if (call.type !== 'CallExpression') return;
        const target = expressionText(call.callee);
        if (target === 'open' && call.arguments.length > 1 && isString(call.arguments[1]) && examples[string(call.arguments[1])]) {
          files = { ...examples[string(call.arguments[1])] }; add(files);
          scenario.inputEvents.push({kind:'open', files:{...files}});
        }
        if (target === 'workspace.write') {
          const name = evaluate(call.arguments[0]);
          if (call.arguments[1].type === 'MemberExpression' && call.arguments[1].computed && expressionText(call.arguments[1].object) === 'files') {
            // Repair from the original analysis-recovery fixture passed to evaluate.
            if (scenario.name !== 'invalid edits retain stale flow, disable references and repair') throw Error('Unclassified browser file repair');
            files[name] = examples['analysis-recovery'][name];
          } else files[name] = evaluate(call.arguments[1]);
          add(files);
          scenario.inputEvents.push({kind:'workspace.write', files:{...files}});
        }
        if (['compiler.check','compiler.analyze'].includes(target) && !['Identifier','ObjectExpression'].includes(call.arguments[0]?.type)) throw Error(`Non-static active compiler input: ${file}/${scenario.name}`);
        if (['compiler.check','compiler.analyze'].includes(target) && call.arguments[0]?.type === 'Identifier') {
          if (call.arguments[0].name === 'initialFiles') scenario.inputEvents.push({kind:target,files:{...initial}});
          else if (call.arguments[0].name === 'files' && scenario.name === 'native and real browser WASM models match for all supported fixtures') {
            for (const files of Object.values(examples)) scenario.inputEvents.push({kind:target,files:{...files}});
          } else throw Error(`Unclassified active compiler request: ${file}/${scenario.name}`);
        }
        if (['compiler.check','compiler.analyze'].includes(target) && call.arguments[0]?.type === 'ObjectExpression') {
          const properties = call.arguments[0].properties;
          if (properties.length !== 2 || properties[0].type !== 'SpreadElement' || properties[0].argument.type !== 'Identifier' || properties[0].argument.name !== 'initialFiles' || properties[1].type !== 'ObjectProperty' || !isString(properties[1].key) || string(properties[1].key) !== 'main.bal') throw Error(`Unclassified compiler input object/spread: ${file}/${scenario.name}`);
          const source = call.arguments[0].properties.find(p => p.key && isString(p.key) && string(p.key) === 'main.bal')?.value;
          if (source && isString(source)) {
            const files = { ...initial, 'main.bal': string(source) };
            add(files); scenario.inputEvents.push({kind:target,files});
          }
          else if (scenario.name === 'cancellation during bridge compilation terminates its worker') {
            if (source?.type !== 'Identifier') throw Error('Missing cancellation generator reference');
            const definitions = [];
            visit(node.arguments[node.arguments.length - 1], declaration => {
              if (declaration.type === 'VariableDeclaration' && declaration.declarations.some(d => d.id.name === source.name)) {
                if (declaration.kind !== 'const') throw Error('Cancellation generator binding must remain immutable');
                for (const binding of declaration.declarations.filter(d => d.id.name === source.name)) definitions.push(binding.init);
              }
            });
            if (definitions.length !== 1) throw Error('Ambiguous cancellation stress generator');
            // Pin the actual AST, not merely the exclusion label: size, template,
            // index expression and join separator all remain baseline authority.
            scenario.inputEvents.push({kind:target,excludedGenerator:source.name});
            scenario.generators.push(JSON.parse(JSON.stringify(definitions[0], (key, value) => ['start', 'end', 'loc', 'extra', 'comments'].includes(key) ? undefined : value)));
            scenario.exclusions.push('Generated 15,000-declaration source is a worker-cancellation stress input: deliberately aborted, no completed frontend result or AST expectation. Generation expression and size are pinned by original file hash.');
          }
          else throw Error(`Unclassified compiler input: ${scenario.name}`);
        }
        if (target === 'editSource') { files['main.bal'] = globals.get('draft'); if (typeof files['main.bal'] !== 'string') throw Error('Missing static saved draft'); add(files); scenario.inputEvents.push({kind:'editSource',files:{...files}}); }
      });
      if (scenario.name === 'native and real browser WASM models match for all supported fixtures') Object.values(examples).forEach(add);
      if (name === 'storage.spec.mjs') scenario.exclusions.push('old.bal localStorage text is intentionally never restored/compiled; browser-storage infrastructure only.');
      if (scenario.name === 'unsaved editor text does not invalidate analysis; removing selected scopes falls back to Automation') scenario.exclusions.push('Textbox draft "not saved" is not written to the workspace or compiled.');
      if (scenario.name === 'chat renders action-only tool summaries through streaming, outcomes and scope restoration') scenario.exclusions.push('private.bal/secret source strings are simulated tool-message content, not workspace source edits.');
      if (name === 'render-parity.spec.mjs') scenario.exclusions.push('Harness renders frozen graph inputs; no compiler source mutation. Original project inputs are covered separately by manifest catalog coverage.');
    });
    result.push({ file, sha256: hash(text), scenarios });
  }
  return result;
}

export function assertBrowserRequestsUnchanged(current, historical) {
  if (current.length !== historical.length) throw Error('Current browser file inventory changed');
  for (const [index, live] of current.entries()) {
    const original = historical[index];
    if (live.file !== original.file || canonical(live.scenarios) !== canonical(original.scenarios)) throw Error(`Current browser requests/scenarios/exclusions/generators changed: ${live.file}`);
  }
}

export function checkBrowserInventory() {
  const migrations = loadMigrations();
  const inventory = JSON.parse(readFileSync(path.join(base, 'source-inventory.json'), 'utf8'));
  // New HIR-only suites are audited in the post-baseline registry, not silently
  // added to the immutable original source inventory.
  const registry = JSON.parse(readFileSync(path.join(root, 'tests/hir-suite-inventory.json'), 'utf8'));
  validateRenderCoverage(registry, root);
  const infrastructure = validateInfrastructure(registry, root, [...inventory.browser, ...(inventory.infrastructure ?? [])].map(entry => entry.file));
  const postBaseline = new Set([...registry.suites.map(suite => suite.file), ...infrastructure]);
  const infrastructureFiles = ['packages/compiler/tests/client.test.mjs', 'packages/compiler/tests/native/main.go'];
  for (const directory of ['apps/editor/tests', 'packages/browser-workspace/tests']) {
    infrastructureFiles.push(...readdirSync(path.join(root, directory)).filter(name => name.endsWith('.test.mjs') || name === 'fixtures.mjs').map(name => `${directory}/${name}`).filter(file => !postBaseline.has(file)));
  }
  const excludedFiles = new Set();
  for (const entry of inventory.infrastructure ?? []) {
    if (excludedFiles.has(entry.file) || !entry.exclusion || hash(baselineSource(entry.file, entry.sha256, root, migrations)) !== entry.sha256) throw Error(`Infrastructure exclusion needs audit: ${entry.file}`);
    excludedFiles.add(entry.file);
  }
  if (canonical([...excludedFiles].sort()) !== canonical(infrastructureFiles.sort())) throw Error('Missing compiler/UI/workspace infrastructure exclusions');
  const current = collectBrowserInventory(false, migrations);
  const historical = collectBrowserInventory(true, migrations);
  assertBrowserRequestsUnchanged(current, historical);
  if (current.length !== inventory.browser.length) throw Error('Browser source file inventory mismatch');
  for (const [index, original] of current.entries()) {
    const archived = inventory.browser[index];
    if (original.file !== archived.file || historical[index].sha256 !== archived.sha256) throw Error(`Original browser definition changed: ${original.file}; explicitly audit source inventory, never silently refresh its hash`);
    if (original.scenarios.length !== archived.scenarios.length) throw Error(`Browser scenario coverage mismatch: ${original.file}`);
    for (const [i, scenario] of original.scenarios.entries()) {
      const expected = archived.scenarios[i];
      if (scenario.name !== expected.name || canonical(scenario.exclusions) !== canonical(expected.exclusions) || scenario.requests.length !== expected.projects.length) throw Error(`Browser request inventory mismatch: ${original.file}/${scenario.name}`);
      for (const [j, files] of scenario.requests.entries()) {
        const case_ = manifest.cases.find(c => c.id === expected.projects[j] && c.kind === 'project');
        if (!case_ || canonical(files) !== canonical(sources(path.join(base, case_.directory, 'source')))) throw Error(`Browser original source bytes differ: ${original.file}/${scenario.name}/${expected.projects[j]}`);
      }
    }
  }
}

function main() {
if (process.argv.length === 3 && process.argv[2] === '--check-inventory') { checkBrowserInventory(); return; }
if (process.argv.length !== 2) throw Error('Usage: npm run test:hir:update (no arbitrary paths or test flags)');
checkBrowserInventory();
const catalog = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/flow-rendering/inputs/catalog.json'), 'utf8'));
for (const case_ of manifest.cases) {
  if (case_.kind !== 'project') {
    if (case_.ast !== null || case_.hir !== null) throw Error(`Synthetic input must explicitly omit AST/HIR: ${case_.id}`);
    continue;
  }
  if (case_.hir !== (case_.ast === null ? null : 'hir.golden.json')) throw Error(`HIR expectation must match resolved AST availability: ${case_.id}`);
  if (path.basename(case_.directory) !== case_.directory || ['.', '..'].includes(case_.directory)) throw Error(`Unsafe corpus directory: ${case_.directory}`);
  const files = sources(path.join(base, case_.directory, 'source'));
  for (const [name, source] of Object.entries(files)) {
    if (case_.sourceHashes[name] !== hash(source)) throw Error(`Original source hash mismatch: ${case_.id}/${name}`);
  }
  if (Object.keys(files).length !== Object.keys(case_.sourceHashes).length) throw Error(`Source inventory mismatch: ${case_.id}`);
  if (hash(canonical({ kind: 'project', files })) !== case_.inputHash) throw Error(`Input hash mismatch: ${case_.id}`);
  if (case_.catalogRef && canonical(catalog[case_.catalogRef]?.files) !== canonical(files)) throw Error(`Captured original input mismatch: ${case_.id}`);
}
const result = spawnSync('go', ['test', '.', '-run', '^TestHIR(CorpusCoverage|SourceInventory|Projects|SyntheticFixtures)$', '-count=1', '-update'], {
  cwd: path.join(root, 'packages/compiler'), env: { ...process.env, GOWORK: 'off' }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const projects = manifest.cases.filter(case_ => case_.kind === 'project');
  console.log(`Updated ${projects.filter(case_ => case_.ast !== null).length} AST/HIR/test-only legacy lookup snapshots and ${projects.length} diagnostic goldens; ${manifest.cases.length - projects.length} synthetic inputs have separate test-only graph adapters, never an AST or frontend-lowered HIR. No frozen render artifacts written.`);
}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
