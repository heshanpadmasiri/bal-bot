import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const {scripts} = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bal-bot-hooks-')));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  assert.equal(spawnSync('git', ['init', dir]).status, 0);
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'bin', 'npm'), `#!/bin/sh
printf '%s:%s\\n' "$PWD" "$*" >> "$TEST_LOG"
if [ "$*" = "$FAIL_COMMAND" ]; then exit 17; fi
`, {mode: 0o755});
  return {
    dir,
    env: {...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, TEST_LOG: join(dir, 'log'), FAIL_COMMAND: ''},
    log: () => readFileSync(join(dir, 'log'), 'utf8').trim().split('\n'),
  };
}

test('pre-commit runs the full gate from the repository root and propagates failures', t => {
  const {dir, env, log} = fixture(t);
  for (const fail of ['', 'run test:all']) {
    const result = spawnSync(join(root, '.githooks/pre-commit'), [], {
      cwd: join(dir, 'nested'), env: {...env, FAIL_COMMAND: fail},
    });
    assert.equal(result.status, fail ? 17 : 0);
  }
  assert.deepEqual(log(), [`${dir}:run test:all`, `${dir}:run test:all`]);
});

test('test:all runs every suite and stops on each failure', t => {
  const {dir, env, log} = fixture(t);
  const commands = ['test', 'run test:scripts', 'run test:compiler', 'run test:browser', 'run test:playground:browser', 'run test:svg'];
  for (const fail of ['', ...commands]) {
    writeFileSync(env.TEST_LOG, '');
    const result = spawnSync('sh', ['-c', scripts['test:all']], {
      cwd: dir, env: {...env, FAIL_COMMAND: fail},
    });
    assert.equal(result.status, fail ? 17 : 0);
    const expected = fail ? commands.slice(0, commands.indexOf(fail) + 1) : commands;
    assert.deepEqual(log(), expected.map(command => `${dir}:${command}`));
  }
});

test('installer configures local hooks, is repeatable, and protects custom hooks', t => {
  const {dir} = fixture(t);
  mkdirSync(join(dir, 'scripts'));
  const installer = join(dir, 'scripts/install_git_hooks.mjs');
  copyFileSync(join(root, 'scripts/install_git_hooks.mjs'), installer);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], {encoding: 'utf8'});
  const env = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
  for (let i = 0; i < 2; i++) {
    assert.equal(spawnSync(process.execPath, [installer], {env}).status, 0);
    assert.equal(git('config', '--local', '--get', 'core.hooksPath').stdout.trim(), '.githooks');
  }
  assert.equal(git('config', '--local', 'core.hooksPath', 'custom-hooks').status, 0);
  assert.notEqual(spawnSync(process.execPath, [installer], {env}).status, 0);
  assert.equal(git('config', '--local', '--get', 'core.hooksPath').stdout.trim(), 'custom-hooks');
});
