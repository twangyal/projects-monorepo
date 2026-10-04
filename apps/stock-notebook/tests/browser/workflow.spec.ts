import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { originalCsv, header } from '../oracle/fixtures';
import type { Notebook } from '../../src/types';

async function download(page: Page, label: string) {
  const button = page.getByRole('button', { name: label, exact: true });
  await expect(button).toBeEnabled();
  const pending = page.waitForEvent('download');
  await button.click(); const file = await pending;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}
async function backup(page: Page): Promise<Notebook> {
  const file = await download(page, 'Download notebook backup');
  expect(file.name).toBe('stock-notebook.json');
  return JSON.parse(file.text) as Notebook;
}
async function importCsv(page: Page, content = originalCsv, replacing = false) {
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'original-research.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
  await expect(page.locator('#import-review')).toBeVisible();
  await expect(page.locator('#import-review')).toContainText(/currency.*millions|currency-millions/i);
  await expect(page.locator('#import-review')).toContainText(/12.month|annual/i);
  await expect(page.getByRole('button', { name: 'Replace universe', exact: true })).toBeDisabled();
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  if (replacing) page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  await expect(page.locator('[data-ticker="ALFA"]')).toBeVisible();
}
function result(page: Page, ticker: string) { return page.locator(`[data-ticker="${ticker}"]`).filter({ has: page.getByRole('button', { name: 'View evidence', exact: true }) }); }
async function interpret(page: Page, query: string) {
  await page.locator('#query-form [name=query]').fill(query);
  await page.getByRole('button', { name: 'Interpret criteria', exact: true }).click();
}
async function apply(page: Page) { await page.getByRole('button', { name: 'Apply filters', exact: true }).click(); }

test('real original CSV becomes an inspected shortlist, source-linked comparison, notes and portable reports', async ({ page, baseURL }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url()); });
  await page.goto('/');
  const template = await download(page, 'Download blank template');
  expect(template.name).toBe('stock-notebook-template.csv'); expect(template.text).toBe(header + '\n');
  await importCsv(page);
  const initial = await backup(page);
  expect(initial.dataset.synthetic).toBe(false);
  expect(initial.dataset.companies.map(row => row.sourceLine)).toEqual([2, 3, 4, 5, 6, 7]);
  expect(initial.dataset.companies[4]).toMatchObject({ revenue: null, priorRevenue: 0, netIncome: null, equity: -5 });
  await interpret(page, 'companies with profitable and growing and low debt sorted by profit margin descending');
  expect((await backup(page)).screen).toEqual(initial.screen);
  await apply(page);
  await expect(result(page, 'ALFA')).toBeVisible(); await expect(result(page, 'DELTA')).toBeVisible();
  await expect(result(page, 'BRAVO')).toHaveCount(0);
  let current = await backup(page);
  expect(current.screen.filters).toEqual([
    { metric: 'netIncome', operator: 'gt', value: 0, currency: null },
    { metric: 'growthPct', operator: 'gt', value: 0, currency: null },
    { metric: 'debtEquity', operator: 'lte', value: 1, currency: null },
  ]);
  const leverage = page.locator('[data-filter-id]').filter({ has: page.locator('select[name=metric] option:checked[value=debtEquity]') });
  await leverage.locator('[name=value]').fill('4'); await apply(page);
  await expect(result(page, 'BRAVO')).toBeVisible();
  await expect(page.locator('#applied-criteria')).toContainText(/edited after interpretation/i);
  await result(page, 'ALFA').getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(page.locator('#company-detail')).toContainText('original-research.csv:2');
  await expect(page.locator('#company-detail')).toContainText('120');
  await expect(page.locator('#company-detail')).toContainText(/Reported facts/i);
  await expect(page.locator('#company-detail')).toContainText(/Derived ratios/i);
  await expect(page.locator('#company-detail')).toContainText('<img src=x onerror=window.bad=true>');
  expect(await page.locator('#company-detail img').count()).toBe(0);
  const source = page.locator('#company-detail a[href="https://example.com/alfa"]');
  await expect(source).toHaveText(/Supplied source link/i); await expect(source).toHaveAttribute('rel', /noopener/);
  await result(page, 'ALFA').getByRole('button', { name: 'Add to comparison', exact: true }).click();
  await result(page, 'BRAVO').getByRole('button', { name: 'Add to comparison', exact: true }).click();
  await result(page, 'ALFA').getByRole('button', { name: 'Add to watchlist', exact: true }).click();
  await page.locator('#note-form [name=note]').fill('<script>A literal research note</script>\nCheck the annual period basis.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByRole('tab', { name: 'Comparison', exact: true }).click();
  await expect(page.getByText('Different currencies: amounts are not directly comparable', { exact: true })).toBeVisible();
  await expect(page.getByText('Different fiscal year ends: periods may not align', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Watchlist', exact: true }).click();
  await expect(page.locator('#note-form [name=note]')).toHaveValue('<script>A literal research note</script>\nCheck the annual period basis.');
  expect(await page.locator('script').evaluateAll(nodes => nodes.filter(node => !node.getAttribute('src')).length)).toBe(0);
  current = await backup(page);
  expect(current.watchlist).toEqual(['ALFA']); expect(current.comparison).toEqual(['ALFA', 'BRAVO']);
  expect(current.screen.filters[2]!.value).toBe(4);
  const report = await download(page, 'Download research report');
  expect(report.name).toBe('stock-notebook-report.txt');
  for (const expected of ['original-research.csv:2', 'https://example.com/alfa', 'ALFA', 'BRAVO', 'DELTA', '34237.026104', 'Figures and period comparability', 'A literal research note']) expect(report.text).toContain(expected);
  expect(report.text).toMatch(/debtEquity.*(?:lte|≤|at most).*4|debt.*equity.*4/i);
  expect(report.text).not.toContain('Synthetic demonstration — not real companies or filings');
  await expect(page.locator('#save-status')).toContainText(/^Saved\b/i);
  await page.reload(); expect(await backup(page)).toEqual(current);
  await page.getByLabel('Import notebook backup', { exact: true }).setInputFiles({ name: 'reopen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(current)) });
  await expect(page.locator('#import-review')).toBeVisible();
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  expect(await backup(page)).toEqual(current);
  expect(errors).toEqual([]); expect(external).toEqual([]);
  await page.screenshot({ path: '/tmp/stock-desktop.png', fullPage: true });
});

test('a delayed real file read cannot replace a newer review or erase an unsaved note', async ({ page }) => {
  await page.addInitScript(() => {
    const control = { pending: [] as (() => void)[] };
    Object.defineProperty(window, 'stockNativeReads', { value: control });
    const arrayBuffer = File.prototype.arrayBuffer, text = File.prototype.text;
    File.prototype.arrayBuffer = function () {
      return arrayBuffer.call(this).then(value => this.name === 'late.csv' ? new Promise<ArrayBuffer>(resolve => control.pending.push(() => resolve(value))) : value);
    };
    File.prototype.text = function () {
      return text.call(this).then(value => this.name === 'late.csv' ? new Promise<string>(resolve => control.pending.push(() => resolve(value))) : value);
    };
  });
  await page.goto('/'); await importCsv(page);
  await result(page, 'ALFA').getByRole('button', { name: 'View evidence', exact: true }).click();
  const before = await backup(page);
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'late.csv', mimeType: 'text/csv', buffer: Buffer.from(originalCsv) });
  await expect.poll(() => page.evaluate(() => (window as unknown as { stockNativeReads: { pending: unknown[] } }).stockNativeReads.pending.length)).toBe(1);
  await page.locator('#note-form [name=note]').fill('An unsent note that a late import must keep.');
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'newer.csv', mimeType: 'text/csv', buffer: Buffer.from(originalCsv) });
  await expect(page.locator('#import-review')).toContainText('newer.csv');
  await page.evaluate(() => {
    const control = (window as unknown as { stockNativeReads: { pending: (() => void)[] } }).stockNativeReads;
    for (const release of control.pending.splice(0)) release();
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('#import-review')).toContainText('newer.csv');
  await expect(page.locator('#import-review')).not.toContainText('late.csv');
  await expect(page.locator('#note-form [name=note]')).toHaveValue('An unsent note that a late import must keep.');
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  expect(await backup(page)).toEqual(before);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  expect((await backup(page)).notes).toEqual([{ ticker: 'ALFA', text: 'An unsent note that a late import must keep.' }]);
});

test('unavailable storage retains an editable notebook and real JSON/text backup guidance', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); } }));
  await page.goto('/'); await importCsv(page, originalCsv, true);
  await result(page, 'ALFA').getByRole('button', { name: 'Add to watchlist', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText(/not saved|unsaved|failed|unavailable/i);
  const current = await backup(page); expect(current.watchlist).toEqual(['ALFA']);
  const report = await download(page, 'Download research report'); expect(report.text).toContain('ALFA');
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText(/not saved|unsaved|failed|unavailable/i);
  expect(await backup(page)).toEqual(current);
});

test('corrupt persisted text remains recoverable until explicit reset without a fabricated notebook', async ({ page }) => {
  await page.goto('/');
  const raw = '{"broken":true}';
  await page.evaluate(raw => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('stock-notebook-v1', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('notebooks');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction('notebooks', 'readwrite');
      transaction.objectStore('notebooks').put(raw, 'current');
      transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), raw);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Download raw saved record', exact: true })).toBeVisible();
  expect((await download(page, 'Download raw saved record')).text).toBe(raw);
  await expect(page.locator('.workspace')).toBeHidden();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset saved record', exact: true }).click();
  await expect(page.getByLabel('Import CSV', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Download raw saved record', exact: true })).toBeHidden();
  await expect(page.locator('.workspace')).toBeHidden();
});

test('synthetic demo stays labeled in real reports and mobile keyboard edits do not execute imported text', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url()); });
  await page.goto('/'); await page.getByRole('button', { name: 'Load synthetic demo', exact: true }).click();
  await expect(page.locator('#import-review')).toContainText('Synthetic demonstration — not real companies or filings');
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  const notebook = await backup(page); expect(notebook.dataset.synthetic).toBe(true);
  expect((await download(page, 'Download research report')).text).toContain('Synthetic demonstration — not real companies or filings');
  const input = page.locator('#title-form [name=title]'); await input.fill('A keyboard research notebook');
  await input.press('Enter');
  expect((await backup(page)).title).toBe('A keyboard research notebook');
  await page.getByRole('tab', { name: 'Shortlist', exact: true }).focus();
  await page.keyboard.press('Control+z'); expect((await backup(page)).title).toBe(notebook.title);
  await page.keyboard.press('Control+Shift+z'); expect((await backup(page)).title).toBe('A keyboard research notebook');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); expect(external).toEqual([]);
  await page.screenshot({ path: '/tmp/stock-mobile.png', fullPage: true });
});

test('invalid or canceled replacements and unsupported criteria preserve applied data and history', async ({ page }) => {
  await page.goto('/'); await importCsv(page);
  const before = await backup(page);
  await interpret(page, 'companies with profitable OR growing');
  await expect(page.locator('#message')).toContainText(/supported|syntax|criteria|interpret/i);
  expect(await backup(page)).toEqual(before);
  await interpret(page, 'companies sorted by revenue descending'); await apply(page);
  await expect(page.locator('#screen-error')).toContainText(/currenc|sort/i);
  expect(await backup(page)).toEqual(before);
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'duplicate.csv', mimeType: 'text/csv', buffer: Buffer.from(originalCsv.replace('BRAVO,', 'ALFA,')) });
  await expect(page.locator('#message')).toContainText(/invalid|duplicate|CSV|import/i);
  expect(await backup(page)).toEqual(before);
  await page.getByLabel('Import notebook backup', { exact: true }).setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...before, unexpected: 1 })) });
  await expect(page.locator('#message')).toContainText(/invalid|backup|notebook|import/i);
  expect(await backup(page)).toEqual(before);
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from(originalCsv) });
  await expect(page.locator('#import-review')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  expect(await backup(page)).toEqual(before);
  await interpret(page, 'companies with profitable'); await apply(page);
  const applied = await backup(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await backup(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await backup(page)).toEqual(applied);
});

test('editing a staged sentence cannot credit an earlier interpretation to an invalid new draft', async ({ page }) => {
  await page.goto('/'); await importCsv(page);
  await interpret(page, 'companies with profitable');
  await expect(page.locator('#staged-interpretation')).toBeVisible();
  await page.locator('#query-form [name=query]').fill('companies with profitable OR growing');
  await expect(page.locator('#staged-interpretation')).toBeHidden();
  await page.getByRole('button', { name: 'Interpret criteria', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Unsupported screening sentence');
  await expect(page.locator('#staged-interpretation')).toBeHidden();
  await apply(page);
  const applied = await backup(page);
  expect(applied.query).toBe('');
  expect(applied.screen.filters).toEqual([{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }]);
  await expect(page.locator('#query-form [name=query]')).toHaveValue('companies with profitable OR growing');
  const report = await download(page, 'Download research report');
  expect(report.text).toContain('netIncome');
  expect(report.text).not.toContain('companies with profitable');
});
