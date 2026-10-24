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
  if (canonical(tests) !== canonical(inventory.suites.map(suite=>suite.file).sort())) throw Error('Test suite inventory drift: update scenario mappings explicitly');
  for (const [file, expected] of Object.entries(inventory.sourceHashes)) {
    const actual = hash(await readFile(resolve(ROOT,file)));
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
