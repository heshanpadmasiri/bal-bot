import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function installationId(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'device-id');
  try { await writeFile(path, randomUUID(), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return (await readFile(path, 'utf8')).trim();
}
