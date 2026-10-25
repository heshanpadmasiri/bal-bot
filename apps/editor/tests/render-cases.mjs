/**
 * Stage-1 frozen render input catalog. No expected rendering is synthesized here.
 *
 * RenderCase = {id, provenance:[{file,scenario,line?}], inputHash,
 *   input:{kind:'project',files:Record<string,string>} |
 *         {kind:'synthetic',program,graphOnly:boolean,expanded?:string[],state?},
 *     (state-only synthetic fixtures can render the full component; graph-only
 *      fixtures omit FlowEntry because the original tests lack its metadata),
 *   selection:({kind:'definitions',scopeId}|{kind:'function',functionId}) &
 *             {selector?:string,index?:number},
 *     (optional locator identifies an endpoint's exact sidebar occurrence),
 *   actions:({type:'click',target:{selector,index?}|{role,name,exact?,index?}} |
 *            {type:'resize',viewport} | {type:'write',file,text,analysisKind?} |
 *            {type:'fill',target,value} | {type:'failAnalysis',message} |
 *            {type:'drag',target,offset:{x,y},to:{x,y}})[],
 *     (drag offset is relative to the target box; to is a viewport coordinate),
 *   viewport:{width,height}, panel:{mode:'normal'|'expanded',width,height},
 *     (viewport is initial; panel records final measured inspection geometry.
 *      Expanded projects auto-click the toggle before actions; normal projects
 *      may explicitly expand/collapse in actions. Expanded synthetic cases opt
 *      into the production wrapper class, not a fabricated toggle or input),
 *   svg:'present'|'absent', astExpectation:boolean, limitations:string[],
 *     (astExpectation marks future project AST eligibility, never a claim that
 *      Stage-1 AST goldens already exist; every synthetic case declares false),
 *   artifacts:{development:ArtifactPaths,production:ArtifactPaths}}
 * ArtifactPaths = {capture,svg,html,screenshot}; all paths are repository-relative.
 * SVG absence is a capture result, never permission to skip a missing artifact.
 * inventory.json stores inputRef keys into inputs/catalog.json; this loader
 * resolves them to input objects. It never spawns a compiler or regenerates cases.
 * inputHash hashes canonical JSON of the input. sourceHashes hashes original
 * files byte-for-byte. Case identity and actions are separately hashed by the
 * frozen manifest recorder. loadRenderCases is read-only and asynchronous.
 */
import {readFile, readdir} from 'node:fs/promises';
import {loadMigrations, baselineSource} from '../../../scripts/hir-baseline-migrations.mjs';
import {checkBrowserInventory} from '../../../scripts/update_hir_goldens.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = 'tests/fixtures/flow-rendering';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value === undefined ? null : value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);
const readJSON = async path => JSON.parse(await readFile(resolve(ROOT,path),'utf8'));

export async function loadRenderCases() {
  const inventory = await readJSON(`${FIXTURES}/inventory.json`);
  const inputs = await readJSON(`${FIXTURES}/inputs/catalog.json`);
  await assertInventory(inventory, inputs);
  return inventory.cases.map(case_ => {
    const input = inputs[case_.inputRef];
    const sourceHashes = Object.fromEntries(Object.entries(input.files ?? {}).map(([file,text]) => [file, hash(text)]));
    const provenanceHashes = Object.fromEntries(Object.entries(inventory.sourceHashes).filter(([file]) => case_.provenance.some(origin => file === origin.file || file.startsWith(`${origin.file}/`))));
    return structuredClone({...case_, input, sourceHashes, provenanceHashes});
  });
}

async function assertInventory(inventory, inputs) {
  if (inventory.version !== 1) throw Error('Unsupported flow inventory version');
  const packages = (await readdir(resolve(ROOT,'examples'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  if (canonical(packages) !== canonical(inventory.examples.map(entry=>entry.name).sort())) throw Error('Example package inventory drift: every discovered package needs render coverage');
  const exampleSources = [];
  async function visitExamples(directory) {
    for (const entry of await readdir(resolve(ROOT,directory),{withFileTypes:true})) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visitExamples(path);
      else if (/\.(bal|toml)$/.test(entry.name)) exampleSources.push(path);
    }
  }
  await visitExamples('examples');
  const recordedSources = Object.keys(inventory.sourceHashes).filter(path => path.startsWith('examples/') && /\.(bal|toml)$/.test(path)).sort();
  if (canonical(exampleSources.sort()) !== canonical(recordedSources)) throw Error('Example source inventory drift: new/deleted project input');
  const tests = await discoverTests();
  await assertSuiteInventory(tests, inventory);
  const migrations = loadMigrations(ROOT);
  checkBrowserInventory();
  for (const [file, expected] of Object.entries(inventory.sourceHashes)) {
    const actual = hash(baselineSource(file, expected, ROOT, migrations));
    if (actual !== expected) throw Error(`Flow inventory input drift: ${file}`);
  }
  const ids = new Set();
  for (const case_ of inventory.cases) {
    if (ids.has(case_.id)) throw Error(`Duplicate render case ${case_.id}`);
    ids.add(case_.id);
    const input = inputs[case_.inputRef];
    if (!input || case_.inputHash !== hash(canonical(input))) throw Error(`Render input hash mismatch: ${case_.id}`);
    // Dimensions describe the inspection wrapper, not the viewport or chat grid
    // column. Preserve exact measured fractions; capture asserts them unchanged.
    if (!['normal', 'expanded'].includes(case_.panel?.mode) ||
        ![case_.panel.width, case_.panel.height, case_.viewport?.width, case_.viewport?.height].every(value => Number.isFinite(value) && value > 0)) {
      throw Error(`Missing/invalid explicit wrapper dimensions: ${case_.id}`);
    }
    if (input.kind === 'synthetic' && (!Number.isFinite(input.width) || !Number.isFinite(input.height))) throw Error(`Synthetic wrapper must have fixed dimensions: ${case_.id}`);
    if (input.kind === 'synthetic' && case_.astExpectation !== false) throw Error(`Synthetic input cannot claim AST coverage: ${case_.id}`);
    for (const paths of Object.values(case_.artifacts)) for (const path of Object.values(paths)) if (!path.startsWith(`${FIXTURES}/artifacts/`) || path.includes('..')) throw Error(`Unsafe artifact path: ${path}`);
  }
  for (const suite of inventory.suites) for (const scenario of suite.scenarios) {
    if (scenario.rendering && !scenario.caseIds.length) throw Error(`Uncovered flow scenario: ${suite.file}: ${scenario.name}`);
    if (!scenario.rendering && scenario.caseIds.length) throw Error(`Non-rendering scenario claims render captures: ${suite.file}: ${scenario.name}`);
    for (const id of scenario.caseIds) if (!ids.has(id)) throw Error(`Unknown mapped render case: ${id}`);
  }
  for (const example of inventory.examples) if (!example.caseIds.length || example.caseIds.some(id=>!ids.has(id))) throw Error(`Uncovered example: ${example.name}`);
}

// This registry is deliberately outside the frozen input catalog. Its entries
// are new contract/serialization tests, not additional baseline render coverage.
export async function assertSuiteInventory(tests, inventory) {
  const registry = await readJSON('tests/hir-suite-inventory.json');
  if (registry.version !== 1 || registry.stage !== 'post-baseline' || !Array.isArray(registry.suites)) {
    throw Error('Invalid post-baseline HIR suite registry');
  }
  const baseline = new Set(inventory.suites.map(suite => suite.file));
  const registered = new Set();
  for (const suite of registry.suites) {
    if (typeof suite.file !== 'string' ||
        !/^(?:packages\/compiler\/(?:[a-z0-9_-]+_test\.go|tests\/[a-z0-9_-]+\.test\.mjs)|apps\/editor\/tests\/hir-[a-z0-9_-]+\.test\.mjs)$/.test(suite.file) ||
        suite.rendering !== false || typeof suite.purpose !== 'string' || !suite.purpose.trim() ||
        baseline.has(suite.file) || registered.has(suite.file)) {
      throw Error(`Invalid post-baseline non-rendering suite: ${suite.file}`);
    }
    registered.add(suite.file);
  }
  for (const helper of registry.helpers ?? []) {
    if (typeof helper.file !== 'string' ||
        !/^(?:apps\/editor\/tests\/hir-[a-z0-9-]+\.mjs|packages\/compiler\/tests\/[A-Za-z0-9_-]+\.mjs)$/.test(helper.file) ||
        /\.(?:test|spec)\.mjs$/.test(helper.file) || helper.rendering !== false ||
        typeof helper.purpose !== 'string' || !helper.purpose.trim() ||
        baseline.has(helper.file) || registered.has(helper.file)) throw Error(`Invalid post-baseline test helper: ${helper.file}`);
    registered.add(helper.file);
    await readFile(resolve(ROOT,helper.file));
  }
  const discovered = new Set(tests);
  const missing = [...baseline].filter(file => !discovered.has(file));
  const unknown = tests.filter(file => !baseline.has(file) && !registered.has(file));
  if (missing.length || unknown.length) {
    throw Error(`Test suite inventory drift: missing baseline suites [${missing.join(', ')}]; unregistered suites [${unknown.join(', ')}]. Register new non-rendering HIR suites separately; flow-producing tests need explicit post-baseline coverage, not frozen baseline claims.`);
  }
  // Planned registry entries need not exist yet. Baseline entries must exist,
  // and their original byte hashes are still checked by assertInventory below.
}

async function discoverTests() {
  const found=[];
  async function visit(directory) {
    for (const entry of await readdir(resolve(ROOT,directory),{withFileTypes:true})) {
      if (['node_modules','dist','.git','test-results'].includes(entry.name)) continue;
      const path=`${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (/(?:\.test\.mjs|\.spec\.mjs|_test\.go)$/.test(entry.name) && !path.endsWith('/render-parity.spec.mjs')) found.push(path);
    }
  }
  for (const path of ['apps','packages']) await visit(path);
  return found.sort();
}
