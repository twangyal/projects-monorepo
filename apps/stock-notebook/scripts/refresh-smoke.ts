/** Original maximum-bound refresh fixture and independent retention/provenance checks. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseCsv, createDataset } from '../src/csv.ts';
import { createNotebook, validateNotebook, parseNotebookJson, serializeNotebook } from '../src/model.ts';
import { reviewRefresh, applyRefresh, type RefreshChoices } from '../src/refresh.ts';
import { buildRefreshReport } from '../src/refresh-report.ts';
import { buildReport } from '../src/exports.ts';

const directory = mkdtempSync(join(tmpdir(), 'stock-refresh-'));
const today = '2026-10-04';
const header = 'ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url';
const ticker = (index: number): string => `T${String(index).padStart(3, '0')}`;
const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
function fixture(firstYear: number, baseRevenue: number): Uint8Array {
  const rows: string[][] = [];
  for (let company = 0; company < 100; company++) {
    // Deliberately unsorted, so source order cannot stand in for fiscal order.
    for (const offset of [2, 4, 0, 3, 1]) {
      const year = firstYear + offset, revenue = baseRevenue + company + offset * 20;
      rows.push([ticker(company), `Original refresh company ${company}`, 'Research', 'USD',
        `${year}-06-30`, String(revenue), String(revenue - 20), String(revenue / 10),
        String(100 - offset * 10), '200', `https://example.com/refresh/${company}/${year}/` + 'p'.repeat(1900)]);
    }
  }
  const encode = (): Uint8Array => new TextEncoder().encode(header + '\n' + rows.map(row => row.join(',')).join('\n') + '\n');
  rows[0][1] += ' '.repeat(2 * 1024 * 1024 - encode().length);
  const bytes = encode();
  assert.equal(bytes.length, 2 * 1024 * 1024);
  return bytes;
}
const timings: Record<string, number> = {};
function measure<T>(name: string, operation: () => T): T {
  const started = performance.now(), result = operation();
  timings[name] = performance.now() - started;
  return result;
}
const previousCsv = fixture(2012, 100), incomingCsv = fixture(2022, 300);
writeFileSync(join(directory, 'refresh-before.csv'), previousCsv);
writeFileSync(join(directory, 'refresh-incoming.csv'), incomingCsv);
const previousDataset = measure('parsePreviousMs', () => createDataset(parseCsv(previousCsv, 'refresh-before.csv', today), today));
const incoming = measure('parseIncomingMs', () => createDataset(parseCsv(incomingCsv, 'refresh-incoming.csv', today), today));
const draft = createNotebook(previousDataset, today);
draft.title = 'Original maximum refresh research';
draft.query = 'companies with profitable sorted by revenue descending';
draft.screen = { sector: null, currency: null, filters: [{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }], includeStale: true, sortBy: 'revenue', direction: 'desc' };
draft.watchlist = Array.from({ length: 100 }, (_, i) => ticker(99 - i));
draft.comparison = ['T080', 'T000', 'T050', 'T099'];
draft.notes = Array.from({ length: 100 }, (_, i) => {
  const prefix = `${ticker(i)} original research <literal> & retained: `;
  return { ticker: ticker(i), text: prefix + '研'.repeat(4000 - [...prefix].length) };
});
const base = validateNotebook(draft, today);
const before = serializeNotebook(base, today);
writeFileSync(join(directory, 'previous-notebook.json'), before);
const choices: RefreshChoices = { criteria: 'keep', annotations: [] };
const review = measure('reviewMs', () => reviewRefresh(base, incoming, today));
assert.equal(review.periods.length, 1000);
assert.equal(review.periods.filter(period => period.kind === 'removed').length, 500);
assert.equal(review.periods.filter(period => period.kind === 'added').length, 500);
assert.equal(review.companies.length, 100);
assert.equal(review.annotations.length, 100);
assert.ok(review.annotations.every(group => group.policy === 'keep'));
assert.deepEqual(review.criteria[0].matchedTickers, Array.from({ length: 100 }, (_, i) => ticker(99 - i)));
const next = measure('applyMs', () => applyRefresh(base, incoming, choices, today));
assert.equal(next.id, base.id);
assert.equal(next.title, base.title);
assert.equal(next.query, base.query);
assert.deepEqual(next.screen, base.screen);
assert.deepEqual(next.dataset, incoming);
assert.deepEqual(next.watchlist, draft.watchlist);
assert.deepEqual(next.comparison, ['T080', 'T000', 'T050', 'T099']);
assert.deepEqual(next.notes, draft.notes);
assert.equal(next.dataset.companies[1].fiscalDate, '2026-06-30');
assert.equal(next.dataset.companies[1].revenue, 380);
assert.equal(next.dataset.companies[496].revenue, 479);
const after = serializeNotebook(next, today);
assert.deepEqual(parseNotebookJson(after, today), next);
const report = measure('refreshReportMs', () => buildRefreshReport(base, incoming, choices, today));
assert.ok(report.startsWith('Proposed CSV refresh review — not an applied or saved transaction'));
const periodSection = report.split('Annual period changes begin\n')[1]?.split('Annual period changes end')[0];
assert.ok(periodSection);
const expectedPeriods = Array.from({ length: 100 }, (_, i) => [...Array.from({ length: 5 }, (_, y) => 2012 + y), ...Array.from({ length: 5 }, (_, y) => 2022 + y)].map(year => `Refresh period: ${ticker(i)} — ${year}-06-30`)).flat();
assert.deepEqual(periodSection.split('\n').filter(line => line.startsWith('Refresh period: ')), expectedPeriods);
assert.ok(report.includes('refresh-before.csv:501'));
assert.ok(report.includes('refresh-incoming.csv:501'));
for (const note of draft.notes) assert.ok(report.includes(note.text), note.ticker);
assert.ok(Buffer.byteLength(report) <= 8 * 1024 * 1024);
const research = measure('researchReportMs', () => buildReport(next, today));
assert.ok(research.includes('refresh-incoming.csv:501'));
assert.ok(!research.includes('refresh-before.csv'));
assert.equal(serializeNotebook(base, today), before);
writeFileSync(join(directory, 'refreshed-notebook.json'), after);
writeFileSync(join(directory, 'proposed-refresh.txt'), report);
writeFileSync(join(directory, 'research.txt'), research);
const result = {
  date: today, node: process.version, platform: `${process.platform} ${process.arch}`,
  fixture: { companies: 100, annualRowsPerInput: 500, periodsPerTicker: 5, unionPeriods: 1000,
    csvBytesPerInput: previousCsv.length, csvSha256: { previous: digest(previousCsv), incoming: digest(incomingCsv) },
    retainedWatchlistEntries: 100, retainedComparisonEntries: 4, retainedNotes: 100, codePointsPerNote: 4000,
    note: 'Original fictional data, disjoint five-year periods, retained long source links and maximum Unicode note lengths. Exact CSV bound includes trimmed padding. No source link is fetched.' },
  timings,
  artifacts: Object.fromEntries(Object.entries({ before, after, report, research }).map(([name, value]) => [name, { bytes: Buffer.byteLength(value), sha256: digest(value) }])),
  verified: ['1,000 complete old/new period records', 'independent latest-period ordering and amounts', 'unchanged notebook identity and applied criteria', 'exact ordered research retention', 'complete correctly attributed proposed report', 'incoming-only final research provenance', 'exact schema-v3 JSON roundtrip', 'unchanged previous notebook'],
  limitation: 'One Node sample and specific maximum-bound fixture, not a browser or performance guarantee. Native browser publication/persistence is verified separately.',
};
writeFileSync(join(directory, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ directory, ...result }, null, 2) + '\n');
