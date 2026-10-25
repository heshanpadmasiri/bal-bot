#!/usr/bin/env node
// Explicit, review-only registration. Never updates frozen authority or outputs.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {repositoryRoot as root, digest, infrastructureProjection, loadMigrations, preserveBaselineArchive, dtoInfrastructure} from './hir-baseline-migrations.mjs';
const read = file => JSON.parse(readFileSync(path.join(root,file)));
const inventory = read('tests/fixtures/hir-projects/source-inventory.json');
const registry = read('tests/hir-baseline-migrations.json');
if (process.argv.length < 3) throw Error('Pass explicit, reviewed changed baseline test paths');
for (const file of process.argv.slice(2)) {
  const kind = inventory.native.some(e => e.file === file) ? 'go' : inventory.browser.some(e => e.file === file && file.endsWith('.spec.mjs')) ? 'browser' : inventory.infrastructure.some(e => e.file === file && dtoInfrastructure.has(file)) ? 'infrastructure' : null;
  if (!kind) throw Error(`Not a migratable baseline test: ${file}`);
  const authority = [...inventory.native,...inventory.browser,...inventory.infrastructure].find(e => e.file === file);
  const original = execFileSync('git',['show',`280850fd:${file}`],{cwd:root});
  const current = readFileSync(path.join(root,file));
  if (digest(original) !== authority.sha256 || digest(original) === digest(current)) throw Error(`Original authority mismatch or unchanged candidate: ${file}`);
  const oldProjection = kind === 'infrastructure' ? infrastructureProjection(original.toString(),file) : null;
  const liveProjection = kind === 'infrastructure' ? infrastructureProjection(current.toString(),file) : null;
  const names = (oldProjection ?? authority.scenarios ?? []).map(s => s.name);
  const entry = {file,kind,originalSHA256:digest(original),archive:`tests/legacy-baseline-sources/${file}.txt`,currentSHA256:digest(current),extraction:{mode:({go:'go-ast-semantic-literal-anchors',browser:'babel-static-requests',infrastructure:'babel-infrastructure-inputs'})[kind],scenarios:names.map(name => ({original:name,current:name}))}};
  if (kind === 'go') entry.extraction.additionalScenarios = [...current.toString().matchAll(/^func (Test\w+)\(/gm)].map(match => match[1]).filter(name => !names.includes(name));
  if (kind === 'infrastructure') {
    entry.extraction.additionalScenarios = liveProjection.filter(s => !names.includes(s.name)).map(s => s.name);
    entry.extraction.syntheticFixtures = Object.fromEntries(liveProjection.filter(s => s.syntheticFixtures.length).map(s => [s.name,s.syntheticFixtures]));
  }
  const prior = registry.files.find(candidate => candidate.file === file);
  if (prior && (prior.originalSHA256 !== entry.originalSHA256 || prior.archive !== entry.archive || prior.kind !== entry.kind)) throw Error(`Immutable migration authority changed: ${file}`);
  preserveBaselineArchive(path.join(root,entry.archive), original, !!prior);
  registry.files = [...registry.files.filter(e => e.file !== file),entry].sort((a,b) => a.file.localeCompare(b.file));
}
writeFileSync(path.join(root,'tests/hir-baseline-migrations.json'),JSON.stringify(registry,null,2)+'\n');
loadMigrations();
console.log('Registered explicit migrations; run native AST and browser inventory proofs before accepting.');
