import { test, expect, downloadText, ODD, AFTER, openChanges, discoverChanges } from './changed-files-fixtures.js';

async function inspect(page, path, side) {
  await page.locator('#changes-filter').fill(path === ODD ? '雪' : path);
  const row = page.locator('#changes-table tbody tr');
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: `Inspect ${side} history`, exact: true }).click();
  await expect(page.locator('#workspace-mode')).toHaveValue('history');
  await expect(page.locator('#source-caption')).toContainText('physical lines');
  await expect(page.locator('#stop-button')).toBeDisabled();
}

test('changed-file investigation uses captured source and exports exact CLI evidence after ref movement', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page);
  await changes.write('src/edited.txt', 'a later branch value never selected\n');
  const advanced = await changes.commit('Advance branch after discovery'); await changes.git('branch', '-f', 'changes-right', advanced);
  await changes.write('src/edited.txt', 'staged bytes never selected\n'); await changes.git('add', '--', 'src/edited.txt');
  await changes.write('src/edited.txt', 'dirty bytes never selected\n'); const status = await changes.git('status', '--porcelain');
  const operations = []; page.on('request', request => { if (request.url().endsWith('/api/jobs')) operations.push(request.postDataJSON()); });
  await inspect(page, 'src/edited.txt', 'right');
  await expect(page.locator('#ref')).toHaveValue(changes.right); await expect(page.locator('#path')).toHaveValue(JSON.stringify('src/edited.txt'));
  expect(operations.map(job => job.operation)).toEqual(['source']); expect(operations[0].args).toEqual({ revision: changes.right, path: 'src/edited.txt' });
  await expect(page.locator('#source-lines')).toContainText('new & literal'); await expect(page.locator('#source-lines')).not.toContainText('never selected');
  await page.locator('#end-line').fill('3'); await page.locator('#generate-report').click();
  await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/);
  for (const format of ['json', 'html']) {
    const actual = await downloadText(page, `#download-${format}`);
    expect(actual).toBe(await changes.cli(['explain', '--ref', changes.right, '--file', 'src/edited.txt', '--lines', '1:3', '--format', format]));
    if (format === 'json') { const report = JSON.parse(actual); expect(report.source).toBe(AFTER); expect(report.revision).toBe(changes.right); expect(report.blame).toHaveLength(3); }
  }
  expect(await changes.git('status', '--porcelain')).toBe(status);
});

test('deleted left source and literal control-character paths remain inspectable; absent and special endpoints do not open', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page);
  for (const [path, disabled] of [['deleted.txt', ['right']], ['added.txt', ['left']], ['submodule', ['left', 'right']], ['link', ['left']]]) {
    await page.locator('#changes-filter').fill(path); const row = page.locator('#changes-table tbody tr'); await expect(row).toHaveCount(1);
    for (const side of disabled) await expect(row.getByRole('button', { name: `Inspect ${side} history`, exact: true })).toBeDisabled();
  }
  await inspect(page, 'deleted.txt', 'left'); await expect(page.locator('#ref')).toHaveValue(changes.left);
  await expect(page.locator('#source-lines')).toContainText('original deletion'); await page.locator('#generate-report').click();
  await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/);
  const deleted = JSON.parse(await downloadText(page, '#download-json')); expect(deleted.source).toBe('original deletion\n'); expect(deleted.revision).toBe(changes.left);
  await page.locator('#workspace-mode').selectOption('comparison'); await discoverChanges(page);
  page.once('dialog', dialog => dialog.accept()); await inspect(page, ODD, 'left');
  await expect(page.locator('#path')).toHaveValue(JSON.stringify(ODD)); await expect(page.locator('#source-lines')).toContainText('literal path old');
  await page.locator('#generate-report').click(); await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/);
  const literal = JSON.parse(await downloadText(page, '#download-json')); expect(literal.path).toBe(ODD); expect(literal.source).toBe('literal path old\n');
  expect(await page.evaluate(() => globalThis.OWNED)).toBeUndefined();
});

test('replacement refusal preserves history and context drafts; acceptance keeps discussion fields and comparison selections', async ({ page, changes }) => {
  await openChanges(page, changes); await page.locator('#workspace-mode').selectOption('history');
  await page.locator('#ref').fill('raw history revision'); await page.locator('#path').fill('raw history path');
  await page.locator('#context-mode').selectOption('authored'); await page.locator('#discussion-title').fill('unsaved supplied discussion');
  await page.locator('#workspace-mode').selectOption('comparison'); await page.locator('#left-path').fill('retained comparison draft'); await discoverChanges(page);
  await page.locator('#changes-filter').fill('src/edited.txt');
  const button = page.getByRole('button', { name: 'Inspect right history', exact: true });
  const jobs = []; page.on('request', request => { if (request.url().endsWith('/api/jobs')) jobs.push(request.postDataJSON().operation); });
  page.once('dialog', dialog => dialog.dismiss()); await button.click(); await expect(page.locator('#workspace-mode')).toHaveValue('comparison'); expect(jobs).toEqual([]);
  await expect(page.locator('#ref')).toHaveValue('raw history revision'); await expect(page.locator('#path')).toHaveValue('raw history path');
  await expect(page.locator('#changes-download-json')).toHaveAttribute('href', /^blob:/);
  page.once('dialog', dialog => dialog.accept()); await button.click(); await expect(page.locator('#source-caption')).toContainText('physical lines');
  await expect(page.locator('#discussion-title')).toHaveValue('unsaved supplied discussion'); await expect(page.locator('#context-mode')).toHaveValue('authored');
  await expect(page.locator('#left-path')).toHaveValue('retained comparison draft'); expect(jobs).toEqual(['source']);
  await page.locator('#workspace-mode').selectOption('comparison');
  for (const old of await page.locator('[data-history-side]').all()) await expect(old).toBeDisabled();
});

test('candidate decoding errors stay explicit and a 201-line file supports bounded history selection on mobile', async ({ page, changes }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openChanges(page, changes); await discoverChanges(page);
  await page.locator('#changes-filter').fill('binary.dat'); await page.getByRole('button', { name: 'Inspect right history', exact: true }).click();
  await expect(page.locator('#error')).toContainText(/binary|NUL/); await expect(page.locator('#ref')).toHaveValue(changes.right); await expect(page.locator('#generate-report')).toBeDisabled();
  await page.locator('#workspace-mode').selectOption('comparison'); await discoverChanges(page);
  page.once('dialog', dialog => dialog.accept()); await inspect(page, 'large.txt', 'right');
  await expect(page.locator('#source-caption')).toContainText('201'); await page.locator('#start-line').fill('2'); await page.locator('#end-line').fill('3');
  await page.locator('#generate-report').click(); await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/);
  const report = JSON.parse(await downloadText(page, '#download-json')); expect(report.source).toBe('new 2\nnew 3\n'); expect([report.start_line, report.end_line]).toEqual([2, 3]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('changed-history-mobile.png'), fullPage: true });
});

test('a discovered Python change continues through named-function selection and exact evidence export', async ({ page, changes }) => {
  const path = 'src/function.py', initial = 'raise RuntimeError("source must never execute")\ndef scale(value):\n    return value + 1\n';
  await changes.write(path, initial); const left = await changes.commit('Original scale function');
  await changes.write(path, initial.replace('value + 1', 'value * 2')); const right = await changes.commit('Change scale function');
  await openChanges(page, changes); await discoverChanges(page, { left, right }); await inspect(page, path, 'right');
  await page.locator('#functions-button').click(); await expect(page.locator('#function-list')).toContainText('scale');
  await page.locator('#function-list').getByRole('button', { name: 'Select function', exact: true }).click();
  await expect(page.locator('#selection-mode')).toHaveValue('function'); await page.locator('#generate-report').click();
  await expect(page.locator('#download-json')).toHaveAttribute('href', /^blob:/);
  const actual = await downloadText(page, '#download-json'); expect(actual).toBe(await changes.cli(['explain', '--ref', right, '--file', path, '--function', 'scale', '--format', 'json']));
  const report = JSON.parse(actual); expect(report.source).toBe('def scale(value):\n    return value * 2\n'); expect(report.selected_function).toBe('scale');
});

test('history handoff drains a held real source job before reading its pinned replacement', async ({ page, changes }) => {
  await openChanges(page, changes); await discoverChanges(page);
  await page.locator('#changes-filter').fill('added.txt'); await page.locator('[data-use-change]').click();
  const jobs = [], cancellations = []; let release, reached, held = false;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { reached = resolve; });
  await page.route('**/api/jobs', async route => {
    const body = route.request().postDataJSON(); jobs.push(body); const response = await route.fetch();
    if (!held && body.operation === 'source') { held = true; reached(); await gate; }
    await route.fulfill({ response }).catch(() => {});
  });
  await page.route('**/api/cancel', async route => { cancellations.push(route.request().postDataJSON().id); await route.continue(); });
  try {
    await page.locator('#right-open-source').click(); await ready;
    await page.locator('#changes-filter').fill('src/edited.txt'); await page.getByRole('button', { name: 'Inspect right history', exact: true }).click();
    expect(jobs.map(job => job.operation)).toEqual(['source']); await expect(page.locator('#workspace-mode')).toHaveValue('history');
    release(); await expect(page.locator('#source-caption')).toContainText('physical lines'); await expect(page.locator('#stop-button')).toBeDisabled();
    expect(jobs.map(job => job.args.path)).toEqual(['added.txt', 'src/edited.txt']); expect(cancellations.length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#source-lines')).toContainText('new & literal'); await expect(page.locator('#source-lines')).not.toContainText('original addition');
    await expect(page.locator('#right-source-caption')).toHaveText('No source loaded');
  } finally { release(); }
});
