import { test, expect, openComparison, prepare, pin, source, compare, noDownloads, exportsMatch, target, hash, block,
  LEFT_PATH, RIGHT_PATH, LEFT_SOURCE, RIGHT_SOURCE, PHYSICAL_LEFT, PHYSICAL_RIGHT, holdComparison, downloadText } from './comparison-fixtures.js';
import { openSession } from './fixtures.js';

test('comparison workspace is an explicit independently selectable investigation', async ({ page, workbench }) => {
  await openSession(page, workbench);
  const workspace = page.getByRole('combobox', { name: 'Workspace', exact: true });
  await expect(workspace).toBeVisible({ timeout: 2000 });
  await workspace.selectOption('comparison');
  await expect(page.locator('#comparison-workspace')).toBeVisible();
  await expect(page.getByLabel('Left ref', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Right ref', { exact: true })).toBeVisible();
});

test('literal repeated lines use canonical delete-first ties and byte-identical native downloads', async ({ page, comparison }) => {
  await prepare(page, comparison); await compare(page);
  const { report, html } = await exportsMatch(page, comparison, target(comparison.left, 'repeated.txt'), target(comparison.right, 'repeated.txt'));
  expect(report.kind).toBe('source-comparison'); expect(report.schema_version).toBe(1);
  expect(report.blocks).toEqual([block('change', 0, 1, 0, 0), block('equal', 1, 3, 0, 2), block('change', 3, 3, 2, 3)]);
  expect([report.unchanged_lines, report.removed_lines, report.added_lines]).toEqual([2, 1, 1]);
  expect(report.left.source).toBe('A\nB\nA\n'); expect(report.right.source).toBe('B\nA\nB\n');
  expect(report.left.source_sha256).toBe(hash('A\nB\nA\n'));
  expect(report.right.source_sha256).toBe(hash('B\nA\nB\n'));
  expect(report.left.requested_ref).toBe(comparison.left); expect(report.right.requested_ref).toBe(comparison.right);
  await expect(page.locator('#comparison-lines tbody tr')).toHaveCount(4);
  expect(html).not.toMatch(/<script\b|<iframe\b|<link\b/i);
});

test('chosen renamed functions remain independently pinned through branch movement and dirty source', async ({ page, comparison }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page, comparison, LEFT_PATH, RIGHT_PATH);
  for (const [side, name] of [['left', 'amount'], ['right', 'total']]) {
    await page.locator(`#${side}-functions-button`).click();
    const item = page.locator(`#${side}-function-list li`).filter({ hasText: name });
    await item.getByRole('button', { name: 'Select function', exact: true }).click();
    await expect(page.locator(`#${side}-selection-mode`)).toHaveValue('function');
  }
  await comparison.write(RIGHT_PATH, RIGHT_SOURCE.replace('value + 2', 'value + 999'));
  const advanced = await comparison.commit('Advance after both explicit pins');
  await comparison.git('branch', '-f', 'compare-right', advanced);
  await comparison.write(RIGHT_PATH, 'DIRTY SOURCE MUST NOT APPEAR\n');
  const dirty = await comparison.git('status', '--porcelain');
  await compare(page);
  const { report, html } = await exportsMatch(page, comparison,
    target(comparison.left, LEFT_PATH, { kind: 'function', function: 'amount' }),
    target(comparison.right, RIGHT_PATH, { kind: 'function', function: 'total' }));
  expect(report.left.source).toBe(LEFT_SOURCE.slice(LEFT_SOURCE.indexOf('def ')));
  expect(report.right.source).toBe(RIGHT_SOURCE.slice(RIGHT_SOURCE.indexOf('def ')));
  expect([report.left.start_line, report.left.end_line, report.right.start_line, report.right.end_line]).toEqual([2, 4, 2, 4]);
  expect([report.unchanged_lines, report.removed_lines, report.added_lines]).toEqual([1, 2, 2]);
  expect([report.left.selected_function, report.right.selected_function]).toEqual(['amount', 'total']);
  await expect(page.locator('#left-revision')).toContainText(comparison.left);
  await expect(page.locator('#right-revision')).toContainText(comparison.right);
  await expect(page.locator('#comparison-lines')).toContainText('<script>globalThis.COMPARISON_OWNED=1</script>');
  await expect(page.locator('#comparison-lines script, #comparison-lines img')).toHaveCount(0);
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  const portable = await page.context().newPage();
  await portable.setContent(html);
  expect(await portable.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.hash.slice(1)).filter(id => !document.getElementById(id)))).toEqual([]);
  expect(await portable.evaluate(() => globalThis.COMPARISON_OWNED)).toBeUndefined(); await portable.close();
  expect(await comparison.git('status', '--porcelain')).toBe(dirty); expect(errors).toEqual([]);
});

test('physical LF tokenization preserves BOM CRLF Unicode separators and missing final newline', async ({ page, comparison }) => {
  await prepare(page, comparison, 'physical.txt');
  await expect(page.locator('#left-source-lines tbody tr')).toHaveCount(3);
  await compare(page);
  const { report } = await exportsMatch(page, comparison, target(comparison.left, 'physical.txt'), target(comparison.right, 'physical.txt'));
  expect(report.left.source).toBe(PHYSICAL_LEFT); expect(report.right.source).toBe(PHYSICAL_RIGHT);
  expect(report.left.source_sha256).toBe(hash(PHYSICAL_LEFT)); expect(report.right.source_sha256).toBe(hash(PHYSICAL_RIGHT));
  expect(report.blocks).toEqual([block('change', 0, 1, 0, 1), block('equal', 1, 2, 1, 2), block('change', 2, 3, 2, 3)]);
  expect([report.unchanged_lines, report.removed_lines, report.added_lines]).toEqual([1, 2, 2]);
  await expect(page.locator('#comparison-lines')).toContainText(/CRLF|LF|newline/i);
});

test('explicit verified absence differs from a present empty file and failed binary read', async ({ page, comparison }) => {
  await openComparison(page, comparison); await pin(page, 'left', 'compare-left'); await pin(page, 'right', 'compare-right');
  await page.locator('#left-path').fill('added.txt'); await page.locator('#left-selection-mode').selectOption('missing');
  await expect(page.locator('#left-missing-status')).toContainText('Verification pending');
  await source(page, 'right', 'added.txt'); await compare(page);
  let result = await exportsMatch(page, comparison, target(comparison.left, 'added.txt', { kind: 'missing' }), target(comparison.right, 'added.txt'));
  expect(result.report.left.status).toBe('missing'); expect(result.report.left.source_sha256).toBeNull();
  expect(result.report.blocks).toEqual([block('change', 0, 0, 0, 1)]);
  await expect(page.locator('#left-missing-status')).toContainText('Verified absent at pinned revision');
  await source(page, 'left', 'empty.txt'); await page.locator('#left-selection-mode').selectOption('whole');
  await source(page, 'right', 'empty.txt'); await compare(page);
  result = await exportsMatch(page, comparison, target(comparison.left, 'empty.txt'), target(comparison.right, 'empty.txt'));
  expect(result.report.left.status).toBe('present'); expect(result.report.left.source_sha256).toBe(hash(''));
  expect(result.report.left.start_line).toBeNull(); expect(result.report.blocks).toEqual([]);
  await page.locator('#left-selection-mode').selectOption('missing'); await page.locator('#compare-button').click();
  await expect(page.locator('#error')).toContainText(/exist|present|missing|absen/i); await noDownloads(page);
  await page.locator('#left-path').fill('binary.txt'); await page.locator('#left-open-source').click();
  await expect(page.locator('#error')).toContainText(/binary|NUL|text/i);
  await expect(page.locator('#left-missing-status')).not.toContainText('Verified absent');
  await page.locator('#left-selection-mode').selectOption('missing'); await page.locator('#compare-button').click();
  await expect(page.locator('#error')).toContainText(/binary|NUL|text|exist|present/i); await noDownloads(page);
  await expect(page.locator('#left-path')).toHaveValue('binary.txt');
});

test('deletion is selected explicitly and never inferred from a missing source request', async ({ page, comparison }) => {
  await openComparison(page, comparison); await pin(page, 'left', 'compare-left'); await pin(page, 'right', 'compare-right');
  await source(page, 'left', 'gone.txt');
  await page.locator('#right-path').fill('gone.txt'); await page.locator('#right-open-source').click();
  await expect(page.locator('#error')).toContainText(/exist|found|absen|missing/i);
  await expect(page.locator('#right-selection-mode')).toHaveValue('whole');
  await expect(page.locator('#compare-button')).toBeDisabled();
  await page.locator('#right-selection-mode').selectOption('missing'); await compare(page);
  const { report } = await exportsMatch(page, comparison, target(comparison.left, 'gone.txt'), target(comparison.right, 'gone.txt', { kind: 'missing' }));
  expect([report.unchanged_lines, report.removed_lines, report.added_lines]).toEqual([0, 1, 0]);
  expect(report.blocks).toEqual([block('change', 0, 1, 0, 0)]);
});

test('200 selected lines paginate natively and whole 201-line files require an explicit smaller selection', async ({ page, comparison }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await prepare(page, comparison, 'large.txt');
  await expect(page.locator('#compare-button')).toBeDisabled();
  await expect(page.locator('#comparison-workspace')).toContainText(/200|smaller/);
  for (const side of ['left', 'right']) {
    await expect(page.locator(`#${side}-source-lines tbody tr`)).toHaveCount(100);
    await page.locator(`#${side}-selection-mode`).selectOption('lines');
    await page.locator(`#${side}-start-line`).fill('2'); await page.locator(`#${side}-end-line`).fill('201');
  }
  await page.locator('#compare-button').press('Enter'); await expect(page.locator('#comparison-download-json')).toHaveAttribute('href', /^blob:/);
  await expect(page.locator('#comparison-lines tbody tr')).toHaveCount(100);
  await page.locator('#comparison-next').press('Enter'); await expect(page.locator('#comparison-lines tbody tr')).toHaveCount(100);
  await expect(page.locator('#comparison-lines')).toContainText('left 102');
  await expect(page.locator('#comparison-lines')).toContainText('right 201');
  await expect(page.locator('#comparison-next')).toBeDisabled();
  const selection = { kind: 'lines', start: 2, end: 201 };
  const { report } = await exportsMatch(page, comparison, target(comparison.left, 'large.txt', selection), target(comparison.right, 'large.txt', selection));
  expect(report.blocks).toEqual([block('change', 0, 200, 0, 200)]);
  expect([report.unchanged_lines, report.removed_lines, report.added_lines]).toEqual([0, 200, 200]);
  expect([report.left.start_line, report.left.end_line]).toEqual([2, 201]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('comparison-mobile.png'), fullPage: true });
});

test('input-only invalid range supersedes a genuinely completed response without changing either pin or focus', async ({ page, comparison }) => {
  await prepare(page, comparison); await compare(page); const oldRows = await page.locator('#comparison-lines').textContent();
  await page.locator('#left-selection-mode').selectOption('lines'); await page.locator('#left-start-line').fill('1'); await page.locator('#left-end-line').fill('3');
  const held = await holdComparison(page); await page.locator('#compare-button').click(); await held.reached;
  const end = page.locator('#left-end-line'); await end.fill(''); await expect(end).toBeFocused();
  held.release(); await expect(page.locator('#stop-button')).toBeDisabled();
  await expect(end).toHaveValue(''); await expect(end).toBeFocused(); await noDownloads(page);
  await expect(page.locator('#left-revision')).toContainText(comparison.left); await expect(page.locator('#right-revision')).toContainText(comparison.right);
  await expect(page.locator('#comparison-stale')).toBeVisible(); expect(await page.locator('#comparison-lines').textContent()).toBe(oldRows);
  expect(held.operations).toEqual(['comparison']);
  await end.fill('2'); await compare(page);
  const { report } = await exportsMatch(page, comparison, target(comparison.left, 'repeated.txt', { kind: 'lines', start: 1, end: 2 }), target(comparison.right, 'repeated.txt'));
  expect(report.left.source).toBe('A\nB\n');
});

test('Stop while real 202 delivery is delayed joins the old job before a replacement and preserves independent drafts', async ({ page, comparison }) => {
  await prepare(page, comparison); const held = await holdComparison(page, 'accepted');
  await page.locator('#compare-button').click(); await held.reached;
  await page.locator('#stop-button').click();
  await page.locator('#left-path').fill('physical.txt');
  await page.locator('#left-open-source').click();
  expect(held.operations).toEqual(['comparison']);
  held.release(); await expect(page.locator('#left-source-lines')).toContainText('separator'); await expect(page.locator('#stop-button')).toBeDisabled();
  expect(held.operations).toEqual(['comparison', 'source']);
  await expect(page.locator('#left-path')).toHaveValue('physical.txt');
  await expect(page.locator('#right-path')).toHaveValue(JSON.stringify('repeated.txt'));
  await expect(page.locator('#right-revision')).toContainText(comparison.right); await noDownloads(page);
  await compare(page); const json = JSON.parse(await downloadText(page, '#comparison-download-json'));
  expect(json.left.source).toBe(PHYSICAL_LEFT); expect(json.right.source).toBe('B\nA\nB\n');
});

test('workspace changes cancel publication without automatic work or resetting either workspace drafts', async ({ page, comparison }) => {
  await prepare(page, comparison); const held = await holdComparison(page); await page.locator('#compare-button').click(); await held.reached;
  await page.locator('#workspace-mode').selectOption('history'); await page.locator('#ref').fill('untouched history draft');
  held.release(); await expect(page.locator('#stop-button')).toBeDisabled(); expect(held.operations).toEqual(['comparison']);
  await page.locator('#workspace-mode').selectOption('comparison');
  await expect(page.locator('#left-path')).toHaveValue(JSON.stringify('repeated.txt'));
  await expect(page.locator('#right-revision')).toContainText(comparison.right); await noDownloads(page);
  await page.locator('#left-ref').fill('new input-only ref');
  await expect(page.locator('#left-revision')).not.toContainText(comparison.left);
  await expect(page.locator('#right-revision')).toContainText(comparison.right);
  await page.locator('#workspace-mode').selectOption('history'); await expect(page.locator('#ref')).toHaveValue('untouched history draft');
  expect(held.operations).toEqual(['comparison']);
});

test('lost acceptance is not replayed and session capability never persists across reload', async ({ page, comparison }) => {
  await prepare(page, comparison); let accepted = 0;
  await page.route('**/api/jobs', async route => {
    await route.fetch(); accepted++; await route.abort('failed');
  });
  await page.locator('#compare-button').click(); await expect(page.locator('#error')).toContainText(/lost|cleanup|terminal|reopen/i);
  await expect(page.locator('#compare-button')).toBeDisabled(); await noDownloads(page); expect(accepted).toBe(1);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.evaluate(() => location.hash)).toBe('');
  const requests = []; page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.reload(); await expect(page.locator('#error')).toContainText(/session|terminal|reopen/i);
  await page.locator('#workspace-mode').selectOption('comparison'); await expect(page.locator('#compare-button')).toBeDisabled();
  await noDownloads(page); expect(requests).toEqual([]); expect(accepted).toBe(1);
});

test.describe('manual comparison with actual optional-parser dependency failure', () => {
  test.use({ missingNative: true });
  test('a missing native grammar never prevents exact manual source comparison', async ({ page, comparison }) => {
    await prepare(page, comparison, 'optional.ts'); await page.locator('#left-functions-button').click();
    await expect(page.locator('#error')).toContainText(/dependencies|extra|install/i);
    for (const side of ['left', 'right']) {
      await page.locator(`#${side}-selection-mode`).selectOption('lines');
      await page.locator(`#${side}-start-line`).fill('2'); await page.locator(`#${side}-end-line`).fill('2');
    }
    await compare(page); const selection = { kind: 'lines', start: 2, end: 2 };
    const { report } = await exportsMatch(page, comparison, target(comparison.left, 'optional.ts', selection), target(comparison.right, 'optional.ts', selection));
    expect(report.left.source).toBe('  return 1;\n'); expect(report.right.source).toBe('  return 2;\n');
    expect([report.unchanged_lines, report.removed_lines, report.added_lines]).toEqual([0, 1, 1]);
  });
});
