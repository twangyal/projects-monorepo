import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Company, Notebook, Screen } from '../../src/types.ts';

const HEADER = 'ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url';
const DAY = '2026-10-04';
const ALPHA_NOTE = '<script>Literal saved alpha note</script>\nKeep the complete annual basis claim 🎵';
const LOST_NOTE = 'Lost note <img src=x onerror=window.REFRESH_BAD=true> 📌';
const OLD_ROWS: Company[] = [
  { ticker: 'ALFA', name: 'Alpha research', sector: 'Software', currency: 'USD', fiscalDate: '2025-03-31', revenue: 100, priorRevenue: 80, netIncome: 10, debt: 20, equity: 50, filingUrl: 'https://example.com/old-alpha-2025', sourceLine: 2 },
  { ticker: 'ALFA', name: 'Alpha research', sector: 'Software', currency: 'USD', fiscalDate: '2026-03-31', revenue: 120, priorRevenue: 100, netIncome: 12, debt: 20, equity: 60, filingUrl: 'https://example.com/old-alpha-2026', sourceLine: 3 },
  { ticker: 'BRAVO', name: 'Beta labs', sector: 'Hardware', currency: 'USD', fiscalDate: '2026-03-31', revenue: 200, priorRevenue: 100, netIncome: 20, debt: 30, equity: 100, filingUrl: 'https://example.com/old-beta', sourceLine: 4 },
  { ticker: 'CHARLIE', name: 'Gone research', sector: 'Software', currency: 'USD', fiscalDate: '2026-03-31', revenue: 50, priorRevenue: 40, netIncome: 5, debt: 10, equity: 50, filingUrl: 'https://example.com/old-charlie', sourceLine: 5 },
  { ticker: 'DELTA', name: 'Delta fixed facts', sector: 'Software', currency: 'USD', fiscalDate: '2026-03-31', revenue: 80, priorRevenue: 60, netIncome: 8, debt: 20, equity: 80, filingUrl: 'https://example.com/old-delta', sourceLine: 6 },
];
const NEW_ROWS: Company[] = [
  { ...OLD_ROWS[4]!, filingUrl: 'https://example.com/incoming-delta', sourceLine: 2 },
  { ...OLD_ROWS[1]!, revenue: 150, netIncome: 30, filingUrl: 'https://example.com/incoming-alpha', sourceLine: 3 },
  { ...OLD_ROWS[2]!, name: 'Beta holdings', currency: 'EUR', filingUrl: 'https://example.com/incoming-beta', sourceLine: 4 },
  { ...OLD_ROWS[3]!, ticker: 'ECHO', name: 'Added research', revenue: 60, priorRevenue: 50, netIncome: 6, filingUrl: 'https://example.com/incoming-echo', sourceLine: 5 },
];
const DEFAULT_SCREEN: Screen = { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' };

function csv(rows: Company[]): string {
  const quote = (value: string | number | null) => value === null ? '' : `"${String(value).replaceAll('"', '""')}"`;
  return HEADER + '\n' + rows.map(row => [row.ticker, row.name, row.sector, row.currency, row.fiscalDate,
    row.revenue, row.priorRevenue, row.netIncome, row.debt, row.equity, row.filingUrl].map(quote).join(',')).join('\n') + '\n';
}
function fixture(patch: Partial<Notebook> = {}): Notebook {
  return { schemaVersion: 2, id: '22222222-2222-4222-8222-222222222222', title: 'Committed refresh research', query: '',
    screen: structuredClone(DEFAULT_SCREEN), watchlist: ['DELTA', 'ALFA', 'BRAVO', 'CHARLIE'], comparison: ['BRAVO', 'ALFA', 'CHARLIE'],
    notes: [{ ticker: 'ALFA', text: ALPHA_NOTE }, { ticker: 'BRAVO', text: 'Beta baseline note' }, { ticker: 'CHARLIE', text: LOST_NOTE }],
    dataset: { id: '11111111-1111-4111-8111-111111111111', fileName: 'previous-financials.csv', importedDate: DAY,
      basis: 'annual-12-month', units: 'currency-millions', synthetic: false, companies: structuredClone(OLD_ROWS) }, ...patch };
}
const applyRefresh = (page: Page) => page.getByRole('button', { name: 'Apply reviewed refresh', exact: true });
const retention = (page: Page, ticker = 'BRAVO') => page.getByRole('combobox', { name: `Research retention for ${ticker}`, exact: true });
const units = (page: Page) => page.getByLabel('I confirm the refreshed CSV uses currency millions and comparable 12-month annual periods', { exact: true });
const losses = (page: Page) => page.getByLabel('I reviewed the annual periods and research that will be removed', { exact: true });

async function download(page: Page, name: string): Promise<string> {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  const path = await (await pending).path(); if (!path) throw new Error('Expected an actual downloaded file.');
  return readFile(path, 'utf8');
}
async function backup(page: Page): Promise<Notebook> { return JSON.parse(await download(page, 'Download notebook backup')) as Notebook; }
async function rawRecord(page: Page): Promise<unknown> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('stock-notebook-v1', 1);
    open.onerror = () => reject(new Error('Native database read failed.'));
    open.onsuccess = () => {
      const database = open.result, transaction = database.transaction('notebooks', 'readonly');
      const read = transaction.objectStore('notebooks').get('current');
      read.onsuccess = () => resolve(read.result as unknown);
      read.onerror = () => reject(new Error('Native saved record read failed.'));
      transaction.oncomplete = () => database.close();
    };
  }));
}
async function loadNotebook(page: Page, notebook = fixture()): Promise<void> {
  await page.clock.setFixedTime(new Date(`${DAY}T12:00:00Z`));
  await page.goto('/');
  await page.getByLabel('Import notebook backup', { exact: true }).setInputFiles({ name: 'baseline-research.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(notebook)) });
  await expect(page.locator('#import-review')).toBeVisible();
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  expect(await backup(page)).toEqual(notebook);
}
async function stageRefresh(page: Page, rows = NEW_ROWS, name = 'incoming-financials.csv'): Promise<void> {
  await expect(page.locator('#refresh-csv')).toBeVisible();
  await page.getByLabel('Refresh financial data', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv(rows)) });
  await expect(page.locator('#refresh-review')).toBeVisible();
  await expect(page.locator('#refresh-summary')).toContainText(name);
}
async function resolveRefresh(page: Page, decision: 'keep' | 'drop' = 'keep'): Promise<void> {
  await retention(page).selectOption(decision); await units(page).check(); await losses(page).check();
}
async function acceptRefresh(page: Page, fileName = 'incoming-financials.csv'): Promise<void> {
  await expect(applyRefresh(page)).toBeEnabled();
  page.once('dialog', dialog => dialog.accept()); await applyRefresh(page).click();
  await expect(page.locator('#dataset-summary')).toContainText(fileName);
}
const criteria = (page: Page, action: 'keep' | 'clearQuery' | 'reset') => page.locator(`input[name=refresh-criteria][value="${action}"]`);
const rebuild = (page: Page) => page.getByRole('button', { name: 'Rebuild refresh review', exact: true });
const proposedDownload = (page: Page) => page.getByRole('button', { name: 'Download refresh review', exact: true });
async function viewAlpha(page: Page): Promise<void> {
  await page.locator('#results [data-ticker="ALFA"]').getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(page.getByLabel('Research note', { exact: true })).toBeVisible();
}
async function settleReleasedRead(page: Page): Promise<void> {
  // Read bytes are native. These frames only drain a deliberately held completion.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test.beforeEach(async ({ page, baseURL }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(new URL(request.url()).origin); });
  Object.defineProperty(page, 'refreshTestErrors', { value: { errors, external } });
});
test.afterEach(async ({ page }) => {
  const recorded = (page as unknown as { refreshTestErrors: { errors: string[]; external: string[] } }).refreshTestErrors;
  expect(recorded.errors).toEqual([]); expect(recorded.external).toEqual([]);
});

test('reviewed refresh retains research and reopens the exact downloaded incoming notebook', async ({ page }) => {
  await loadNotebook(page);
  await page.getByLabel('Notebook title', { exact: true }).fill('Committed title retained through refresh');
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  const before = await backup(page), oldRaw = await rawRecord(page);
  await stageRefresh(page);
  expect(await backup(page)).toEqual(before); expect(await rawRecord(page)).toBe(oldRaw);
  await expect(applyRefresh(page)).toBeDisabled();
  await expect(retention(page)).toHaveValue('');
  const sourceOnly = page.locator('[data-refresh-period-key="DELTA:2026-03-31"]');
  await expect(sourceOnly).toContainText('previous-financials.csv:6');
  await expect(sourceOnly).toContainText('incoming-financials.csv:2');
  await expect(sourceOnly).toContainText(/unchanged|source.only/i);
  expect(JSON.parse(await download(page, 'Download previous notebook'))).toEqual(before);
  await retention(page).selectOption('keep');
  const proposed = await download(page, 'Download refresh review');
  expect(proposed).toContain('Proposed CSV refresh review — not an applied or saved transaction');
  expect(proposed).toContain(ALPHA_NOTE); expect(proposed).toContain(LOST_NOTE);
  expect(proposed).toContain('previous-financials.csv:6'); expect(proposed).toContain('incoming-financials.csv:2');
  const changedAlpha = proposed.split('Refresh period: ALFA — 2026-03-31\n')[1]!.split('\nRefresh period:')[0]!;
  expect(changedAlpha).toContain('Fact changes: revenue, netIncome');
  expect(changedAlpha).toContain('revenue: 120 -> 150'); expect(changedAlpha).toContain('netIncome: 12 -> 30');
  expect(changedAlpha).toContain('previous-financials.csv:3'); expect(changedAlpha).toContain('incoming-financials.csv:3');
  expect(await rawRecord(page)).toBe(oldRaw);
  await resolveRefresh(page);
  page.once('dialog', dialog => dialog.dismiss()); await applyRefresh(page).click();
  expect(await backup(page)).toEqual(before); expect(await rawRecord(page)).toBe(oldRaw);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await acceptRefresh(page);
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  const after = await backup(page);
  expect(after.schemaVersion).toBe(2); expect(after.id).toBe(before.id); expect(after.title).toBe(before.title);
  expect(after.dataset.id).not.toBe(before.dataset.id);
  expect(after.dataset).toMatchObject({ fileName: 'incoming-financials.csv', importedDate: DAY, synthetic: false });
  expect(after.dataset.companies).toEqual(NEW_ROWS);
  expect(after.watchlist).toEqual(['DELTA', 'ALFA', 'BRAVO']); expect(after.comparison).toEqual(['BRAVO', 'ALFA']);
  expect(after.notes).toEqual([{ ticker: 'ALFA', text: ALPHA_NOTE }, { ticker: 'BRAVO', text: 'Beta baseline note' }]);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  const report = await download(page, 'Download research report');
  expect(report).toContain('incoming-financials.csv:2'); expect(report).toContain('https://example.com/incoming-alpha');
  expect(report).toContain(ALPHA_NOTE); expect(report).not.toContain('previous-financials.csv'); expect(report).not.toContain(LOST_NOTE);
  expect(JSON.parse(await rawRecord(page) as string)).toEqual(after);
  await page.reload(); await expect(page.locator('#dataset-summary')).toContainText('incoming-financials.csv');
  expect(await backup(page)).toEqual(after);
});

test('explicit group decisions reset loss acknowledgement and drop the whole research group', async ({ page }) => {
  await loadNotebook(page); const before = await backup(page), raw = await rawRecord(page);
  await stageRefresh(page);
  await expect(proposedDownload(page)).toBeDisabled();
  await expect(page.locator('[data-refresh-annotation-ticker="ALFA"]')).toContainText(/automatically/i);
  await expect(page.locator('[data-refresh-annotation-ticker="CHARLIE"]')).toContainText(/absent|remove/i);
  await expect(page.locator('[data-refresh-period-key="ALFA:2025-03-31"]')).toContainText('Removed');
  await resolveRefresh(page);
  await expect(applyRefresh(page)).toBeEnabled();
  await retention(page).selectOption('drop');
  await expect(losses(page)).not.toBeChecked();
  await expect(applyRefresh(page)).toBeDisabled();
  await expect(proposedDownload(page)).toBeEnabled();
  const report = await download(page, 'Download refresh review');
  expect(report).toContain('Beta baseline note'); expect(report).toContain(LOST_NOTE);
  expect(await backup(page)).toEqual(before); expect(await rawRecord(page)).toBe(raw);
  await losses(page).check(); await acceptRefresh(page);
  const after = await backup(page);
  expect(after.watchlist).toEqual(['DELTA', 'ALFA']); expect(after.comparison).toEqual(['ALFA']);
  expect(after.notes).toEqual([{ ticker: 'ALFA', text: ALPHA_NOTE }]);
  expect(after.dataset.companies.some(row => row.ticker === 'BRAVO')).toBe(true);
});

test('dirty title, query, filter and note drafts survive review cancellation and require explicit discard', async ({ page }) => {
  const base = fixture({ screen: { ...DEFAULT_SCREEN, filters: [{ metric: 'growthPct', operator: 'gt', value: 0, currency: null }] } });
  await loadNotebook(page, base); await viewAlpha(page);
  const title = page.getByLabel('Notebook title', { exact: true }), query = page.getByLabel('Screening sentence', { exact: true });
  const note = page.getByLabel('Research note', { exact: true }), filter = page.locator('[data-filter-id] [name=value]').first();
  await title.fill('Unsent title'); await query.fill('Unsent invalid sentence'); await filter.fill('000.500'); await note.fill('Unsent note <b>kept literally</b>');
  const before = await backup(page), raw = await rawRecord(page);
  await stageRefresh(page); await resolveRefresh(page);
  await expect(applyRefresh(page)).toBeDisabled();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Discard editor drafts for refresh', exact: true }).click();
  await expect(title).toHaveValue('Unsent title'); await expect(query).toHaveValue('Unsent invalid sentence');
  await expect(filter).toHaveValue('000.500'); await expect(note).toHaveValue('Unsent note <b>kept literally</b>');
  await page.getByRole('button', { name: 'Cancel refresh', exact: true }).click();
  await expect(page.locator('#refresh-review')).toBeHidden();
  expect(await backup(page)).toEqual(before); expect(await rawRecord(page)).toBe(raw);
  await expect(note).toHaveValue('Unsent note <b>kept literally</b>');
  await stageRefresh(page); await resolveRefresh(page);
  page.once('dialog', async dialog => {
    expect(dialog.message()).toMatch(/draft|unsent/i); expect(dialog.message()).toMatch(/backup/i); await dialog.accept();
  });
  await page.getByRole('button', { name: 'Discard editor drafts for refresh', exact: true }).click();
  await expect(title).toHaveValue(base.title); await expect(query).toHaveValue(base.query);
  await expect(filter).toHaveValue('0'); await expect(note).toHaveValue(ALPHA_NOTE);
  await expect(retention(page)).toHaveValue(''); await expect(units(page)).not.toBeChecked(); await expect(losses(page)).not.toBeChecked();
  expect(await backup(page)).toEqual(before); expect(await rawRecord(page)).toBe(raw);
  await resolveRefresh(page); await expect(applyRefresh(page)).toBeEnabled();
});

test('saving drafts and interpreting an already saved sentence never revive stale review choices', async ({ page }) => {
  await loadNotebook(page, fixture({ query: 'companies with profitable' })); await viewAlpha(page);
  await stageRefresh(page); await resolveRefresh(page);
  await page.getByRole('button', { name: 'Interpret criteria', exact: true }).click();
  await expect(page.locator('#refresh-status')).toContainText(/out of date|rebuild/i);
  await expect(applyRefresh(page)).toBeDisabled(); await expect(proposedDownload(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(applyRefresh(page)).toBeDisabled(); await rebuild(page).click();
  await expect(retention(page)).toHaveValue(''); await expect(units(page)).not.toBeChecked();
  await resolveRefresh(page); await expect(applyRefresh(page)).toBeEnabled();
  await page.getByLabel('Notebook title', { exact: true }).fill('A title committed after staging');
  await expect(applyRefresh(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(applyRefresh(page)).toBeDisabled(); await rebuild(page).click(); await resolveRefresh(page);
  await expect(applyRefresh(page)).toBeEnabled();
  await page.getByLabel('Research note', { exact: true }).fill('A note committed after staging');
  await expect(applyRefresh(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(applyRefresh(page)).toBeDisabled(); await rebuild(page).click(); await resolveRefresh(page);
  await expect(applyRefresh(page)).toBeEnabled();
  await acceptRefresh(page);
  const after = await backup(page);
  expect(after.title).toBe('A title committed after staging');
  expect(after.notes.find(item => item.ticker === 'ALFA')?.text).toBe('A note committed after staging');
  expect(after.query).toBe('companies with profitable');
  expect(after.screen.filters).toEqual([{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }]);
});

test('delayed native reads cannot supersede a newer review, cancellation or unsent edits', async ({ page }) => {
  await page.addInitScript(() => {
    const control = { pending: [] as (() => void)[] };
    Object.defineProperty(window, 'refreshNativeReads', { value: control });
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return read.call(this).then(bytes => this.name.startsWith('held-')
        ? new Promise<ArrayBuffer>(resolve => control.pending.push(() => resolve(bytes))) : bytes);
    };
  });
  await loadNotebook(page); await viewAlpha(page);
  const before = await backup(page), raw = await rawRecord(page);
  const input = page.getByLabel('Refresh financial data', { exact: true });
  const sendHeld = async (name: string) => {
    await input.setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv(NEW_ROWS)) });
    await expect.poll(() => page.evaluate(() => (window as unknown as { refreshNativeReads: { pending: unknown[] } }).refreshNativeReads.pending.length)).toBe(1);
  };
  const release = async () => {
    await page.evaluate(() => { for (const finish of (window as unknown as { refreshNativeReads: { pending: (() => void)[] } }).refreshNativeReads.pending.splice(0)) finish(); });
    await settleReleasedRead(page);
  };
  await sendHeld('held-old.csv'); await stageRefresh(page, NEW_ROWS, 'newer.csv');
  await release(); await expect(page.locator('#refresh-summary')).toContainText('newer.csv');
  await expect(page.locator('#refresh-summary')).not.toContainText('held-old.csv');
  await sendHeld('held-cancelled.csv'); await page.getByRole('button', { name: 'Cancel refresh', exact: true }).click();
  await release(); await expect(page.locator('#refresh-review')).toBeHidden();
  await sendHeld('held-edited.csv');
  const note = page.getByLabel('Research note', { exact: true });
  await note.fill('Draft entered while native CSV bytes are pending'); await note.focus();
  await release();
  await expect(note).toHaveValue('Draft entered while native CSV bytes are pending'); await expect(note).toBeFocused();
  await expect(page.locator('#refresh-status')).toContainText(/choose.*complete CSV/i);
  await expect(applyRefresh(page)).toBeDisabled();
  expect(await backup(page)).toEqual(before); expect(await rawRecord(page)).toBe(raw);
});

test('invalid saved interpretation can be cleared explicitly while mixed-currency sorting requires reset', async ({ page }) => {
  const original = fixture();
  const base = fixture({ query: 'companies in "Vanished"', dataset: { ...original.dataset,
    companies: OLD_ROWS.map(row => row.ticker === 'CHARLIE' ? { ...row, sector: 'Vanished' } : { ...row }) } });
  await loadNotebook(page, base);
  await stageRefresh(page); await resolveRefresh(page);
  await expect(applyRefresh(page)).toBeDisabled(); await expect(proposedDownload(page)).toBeDisabled();
  await criteria(page, 'clearQuery').check(); await expect(applyRefresh(page)).toBeEnabled();
  await acceptRefresh(page); const cleared = await backup(page);
  expect(cleared.query).toBe(''); expect(cleared.screen).toEqual(DEFAULT_SCREEN);
  // A separately imported baseline has a valid all-USD monetary sort. The same sort
  // cannot rank the mixed supplied currencies in the incoming CSV.
  const sorted = fixture({ query: 'companies sorted by revenue descending', screen: { ...DEFAULT_SCREEN, sortBy: 'revenue', direction: 'desc' } });
  await page.getByLabel('Import notebook backup', { exact: true }).setInputFiles({ name: 'sorted-baseline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sorted)) });
  await expect(page.locator('#import-review')).toBeVisible();
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  await stageRefresh(page); await resolveRefresh(page);
  await expect(applyRefresh(page)).toBeDisabled(); await criteria(page, 'clearQuery').check();
  await expect(applyRefresh(page)).toBeDisabled(); await criteria(page, 'reset').check();
  await expect(applyRefresh(page)).toBeEnabled(); await acceptRefresh(page);
  const reset = await backup(page); expect(reset.query).toBe(''); expect(reset.screen).toEqual(DEFAULT_SCREEN);
});

test('failed native refresh save preserves old durable text while memory exports and retry recover', async ({ page }) => {
  await loadNotebook(page); const oldRaw = await rawRecord(page);
  await page.evaluate(() => {
    const nativePut = IDBObjectStore.prototype.put;
    Object.defineProperty(window, 'restoreRefreshPut', { value: () => { IDBObjectStore.prototype.put = nativePut; } });
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> {
      const request = key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key);
      if (this.name === 'notebooks') request.onsuccess = () => this.transaction.abort();
      return request;
    };
  });
  await stageRefresh(page); await resolveRefresh(page); await acceptRefresh(page);
  await expect(page.locator('#save-status')).toContainText(/not saved/i);
  expect(await rawRecord(page)).toBe(oldRaw);
  const memory = await backup(page); expect(memory.dataset.companies).toEqual(NEW_ROWS);
  const report = await download(page, 'Download research report');
  expect(report).toContain('incoming-financials.csv:2'); expect(report).not.toContain('previous-financials.csv');
  await page.evaluate(() => (window as unknown as { restoreRefreshPut: () => void }).restoreRefreshPut());
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  expect(JSON.parse(await rawRecord(page) as string)).toEqual(memory);
  await page.reload(); await expect(page.locator('#dataset-summary')).toContainText('incoming-financials.csv');
  expect(await backup(page)).toEqual(memory);
});

test('older in-flight native save cannot mark refreshed memory saved when its queued write aborts', async ({ page }) => {
  await loadNotebook(page);
  await page.evaluate(() => {
    const nativeTransaction = IDBDatabase.prototype.transaction;
    const control = { count: 0, hold: true, statuses: [] as string[] };
    Object.defineProperty(window, 'refreshWriteRace', { value: control });
    Object.defineProperty(window, 'restoreRefreshTransaction', { value: () => { IDBDatabase.prototype.transaction = nativeTransaction; } });
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof nativeTransaction>) {
      const tx = nativeTransaction.apply(this, args);
      if (this.name === 'stock-notebook-v1' && args[1] === 'readwrite') {
        control.count += 1;
        if (control.count === 1) {
          const keepAlive = () => {
            tx.objectStore('notebooks').get('current').onsuccess = () => { if (control.hold) keepAlive(); };
          };
          keepAlive();
        } else tx.objectStore('notebooks').get('current').onsuccess = () => tx.abort();
      }
      return tx;
    };
  });
  await page.getByLabel('Notebook title', { exact: true }).fill('Older durable title transaction');
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { refreshWriteRace: { count: number } }).refreshWriteRace.count)).toBe(1);
  await stageRefresh(page); await resolveRefresh(page); await acceptRefresh(page);
  const refreshed = await backup(page);
  await expect(page.locator('#save-status')).not.toContainText('Saved locally');
  await page.evaluate(() => {
    const control = (window as unknown as { refreshWriteRace: { hold: boolean; statuses: string[] } }).refreshWriteRace;
    const status = document.querySelector('#save-status')!;
    new MutationObserver(() => control.statuses.push(status.textContent ?? '')).observe(status, { childList: true, subtree: true, characterData: true });
    control.hold = false;
  });
  await expect(page.locator('#save-status')).toContainText(/not saved/i);
  const durable = JSON.parse(await rawRecord(page) as string) as Notebook;
  expect(durable.title).toBe('Older durable title transaction'); expect(durable.dataset.fileName).toBe('previous-financials.csv');
  const statuses = await page.evaluate(() => (window as unknown as { refreshWriteRace: { statuses: string[] } }).refreshWriteRace.statuses);
  expect(statuses.some(status => status.includes('Saved locally'))).toBe(false);
  expect(await backup(page)).toEqual(refreshed);
  await page.evaluate(() => (window as unknown as { restoreRefreshTransaction: () => void }).restoreRefreshTransaction());
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  expect(JSON.parse(await rawRecord(page) as string)).toEqual(refreshed);
});

test('read-only v1 restoration and cancelled refresh preserve exact legacy text until explicit refresh save', async ({ page }) => {
  await loadNotebook(page);
  const original = fixture();
  const legacy = { ...original, schemaVersion: 1, dataset: { ...original.dataset, companies: OLD_ROWS.slice(1) } };
  const legacyText = JSON.stringify(legacy, null, 2) + '\n';
  await page.evaluate(raw => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('stock-notebook-v1', 1); open.onerror = () => reject(new Error('Could not seed native legacy record.'));
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('notebooks', 'readwrite');
      tx.objectStore('notebooks').put(raw, 'current');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(new Error('Legacy seed aborted.')); };
    };
  }), legacyText);
  await page.reload(); await expect(page.locator('#dataset-summary')).toContainText('previous-financials.csv');
  expect((await backup(page)).schemaVersion).toBe(2); expect(await rawRecord(page)).toBe(legacyText);
  await stageRefresh(page); await resolveRefresh(page);
  const previous = JSON.parse(await download(page, 'Download previous notebook')) as Notebook;
  expect(previous.schemaVersion).toBe(2); expect(previous.dataset.companies).toEqual(OLD_ROWS.slice(1));
  await page.getByRole('button', { name: 'Cancel refresh', exact: true }).click();
  expect(await rawRecord(page)).toBe(legacyText);
  await stageRefresh(page); await resolveRefresh(page); await acceptRefresh(page);
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  const saved = JSON.parse(await rawRecord(page) as string) as Notebook;
  expect(saved.schemaVersion).toBe(2); expect(saved.dataset.companies).toEqual(NEW_ROWS);
  expect(saved.id).toBe(original.id); expect(saved.notes.find(note => note.ticker === 'ALFA')?.text).toBe(ALPHA_NOTE);
});

test('UTC date change during final confirmation blocks publication until a fresh review is rebuilt', async ({ page }) => {
  await loadNotebook(page); const before = await backup(page), raw = await rawRecord(page);
  await stageRefresh(page); await resolveRefresh(page);
  // A native modal blocks page JavaScript, including Playwright's clock installer.
  // Change Date immediately when the real confirmation returns, before the app's
  // synchronous post-consent check. No refresh handler is mocked or bypassed.
  await page.evaluate(() => {
    const NativeDate = window.Date, nativeConfirm = window.confirm;
    let consentReturned = false;
    window.Date = class extends NativeDate {
      constructor(value?: string | number) { super(value ?? (consentReturned ? NativeDate.parse('2026-10-05T00:00:01Z') : NativeDate.now())); }
    } as DateConstructor;
    window.confirm = message => { const accepted = nativeConfirm(message); if (accepted) consentReturned = true; return accepted; };
  });
  page.once('dialog', dialog => dialog.accept());
  await applyRefresh(page).click();
  await expect(page.locator('#refresh-status')).toContainText(/date|rebuild|out of date/i);
  expect(await backup(page)).toEqual(before); expect(await rawRecord(page)).toBe(raw);
  await expect(applyRefresh(page)).toBeDisabled(); await expect(proposedDownload(page)).toBeDisabled();
  await rebuild(page).click(); await expect(units(page)).not.toBeChecked(); await expect(retention(page)).toHaveValue('');
  await resolveRefresh(page); await acceptRefresh(page);
  expect((await backup(page)).dataset.importedDate).toBe(DAY);
});

test('mobile keyboard review paginates literal annual rows while the proposed report remains complete', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await loadNotebook(page);
  const literal = '<img src=x onerror=window.REFRESH_BAD=true> 🧾';
  const rows = [...NEW_ROWS, ...Array.from({ length: 56 }, (_, index): Company => ({ ...OLD_ROWS[4]!,
    ticker: `T${String(index).padStart(3, '0')}`, name: index === 0 ? literal : `Additional company ${index}`,
    sourceLine: index + 6, filingUrl: `https://example.com/incoming-extra-${index}` }))];
  await stageRefresh(page, rows);
  const periods = page.locator('[data-refresh-period-key]');
  await expect(periods).toHaveCount(50); await expect(page.locator('#refresh-period-page')).toHaveText('1–50 of 62 annual periods');
  await expect(page.locator('[data-refresh-period-key="T000:2026-03-31"]')).toContainText(literal);
  await expect(page.locator('#refresh-review img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next changes', exact: true }).click();
  await expect(periods).toHaveCount(12); await expect(page.locator('#refresh-period-page')).toHaveText('51–62 of 62 annual periods');
  await expect(page.locator('[data-refresh-period-key="T055:2026-03-31"]')).toContainText('incoming-financials.csv:61');
  await expect(page.getByRole('button', { name: 'Next changes', exact: true })).toBeDisabled();
  await retention(page).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(retention(page)).toHaveValue('keep');
  const report = await download(page, 'Download refresh review');
  expect((report.match(/^Refresh period: /gm) ?? []).length).toBe(62);
  for (const row of [...rows, OLD_ROWS[0]!, OLD_ROWS[3]!]) {
    expect(report.split(`Refresh period: ${row.ticker} — ${row.fiscalDate}\n`).length - 1).toBe(1);
  }
  expect(report).toContain(literal); expect(report).toContain('incoming-financials.csv:61');
  await units(page).focus(); await page.keyboard.press('Space'); await losses(page).focus(); await page.keyboard.press('Space');
  await expect(applyRefresh(page)).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  page.once('dialog', dialog => dialog.accept()); await applyRefresh(page).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#dataset-summary')).toContainText('incoming-financials.csv');
  expect((await backup(page)).dataset.companies).toEqual(rows);
});

test('invalid incoming CSV never publishes, saves or erases existing raw research drafts', async ({ page }) => {
  await loadNotebook(page); await viewAlpha(page);
  const before = await backup(page), raw = await rawRecord(page);
  const note = page.getByLabel('Research note', { exact: true }); await note.fill('Unsent work survives rejected incoming periods');
  await page.getByLabel('Refresh financial data', { exact: true }).setInputFiles({ name: 'duplicate-period.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([NEW_ROWS[0]!, NEW_ROWS[0]!])) });
  await expect(page.locator('#refresh-errors')).toBeVisible();
  await expect(page.locator('#refresh-errors')).toContainText(/duplicate/i);
  await expect(note).toHaveValue('Unsent work survives rejected incoming periods');
  expect(await backup(page)).toEqual(before); expect(await rawRecord(page)).toBe(raw);
  await expect(applyRefresh(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel refresh', exact: true }).click();
  await expect(note).toHaveValue('Unsent work survives rejected incoming periods');
});
