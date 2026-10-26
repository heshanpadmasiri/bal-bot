import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {repositoryRoot as root, digest, loadMigrations, preserveBaselineArchive} from './hir-baseline-migrations.mjs';
import {collectBrowserInventory, assertBrowserRequestsUnchanged} from './update_hir_goldens.mjs';
const registryPath = 'tests/hir-baseline-migrations.json';
const registry = JSON.parse(readFileSync(path.join(root,registryPath)));
function temporary(callback) {
  const directory = mkdtempSync(path.join(tmpdir(),'hir-migrations-'));
  try { return callback(directory); } finally { rmSync(directory,{recursive:true,force:true}); }
}
function copy(directory, file) {
  mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});
  cpSync(path.join(root,file),path.join(directory,file),{recursive:true});
}
function registryFixture(directory) {
  for (const file of [registryPath,'tests/fixtures/flow-rendering/inventory.json','tests/fixtures/hir-projects/source-inventory.json',...registry.files.flatMap(e => [e.file,e.archive])]) copy(directory,file);
}
function update(directory,file,transform) { const p=path.join(directory,file); writeFileSync(p,transform(readFileSync(p,'utf8'))); }
function refreshCurrentDigest(directory,file) {
  update(directory,registryPath,text => {
    const registry=JSON.parse(text); registry.files.find(e => e.file === file).currentSHA256=digest(readFileSync(path.join(directory,file))); return JSON.stringify(registry);
  });
}
test('registration preserves original archives and refuses to repair tampered or missing authority', () => temporary(directory => {
  const archive = path.join(directory, 'nested/original.txt');
  const original = Buffer.from('original baseline bytes\r\n');
  preserveBaselineArchive(archive, original, false);
  preserveBaselineArchive(archive, original, true);
  assert.deepEqual(readFileSync(archive), original);
  assert.throws(() => preserveBaselineArchive(archive, Buffer.from('replacement'), true), /Immutable baseline archive changed/);
  assert.deepEqual(readFileSync(archive), original);
  rmSync(archive);
  assert.throws(() => preserveBaselineArchive(archive, original, true), /Missing immutable baseline archive/);
}));
test('registered historical and current arms both validate', () => temporary(directory => {
  registryFixture(directory); assert.equal(loadMigrations(directory).size,registry.files.length);
}));
test('archive tamper cannot be hidden by a valid live digest', () => temporary(directory => {
  registryFixture(directory); update(directory,registry.files[0].archive,text=>text+'\n'); assert.throws(()=>loadMigrations(directory),/archive tamper/);
}));
test('a current Ballerina input change fails without touching historical authority', () => temporary(directory => {
  registryFixture(directory);
  const file='packages/compiler/evaluation_test.go';
  update(directory,file,text=>{ const changed=text.replace('public function main()', 'public function changed()'); assert.notEqual(changed,text); return changed; });
  assert.throws(()=>loadMigrations(directory),/Current migration digest/);
}));
test('removed active scenario fails even after refreshing its current digest', () => temporary(directory => {
  registryFixture(directory); const file='apps/editor/tests/flow.test.mjs';
  update(directory,file,text=>text.replace("test('library calls render once", "test('REMOVED library calls render once")); refreshCurrentDigest(directory,file);
  assert.throws(()=>loadMigrations(directory),/Unregistered new infrastructure scenario|Removed\/reordered/);
}));
for (const file of ['examples/automation-flow/main.bal','tests/fixtures/flow-rendering/inputs/catalog.json','packages/compiler/tests/native/main.go','apps/editor/tests/connection.test.mjs']) test(`ineligible ${file} never receives archive fallback`, () => temporary(directory => {
  registryFixture(directory); update(directory,registryPath,text=>{ const r=JSON.parse(text);r.files.push({...r.files[0],file});return JSON.stringify(r); });
  assert.throws(()=>loadMigrations(directory),/Ineligible/);
}));
for (const [name, mutate] of [
  ['changed cancellation stress generator size', text=>text.replace('length: 15000','length: 15001')],
  ['changed cancellation stress generator expression', text=>text.replace('value${i} = ${i}', 'value${i} = ${i+1}')],
  ['changed actual compiler request order despite unchanged deduplicated corpus', text=>text.replace('const valid = await compiler.check(initialFiles);', 'const valid = await compiler.check({ ...initialFiles, \'main.bal\': \'public function main() { int x = "bad"; }\' });').replace('const invalid = await compiler.check({ ...initialFiles, \'main.bal\': \'public function main() { int x = "bad"; }\' });', 'const invalid = await compiler.check(initialFiles);')],
  ['changed current compiler source', text=>text.replace('public function main() { int x = "bad"; }','public function main() { int x = "changed"; }')],
]) test(name+' fails the static input arm independently of file digests', () => temporary(directory => {
  copy(directory,'packages/compiler/tests/browser'); copy(directory,'packages/workspace/src/files.ts');
  copy(directory,'tests/hir-suite-inventory.json');
  copy(directory,'tests/fixtures/flow-rendering/inventory.json');
  copy(directory,'packages/compiler/hir_error_constructor_postbaseline_test.go');
  symlinkSync(path.join(root,'examples'),path.join(directory,'examples'),'dir');
  const original=collectBrowserInventory(false,new Map(),directory);
  const file='packages/compiler/tests/browser/compiler.spec.mjs';
  update(directory,file,text=>{const changed=mutate(text);assert.notEqual(changed,text,'negative fixture must change actual source');return changed;});
  assert.throws(()=>assertBrowserRequestsUnchanged(collectBrowserInventory(false,new Map(),directory),original),/Current browser requests/);
}));
