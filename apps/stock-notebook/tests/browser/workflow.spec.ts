import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { originalCsv, header } from '../oracle/fixtures';
import { annualCsv, annualDataset } from '../oracle/annual-fixtures';
import type { Notebook } from '../../src/types';
import { createNotebook } from '../../src/model';
import { company as fixtureCompany, dataset as fixtureDataset, today as fixtureToday } from '../oracle/fixtures';

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
async function importCsv(page: Page, content = originalCsv, replacing = false, fileName = 'original-research.csv') {
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(content) });
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

test('applied exclusion audit survives drafts, history, native reopen and downloaded reports', async ({ page }) => {
  await page.goto('/'); await importCsv(page);
  await interpret(page, 'companies with profitable and growing and low debt'); await apply(page);
  await page.getByRole('tab', { name: 'Excluded companies', exact: true }).click();
  const audit = page.locator('#exclusion-content');
  await expect(audit.locator('[data-ticker]')).toHaveCount(4);
  await expect(audit.locator('[data-ticker="BRAVO"]')).toContainText(/debtEquity 3.*<= 1/);
  await expect(audit.locator('[data-ticker="ECHO"]')).toContainText(/netIncome.*not supplied/);
  await expect(audit.locator('[data-ticker="ECHO"]')).toContainText(/equity.*nonpositive/);
  await expect(audit.locator('[data-ticker="FOXTROT"]')).toContainText(/548.day/);
  await expect(audit.locator('[data-ticker="CHARLIE"]')).toContainText('original-research.csv:4');
  const beforeDraft = await audit.innerText();
  await page.locator('[data-filter-id] [name=value]').last().fill('4');
  expect(await audit.innerText()).toBe(beforeDraft);
  const draftReport = await download(page, 'Download research report');
  expect(draftReport.text).toContain('Screening exclusion audit');
  expect(draftReport.text).toMatch(/Excluded: BRAVO; fiscal 2025-12-31; source original-research.csv:3/);
  expect(draftReport.text).toMatch(/debtEquity 3.*<= 1/);
  await apply(page); await expect(audit.locator('[data-ticker]')).toHaveCount(3);
  await expect(audit.locator('[data-ticker="BRAVO"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(audit.locator('[data-ticker="BRAVO"]')).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(audit.locator('[data-ticker="BRAVO"]')).toHaveCount(0);
  await audit.locator('[data-ticker="ECHO"]').getByRole('button', { name: 'View excluded evidence', exact: true }).click();
  await expect(page.locator('#company-detail')).toContainText('ECHO');
  await page.getByLabel('Research note', { exact: true }).fill('Review missing source figures.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  const saved = await backup(page); expect(saved.schemaVersion).toBe(2);
  await page.reload(); await expect(page.locator('#dataset-summary')).toContainText('original-research.csv');
  await page.getByRole('tab', { name: 'Excluded companies', exact: true }).click();
  await expect(audit.locator('[data-ticker]')).toHaveCount(3);
  expect(await backup(page)).toEqual(saved);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(audit).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Shortlist', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Excluded companies', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Excluded companies', exact: true })).toHaveAttribute('aria-selected', 'true');
  const finalReport = await download(page, 'Download research report');
  expect(finalReport.text).toContain('Review missing source figures.');
  expect(finalReport.text).not.toContain('Excluded: BRAVO;');
});

test('production maximum exclusion audit retains 500 companies and 8000 safe source-linked reasons', async ({ page, baseURL }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url()); });
  const data = fixtureDataset(Array.from({ length: 500 }, (_, index) => fixtureCompany({
    ticker: `T${String(index).padStart(3, '0')}`, fiscalDate: '2025-12-31',
    name: index === 0 ? '<img src=x onerror=window.bad=true>' : `Original bounded company ${index}`,
    filingUrl: 'https://example.com/' + 'p'.repeat(2000),
  })));
  const book = createNotebook(data, fixtureToday);
  book.screen.filters = Array.from({ length: 16 }, (_, index) => ({ metric: 'growthPct', operator: 'gt', value: 1000 + index, currency: null }));
  await page.goto('/');
  const started = Date.now();
  await page.getByLabel('Import notebook backup', { exact: true }).setInputFiles({ name: 'bounded-exclusions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(book)) });
  await expect(page.locator('#import-review')).toContainText('500 annual rows');
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  await page.getByRole('tab', { name: 'Excluded companies', exact: true }).click();
  const audit = page.locator('#exclusion-content');
  await expect(audit.locator('[data-ticker]')).toHaveCount(500);
  await expect(audit.locator('li')).toHaveCount(8000);
  await expect(audit.locator('[data-ticker="T499"]')).toContainText('original-research.csv:501');
  await expect(audit.locator('[data-ticker="T000"]')).toContainText('<img src=x onerror=window.bad=true>');
  await expect(audit.locator('img')).toHaveCount(0);
  const publishedMs = Date.now() - started;
  const exportedAt = Date.now(), report = await download(page, 'Download research report');
  expect((report.text.match(/^Excluded: /gm) ?? []).length).toBe(500);
  expect((report.text.match(/^\[threshold\]/gm) ?? []).length).toBe(8000);
  expect(Buffer.byteLength(report.text)).toBeLessThanOrEqual(8 * 1024 * 1024);
  const reportMs = Date.now() - exportedAt;
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  await page.reload(); expect(await backup(page)).toEqual(book);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Excluded companies', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]); expect(external).toEqual([]);
  console.log(JSON.stringify({ verification: 'maximum-exclusion-audit', companies: 500, reasons: 8000, publishedMs, reportMs, reportBytes: Buffer.byteLength(report.text), browser: await page.evaluate(() => navigator.userAgent) }));
});

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
  const source = page.locator('#company-detail .facts a[href="https://example.com/alfa"]');
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
  await page.addInitScript(() => {
    const control = { held: true, started: false, committed: false };
    Object.defineProperty(window, 'stockResetTransaction', { value: control });
    const nativeDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key: IDBValidKey | IDBKeyRange): IDBRequest<undefined> {
      const deletion = nativeDelete.call(this, key);
      if (this.name === 'notebooks' && key === 'current') {
        control.started = true;
        this.transaction.addEventListener('complete', () => { control.committed = true; });
        const keepNativeTransactionOpen = () => {
          const request = this.get('__test_reset_transaction_hold__');
          request.onsuccess = () => { if (control.held) keepNativeTransactionOpen(); };
        };
        keepNativeTransactionOpen();
      }
      return deletion;
    };
  });
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
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    stockResetTransaction: { started: boolean };
  }).stockResetTransaction.started)).toBe(true);
  // Import stays visible during reset. It is not a transaction-completion
  // signal: navigation now aborts the native deletion and preserves old text.
  await expect(page.getByLabel('Import CSV', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download raw saved record', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as {
    stockResetTransaction: { committed: boolean };
  }).stockResetTransaction.committed)).toBe(false);
  await page.evaluate(() => { (window as unknown as {
    stockResetTransaction: { held: boolean };
  }).stockResetTransaction.held = false; });
  await expect(page.locator('#message')).toContainText('Saved record reset. Current in-memory work was kept.');
  await expect(page.getByRole('button', { name: 'Download raw saved record', exact: true })).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as {
    stockResetTransaction: { committed: boolean };
  }).stockResetTransaction.committed)).toBe(true);
  await page.reload();
  const stillSaved = await page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const opening = indexedDB.open('stock-notebook-v1', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction('notebooks', 'readonly');
      const current = transaction.objectStore('notebooks').getKey('current');
      transaction.oncomplete = () => { db.close(); resolve(current.result !== undefined); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
  expect(stillSaved).toBe(false);
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
  const duplicatePeriod = originalCsv + originalCsv.split('\r\n')[1] + '\r\n';
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'duplicate.csv', mimeType: 'text/csv', buffer: Buffer.from(duplicatePeriod) });
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

test('unsorted supplied annual rows drive latest-only screens and source-linked history survives real reports, reload and reimport', async ({ page, baseURL }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url()); });
  await page.goto('/');
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'annual-original.csv', mimeType: 'text/csv', buffer: Buffer.from(annualCsv) });
  await expect(page.locator('#import-review')).toContainText('9 annual rows');
  await expect(page.locator('#import-review')).toContainText('4 unique companies');
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  await expect(page.locator('#dataset-summary')).toContainText('9 annual rows');
  await expect(page.locator('#dataset-summary')).toContainText('4 unique companies');
  await expect(page.locator('#results [data-ticker]')).toHaveCount(4);
  await expect(result(page, 'ALFA')).toContainText('Revenue USD 150 million');
  await expect(result(page, 'ALFA')).toContainText('Growth 25%');
  await expect(result(page, 'BRAVO')).toContainText('Current BRAVO name');
  await expect(result(page, 'BRAVO')).not.toContainText('500');
  expect(await page.locator('#screen-sector option').allTextContents()).not.toContain('Historical sector');
  expect(await page.locator('#screen-currency option').allTextContents()).not.toContain('EUR');
  const initial = await backup(page);
  expect(initial.schemaVersion).toBe(2);
  expect(initial.dataset.companies).toEqual(annualDataset().companies);

  await result(page, 'ALFA').getByRole('button', { name: 'Add to watchlist', exact: true }).click();
  await result(page, 'BRAVO').getByRole('button', { name: 'Add to watchlist', exact: true }).click();
  await result(page, 'ALFA').getByRole('button', { name: 'Add to comparison', exact: true }).click();
  await result(page, 'BRAVO').getByRole('button', { name: 'Add to comparison', exact: true }).click();
  await result(page, 'CHARLIE').getByRole('button', { name: 'Add to comparison', exact: true }).click();
  await result(page, 'BRAVO').getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(page.locator('#company-detail .facts')).toContainText('Current BRAVO name');
  await expect(page.locator('#company-detail .facts')).toContainText('2026-03-31');
  await expect(page.locator('#company-detail .facts')).not.toContainText('500');
  await result(page, 'ALFA').getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(page.locator('#company-detail .facts')).toContainText('annual-original.csv:2');
  await expect(page.getByRole('region', { name: 'ALFA supplied annual history', exact: true })).toBeVisible();
  expect(await page.locator('#annual-history tr[data-fiscal-date]').evaluateAll(rows => rows.map(row => row.getAttribute('data-fiscal-date'))))
    .toEqual(['2024-03-31', '2025-03-31', '2026-03-31']);
  for (const [date, sourceLine, amount] of [['2024-03-31', 4, 80], ['2025-03-31', 6, 100], ['2026-03-31', 2, 150]] as const) {
    const row = page.locator(`#annual-history tr[data-fiscal-date="${date}"]`);
    await expect(row).toContainText(`annual-original.csv:${sourceLine}`);
    await expect(row).toContainText(String(amount));
    await expect(row.locator(`a[href="https://example.com/alfa-${date.slice(0, 4)}"]`)).toHaveAttribute('rel', /noopener/);
  }
  const recent = page.locator('#annual-comparisons .period-comparison[data-previous-date="2025-03-31"][data-current-date="2026-03-31"]');
  await expect(recent).toContainText('50%');
  await expect(recent).toContainText('120');
  await expect(recent).toContainText('100');
  await expect(page.locator('#annual-trends')).toContainText(/unavailable/i);
  await page.locator('#note-form [name=note]').fill('Declared prior revenue differs from the stored preceding annual row; verify both filings.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();

  await interpret(page, 'companies with revenue growth at least 30%'); await apply(page);
  await expect(page.locator('#results [data-ticker]')).toHaveCount(1);
  await expect(result(page, 'DELTA')).toBeVisible();
  await expect(result(page, 'ALFA')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Watchlist', exact: true }).click();
  await expect(page.locator('#watchlist-content [data-ticker="ALFA"]')).toContainText('Revenue USD 150 million');
  await expect(page.locator('#watchlist-content [data-ticker="BRAVO"]')).toContainText('Current BRAVO name');
  await expect(page.locator('#watchlist-content [data-ticker="BRAVO"]')).not.toContainText('500');
  await page.locator('#watchlist-content [data-ticker="ALFA"]').getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(page.locator('#annual-history tr[data-fiscal-date]')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Comparison', exact: true }).click();
  await expect(page.locator('#comparison-content')).toContainText('150');
  await expect(page.locator('#comparison-content')).toContainText('2026-03-31');
  await expect(page.locator('#comparison-content')).toContainText('Current BRAVO name');
  await expect(page.locator('#comparison-content')).not.toContainText('Old BRAVO name');
  const current = await backup(page);
  expect(current.dataset.companies).toEqual(initial.dataset.companies);
  expect(current.watchlist).toEqual(['ALFA', 'BRAVO']); expect(current.comparison).toEqual(['ALFA', 'BRAVO', 'CHARLIE']);
  const report = await download(page, 'Download research report');
  // Excluded BRAVO's older EUR row and null latest revenue must still be in
  // the actual appendix, rather than reduced to the currently visible screen.
  for (const row of annualDataset().companies) {
    expect(report.text).toContain(`annual-original.csv:${row.sourceLine}`);
    expect(report.text).toContain(row.fiscalDate);
    expect(report.text).toContain(row.filingUrl!);
  }
  expect(report.text).toContain('Old BRAVO name'); expect(report.text).toContain('Historical sector');
  expect(report.text).toContain('500'); expect(report.text).toContain('EUR');
  expect(report.text).toContain('priorRevenue'); expect(report.text).toContain('50');
  await expect(page.locator('#save-status')).toContainText(/^Saved\b/i);
  await page.reload(); expect(await backup(page)).toEqual(current);
  await page.getByLabel('Import notebook backup', { exact: true }).setInputFiles({ name: 'annual-reopen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(current)) });
  await expect(page.locator('#import-review')).toContainText('9 annual rows');
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  expect(await backup(page)).toEqual(current);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('annual history is keyboard accessible on mobile and invalid extra periods preserve current annotations and drafts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await importCsv(page, annualCsv, false, 'annual-original.csv');
  await result(page, 'ALFA').getByRole('button', { name: 'Add to watchlist', exact: true }).click();
  await result(page, 'ALFA').getByRole('button', { name: 'View evidence', exact: true }).click();
  const region = page.getByRole('region', { name: 'ALFA supplied annual history', exact: true });
  await region.focus(); await expect(region).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const before = await backup(page);
  await page.locator('#note-form [name=note]').fill('An unsent annual evidence note.');
  const duplicate = annualCsv + 'ALFA,Original annual ALFA,Software,USD,2026-03-31,150,120,30,40,100,\r\n';
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'duplicate-period.csv', mimeType: 'text/csv', buffer: Buffer.from(duplicate) });
  await expect(page.locator('#message')).toContainText(/duplicate|rejected/i);
  expect(await backup(page)).toEqual(before);
  await expect(page.locator('#note-form [name=note]')).toHaveValue('An unsent annual evidence note.');
  const sixth = annualCsv + [2021, 2022, 2023].map(year => `ALFA,Original annual ALFA,Software,USD,${year}-03-31,60,50,6,20,100,`).join('\r\n') + '\r\n';
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles({ name: 'six-periods.csv', mimeType: 'text/csv', buffer: Buffer.from(sixth) });
  await expect(page.locator('#message')).toContainText(/five|5|rejected/i);
  expect(await backup(page)).toEqual(before);
  await expect(page.locator('#note-form [name=note]')).toHaveValue('An unsent annual evidence note.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  expect((await backup(page)).notes).toEqual([{ ticker: 'ALFA', text: 'An unsent annual evidence note.' }]);
  expect(errors).toEqual([]);
});

test('a real v1 saved notebook restores visible research, keeps raw legacy text until editing, and saves v2 for reload', async ({ page }) => {
  await page.goto('/'); await importCsv(page);
  await result(page, 'ALFA').getByRole('button', { name: 'Add to watchlist', exact: true }).click();
  await result(page, 'ALFA').getByRole('button', { name: 'View evidence', exact: true }).click();
  await page.locator('#note-form [name=note]').fill('A preserved legacy research note.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText(/^Saved\b/i);
  const prior = await backup(page), legacyText = JSON.stringify({ ...prior, schemaVersion: 1 });
  await page.evaluate(text => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('stock-notebook-v1', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction('notebooks', 'readwrite');
      transaction.objectStore('notebooks').put(text, 'current');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), legacyText);
  await page.reload();
  await expect(page.locator('#title-form [name=title]')).toHaveValue(prior.title);
  const restored = await backup(page); expect(restored).toEqual(prior); expect(restored.schemaVersion).toBe(2);
  const readPersisted = () => page.evaluate(() => new Promise<string>((resolve, reject) => {
    const opening = indexedDB.open('stock-notebook-v1', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction('notebooks', 'readonly');
      const current = transaction.objectStore('notebooks').get('current');
      transaction.oncomplete = () => { db.close(); resolve(current.result as string); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
  expect(await readPersisted()).toBe(legacyText);
  await page.getByRole('tab', { name: 'Watchlist', exact: true }).click();
  await expect(page.locator('#watchlist-content [data-ticker="ALFA"]')).toBeVisible();
  await page.locator('#watchlist-content [data-ticker="ALFA"]').getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(page.locator('#note-form [name=note]')).toHaveValue('A preserved legacy research note.');
  await page.locator('#title-form [name=title]').fill('A saved v2 annual notebook');
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText(/^Saved\b/i);
  const persisted = JSON.parse(await readPersisted()) as Notebook;
  expect(persisted).toEqual({ ...prior, title: 'A saved v2 annual notebook' });
  await page.reload(); expect(await backup(page)).toEqual(persisted);
});
