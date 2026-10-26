import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

// Fixture Git commands must never inherit a committing repository's identity,
// even when this suite is run directly from an older, unsanitized hook.
const localVariables = spawnSync('git', ['rev-parse', '--local-env-vars'], {encoding: 'utf8'});
assert.equal(localVariables.status, 0, localVariables.stderr);
const fixtureEnv = {...process.env};
for (const name of localVariables.stdout.trim().split('\n')) delete fixtureEnv[name];

const root = fileURLToPath(new URL('../', import.meta.url));
const {scripts} = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bal-bot-hooks-')));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  assert.equal(spawnSync('git', ['init', dir], {env: fixtureEnv}).status, 0);
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'bin', 'npm'), `#!/bin/sh
printf '%s:%s\\n' "$PWD" "$*" >> "$TEST_LOG"
if [ "\${CHECK_GIT_ENV:-}" = 1 ]; then
  for name in $(git rev-parse --local-env-vars); do
    if printenv "$name" >/dev/null; then
      printf 'Leaked Git variable: %s\\n' "$name" >&2
      exit 18
    fi
  done
  [ "\${GOFLAGS:-}" = '-buildvcs=false' ] || exit 19
fi
if [ "$*" = "$FAIL_COMMAND" ]; then exit 17; fi
`, {mode: 0o755});
  return {
    dir,
    env: {...fixtureEnv, PATH: `${join(dir, 'bin')}:${fixtureEnv.PATH}`, TEST_LOG: join(dir, 'log'), FAIL_COMMAND: ''},
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

test('real commit hooks clear Git-local environment in ordinary and linked worktrees', t => {
  const {dir, env, log} = fixture(t);
  const git = (cwd, ...args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], {
      env: {...env, CHECK_GIT_ENV: '1', GOFLAGS: '-buildvcs=false'}, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return result;
  };
  const commit = cwd => git(cwd, '-c', `core.hooksPath=${join(root, '.githooks')}`,
    '-c', 'user.name=Hook Test', '-c', 'user.email=hooks@example.invalid',
    'commit', '--allow-empty', '-m', 'test: exercise pre-commit environment');
  commit(dir);
  const linked = join(dir, 'linked-worktree');
  git(dir, 'worktree', 'add', '--detach', linked);
  commit(linked);
  assert.deepEqual(log(), [`${dir}:run test:all`, `${linked}:run test:all`]);
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').stdout.trim(), '1');
  assert.equal(git(linked, 'rev-list', '--count', 'HEAD').stdout.trim(), '2');
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
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], {env: fixtureEnv, encoding: 'utf8'});
  const env = {...fixtureEnv, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
  for (let i = 0; i < 2; i++) {
    assert.equal(spawnSync(process.execPath, [installer], {env}).status, 0);
    assert.equal(git('config', '--local', '--get', 'core.hooksPath').stdout.trim(), '.githooks');
  }
  assert.equal(git('config', '--local', 'core.hooksPath', 'custom-hooks').status, 0);
  assert.notEqual(spawnSync(process.execPath, [installer], {env}).status, 0);
  assert.equal(git('config', '--local', '--get', 'core.hooksPath').stdout.trim(), 'custom-hooks');
});
