import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifySvg } from '../../scripts/svg-snapshot.mjs';

const root = new URL('./', import.meta.url);
const source = await readFile(new URL('fixtures/branch-call.bal', root), 'utf8');
const mono = (await readFile(new URL('fonts/RobotoMono-latin.woff2', root))).toString('base64');
const sans = (await readFile(new URL('fonts/Roboto-latin.woff2', root))).toString('base64');
const fontFaces = [['Snapshot Mono', mono], ['Snapshot Sans', sans], ['JetBrains Mono', mono], ['DM Sans', sans]];
const fontCss = fontFaces.map(([name, data]) => `@font-face{font-family:"${name}";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${data}) format("woff2")}`).join('\n');

async function prepare(page, context) {
  // No network fonts or host font hashes: both named faces and Chromium's generic families are local.
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.setFontFamilies', { fontFamilies: { standard: 'Snapshot Sans', sansSerif: 'Snapshot Sans', serif: 'Snapshot Sans', fixed: 'Snapshot Mono' } });
  await page.goto('./');
  await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
  await page.evaluate(async faces => {
    await Promise.all(faces.map(async ([name, data]) => {
      const face = new FontFace(name, `url(data:font/woff2;base64,${data})`, { weight: '100 900' });
      document.fonts.add(await face.load());
    }));
    await document.fonts.ready;
  }, fontFaces);
  await page.getByLabel('Ballerina source').fill(source);
  await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis', 'ready');
  await expect(page.locator('.flow-entry h2')).toHaveText('demo');
  await expect(page.locator('.flow-diagnostics')).toHaveCount(0);
  await page.mouse.move(0, 0);
}

async function exportSvg(page) {
  return page.locator('svg.diagram').evaluate((svg, fontCss) => {
    const copy = svg.cloneNode(true);
    const originals = [svg, ...svg.querySelectorAll('*')];
    const copies = [copy, ...copy.querySelectorAll('*')];
    // Inline only applicable production CSS declarations, not entire stylesheets or the UI shell.
    // New declarations are discovered automatically; there is no visual-property allowlist.
    const rules = [];
    function collect(sheetRules) {
      for (const rule of sheetRules) {
        if (rule instanceof CSSStyleRule) rules.push(rule);
        else if (rule instanceof CSSMediaRule && matchMedia(rule.conditionText).matches) collect(rule.cssRules);
        else if (rule instanceof CSSSupportsRule && CSS.supports(rule.conditionText)) collect(rule.cssRules);
      }
    }
    for (const sheet of document.styleSheets) collect(sheet.cssRules);
    const inherited = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-synthesis', 'line-height', 'letter-spacing', 'text-align', 'text-rendering', 'white-space'];
    originals.forEach((element, index) => {
      const properties = new Set(inherited);
      for (const rule of rules) if (element.matches(rule.selectorText)) for (const property of rule.style) properties.add(property);
      for (const property of element.style) properties.add(property);
      const computed = getComputedStyle(element);
      const style = copies[index].style;
      style.cssText = '';
      for (const property of [...properties].sort()) {
        let value = computed.getPropertyValue(property);
        // Materialize the controlled Chromium generic-family mapping for standalone SVG viewing.
        if (property === 'font-family' || property === 'font') value = value.replace(/\bmonospace\b/g, '"Snapshot Mono"').replace(/\bsans-serif\b/g, '"Snapshot Sans"');
        style.setProperty(property, value);
      }
    });
    // Export at the renderer's intrinsic vector bounds, not a viewport-scaled screenshot.
    // Preserve production viewBox, width and height verbatim; omit only shell fit/margins.
    for (const property of ['width', 'height', 'max-width', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']) copy.style.removeProperty(property);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    copy.prepend(style);
    return new XMLSerializer().serializeToString(copy) + '\n';
  }, fontCss);
}

for (const expanded of [false, true]) {
  const name = `branch-call-${expanded ? 'expanded' : 'collapsed'}`;
  test(name, async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page, context);
    if (expanded) {
      await page.getByRole('button', { name: /^Expand .*nextValue/ }).click();
      await expect(page.getByRole('button', { name: /^Collapse .*nextValue/ })).toBeVisible();
      await page.mouse.move(0, 0);
    }
    expect(errors).toEqual([]);
    const actual = await exportSvg(page);
    // A second capture must be byte-identical; no volatile-ID normalization is needed today.
    expect(await exportSvg(page)).toBe(actual);
    await verifySvg({ name, actual,
      expectedPath: fileURLToPath(new URL(`fixtures/${name}.svg`, root)),
      resultsDir: fileURLToPath(new URL('../../test-results/svg/', root)),
      update: process.env.SVG_SNAPSHOT_UPDATE === '1',
    });
  });
}
