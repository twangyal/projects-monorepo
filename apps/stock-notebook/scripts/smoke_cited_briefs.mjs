/* global document, URL, process, performance, Buffer, structuredClone, console, TextDecoder */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

// Independent original inputs and expectations. No application modules,
// serializers, validators, storage injection, clock mocking or route responses.
const base = new URL(process.env.STOCK_BRIEFS_BASE_URL ?? '');
assert.equal(base.protocol, 'http:');
assert.ok(['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname), 'Use the root-owned local production preview.');
const out = path.resolve(process.env.STOCK_BRIEFS_OUTPUT_DIR ?? `/tmp/stock-briefs-${Date.now()}`);
const executablePath = process.env.STOCK_BRIEFS_CHROMIUM ?? process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
await mkdir(out); // Refuse to overwrite prior evidence.
await mkdir(path.join(out, 'inputs')); await mkdir(path.join(out, 'downloads'));
const began = performance.now();
const today = new Date().toISOString().slice(0, 10);
const id = n => `67000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const clone = value => structuredClone(value);
const companies = [], briefs = [];
for (let n = 0; n < 50; n++) {
  const ticker = `S${String(n).padStart(2, '0')}`;
  const old = { ticker, name: `Original company ${n}`, sector: 'Tools', currency: 'USD', fiscalDate: '2024-12-31', revenue: 125.000001 + n, priorRevenue: 50 + n, netIncome: -0.000001, debt: null, equity: 0, filingUrl: `https://sources.example/old/${ticker}?edition=original`, sourceLine: 2 + 2 * n };
  companies.push(old, { ...old, fiscalDate: '2025-12-31', revenue: 700 + n, priorRevenue: 600 + n, sourceLine: 3 + 2 * n, filingUrl: `https://sources.example/latest/${ticker}` });
  const prefix = `  Literal supplied excerpt ${ticker} 😀\r\n<script>not executable</script>\n`;
  const excerpt = prefix + '🧪'.repeat(4000 - [...prefix].length - 2) + '  ';
  assert.equal([...excerpt].length, 4000);
  briefs.push({ ticker, statements: [{ id: id(1000 + n), section: ['business', 'risks', 'questions'][n % 3], text: `  Independent statement ${ticker} 😀\r\nSupplied evidence is not verification.  `, citationIds: [id(2000 + n), id(3000 + n)] }], citations: [
    { id: id(2000 + n), kind: 'annual', fields: ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'], snapshot: { datasetId: id(1), fileName: 'original-annuals.csv', importedDate: '2026-09-01', basis: 'annual-12-month', units: 'currency-millions', synthetic: false, company: clone(old) } },
    { id: id(3000 + n), kind: 'excerpt', title: `  Original title ${ticker}  `, author: ` Author ${n} `, publishedDate: '2024-02-29', url: `https://sources.example/excerpt/${ticker}?x=1&y=2`, excerpt },
  ] });
}
// Fill only legal statement text, retaining all explicit literal end spaces,
// to the independently counted exact UTF-8 graph boundary.
let remaining = 1024 * 1024 - bytes(briefs);
assert.ok(remaining > 0);
for (const brief of briefs) {
  const statement = brief.statements[0];
  const capacity = 1200 - [...statement.text].length;
  const count = Math.min(capacity, Math.floor(remaining / 4));
  statement.text = statement.text.slice(0, -2) + '🌱'.repeat(count) + '  ';
  remaining -= 4 * count;
  if (remaining > 0 && remaining < 4 && capacity - count >= remaining) {
    statement.text = statement.text.slice(0, -2) + 'x'.repeat(remaining) + '  '; remaining = 0;
  }
  if (!remaining) break;
}
assert.equal(remaining, 0); assert.equal(bytes(briefs), 1_048_576);
assert.equal(briefs.length, 50); assert.equal(briefs.flatMap(b => b.citations).length, 100);
for (const brief of briefs) assert.ok([...brief.statements[0].text].length <= 1200);
const fixture = { schemaVersion: 3, id: id(2), dataset: { id: id(1), fileName: 'original-annuals.csv', importedDate: '2026-09-01', basis: 'annual-12-month', units: 'currency-millions', synthetic: false, companies }, title: 'Original maximum cited research', query: '', screen: { sector: null, currency: null, filters: [], includeStale: true, sortBy: 'ticker', direction: 'asc' }, watchlist: [], comparison: [], notes: [{ ticker: 'S00', text: 'Separate existing research note.' }], briefs };
const incomingRows = companies.filter((_, n) => n % 2 === 1).map((row, n) => ({ ...row, name: `Renamed company ${n}`, filingUrl: `https://sources.example/refreshed/${row.ticker}`, sourceLine: n + 2 }));
const csvHeader = 'ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url';
const csvValue = value => value === null ? '' : `"${String(value).replaceAll('"', '""')}"`;
const csv = csvHeader + '\n' + incomingRows.map(row => [row.ticker, row.name, row.sector, row.currency, row.fiscalDate, row.revenue, row.priorRevenue, row.netIncome, row.debt, row.equity, row.filingUrl].map(csvValue).join(',')).join('\n') + '\n';
const inputPath = path.join(out, 'inputs', 'maximum-briefs.json'), csvPath = path.join(out, 'inputs', 'incoming-annuals.csv');
await writeFile(inputPath, JSON.stringify(fixture)); await writeFile(csvPath, csv);
const expectation = { briefCount: 50, citationCount: 100, statementCount: 50, graphBytes: 1_048_576, notebookBytes: bytes(fixture), sourceAnnualRows: 100, incomingAnnualRows: 50, retainedBriefsSha256: sha(JSON.stringify(briefs)), expectedMissingSnapshots: 50, expectedKeepDecisions: 50, oldSnapshotDate: '2024-12-31', currentDate: '2025-12-31', sourceFile: 'original-annuals.csv', incomingFile: 'incoming-annuals.csv', noExternalRequests: true };
await writeFile(path.join(out, 'frozen-expectations.json'), JSON.stringify(expectation, null, 2));
console.log(JSON.stringify({ phase: 'expectations-frozen', output: out, ...expectation }));
if (process.env.STOCK_BRIEFS_FIXTURE_ONLY === '1') process.exit(0);

let context;
const pageErrors = [], externalRequests = [], artifacts = [];
async function launch() {
  context = await chromium.launchPersistentContext(path.join(out, 'profile'), { executablePath, headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(30_000);
  context.on('page', observe);
  for (const page of context.pages()) observe(page);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(base.href); return page;
}
function observe(page) {
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== base.origin) externalRequests.push(url.href); });
}
async function download(page, label, filename) {
  const target = page.getByRole('button', { name: label, exact: true }); await expect(target).toBeEnabled();
  const pending = page.waitForEvent('download'); await target.click(); const file = await pending;
  const destination = path.join(out, 'downloads', filename); await file.saveAs(destination);
  const raw = await readFile(destination); artifacts.push({ file: destination, bytes: raw.length, sha256: sha(raw), suggestedFilename: file.suggestedFilename() }); return raw;
}
async function saved(page) { await expect(page.locator('#save-status')).toContainText('Saved locally', { timeout: 30_000 }); }
async function openFile(page, file, replacing) {
  await page.getByLabel('Import notebook backup', { exact: true }).setInputFiles(file);
  await expect(page.locator('#import-review')).toBeVisible();
  await page.getByLabel('I confirm currency millions and comparable 12-month annual periods', { exact: true }).check();
  if (replacing) page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Replace universe', exact: true }).click();
  await saved(page); await expect(page.getByLabel('Notebook title', { exact: true })).toHaveValue(fixture.title);
}
async function viewFirst(page) {
  await page.locator('#results [data-ticker="S00"]').getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(page.locator('#company-brief')).toBeVisible();
}
function reportEvidence(raw, selected = briefs, missing = false) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  assert.ok(text.endsWith('\n')); assert.ok(raw.length <= 8 * 1024 * 1024);
  for (const brief of selected) {
    for (const statement of brief.statements) { assert.ok(text.includes(statement.text), `Exact literal ${statement.id}`); assert.ok(text.includes(statement.id)); }
    for (const citation of brief.citations) {
      assert.ok(text.includes(citation.id));
      if (citation.kind === 'excerpt') {
        for (const literal of [citation.title, citation.author, citation.publishedDate, citation.url, citation.excerpt]) assert.ok(text.includes(literal), `Complete excerpt metadata ${citation.id}`);
      } else {
        const source = citation.snapshot;
        for (const literal of [source.datasetId, source.fileName, source.importedDate, source.company.ticker, source.company.fiscalDate, source.company.name, source.company.filingUrl, String(source.company.revenue), String(source.company.priorRevenue), '-0.000001']) assert.ok(text.includes(literal), `Complete captured provenance ${citation.id}`);
      }
    }
  }
  assert.match(text, /not.*verif|unverified/i);
  if (missing) assert.match(text, /missing.*comparison dataset|missing.*period/i);
  return { bytes: raw.length, sha256: sha(raw), exactLiteralStatements: selected.length, exactLiteralExcerpts: selected.length };
}
const results = {};
try {
  let page = await launch();
  results.browser = await context.browser().version();
  await openFile(page, inputPath, false);
  const first = await download(page, 'Download notebook backup', 'initial.json');
  assert.deepEqual(JSON.parse(first), fixture);
  await viewFirst(page);
  results.standalone = reportEvidence(await download(page, 'Download company brief', 'initial-company.txt'), [briefs[0]]);
  results.initialReport = reportEvidence(await download(page, 'Download research report', 'initial-full.txt'));
  await page.screenshot({ path: path.join(out, 'desktop.png') });
  await openFile(page, path.join(out, 'downloads', 'initial.json'), true);
  const reopened = await download(page, 'Download notebook backup', 'reopened.json'); assert.deepEqual(reopened, first);

  await page.getByLabel('Refresh financial data', { exact: true }).setInputFiles(csvPath);
  await expect(page.getByRole('combobox', { name: 'Research retention for S00', exact: true })).toBeVisible();
  for (const brief of briefs) await page.getByRole('combobox', { name: `Research retention for ${brief.ticker}`, exact: true }).selectOption('keep');
  await page.getByLabel('I confirm the refreshed CSV uses currency millions and comparable 12-month annual periods', { exact: true }).check();
  await page.getByLabel('I reviewed the annual periods and research that will be removed', { exact: true }).check();
  results.proposedReport = reportEvidence(await download(page, 'Download refresh review', 'proposed-refresh.txt'), briefs, true);
  const previous = await download(page, 'Download previous notebook', 'previous-before-refresh.json'); assert.deepEqual(previous, first);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Apply reviewed refresh', exact: true }).click(); await saved(page);
  const after = await download(page, 'Download notebook backup', 'after-refresh.json'), imported = JSON.parse(after);
  assert.match(imported.dataset.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/); assert.notEqual(imported.dataset.id, fixture.dataset.id);
  assert.equal(new Date().toISOString().slice(0, 10), today, 'UTC turnover: rerun the complete probe with one day.');
  assert.deepEqual(imported, { ...fixture, dataset: { ...fixture.dataset, id: imported.dataset.id, fileName: 'incoming-annuals.csv', importedDate: today, companies: incomingRows } });
  assert.equal(bytes(imported.briefs), 1_048_576); assert.equal(sha(JSON.stringify(imported.briefs)), expectation.retainedBriefsSha256);
  await viewFirst(page); await expect(page.locator('[data-citation-state="missing"]')).toHaveCount(1);
  results.afterReport = reportEvidence(await download(page, 'Download research report', 'after-refresh-full.txt'), briefs, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#company-brief').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  await page.screenshot({ path: path.join(out, 'mobile.png') });
  await context.close(); context = undefined;
  page = await launch(); await saved(page);
  await expect(page.locator('#save-status')).toContainText('restored');
  const restarted = await download(page, 'Download notebook backup', 'after-process-restart.json'); assert.deepEqual(restarted, after);
  const restartedReport = await download(page, 'Download research report', 'after-process-restart-full.txt');
  assert.deepEqual(restartedReport, await readFile(path.join(out, 'downloads', 'after-refresh-full.txt')));
  results.restart = { completeChromiumProcessRelaunch: true, byteIdenticalNotebook: true, byteIdenticalReport: true, notebookBytes: after.length, notebookSha256: sha(after) };
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  await context.close(); context = undefined;
  await writeFile(path.join(out, 'verification.json'), JSON.stringify({ passed: true, elapsedSeconds: (performance.now() - began) / 1000, base: base.origin, expectation, ...results, pageErrors, externalRequests, artifacts, controlledBoundaries: [], limitations: ['Source authenticity and statement support are not verified.', 'Only supplied local CSV/JSON data was used; source HTTPS links were not opened.'] }, null, 2));
  console.log(JSON.stringify({ passed: true, output: out, elapsedSeconds: (performance.now() - began) / 1000, ...results }));
} catch (error) {
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ passed: false, message: error.stack, elapsedSeconds: (performance.now() - began) / 1000, expectation, results, pageErrors, externalRequests, artifacts }, null, 2));
  throw error;
} finally { await context?.close(); }
