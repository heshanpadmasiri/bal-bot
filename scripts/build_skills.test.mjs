import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { generateSkills, parseSkill } from './build_skills.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const markdown = (name, body = '# Instructions\n\nKeep **all** this text.\n') => `---\nname: ${name}\ndescription: Use when testing skills.\n---\n${body}`;

async function fixture(run) {
  const directory = await mkdtemp(resolve(tmpdir(), 'bal-bot-skills-'));
  try {
    const source = resolve(directory, 'skills');
    const output = resolve(directory, 'generated/skills.ts');
    await mkdir(source);
    await run({ directory, source, output });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('skill frontmatter validates names, descriptions, YAML and bodies', () => {
  const body = '# Heading\r\n\r\n```bal\r\n// exact\r\n```\r\n';
  assert.equal(parseSkill('sample.md', markdown('sample', body)).instructions, body);
  for (const [file, input, reason] of [
    ['sample.md', '# No metadata', /frontmatter/],
    ['sample.md', markdown('different'), /filename stem/],
    ['sample.md', markdown('../sample'), /identifier/],
    ['sample.md', markdown('sample').replace('Use when testing skills.', '""'), /description/],
    ['sample.md', markdown('sample').replace('description: Use when testing skills.\n', ''), /description/],
    ['sample.md', markdown('sample').replace('name: sample', 'name: [broken'), /Invalid YAML/],
    ['sample.md', markdown('sample').replace('name: sample', 'name: sample\nname: sample'), /Invalid YAML/],
    ['sample.md', markdown('sample', ' \n'), /instructions/],
  ]) assert.throws(() => parseSkill(file, input), reason);
});

test('generation supports empty catalogs and deterministic sorted Markdown discovery', async () => fixture(async ({ source, output }) => {
  assert.deepEqual(await generateSkills(source, output), []);
  await writeFile(resolve(source, 'z-last.md'), markdown('z-last'));
  await writeFile(resolve(source, 'a-first.md'), markdown('a-first'));
  await writeFile(resolve(source, '.gitkeep'), '');
  assert.deepEqual((await generateSkills(source, output)).map(skill => skill.name), ['a-first', 'z-last']);
  const before = await readFile(output, 'utf8');
  await generateSkills(source, output);
  assert.equal(await readFile(output, 'utf8'), before);
  await writeFile(resolve(source, 'bad.md'), markdown('wrong'));
  await assert.rejects(generateSkills(source, output), /bad.md:.*filename stem/);
  assert.equal(await readFile(output, 'utf8'), before, 'invalid catalog must not partially overwrite output');
}));

test('bundled skill lookup, agent prompt and tool use work without runtime skill files', async () => fixture(async ({ directory, source, output }) => {
  const body = '# Private instruction body\n\nPreserve this entire body.\n';
  await writeFile(resolve(source, 'sample.md'), markdown('sample', body));
  await generateSkills(source, output);
  await writeFile(resolve(directory, 'package.json'), '{"type":"module"}');
  await symlink(resolve(root, 'node_modules'), resolve(directory, 'node_modules'), 'dir');
  await writeFile(resolve(directory, 'skills.ts'), await readFile(resolve(root, 'packages/browser-workspace/src/skills.ts'), 'utf8'));
  const agentSource = (await readFile(resolve(root, 'packages/browser-workspace/src/agent.ts'), 'utf8'))
    .replace("'./compaction.ts'", JSON.stringify(pathToFileURL(resolve(root, 'packages/browser-workspace/src/compaction.ts')).href));
  await writeFile(resolve(directory, 'agent.ts'), agentSource);
  await rm(source, { recursive: true });
  const { readSkill, skillCatalogPrompt } = await import(pathToFileURL(resolve(directory, 'skills.ts')));
  assert.equal(readSkill('sample').instructions, body);
  assert.throws(() => readSkill('../sample'), /Unknown built-in skill/);
  assert.throws(() => readSkill('toString'), /Unknown built-in skill/);
  assert.match(skillCatalogPrompt(), /sample/);
  assert.match(skillCatalogPrompt(), /Use when testing skills/);
  assert.doesNotMatch(skillCatalogPrompt(), /Private instruction body/);
  const { workspaceTools, createWorkspaceAgent } = await import(pathToFileURL(resolve(directory, 'agent.ts')));
  const { BrowserWorkspace } = await import('../packages/browser-workspace/src/workspace.ts');
  const workspace = new BrowserWorkspace({ getItem: () => null, setItem: () => {} });
  const tool = workspaceTools(workspace).find(tool => tool.name === 'read_skill');
  assert.deepEqual(await tool.execute('test', { name: 'sample' }), {
    content: [{ type: 'text', text: body }], details: { skillName: 'sample' },
  });
  await assert.rejects(tool.execute('test', { name: 'sample' }, AbortSignal.abort()));
  await assert.rejects(tool.execute('test', { name: 'unknown' }), /Unknown built-in skill/);
  workspace.write('sample.md', 'Untrusted replacement');
  workspace.write('user-skill.md', markdown('user-skill'));
  assert.equal((await tool.execute('test', { name: 'sample' })).content[0].text, body);
  await assert.rejects(tool.execute('test', { name: 'user-skill' }), /Unknown built-in skill/);
  const agent = createWorkspaceAgent(workspace, undefined, () => { throw new Error('No model call expected'); }, { id: 'test', kind: 'automation', title: 'Test', source: {} });
  assert.match(agent.state.systemPrompt, /Automatically select relevant skills/);
  assert.doesNotMatch(agent.state.systemPrompt, /Private instruction body/);
  // Exercise the same browser bundler as production, after removing the .md source.
  await writeFile(resolve(directory, 'entry.ts'), `import { workspaceTools } from './agent.ts';\nimport { skillCatalogPrompt } from './skills.ts';\nglobalThis.skillSmoke = { tools: workspaceTools({}), catalog: skillCatalogPrompt() };\n`);
  const { build } = await import('vite');
  const bundle = await build({ configFile: false, root: directory, logLevel: 'silent', build: {
    write: false, minify: false, lib: { entry: resolve(directory, 'entry.ts'), formats: ['es'] },
  } });
  const code = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output)
    .filter(output => output.type === 'chunk').map(output => output.code).join('\n');
  assert.match(code, /Private instruction body/);
  assert.match(code, /read_skill/);
  assert.doesNotMatch(code, /node:fs|parseDocument|build_skills\.mjs/);
}));
