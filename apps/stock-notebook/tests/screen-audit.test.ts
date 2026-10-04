import assert from 'node:assert/strict';
import test from 'node:test';
import * as research from '../src/research.ts';
import { company, dataset, screen, today } from './oracle/fixtures.ts';
import { createNotebook } from '../src/model.ts';
import { buildReport } from '../src/exports.ts';

test('every latest company has an explicit applied decision and all failed rules retain evidence', () => {
  assert.equal(typeof research.auditScreen, 'function', 'screening audit must be available');
  const data = dataset([
    company({ ticker: 'PASS', fiscalDate: '2025-12-31' }),
    company({ ticker: 'FAIL', fiscalDate: '2025-12-31', revenue: 90, priorRevenue: 100, equity: 0, netIncome: null }),
    company({ ticker: 'OLD', fiscalDate: '2024-01-01', sector: 'Other', currency: 'EUR', revenue: 80 }),
    company({ ticker: 'FAIL', fiscalDate: '2024-12-31', revenue: 500, netIncome: 50 }),
  ]);
  const criteria = screen({ sector: 'Software', currency: 'USD', filters: [
    { metric: 'revenue', operator: 'gte', value: 100, currency: 'USD' },
    { metric: 'growthPct', operator: 'gt', value: 0, currency: null },
    { metric: 'debtEquity', operator: 'lte', value: 1, currency: null },
    { metric: 'netIncome', operator: 'gt', value: 0, currency: null },
  ] });
  const before = JSON.stringify({ data, criteria });
  const audit = research.auditScreen(data, criteria, today);
  assert.deepEqual(audit.map(d => [d.row.company.ticker, d.matched]), [['FAIL', false], ['OLD', false], ['PASS', true]]);
  const failed = audit[0]!;
  assert.equal(failed.row.company.sourceLine, 3);
  assert.deepEqual(failed.reasons.map(r => [r.kind, r.filterIndex, r.fields]), [
    ['threshold', 0, ['revenue']], ['threshold', 1, ['revenue', 'priorRevenue']],
    ['undefined', 2, ['debt', 'equity']], ['undefined', 3, ['netIncome']],
  ]);
  assert.match(failed.reasons[0]!.text, /90.*>=.*100.*USD/);
  assert.match(failed.reasons[1]!.text, /-10.*>.*0.*%/);
  assert.match(failed.reasons[2]!.text, /nonpositive.*equity|equity.*nonpositive/i);
  assert.match(failed.reasons[3]!.text, /not supplied/i);
  assert.deepEqual(audit[1]!.reasons.map(r => r.kind), ['stale', 'sector', 'currency', 'filter-currency', 'threshold']);
  assert.match(audit[1]!.reasons.find(r => r.kind === 'filter-currency')!.text, /EUR.*USD/);
  assert.ok(!audit[1]!.reasons.some(r => r.kind === 'threshold' && r.filterIndex === 0), 'different money currencies must never be numerically compared');
  assert.deepEqual(research.screenDataset(data, criteria, today).rows.map(r => r.company.ticker), ['PASS']);
  assert.equal(research.screenDataset(data, criteria, today).excludedStale, 1);
  assert.equal(research.screenDataset(data, criteria, today).excludedMissing, 1);
  assert.equal(JSON.stringify({ data, criteria }), before);
});

test('audit operator boundaries are exact and sort choice cannot change decisions', () => {
  assert.equal(typeof research.auditScreen, 'function');
  const data = dataset([company({ ticker: 'LOW', netIncome: -1 }), company({ ticker: 'ZERO', netIncome: 0 }), company({ ticker: 'HIGH', netIncome: 1 }), company({ ticker: 'NULL', netIncome: null })]);
  const expected = { gt: ['HIGH'], gte: ['HIGH', 'ZERO'], lt: ['LOW'], lte: ['LOW', 'ZERO'], eq: ['ZERO'] };
  for (const operator of ['gt', 'gte', 'lt', 'lte', 'eq'] as const) {
    const criteria = screen({ filters: [{ metric: 'netIncome', operator, value: 0, currency: null }] });
    const audit = research.auditScreen(data, criteria, today);
    assert.deepEqual(audit.filter(d => d.matched).map(d => d.row.company.ticker), expected[operator]);
    assert.equal(audit.find(d => d.row.company.ticker === 'NULL')!.reasons[0]!.kind, 'undefined');
    assert.deepEqual(research.auditScreen(data, { ...criteria, sortBy: 'marginPct', direction: 'desc' }, today), audit);
  }
  const thirds = dataset([company({ revenue: 3, netIncome: 1 })]);
  const decision = research.auditScreen(thirds, screen({ filters: [{ metric: 'marginPct', operator: 'lte', value: 33.333333, currency: null }] }), today)[0]!;
  assert.equal(decision.matched, false);
  assert.match(decision.reasons[0]!.text, /33\.333333333333336/);
});

test('audit distinguishes missing inputs, zero denominators and stale boundary without fallback', () => {
  assert.equal(typeof research.auditScreen, 'function');
  const data = dataset([company({ ticker: 'BOUNDARY', fiscalDate: '2025-04-04', revenue: 0, priorRevenue: 0, equity: -1 }), company({ ticker: 'STALE', fiscalDate: '2025-04-03', revenue: null, priorRevenue: null })]);
  const criteria = screen({ filters: [{ metric: 'growthPct', operator: 'gte', value: 0, currency: null }, { metric: 'marginPct', operator: 'gte', value: 0, currency: null }] });
  const audit = research.auditScreen(data, criteria, today);
  assert.deepEqual(audit[0]!.reasons.map(r => r.kind), ['undefined', 'undefined']);
  assert.ok(audit[0]!.reasons.every(r => /zero/.test(r.text)));
  assert.deepEqual(audit[1]!.reasons.map(r => r.kind), ['stale', 'undefined', 'undefined']);
  assert.match(audit[1]!.reasons[0]!.text, /549.*548/);
  assert.deepEqual(research.auditScreen(data, { ...criteria, includeStale: true }, today)[1]!.reasons.map(r => r.kind), ['undefined', 'undefined']);
  assert.throws(() => research.auditScreen(data, criteria, '2026-02-30'));
  assert.throws(() => research.auditScreen(data, { ...criteria, sector: 'Unknown' }, today));
});

test('research reports retain applied exclusion decisions and their raw source provenance', () => {
  const data = dataset([company({ ticker: 'PASS', fiscalDate: '2025-12-31' }), company({ ticker: 'FAIL', fiscalDate: '2025-12-31', netIncome: -5 })]);
  const book = createNotebook(data, today);
  book.screen.filters = [{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }];
  const report = buildReport(book, today);
  assert.match(report, /Screening exclusion audit/);
  assert.match(report, /FAIL.*2025-12-31.*original-research\.csv:3/);
  assert.match(report, /netIncome.*-5.*>.*0/);
  assert.match(report, /fields: netIncome/);
  assert.match(report, /https:\/\/example\.com\/annual-report/);
});

test('maximum 500-company and 16-filter audit retains every reason and bounded report', () => {
  const data = dataset(Array.from({ length: 500 }, (_, index) => company({ ticker: `T${String(index).padStart(3, '0')}`, fiscalDate: '2025-12-31', filingUrl: 'https://example.com/' + 'p'.repeat(2000) })));
  const book = createNotebook(data, today);
  book.screen.filters = Array.from({ length: 16 }, (_, index) => ({ metric: 'growthPct', operator: 'gt', value: 1000 + index, currency: null }));
  const audit = research.auditScreen(data, book.screen, today);
  assert.equal(audit.length, 500);
  assert.ok(audit.every(d => !d.matched && d.reasons.length === 16));
  assert.equal(audit[499]!.row.company.sourceLine, 501);
  const report = buildReport(book, today);
  assert.equal((report.match(/^Excluded: /gm) ?? []).length, 500);
  assert.equal((report.match(/^\[threshold\]/gm) ?? []).length, 8000);
  assert.ok(Buffer.byteLength(report) <= 8 * 1024 * 1024);
  audit[0]!.row.company.name = 'Edited copy';
  audit[0]!.reasons[0]!.fields.push('filingUrl');
  assert.equal(data.companies[0]!.name, 'An original annual fixture');
  assert.deepEqual(research.auditScreen(data, book.screen, today)[0]!.reasons[0]!.fields, ['revenue', 'priorRevenue']);
});
