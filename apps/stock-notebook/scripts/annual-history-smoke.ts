/** Original maximum-bound fixture and independent arithmetic checks. No remote data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseCsv, createDataset } from '../src/csv.ts';
import { createNotebook, parseNotebookJson, serializeNotebook } from '../src/model.ts';
import { screenDataset } from '../src/research.ts';
import { analyzeCompanyHistory } from '../src/annual-history.ts';
import { buildReport } from '../src/exports.ts';

const directory = mkdtempSync(join(tmpdir(), 'stock-annual-history-'));
const today = '2026-10-04';
const header = 'ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url';
const rows: string[][] = [];
for (let company = 0; company < 100; company++) {
  for (const year of [2024, 2026, 2022, 2025, 2023]) {
    const revenue = 100 + company + (year - 2022) * 20;
    rows.push([`T${String(company).padStart(3, '0')}`, `Original Annual Fixture ${company}`, 'Industry', 'USD',
      `${year}-06-30`, String(revenue), String(revenue - 20), (revenue / 10).toFixed(1),
      String(100 - (year - 2022) * 10), '200', `https://example.com/original/${company}/${year}/` + 'p'.repeat(1900)]);
  }
}
// Original fixture cells contain no commas/quotes/newlines. Padding is trimmed
// by import, while long per-row source links remain part of retained evidence.
const encode = () => new TextEncoder().encode(header + '\n' + rows.map(row => row.join(',')).join('\n') + '\n');
rows[0][1] += ' '.repeat(2 * 1024 * 1024 - encode().length);
const csv = encode();
assert.equal(csv.length, 2 * 1024 * 1024);
writeFileSync(join(directory, 'annual-history-max.csv'), csv);
const timings: Record<string, number> = {};
function measure<T>(name: string, operation: () => T): T {
  const started = performance.now();
  const result = operation();
  timings[name] = performance.now() - started;
  return result;
}
const preview = measure('parseCsvMs', () => parseCsv(csv, 'annual-history-max.csv', today));
const notebook = measure('createNotebookMs', () => createNotebook(createDataset(preview, today, true), today));
const screened = measure('screenMs', () => screenDataset(notebook.dataset, notebook.screen, today));
assert.equal(notebook.schemaVersion, 2);
assert.equal(notebook.dataset.companies.length, 500);
assert.equal(screened.rows.length, 100);
assert.deepEqual(screened.rows.map(row => row.company.sourceLine), Array.from({length: 100}, (_, i) => 3 + i * 5));
assert.equal(screened.rows[0].company.revenue, 180);
assert.equal(screened.rows[99].company.revenue, 279);
const history = measure('oneCompanyHistoryMs', () => analyzeCompanyHistory(notebook.dataset, 'T000', today));
assert.deepEqual(history.periods.map(row => row.company.revenue), [100, 120, 140, 160, 180]);
assert.deepEqual(history.periods.map(row => row.company.sourceLine), [4, 6, 2, 5, 3]);
assert.deepEqual(history.comparisons.map(pair => pair.changes.map(change => change.delta)), Array.from({length: 4}, () => [20, -10, 0]));
assert.deepEqual(history.trends.map(trend => trend.direction), ['increasing', 'decreasing', 'flat']);
const backup = measure('serializeMs', () => serializeNotebook(notebook, today));
assert.deepEqual(parseNotebookJson(backup, today), notebook);
const report = measure('reportMs', () => buildReport(notebook, today));
assert.ok(report.includes('annual-history-max.csv:501'));
assert.ok(report.includes('https://example.com/original/99/2023/'));
writeFileSync(join(directory, 'notebook.json'), backup);
writeFileSync(join(directory, 'research.txt'), report);
const result = {
  date: today, node: process.version, platform: `${process.platform} ${process.arch}`,
  fixture: {companies: 100, annualRows: 500, periodsPerTicker: 5, csvBytes: csv.length,
    sha256: createHash('sha256').update(csv).digest('hex'), lastSourceLine: 501,
    note: 'Original fictional data; exact CSV byte bound uses long retained source links and trimmed whitespace padding. No source URL is fetched.'},
  timings, notebookBytes: Buffer.byteLength(backup), reportBytes: Buffer.byteLength(report),
  verified: ['latest period independent of source order', 'all raw rows preserved', 'exact annual change and direction oracle', 'schema v2 JSON roundtrip', 'final source row and link retained in report'],
  limitation: 'One Node runtime sample with a specific bounded fixture; not a performance guarantee. Browser workflow is measured separately.',
};
writeFileSync(join(directory, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({directory, ...result}, null, 2) + '\n');
