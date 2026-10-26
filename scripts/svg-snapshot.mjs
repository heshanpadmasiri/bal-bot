import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function snapshotMode(args, env = process.env) {
  if (args.some(arg => arg !== '--update')) throw new Error('Usage: svg snapshots [--update]');
  const update = args.includes('--update');
  if (update && env.CI && env.CI !== 'false' && env.CI !== '0') {
    throw new Error('SVG baseline updates are blocked in CI. Review and run npm run update:svg locally.');
  }
  return update;
}

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Exact SVG comparison: no coordinate rounding, ID stripping, or whitespace normalization. */
export async function verifySvg({ name, actual, source, expectedPath, resultsDir, update = false, env = process.env }) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unsafe fixture name: ${name}`);
  if (update) {
    snapshotMode(['--update'], env);
    await writeFile(expectedPath, actual);
    await rm(join(resultsDir, name), { recursive: true, force: true });
    return;
  }
  let expected;
  try { expected = await readFile(expectedPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (expected === actual) {
    await rm(join(resultsDir, name), { recursive: true, force: true });
    return;
  }
  const dir = join(resultsDir, name);
  await mkdir(dir, { recursive: true });
  // A missing baseline still produces two inspectable SVGs, with its absence labelled in the report.
  await writeFile(join(dir, 'expected.svg'), expected ?? '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80"><text x="10" y="40">Missing expected SVG</text></svg>\n');
  await writeFile(join(dir, 'actual.svg'), actual);
  if (source !== undefined) await writeFile(join(dir, 'source.bal'), source);
  else await rm(join(dir, 'source.bal'), { force: true });
  const diff = spawnSync('diff', ['-u', 'expected.svg', 'actual.svg'], { cwd: dir, encoding: 'utf8' });
  if (diff.error || diff.status > 1) throw diff.error ?? new Error(diff.stderr);
  const patch = `${expected === undefined ? 'Missing expected baseline.\n' : ''}${diff.stdout}`;
  await writeFile(join(dir, 'diff.patch'), patch);
  const frame = (title, svg) => `<iframe sandbox title="${title}" srcdoc="${escape(svg)}"></iframe>`;
  await writeFile(join(dir, 'diff.html'), `<!doctype html><meta charset="utf-8"><title>${name} SVG diff</title>
<style>body{font:14px sans-serif;margin:20px}main{display:grid;grid-template-columns:repeat(3,minmax(300px,1fr));gap:20px;overflow-x:auto}section{min-width:0}iframe,.source{box-sizing:border-box;width:100%;height:900px;border:1px solid #aaa}.source{margin:0;padding:16px;overflow:auto;white-space:pre;background:#f6f8fa}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>${name}: ${expected === undefined ? 'missing expected baseline' : 'SVG mismatch'}</h1>
<p>Compare at native vector size (scroll each pane); inspect ${source === undefined ? '' : '<a href="source.bal">source.bal</a>, '}<a href="expected.svg">expected.svg</a>, <a href="actual.svg">actual.svg</a>, or <a href="diff.patch">diff.patch</a>.</p>
<main><section><h2>Ballerina source</h2><pre class="source"><code>${escape(source ?? 'Source not supplied.')}</code></pre></section><section><h2>Expected</h2>${frame('Expected SVG', expected ?? '<p>Missing baseline</p>')}</section><section><h2>Actual</h2>${frame('Actual SVG', actual)}</section></main><h2>Exact text diff</h2><pre>${escape(patch)}</pre>\n`);
  throw new Error(`SVG fixture "${name}": ${expected === undefined ? 'missing expected baseline' : 'rendering differs'}. Inspect ${join(dir, 'diff.html')} (expected.svg, actual.svg, diff.patch). If intentional, review then run npm run update:svg.`);
}
