import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport } from '../src/exports.ts';
import type { Notebook } from '../src/types.ts';
import { serializeNotebook } from '../src/model.ts';

function notebook(): Notebook {
  return {
    schemaVersion: 1, id: '00000000-0000-4000-8000-000000000001', title: 'Explicit research study',
    dataset: {
      id: '00000000-0000-4000-8000-000000000002', fileName: 'annual-supplied.csv', importedDate: '2026-10-03',
      basis: 'annual-12-month', units: 'currency-millions', synthetic: false,
      companies: [
        { ticker: 'AAA', name: '<script>literal supplied name</script>', sector: 'Software', currency: 'USD', fiscalDate: '2026-06-30', revenue: 120, priorRevenue: 100, netIncome: 12, debt: 40, equity: 80, filingUrl: 'https://example.com/supplied-a', sourceLine: 2 },
        { ticker: 'BBB', name: 'Original B', sector: 'Materials', currency: 'EUR', fiscalDate: '2025-04-03', revenue: 90, priorRevenue: 100, netIncome: -4, debt: 60, equity: 20, filingUrl: null, sourceLine: 3 },
      ],
    },
    query: 'companies with growing', screen: { sector: null, currency: 'USD', filters: [{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }], includeStale: false, sortBy: 'marginPct', direction: 'desc' },
    watchlist: ['BBB'], comparison: ['BBB', 'AAA'], notes: [{ ticker: 'AAA', text: '=literal formula-like note\nResearch <b>is plain text</b>' }],
  };
}

test('report rejects an invalid notebook and invalid evaluation date', () => {
  assert.throws(() => buildReport({} as Notebook, '2026-10-04'), /notebook|object|schema|fields/i);
  assert.throws(() => buildReport({} as Notebook, '2026-02-29'), /date|today/i);
});

test('plain report contains applied criteria, exact facts/formulas and supplied source provenance', () => {
  const input = notebook();
  const before = JSON.stringify(input);
  const report = buildReport(input, '2026-10-04');
  assert.ok(report.startsWith('Stock Notebook research report\n'));
  for (const text of ['Explicit research study', '2026-10-04', 'annual-supplied.csv', '2026-10-03', 'annual-12-month', 'currency-millions', 'companies with growing', 'Filters edited after interpretation', 'netIncome > 0', 'USD', 'marginPct descending', 'Exclude stale', 'annual-supplied.csv:2', 'https://example.com/supplied-a', 'Supplied source link', '120', '100', '12', '40', '80', 'growthPct = 100 * (120 - 100) / 100 = 20%', 'marginPct = 100 * 12 / 120 = 10%', 'debtEquity = 40 / 80 = 0.5', 'growth-positive', 'margin-high', 'leverage-low', 'not been independently verified']) assert.ok(report.includes(text), `Missing report evidence: ${text}`);
  assert.ok(report.includes('<script>literal supplied name</script>'));
  assert.ok(report.includes('Research <b>is plain text</b>'));
  assert.ok(!report.startsWith('<'));
  assert.equal(JSON.stringify(input), before);
});

test('comparison/watchlist preserve manual stale selections, order, warnings and notes', () => {
  const report = buildReport(notebook(), '2026-10-04');
  for (const text of ['Comparison order: BBB, AAA', 'Different currencies: amounts are not directly comparable', 'Different fiscal year ends: periods may not align', '549 days', 'No filing link supplied', 'Watchlist: BBB', '=literal formula-like note']) assert.ok(report.includes(text), text);
});

test('undefined formulas distinguish missing inputs from zero and nonpositive denominators', () => {
  const input = notebook();
  input.query = '';
  input.screen = { sector: null, currency: null, filters: [], includeStale: true, sortBy: 'ticker', direction: 'asc' };
  const first = input.dataset.companies[0]!;
  first.revenue = null; first.priorRevenue = 0; first.netIncome = null; first.debt = 0; first.equity = 0;
  const report = buildReport(input, '2026-10-04');
  assert.ok(report.includes('revenue: Not supplied'));
  assert.ok(report.includes('growthPct: Undefined (missing revenue or priorRevenue input)'));
  assert.ok(report.includes('marginPct: Undefined (missing netIncome or revenue input)'));
  assert.ok(report.includes('debtEquity: Undefined (equity is nonpositive)'));
  first.revenue = 0; first.netIncome = 0;
  const zeroReport = buildReport(input, '2026-10-04');
  assert.ok(zeroReport.includes('growthPct: Undefined (priorRevenue is zero)'));
  assert.ok(zeroReport.includes('marginPct: Undefined (revenue is zero)'));
});

test('report reevaluates UTC freshness and preserves synthetic disclosure', () => {
  const input = notebook();
  input.dataset.synthetic = true;
  const yesterday = buildReport(input, '2026-10-03');
  const today = buildReport(input, '2026-10-04');
  assert.ok(yesterday.includes('548 days; fresh'));
  assert.ok(today.includes('549 days; stale'));
  for (const report of [yesterday, today]) assert.ok(report.includes('Synthetic demonstration — not real companies or filings'));
});

test('uncomputable mixed-currency monetary sort cannot export a misleading report', () => {
  const input = notebook();
  input.screen = { sector: null, currency: null, filters: [], includeStale: true, sortBy: 'revenue', direction: 'desc' };
  assert.throws(() => buildReport(input, '2026-10-04'), /currenc/i);
});

test('nonzero tiny ratios and legal large six-decimal amounts remain exact in the text report', () => {
  const input = notebook();
  const company = input.dataset.companies[0]!;
  company.revenue = 1_000_000_000; company.priorRevenue = 543113052.487179;
  company.netIncome = 0.000001; company.debt = 0.000001; company.equity = 1_000_000_000;
  const report = buildReport(input, '2026-10-04');
  assert.ok(report.includes('priorRevenue: 543113052.487179 million USD'));
  assert.ok(report.includes(`marginPct = 100 * 0.000001 / 1000000000 = ${String(100 * 0.000001 / 1_000_000_000)}%`));
  assert.ok(report.includes(`debtEquity = 0.000001 / 1000000000 = ${String(0.000001 / 1_000_000_000)}`));
});

test('a legal 4 MiB notebook that expands beyond the report cap fails with useful selection guidance', () => {
  const input = notebook();
  input.query = '';
  input.dataset.fileName = '😀'.repeat(120);
  input.dataset.companies = Array.from({ length: 500 }, (_, index) => ({
    ticker: `X${index}`, name: '😀'.repeat(100), sector: '😀'.repeat(60), currency: 'USD', fiscalDate: '2000-01-01',
    revenue: null, priorRevenue: null, netIncome: null, debt: null, equity: null,
    filingUrl: 'https://example.com/' + '😀'.repeat(1700), sourceLine: index + 2,
  }));
  input.screen = { sector: null, currency: null, filters: [], includeStale: true, sortBy: 'ticker', direction: 'asc' };
  input.watchlist = input.dataset.companies.slice(0, 100).map(company => company.ticker);
  input.comparison = input.dataset.companies.slice(0, 4).map(company => company.ticker);
  input.notes = [];
  assert.ok(new TextEncoder().encode(serializeNotebook(input, '2026-10-04')).length <= 4 * 1024 * 1024);
  assert.throws(() => buildReport(input, '2026-10-04'), /8 MiB.*(watchlist|comparison)/i);
});
