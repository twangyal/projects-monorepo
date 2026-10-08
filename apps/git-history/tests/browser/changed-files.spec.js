import { test, expect, downloadText, ODD, BEFORE, AFTER, openChanges, discoverChanges, usePath, compareHandoff, exactComparison, holdChanges } from './changed-files-fixtures.js';

function expectedCatalog(fixture, directory = '') {
  return { schema_version: 1, kind: 'changed-file-catalog', repo_name: 'repository', left_requested_ref: 'changes-left', left_revision: fixture.left, right_requested_ref: 'changes-right', right_revision: fixture.right, directory,
    entries: fixture.expected.filter(entry => !directory || entry.path.startsWith(`${directory}/`)), omitted_non_utf8_paths: 0 };
}
const failures = new WeakMap();
test.beforeEach(({ page }) => { const errors = []; failures.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(failures.get(page)).toEqual([]); });

test('explicit discovery produces literal complete endpoint metadata and exact token-free CLI JSON', async ({ page, changes }) => {
  const operations = []; page.on('request', request => { if (request.url().endsWith('/api/jobs')) operations.push(request.postDataJSON().operation); });
  await openChanges(page, changes); expect(operations).toEqual([]); await discoverChanges(page);
  const text = await downloadText(page, '#changes-download-json'); expect(JSON.parse(text)).toEqual(expectedCatalog(changes));
  expect(text).toBe(await changes.cli(['changes', '--left-ref', 'changes-left', '--right-ref', 'changes-right', '--format', 'json']));
  expect(text).not.toContain(new URL(changes.url).hash.slice(9)); expect(text).not.toContain(changes.repo);
  await expect(page.locator('#changes-summary')).toContainText(changes.left); await expect(page.locator('#changes-summary')).toContainText(changes.right);
  expect(operations).toEqual(['changed-files']);
  await expect(page.locator('#changes-table tbody tr')).toHaveCount(17);
  await expect(page.locator('#changes-table script, #changes-table img')).toHaveCount(0); expect(await page.evaluate(() => globalThis.CHANGES_OWNED)).toBeUndefined();
});

test('added deleted present-empty and modified rows explicitly hand off into exact source comparisons', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page); page.on('dialog', dialog => dialog.accept());
  const scenarios = [
    ['added.txt', 'missing', 'whole', '', 'original addition\n', [0, 0, 1]],
    ['deleted.txt', 'whole', 'missing', 'original deletion\n', '', [0, 1, 0]],
    ['empty.txt', 'missing', 'whole', '', '', [0, 0, 0]],
    ['src/edited.txt', 'whole', 'whole', BEFORE, AFTER, [2, 1, 1]],
  ];
  for (const [path, leftKind, rightKind, leftText, rightText, counts] of scenarios) {
    const operations = []; const listen = request => { if (request.url().endsWith('/api/jobs')) operations.push(request.postDataJSON().operation); }; page.on('request', listen);
    await usePath(page, path); expect(operations).toEqual([]); page.off('request', listen);
    for (const [side, pin, mode] of [['left', changes.left, leftKind], ['right', changes.right, rightKind]]) {
      await expect(page.locator(`#${side}-ref`)).toHaveValue(pin); await expect(page.locator(`#${side}-path`)).toHaveValue(JSON.stringify(path)); await expect(page.locator(`#${side}-selection-mode`)).toHaveValue(mode);
    }
    await compareHandoff(page); const { report, html } = await exactComparison(page, changes, path, leftKind, rightKind);
    expect([report.left.source, report.right.source]).toEqual([leftText, rightText]); expect([report.unchanged_lines, report.removed_lines, report.added_lines]).toEqual(counts);
    expect([report.left.status, report.right.status]).toEqual([leftKind === 'missing' ? 'missing' : 'present', rightKind === 'missing' ? 'missing' : 'present']);
    expect(html).not.toMatch(/<script\b|<iframe\b/i);
  }
});

test('symlink and gitlink rows are honest metadata while binary reads and oversized whole selection fail explicitly', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page);
  for (const path of ['link', 'submodule']) {
    await page.locator('#changes-filter').fill(path); const row = page.locator('#changes-table tbody tr'); await expect(row).toHaveCount(1);
    await expect(row).toContainText(path === 'link' ? /symlink|120000/ : /gitlink|160000/); await expect(row.locator('[data-use-change]')).toBeDisabled();
  }
  await usePath(page, 'binary.dat'); await page.locator('#left-open-source').click(); await expect(page.locator('#error')).toContainText(/binary|NUL|text/i);
  await expect(page.locator('#left-selection-mode')).toHaveValue('whole'); await expect(page.locator('#left-missing-status')).not.toContainText('Verified absent'); await expect(page.locator('#compare-button')).toBeDisabled();
  page.on('dialog', dialog => dialog.accept()); await usePath(page, 'utf8-invalid.txt'); await page.locator('#right-open-source').click(); await expect(page.locator('#error')).toContainText(/UTF|encod|text/i); await expect(page.locator('#right-selection-mode')).toHaveValue('whole');
  await usePath(page, 'large.txt');
  for (const side of ['left', 'right']) { await page.locator(`#${side}-open-source`).click(); await expect(page.locator(`#${side}-source-caption`)).toContainText(/201/); await expect(page.locator('#stop-button')).toBeDisabled(); }
  await expect(page.locator('#compare-button')).toBeDisabled(); await expect(page.locator('#comparison-workspace')).toContainText(/200|smaller/);
  for (const side of ['left', 'right']) { await page.locator(`#${side}-selection-mode`).selectOption('lines'); await page.locator(`#${side}-start-line`).fill('2'); await page.locator(`#${side}-end-line`).fill('3'); }
  await page.locator('#compare-button').click(); await expect(page.locator('#comparison-download-json')).toHaveAttribute('href', /^blob:/);
  const report = JSON.parse(await downloadText(page, '#comparison-download-json')); expect([report.left.source, report.right.source]).toEqual(['old 2\nold 3\n', 'new 2\nnew 3\n']);
});

test('literal directory boundary, quoted tab/newline Unicode path and safe DOM remain exact', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page, { directory: 'src' });
  const catalog = JSON.parse(await downloadText(page, '#changes-download-json')); expect(catalog).toEqual(expectedCatalog(changes, 'src'));
  expect(catalog.entries.map(entry => entry.path)).toEqual(['src/edited.txt', ODD]);
  await page.locator('#changes-filter').fill('雪'); await expect(page.locator('#changes-table tbody tr')).toHaveCount(1); await expect(page.locator('#changes-table')).toContainText('\\t'); await expect(page.locator('#changes-table')).toContainText('\\n');
  await expect(page.locator('#changes-table img, #changes-table script')).toHaveCount(0); await page.locator('[data-use-change]').click();
  await expect(page.locator('#left-path')).toHaveValue(JSON.stringify(ODD)); await expect(page.locator('#right-path')).toHaveValue(JSON.stringify(ODD));
  await compareHandoff(page); const { report } = await exactComparison(page, changes, ODD); expect([report.left.source, report.right.source]).toEqual(['literal path old\n', 'literal path new\n']);
});

test.describe('large original metadata catalog', () => {
  test.use({ manyChanges: true });
  test('390px keyboard paging keeps 100 DOM rows and downloads all122 exact entries', async ({ page, changes }, info) => {
    await page.setViewportSize({ width: 390, height: 844 }); await openChanges(page, changes); await discoverChanges(page);
    await expect(page.locator('#changes-table tbody tr')).toHaveCount(100); const firstIndex = await page.locator('#changes-table tbody tr').first().getAttribute('data-change-index'); expect(firstIndex).toBe('0');
    await page.locator('#changes-next').press('Enter'); await expect(page.locator('#changes-table tbody tr')).toHaveCount(22); await expect(page.locator('#changes-next')).toBeDisabled(); await expect(page.locator('#changes-table tbody tr').first()).toHaveAttribute('data-change-index', '100');
    expect(JSON.parse(await downloadText(page, '#changes-download-json'))).toEqual(expectedCatalog(changes));
    await page.locator('#changes-filter').fill('pages/104'); await expect(page.locator('#changes-table tbody tr')).toHaveCount(1); await expect(page.locator('#changes-table')).toContainText('pages/104.txt');
    await page.locator('#changes-filter').fill(''); await page.locator('#changes-status-filter').selectOption('deleted'); await expect(page.locator('#changes-table tbody tr')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('changed-files-mobile.png'), fullPage: true });
  });
});

test('changed-back discovery input preserves native node focus and caret while rejecting a held actual result', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page); const oldRows = await page.locator('#changes-table').textContent();
  const held = await holdChanges(page);
  try {
    await page.locator('#changes-discover').click(); await held.reached;
    const input = page.locator('#changes-left-ref'); await input.fill('changed input'); await input.fill('changes-left'); await input.focus(); await input.evaluate(node => { node.dataset.oracleNode = 'same'; node.setSelectionRange(2, 5); });
    held.release(); await expect(page.locator('#stop-button')).toBeDisabled(); await expect(input).toHaveValue('changes-left'); await expect(input).toHaveAttribute('data-oracle-node', 'same'); await expect(input).toBeFocused(); expect(await input.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
    await expect(page.locator('#changes-stale')).toBeVisible(); await expect(page.locator('#changes-download-json')).not.toHaveAttribute('href', /^blob:/); expect(await page.locator('#changes-table').textContent()).toBe(oldRows);
    for (const control of await page.locator('[data-use-change]').all()) await expect(control).toBeDisabled(); expect(held.operations).toEqual(['changed-files']);
    await page.locator('#changes-discover').click(); await expect(page.locator('#changes-download-json')).toHaveAttribute('href', /^blob:/); expect(JSON.parse(await downloadText(page, '#changes-download-json'))).toEqual(expectedCatalog(changes));
  } finally { held.release(); }
});

test('Stop drains a real delayed202 before the replacement changed-file job and keeps comparison drafts', async ({ page, changes }) => {
  await openChanges(page, changes); await page.locator('#left-path').fill('unsent side <literal>'); await page.locator('#changes-left-ref').fill('changes-left'); await page.locator('#changes-right-ref').fill('changes-right');
  const held = await holdChanges(page, 'accepted');
  try {
    await page.locator('#changes-discover').click(); await held.reached; await page.locator('#stop-button').click(); await page.locator('#changes-directory').fill('src'); await page.locator('#changes-discover').click(); expect(held.operations).toEqual(['changed-files']);
    held.release(); await expect(page.locator('#changes-download-json')).toHaveAttribute('href', /^blob:/); await expect(page.locator('#stop-button')).toBeDisabled(); expect(held.operations).toEqual(['changed-files', 'changed-files']); expect(held.cancellations.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(await downloadText(page, '#changes-download-json'))).toEqual(expectedCatalog(changes, 'src')); await expect(page.locator('#left-path')).toHaveValue('unsent side <literal>');
  } finally { held.release(); }
});

test('handoff confirmation refusal keeps raw selections and completed report; acceptance invalidates without auto-reading', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page); await usePath(page, 'src/edited.txt'); await compareHandoff(page);
  const before = await downloadText(page, '#comparison-download-json'); const raw = await page.locator('#left-path').inputValue(); const right = await page.locator('#right-ref').inputValue();
  let message = ''; page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); }); await usePath(page, 'added.txt');
  expect(message).toContain('added.txt'); expect(message).toContain(changes.left); expect(message).toContain(changes.right); await expect(page.locator('#left-path')).toHaveValue(raw); await expect(page.locator('#right-ref')).toHaveValue(right); expect(await downloadText(page, '#comparison-download-json')).toBe(before);
  const operations = []; page.on('request', request => { if (request.url().endsWith('/api/jobs')) operations.push(request.postDataJSON().operation); });
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-use-change]').click(); await expect(page.locator('#comparison-download-json')).not.toHaveAttribute('href', /^blob:/); await expect(page.locator('#left-selection-mode')).toHaveValue('missing'); expect(operations).toEqual([]);
});

test('captured full revisions survive branch movement, staged edits and dirty worktree without metadata repinning', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page); const original = await downloadText(page, '#changes-download-json');
  await changes.write('src/edited.txt', 'new branch tip never selected\n'); const advanced = await changes.commit('Move only the named branch after catalog completion'); await changes.git('branch', '-f', 'changes-right', advanced);
  await changes.write('src/edited.txt', 'staged bytes not committed\n'); await changes.git('add', '--', 'src/edited.txt'); await changes.write('src/edited.txt', 'dirty bytes not staged\n'); await changes.write('untracked-oracle.txt', 'untracked immutable evidence\n'); const status = await changes.git('status', '--porcelain');
  await usePath(page, 'src/edited.txt'); await compareHandoff(page); const { report } = await exactComparison(page, changes, 'src/edited.txt'); expect([report.left.source, report.right.source]).toEqual([BEFORE, AFTER]); expect([report.left.revision, report.right.revision]).toEqual([changes.left, changes.right]);
  expect(await downloadText(page, '#changes-download-json')).toBe(original); expect(await changes.git('status', '--porcelain')).toBe(status);
});

test('workspace retirement preserves history drafts and prevents stale catalog publication or silent session replay', async ({ page, changes }) => {
  await openChanges(page, changes); await page.locator('#changes-left-ref').fill('changes-left'); await page.locator('#changes-right-ref').fill('changes-right'); const held = await holdChanges(page);
  try {
    await page.locator('#changes-discover').click(); await held.reached; await page.locator('#workspace-mode').selectOption('history'); await page.locator('#ref').fill('history raw draft'); held.release(); await expect(page.locator('#stop-button')).toBeDisabled();
    await page.locator('#workspace-mode').selectOption('comparison'); await expect(page.locator('#changes-left-ref')).toHaveValue('changes-left'); await expect(page.locator('#changes-download-json')).not.toHaveAttribute('href', /^blob:/); expect(held.operations).toEqual(['changed-files']);
    await page.locator('#workspace-mode').selectOption('history'); await expect(page.locator('#ref')).toHaveValue('history raw draft'); expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await page.reload(); await expect(page.locator('#error')).toContainText(/session|terminal|reopen/i); await page.locator('#workspace-mode').selectOption('comparison'); await expect(page.locator('#changes-discover')).toBeDisabled(); expect(held.operations).toEqual(['changed-files']);
  } finally { held.release(); }
});


test('same committed tree yields a valid empty catalog while a missing revision leaves stale evidence and side drafts intact', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page, { left: 'changes-left', right: 'changes-left' });
  const empty = JSON.parse(await downloadText(page, '#changes-download-json'));
  expect(empty).toEqual({ ...expectedCatalog(changes), right_requested_ref: 'changes-left', right_revision: changes.left, entries: [] });
  await expect(page.locator('#changes-table tbody tr')).toHaveCount(0);
  await discoverChanges(page); const rows = await page.locator('#changes-table').textContent(); await page.locator('#right-path').fill('literal unsent comparison path');
  await page.locator('#changes-left-ref').fill('definitely-no-such-original-ref'); await page.locator('#changes-discover').click();
  await expect(page.locator('#error')).toContainText(/revision|resolve|ref|commit/i); await expect(page.locator('#stop-button')).toBeDisabled();
  await expect(page.locator('#changes-download-json')).not.toHaveAttribute('href', /^blob:/); await expect(page.locator('#changes-stale')).toBeVisible();
  expect(await page.locator('#changes-table').textContent()).toBe(rows); await expect(page.locator('#right-path')).toHaveValue('literal unsent comparison path');
});
