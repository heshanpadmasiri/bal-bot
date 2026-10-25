// Post-baseline coverage is executable and separate from immutable captures.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {babelParse} = require(resolve(dirname(require.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'));

// Infrastructure is audited separately: mounting an editor for chat assertions
// is not evidence of new flow-rendering coverage. Exact bytes require re-audit.
export function validateInfrastructure(registry, root, baselineFiles = []) {
  const files = new Set();
  const occupied = new Set([...baselineFiles, ...(registry.suites ?? []).map(e => e.file), ...(registry.helpers ?? []).map(e => e.file), ...(registry.postBaselineRenderingSuites ?? []).map(e => e.file)]);
  if (registry.infrastructure !== undefined && !Array.isArray(registry.infrastructure)) throw Error('Invalid post-baseline infrastructure registry');
  for (const entry of registry.infrastructure ?? []) {
    if (!entry || typeof entry.file !== 'string' ||
        !/^(?:packages\/browser-workspace\/tests\/[a-z0-9-]+\.test\.mjs|packages\/compiler\/tests\/browser\/[a-z0-9-]+\.spec\.mjs|apps\/flow-playground\/tests\/(?:controller|demo-link|entries)\.test\.mjs)$/.test(entry.file) ||
        entry.rendering !== false || entry.coverage !== undefined ||
        typeof entry.purpose !== 'string' || !entry.purpose.trim() ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) || files.has(entry.file) || occupied.has(entry.file)) {
      throw Error(`Invalid post-baseline infrastructure: ${entry?.file}`);
    }
    const actual = createHash('sha256').update(readFileSync(resolve(root, entry.file))).digest('hex');
    if (actual !== entry.sha256) throw Error(`Post-baseline infrastructure needs hash audit: ${entry.file}`);
    files.add(entry.file);
  }
  return files;
}

export function validateRenderCoverage(registry, root) {
  const coverage = new Map();
  for (const entry of registry.renderCoverage ?? []) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || coverage.has(entry.id) ||
        !/^(?:apps\/editor\/tests\/hir-[a-z0-9-]+\.test\.mjs|apps\/editor\/tests\/post-baseline\/template-rendering\.test\.mjs)$/.test(entry.file) ||
        !Array.isArray(entry.scenarios) || !entry.scenarios.length ||
        entry.scenarios.some(name => typeof name !== 'string' || !name.trim()) ||
        new Set(entry.scenarios).size !== entry.scenarios.length) throw Error('Invalid post-baseline render coverage');
    const ast = babelParse(readFileSync(resolve(root, entry.file), 'utf8'), entry.file);
    const names = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'test' && node.arguments[0]?.type === 'StringLiteral') names.push(node.arguments[0].value);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
    visit(ast);
    if (entry.scenarios.some(name => names.filter(found => found === name).length !== 1)) throw Error(`Missing executable render scenario: ${entry.file}`);
    if (!registry.suites.some(suite => suite.file === entry.file && suite.rendering === true && suite.coverage?.includes(entry.id))) throw Error(`Unregistered render coverage suite: ${entry.file}`);
    coverage.set(entry.id, entry);
  }
  for (const suite of registry.suites) {
    if (suite.rendering === false) {
      if (suite.coverage !== undefined) throw Error(`Non-rendering suite claims coverage: ${suite.file}`);
    } else if (suite.rendering === true) {
      if (!Array.isArray(suite.coverage) || !suite.coverage.length || new Set(suite.coverage).size !== suite.coverage.length || suite.coverage.some(id => !coverage.has(id))) throw Error(`Missing post-baseline render coverage: ${suite.file}`);
    } else throw Error(`Invalid post-baseline rendering classification: ${suite.file}`);
  }
  return coverage;
}
