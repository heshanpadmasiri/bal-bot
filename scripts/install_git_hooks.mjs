import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => spawnSync('git', args, {cwd, encoding: 'utf8'});

if (git('rev-parse', '--git-dir').status !== 0) {
  console.log('Skipping Git hook installation: not a Git checkout.');
} else {
  const current = git('config', '--get', 'core.hooksPath');
  if (current.status !== 0 && current.status !== 1) {
    throw new Error(current.stderr || 'Could not read core.hooksPath');
  }
  if (current.status === 0 && current.stdout.trim() !== '.githooks') {
    throw new Error('core.hooksPath already points elsewhere; reconcile your hooks before installing .githooks.');
  }
  const result = git('config', '--local', 'core.hooksPath', '.githooks');
  if (result.status !== 0) throw new Error(result.stderr || 'Could not install Git hooks');
  console.log('Git hooks installed from .githooks.');
}
