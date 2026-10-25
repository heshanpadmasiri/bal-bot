import {test, expect} from '@playwright/test';

// Executable acceptance cases for the approved XML selection-card design.
// Pending renderer implementation: do not count these as passing feature coverage.
// Keep these separate from the immutable Stage 1 rendering inventory/artifacts.
const cases = [
  {name: 'direct named children', expression: 'catalog/<book>', text: ['Select direct child elements named “book”']},
  {name: 'chained navigation', expression: 'catalog/<book>/<title>', text: ['Select direct child elements named “book”', 'Select direct child elements named “title”']},
  {name: 'descendants exclude the input element itself', expression: 'catalog/**/<book>', text: ['Select descendant elements named “book”, at any depth']},
  {name: 'all child nodes include non-elements', expression: 'catalog/*', text: ['Select all direct child nodes, including text and comments']},
  {name: 'child wildcard selects elements only', expression: 'catalog/<*>', text: ['Select all direct child elements'], absent: ['including text and comments']},
  {name: 'descendant wildcard', expression: 'catalog/**/<*>', text: ['Select all descendant elements']},
  {name: 'name alternatives are not successive traversal steps', expression: 'catalog/<book|magazine>', text: ['Select direct child elements named “book” or “magazine”']},
  {name: 'namespace-qualified name', expression: 'catalog/<p:book>', text: ['p:book'], namespace: 'urn:books'},
  {name: 'namespace wildcard', expression: 'catalog/<p:*>', text: ['p:*'], namespace: 'urn:books'},
  {name: 'default namespace remains distinguishable from no namespace', expression: 'catalog/<book>', declarations: 'xmlns "urn:books";', text: ['“book”'], namespace: 'urn:books'},
  {name: 'standalone name filter keeps the current sequence, not children', expression: 'catalog.<book>', text: ['Keep elements named “book” in the current sequence'], absent: ['Select direct child']},
  {name: 'standalone filter alternatives', expression: 'catalog.<book|magazine>', text: ['Keep elements named “book” or “magazine” in the current sequence']},
  {name: 'standalone wildcard filter keeps elements only', expression: 'catalog.<*>', text: ['Keep all elements in the current sequence'], absent: ['including text and comments']},
  {name: 'standalone namespace filter', expression: 'catalog.<p:book>', text: ['p:book'], namespace: 'urn:books'},
  {name: 'name-filter extension stays inside per-element group', expression: 'catalog/<book>.<book|magazine>', text: ['For each input element:', 'Select direct child elements named “book”', 'Keep elements named “book” or “magazine” in the current sequence', 'Combine results in document order']},
  {name: 'first match uses a human ordinal and zero-based index', expression: 'catalog/<book>[0]', text: ['For each input element:', 'Keep the first match (index 0)', 'Combine results in document order']},
  {name: 'index ten means the eleventh match', expression: 'catalog/<book>[10]', text: ['For each input element:', 'Keep the 11th match (index 10)', 'Combine results in document order'], absent: ['10th match']},
  {name: 'variable index retains source spelling without value inference', expression: 'catalog/<book>[n]', text: ['For each input element:', 'Keep the match at index n (counting from 0)', 'Combine results in document order'], absent: ['11th match', 'first match']},
  {name: 'computed index retains the original expression', expression: 'catalog/<book>[n + 1]', text: ['Keep the match at index n + 1 (counting from 0)']},
  {name: 'negative index is not described as an empty selection', expression: 'catalog/<book>[-1]', text: ['index -1'], absent: ['0th match', 'No matches']},
  {name: 'index after parentheses applies after combining', expression: '(catalog/<book>)[0]', text: ['Select direct child elements named “book”', 'Combine results in document order', 'Keep the first match (index 0)']},
  {name: 'variable index after parentheses applies after combining', expression: '(catalog/<book>)[n]', text: ['Combine results in document order', 'Keep the match at index n (counting from 0)']},
  {name: 'method extension operates within each input element', expression: 'catalog/<book>.children()', text: ['For each input element:', 'children()', 'Combine results in document order']},
  {name: 'mapping method retains its callback without inferring values', expression: 'catalog/<book>.map(e => e)', text: ['For each input element:', 'map(e => e)', 'Combine results in document order']},
  {name: 'predicate filter is not confused with a name filter', expression: 'catalog/<book>.filter(e => true)', text: ['For each input element:', 'filter(e => true)', 'Combine results in document order']},
  {name: 'filter predicate function is not paraphrased or evaluated', expression: 'catalog/<book>.filter(keepBook)', text: ['For each input element:', 'filter(keepBook)', 'Combine results in document order']},
  {name: 'filter then index preserves extension order', expression: 'catalog/<book>.filter(keepBook)[n]', text: ['filter(keepBook)', 'Keep the match at index n (counting from 0)', 'Combine results in document order']},
  {name: 'index then filter preserves extension order', expression: 'catalog/<book>[n].filter(keepBook)', text: ['Keep the match at index n (counting from 0)', 'filter(keepBook)', 'Combine results in document order']},
  {name: 'predicate filter outside navigation operates on combined results', expression: '(catalog/<book>).filter(keepBook)', text: ['Combine results in document order', 'filter(keepBook)']},
];

function filesFor(scenario) {
  return {
    'Ballerina.toml': '[package]\norg = "demo"\nname = "xml_selection"\nversion = "0.1.0"\n',
    'main.bal': `xmlns "urn:books" as p;
${scenario.declarations ?? ''}
function keepBook(xml item) returns boolean { return true; }
public function main() {
    xml catalog = ();
    int n = 10;
    xml selected = ${scenario.expression};
    _ = selected;
}
`,
  };
}

for (const scenario of cases) {
  test(`XML selection: ${scenario.name}`, async ({page}) => {
    test.fixme(true, 'Approved acceptance case; XML selection-card rendering is not implemented yet.');
    await page.goto('/apps/editor/tests/browser/harness.html');
    await page.waitForFunction(() => window.ready && window.mountEditor);
    await page.evaluate(files => window.mountEditor(files), filesFor(scenario));
    await page.waitForFunction(() => ['ready', 'invalid', 'failed'].includes(window.workspace.analysisSnapshot().kind));
    expect(await page.evaluate(() => window.workspace.analysisSnapshot().kind)).toBe('ready');

    // Use the existing source-selection button contract, not a proposed XML CSS class.
    const card = page.getByRole('button', {name: /^Reference Select XML/});
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('From: catalog');
    const content = (await card.innerText()).replace(/\s+/g, ' ');
    let previous = -1;
    for (const fragment of scenario.text) {
      const position = content.indexOf(fragment);
      expect(position, `Missing or reordered recipe step: ${fragment}`).toBeGreaterThan(previous);
      previous = position;
    }
    for (const fragment of scenario.absent ?? []) await expect(card).not.toContainText(fragment);
    await expect(page.locator('.node-limitation')).toHaveCount(0);

    // Selection rules are static: never fabricate a tree, matches, or result counts.
    await expect(card).not.toContainText(/Found \d+|\d+ matches found|No matches/);
    if (scenario.namespace) {
      // Namespace URI must be accessible in the card's enclosing rendered node,
      // either directly or through a native details disclosure.
      const node = card.locator('xpath=ancestor::g[@data-node-kind][1]');
      for (const details of await node.locator('details').all()) {
        await details.evaluate(element => { element.open = true; });
      }
      await expect(node).toContainText(scenario.namespace);
    }
    await card.click();
    await expect(page.locator('.reference-chip')).toHaveCount(1);
    await expect(page.locator('.reference-chip')).toContainText('main.bal:');
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    // The primary prose must not replace the exact source held by the reference.
    expect(await page.evaluate(() => {
      const program = window.workspace.analysisSnapshot().program;
      return Object.values(program.sources).map(source => source.text);
    })).toContain(scenario.expression);
  });
}
