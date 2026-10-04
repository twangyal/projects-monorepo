import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCompanyHistory } from '../src/annual-history.ts';
import { latestCompanies, periodsForTicker } from '../src/periods.ts';
import { screenDataset } from '../src/research.ts';
import { parseQuery } from '../src/query.ts';
import { parseCsv } from '../src/csv.ts';
import { annualCsv, annualDataset } from './oracle/annual-fixtures.ts';
import { company, dataset, screen, today } from './oracle/fixtures.ts';
import type { Company } from '../src/types';

const near = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) <= Math.max(1, Math.abs(expected)) * 1e-12,
    `${actual} differs from independently calculated ${expected}`);
};
function series(values: { revenue: number | null; debt?: number | null; netIncome?: number | null; priorRevenue?: number | null }[]) {
  return dataset(values.map((value, index) => company({ name: 'Consistent annual identity',
    fiscalDate: `${2022 + index}-03-31`,
    priorRevenue: index ? values[index - 1].revenue : 60,
    debt: 20, netIncome: value.revenue === null ? null : value.revenue / 10, ...value })));
}

test('original unsorted CSV keeps every raw source while latest and period selectors return detached dated views', () => {
  const parsed = parseCsv(new TextEncoder().encode(annualCsv), 'annual-original.csv', today);
  const original = annualDataset();
  assert.deepEqual(parsed.companies, original.companies);
  const before = structuredClone(original);
  const latest = latestCompanies(original.companies);
  assert.deepEqual(latest.map(row => [row.ticker, row.fiscalDate, row.sourceLine, row.revenue]),
    [['ALFA', '2026-03-31', 2, 150], ['BRAVO', '2026-03-31', 5, null],
      ['CHARLIE', '2026-06-30', 7, 120], ['DELTA', '2026-06-30', 10, 20]]);
  const history = periodsForTicker(original.companies, 'ALFA');
  assert.deepEqual(history.map(row => [row.fiscalDate, row.sourceLine]),
    [['2024-03-31', 4], ['2025-03-31', 6], ['2026-03-31', 2]]);
  assert.deepEqual(periodsForTicker(original.companies, 'alfa'), []);
  latest[0]!.revenue = -999; history[0]!.name = 'Mutated detached view';
  assert.deepEqual(original, before);
});

test('declared 25 percent row growth is separate from 50 percent stored revenue change and a ten point margin change', () => {
  const original = annualDataset(), before = structuredClone(original);
  const result = analyzeCompanyHistory(original, 'ALFA', today);
  assert.deepEqual(result.periods.map(row => [row.company.fiscalDate, row.company.sourceLine]),
    [['2024-03-31', 4], ['2025-03-31', 6], ['2026-03-31', 2]]);
  assert.equal(result.periods[2]!.derived.growthPct, 25);
  const recent = result.comparisons[1]!;
  assert.equal(recent.comparable, true);
  assert.deepEqual(recent.changes.map(change => change.metric), ['revenue', 'debt', 'marginPct']);
  near(recent.changes[0]!.delta, 50); near(recent.changes[0]!.percentChange, 50);
  near(recent.changes[1]!.delta, -20); near(recent.changes[1]!.percentChange, -100 / 3);
  near(recent.changes[2]!.delta, 10);
  assert.equal(recent.changes[2]!.percentChange, null);
  assert.match(recent.changes[2]!.percentReason!, /point|relative/i);
  assert.equal(recent.warnings.length, 1);
  assert.match(recent.warnings[0]!, /120/); assert.match(recent.warnings[0]!, /100/);
  assert.match(recent.warnings[0]!, /2025-03-31/); assert.match(recent.warnings[0]!, /2026-03-31/);
  assert.ok(result.trends.every(trend => trend.direction === 'unavailable' && trend.periodCount === 3 && trend.reason));
  result.periods[0]!.company.name = 'Changed result'; recent.previous.revenue = -999;
  assert.deepEqual(original, before);
});

test('latest selection precedes financial and missing filters and historical vocabulary is not a current choice', () => {
  const original = annualDataset();
  const selected = screenDataset(original, screen({ filters: [{ metric: 'growthPct', operator: 'gte', value: 30, currency: null }] }), today);
  assert.deepEqual(selected.rows.map(row => row.company.ticker), ['DELTA']);
  assert.equal(selected.excludedMissing, 1);
  const highRevenue = screenDataset(original, screen({ filters: [{ metric: 'revenue', operator: 'gte', value: 200, currency: 'USD' }] }), today);
  assert.deepEqual(highRevenue.rows, []);
  assert.equal(highRevenue.excludedMissing, 1);
  assert.throws(() => parseQuery('companies in sector "Historical sector"', original));
  assert.throws(() => parseQuery('companies in currency EUR', original));
});

test('all date identity guards withhold every pair delta without losing either source row', () => {
  const earlier = company({ name: 'Exact identity', fiscalDate: '2024-03-31', revenue: 100 });
  const later = company({ name: 'Exact identity', fiscalDate: '2025-03-31', revenue: 150, priorRevenue: 100 });
  const cases: [Partial<Company>, RegExp][] = [
    [{ fiscalDate: '2026-03-31' }, /year|gap|consecutive/i],
    [{ fiscalDate: '2025-04-01' }, /date|align|month|day/i],
    [{ currency: 'EUR' }, /currenc/i], [{ name: 'Different identity' }, /name/i],
    [{ name: 'exact identity' }, /name/i],
    [{ sector: 'Hardware' }, /sector/i], [{ sector: 'software' }, /sector/i],
  ];
  for (const [patch, reason] of cases) {
    const original = dataset([earlier, { ...later, ...patch }]);
    const result = analyzeCompanyHistory(original, 'ALFA', today);
    const pair = result.comparisons[0]!;
    assert.equal(pair.comparable, false);
    assert.ok(pair.reasons.some(text => reason.test(text)), JSON.stringify(pair.reasons));
    assert.equal(pair.previous.filingUrl, earlier.filingUrl);
    assert.equal(pair.current.fiscalDate, patch.fiscalDate ?? later.fiscalDate);
    assert.ok(pair.changes.every(change => change.delta === null && change.percentChange === null && change.reason));
    assert.deepEqual(pair.warnings, []);
  }
  const trimmed = analyzeCompanyHistory(dataset([earlier, { ...later, name: '  Exact identity  ' }]), 'ALFA', today);
  assert.equal(trimmed.comparisons[0]!.comparable, true);
  assert.equal(trimmed.comparisons[0]!.current.name, 'Exact identity');
});

test('February 28 and 29 alignment is allowed but same-year and other shifted fiscal days are not', () => {
  for (const [before, after] of [['2023-02-28', '2024-02-29'], ['2024-02-29', '2025-02-28']]) {
    const result = analyzeCompanyHistory(dataset([company({ fiscalDate: before, revenue: 100 }),
      company({ fiscalDate: after, revenue: 150, priorRevenue: 100 })]), 'ALFA', today);
    assert.equal(result.comparisons[0]!.comparable, true);
    assert.equal(result.comparisons[0]!.changes[0]!.delta, 50);
  }
  for (const [before, after] of [['2024-02-28', '2024-02-29'], ['2024-02-29', '2025-03-01']]) {
    assert.equal(analyzeCompanyHistory(dataset([company({ fiscalDate: before }), company({ fiscalDate: after })]),
      'ALFA', today).comparisons[0]!.comparable, false);
  }
});

test('zero bases retain absolute deltas, null endpoints stay absent and negative margins change in points', () => {
  const result = analyzeCompanyHistory(annualDataset(), 'DELTA', today);
  const first = result.comparisons[0]!, second = result.comparisons[1]!;
  assert.equal(first.comparable, true);
  assert.deepEqual(first.warnings, []);
  assert.equal(first.changes[0]!.delta, 10); assert.equal(first.changes[0]!.percentChange, null);
  assert.match(first.changes[0]!.percentReason!, /zero|positive/i);
  assert.equal(first.changes[1]!.delta, 5); assert.equal(first.changes[1]!.percentChange, null);
  assert.equal(first.changes[2]!.delta, null);
  near(second.changes[2]!.delta, 5); // -5% minus -10% = +5 percentage points.
  assert.deepEqual(result.trends.map(trend => [trend.metric, trend.direction]),
    [['revenue', 'increasing'], ['debt', 'mixed'], ['marginPct', 'unavailable']]);
  const missing = analyzeCompanyHistory(series([{ revenue: 100 }, { revenue: null }, { revenue: 200 }]), 'ALFA', today);
  assert.ok(missing.comparisons.every(pair => pair.changes[0]!.delta === null && pair.changes[0]!.reason));
  assert.equal(missing.trends[0]!.direction, 'unavailable');
});

test('neutral directions use all three to five periods, including flat intervals and an intervening gap', () => {
  const cases: [number[], string][] = [[[100, 110, 120, 130, 140], 'increasing'],
    [[140, 130, 120, 110, 100], 'decreasing'], [[100, 100, 100], 'flat'],
    [[100, 100, 110], 'mixed'], [[100, 120, 110, 130], 'mixed']];
  for (const [values, expected] of cases) {
    const result = analyzeCompanyHistory(series(values.map(revenue => ({ revenue }))), 'ALFA', today);
    assert.equal(result.trends[0]!.direction, expected);
    assert.equal(result.trends[0]!.periodCount, values.length);
  }
  const original = series([{ revenue: 80 }, { revenue: 100 }, { revenue: 120 }, { revenue: 140 }]);
  original.companies[1]!.fiscalDate = '2024-04-01';
  assert.equal(analyzeCompanyHistory(original, 'ALFA', today).trends[0]!.direction, 'unavailable');
  assert.equal(analyzeCompanyHistory(series([{ revenue: 100 }, { revenue: 150 }]), 'ALFA', today).trends[0]!.direction, 'unavailable');
});

test('an otherwise comparable prior-revenue mismatch makes every summary unavailable even when all deltas increase', () => {
  const original = series([{ revenue: 80, debt: 10, netIncome: 4 },
    { revenue: 100, debt: 20, netIncome: 10, priorRevenue: 79 },
    { revenue: 150, debt: 30, netIncome: 30 }]);
  const result = analyzeCompanyHistory(original, 'ALFA', today);
  assert.ok(result.comparisons.every(pair => pair.comparable));
  assert.equal(result.comparisons[0]!.warnings.length, 1);
  assert.ok(result.trends.every(trend => trend.direction === 'unavailable' && trend.reason));
});

test('six-decimal raw values retain unrounded historical arithmetic and full source identity', () => {
  const original = dataset([company({ fiscalDate: '2024-03-31', revenue: 0.123456, priorRevenue: 0.1,
    netIncome: 0.000001, debt: 0.000003, filingUrl: 'https://example.com/six-a' }),
  company({ fiscalDate: '2025-03-31', revenue: 0.654321, priorRevenue: 0.123456,
    netIncome: 0.000007, debt: 0.000011, filingUrl: 'https://example.com/six-b' })]);
  const pair = analyzeCompanyHistory(original, 'ALFA', today).comparisons[0]!;
  near(pair.changes[0]!.delta, 0.530865);
  near(pair.changes[0]!.percentChange, 100 * 0.530865 / 0.123456);
  near(pair.changes[1]!.delta, 0.000008);
  near(pair.changes[1]!.percentChange, 800 / 3);
  near(pair.changes[2]!.delta, 100 * 0.000007 / 0.654321 - 100 * 0.000001 / 0.123456);
  assert.deepEqual([pair.previous.sourceLine, pair.current.sourceLine], [2, 3]);
  assert.deepEqual([pair.previous.filingUrl, pair.current.filingUrl], ['https://example.com/six-a', 'https://example.com/six-b']);
  assert.throws(() => analyzeCompanyHistory(original, 'alfa', today));
  assert.throws(() => analyzeCompanyHistory(original, 'UNKNOWN', today));
  assert.throws(() => analyzeCompanyHistory(original, 'ALFA', '2026-02-30'));
});
