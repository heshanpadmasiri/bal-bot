import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import {join} from 'node:path';
// Retain the existing headless launch configuration as reproducible browser
// parameters, not as a raster-stability requirement. Acceptance compares exact
// isolated SVG and separate HTML/style/wrapper assertions; optional PNG presence,
// bytes and GPU/rasterizer behavior never gate recording, freezing or verification.
// Fonts, browser/runtime and CSS remain pinned for deterministic SVG measurement.
// No page/style/output normalization is applied.
export const browserLaunchOptions = {headless: true, args: [
  '--disable-gpu-rasterization', '--disable-gpu', '--disable-gpu-compositing', '--num-raster-threads=1',
]};
export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
export const json = async path => JSON.parse(await readFile(path, 'utf8'));
export const fontDirectory = 'tests/fixtures/flow-rendering/environment/fonts';
const cssURL = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
const command = (file, args) => execFileSync(file, args, {encoding: 'utf8'}).trim();
export async function prepareFonts(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const entries = {};
    const archive = async url => {
      const response = await context.request.get(url, {headers: {'User-Agent': userAgent}});
      if (!response.ok()) throw Error(`Font archive HTTP ${response.status()}: ${url}`);
      const body = await response.body();
      const sha256 = digest(body);
      entries[url] = {sha256, contentType: response.headers()['content-type']};
      await writeFile(join(fontDirectory, sha256), body);
      return body.toString('utf8');
    };
    await mkdir(fontDirectory, {recursive: true});
    const css = await archive(cssURL);
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(match => match[1]))];
    if (!urls.length) throw Error('Google Fonts response contains no font files');
    for (const url of urls) await archive(url);
    await writeFile(join(fontDirectory, 'lock.json'), JSON.stringify({version: 1, userAgent, entries}, null, 2) + '\n');
  } finally { await context.close(); }
}
export async function loadFonts() {
  let lock;
  try { lock = await json(join(fontDirectory, 'lock.json')); }
  catch (error) { throw Error('Missing font archive. Run --prepare-fonts explicitly before recording.', {cause: error}); }
  if (lock.version !== 1 || !lock.entries[cssURL]) throw Error('Invalid font archive');
  const bodies = new Map();
  for (const [url, entry] of Object.entries(lock.entries)) {
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error(`Invalid font hash: ${url}`);
    const body = await readFile(join(fontDirectory, entry.sha256));
    if (digest(body) !== entry.sha256) throw Error(`Font archive drift: ${url}`);
    bodies.set(url, body);
  }
  return {lock, async install(context, origin) {
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (bodies.has(url)) return route.fulfill({status: 200, contentType: lock.entries[url].contentType, body: bodies.get(url)});
      if (new URL(url).origin === origin) return route.continue();
      throw Error(`Unarchived external request: ${url}`);
    });
  }};
}
async function hashTree(directory, result = {}) {
  let entries;
  try { entries = await readdir(directory, {withFileTypes: true}); }
  catch (error) { if (error.code === 'ENOENT') return result; throw error; }
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await hashTree(path, result);
    else if (entry.isFile()) result[path] = digest(await readFile(path));
  }
  return result;
}
// Fingerprint source inventory/provenance, never generated artifacts or manifests:
// recording those outputs here would make the recording invalidate itself.
// Optional screenshot paths in inventory metadata are harmless provenance; PNG
// contents live outside inputs and are never fingerprinted or required here.
export async function fixtureInputs(root = 'tests/fixtures/flow-rendering') {
  return {
    inventory: digest(await readFile(join(root, 'inventory.json'))),
    archives: await hashTree(join(root, 'inputs')),
  };
}
export async function environment(browser, chromium, fonts) {
  const fontPaths = process.platform === 'darwin'
    ? ['/System/Library/Fonts', '/Library/Fonts', join(os.homedir(), 'Library/Fonts')]
    : ['/usr/share/fonts', '/usr/local/share/fonts', join(os.homedir(), '.fonts'), join(os.homedir(), '.local/share/fonts')];
  const systemFonts = {};
  for (const path of fontPaths) await hashTree(path, systemFonts);
  if (!Object.keys(systemFonts).length) throw Error('No system fonts inventoried: unsupported environment');
  const tracked = command('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const workingTree = {};
  // Include editor entrypoints, configuration and test harness helpers, not
  // only production src: changing capture code after recording must block freeze.
  for (const path of tracked) if (/^(apps\/editor\/|packages\/|scripts\/)|^package(-lock)?\.json$/.test(path)) {
    try { workingTree[path] = digest(await readFile(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const css = await hashTree('apps/editor/src');
  return {
    lock: {
      platform: process.platform, arch: process.arch, osRelease: os.release(), osVersion: os.version(),
      macOS: process.platform === 'darwin' ? command('sw_vers', []) : null,
      node: process.version, nodeBinary: digest(await readFile(process.execPath)),
      python: command('python3', ['--version']), go: command('go', ['version']),
      hostLocale: {LANG: process.env.LANG ?? null, LC_ALL: process.env.LC_ALL ?? null, LC_CTYPE: process.env.LC_CTYPE ?? null},
      playwright: (await json('node_modules/playwright-core/package.json')).version,
      browserVersion: browser.version(), browserBinary: digest(await readFile(chromium.executablePath())),
      browserLaunchOptions,
      lockfile: digest(await readFile('package-lock.json')),
      compilerPin: (await readFile('packages/compiler/go.mod', 'utf8')).split('\n').filter(line => line.includes('ballerina-nutcracker')).join('\n'),
      css: Object.fromEntries(Object.entries(css).filter(([path]) => path.endsWith('.css'))),
      fixtureInputs: await fixtureInputs(),
      fonts: fonts.lock, systemFonts, locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1,
      context: {colorScheme: 'light', reducedMotion: 'no-preference', serviceWorkers: 'block'},
    },
    baseline: {gitRevision: command('git', ['rev-parse', 'HEAD']), workingTree},
  };
}
