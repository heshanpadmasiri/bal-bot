import { spawnSync } from 'node:child_process';
import { snapshotMode } from './svg-snapshot.mjs';

const update = snapshotMode(process.argv.slice(2));
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/svg/playwright.config.mjs'], {
  stdio: 'inherit', env: { ...process.env, SVG_SNAPSHOT_UPDATE: update ? '1' : '0' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
