import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// One server owns this store. Serialize login, refresh and logout together.
export class FileCredentials {
  #queue = Promise.resolve();
  constructor(directory) { this.directory = directory; }
  async #load() {
    try { return JSON.parse(await readFile(join(this.directory, 'auth.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  #locked(fn) {
    const next = this.#queue.then(fn);
    this.#queue = next.catch(() => {});
    return next;
  }
  async #save(data) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temp = join(this.directory, `auth-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
    await rename(temp, join(this.directory, 'auth.json'));
  }
  read(provider) { return this.#locked(async () => (await this.#load())[provider]); }
  list() { return this.#locked(async () => Object.entries(await this.#load()).map(([providerId, value]) => ({ providerId, type: value.type }))); }
  modify(provider, fn) {
    return this.#locked(async () => {
      const data = await this.#load();
      const credential = await fn(data[provider]);
      if (credential !== undefined) { data[provider] = credential; await this.#save(data); }
      return data[provider];
    });
  }
  delete(provider) {
    return this.#locked(async () => { const data = await this.#load(); delete data[provider]; await this.#save(data); });
  }
}

export async function installationId(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'device-id');
  try { await writeFile(path, randomUUID(), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return (await readFile(path, 'utf8')).trim();
}
