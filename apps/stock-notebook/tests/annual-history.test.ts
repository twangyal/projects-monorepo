import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeCompanyHistory } from '../src/annual-history.ts';
import type { Company, Dataset } from '../src/types.ts';

const today = '2026-10-04';
function dataset(overrides: Partial<Company>[]): Dataset {
  return { id: '11111111-1111-4111-8111-111111111111', fileName: 'periods.csv', importedDate: today,
    basis: 'annual-12-month', units: 'currency-millions', synthetic: false,
    companies: overrides.map((value, index) => ({ ticker: 'HISTORY', name: 'Original History', sector: 'Software', currency: 'USD',
      fiscalDate: `${2023 + index}-12-31`, revenue: 100, priorRevenue: null, netIncome: 10,
      debt: 20, equity: 100, filingUrl: `https://example.com/period-${index}`, sourceLine: index + 2, ...value })) };
}

test('declared growth remains25percent while independent stored-row revenue change is50percent with dated evidence', () => {
  const data = dataset([{ revenue: 100 }, { revenue: 150, priorRevenue: 120, netIncome: -15, debt: 30 }]);
  const before = JSON.stringify(data), result = analyzeCompanyHistory(data, 'HISTORY', today);
  assert.equal(result.periods[1]!.derived.growthPct, 25);
  const pair = result.comparisons[0]!;
  assert.equal(pair.comparable, true);
  assert.deepEqual(pair.changes.map(({ metric, delta, percentChange }) => ({ metric, delta, percentChange })), [
    { metric: 'revenue', delta: 50, percentChange: 50 }, { metric: 'debt', delta: 10, percentChange: 50 },
    { metric: 'marginPct', delta: -20, percentChange: null },
  ]);
  assert.equal(pair.warnings.length, 1);
  for (const text of ['2023-12-31', '2024-12-31', '100', '120', 'row 2', 'row 3']) assert.ok(pair.warnings[0]!.includes(text));
  assert.match(pair.changes[2]!.percentReason!, /percentage points/);
  assert.equal(pair.previous.filingUrl, data.companies[0]!.filingUrl);
  result.periods[0]!.company.name = 'Changed result'; pair.current.revenue = 999;
  assert.equal(JSON.stringify(data), before);
});

test('history is chronological and raw source lines survive unsorted input without interpolation', () => {
  const data = dataset([{ fiscalDate: '2025-12-31', revenue: 150 }, { fiscalDate: '2023-12-31', revenue: 100 }, { fiscalDate: '2024-12-31', revenue: 120 }]);
  const result = analyzeCompanyHistory(data, 'HISTORY', today);
  assert.deepEqual(result.periods.map(row => [row.company.fiscalDate, row.company.sourceLine]), [['2023-12-31', 3], ['2024-12-31', 4], ['2025-12-31', 2]]);
  assert.deepEqual(result.comparisons.map(pair => [pair.previous.revenue, pair.current.revenue]), [[100, 120], [120, 150]]);
  assert.equal(result.trends[0]!.direction, 'increasing'); assert.equal(result.trends[0]!.periodCount, 3);
  assert.deepEqual(data.companies.map(row => row.sourceLine), [2, 3, 4]);
});

test('calendar gap, alignment, currency, company name and sector changes withhold all automatic deltas', () => {
  for (const [change, reason] of [
    [{ fiscalDate: '2025-12-31' }, /consecutive|gap/i], [{ fiscalDate: '2024-12-30' }, /align/i],
    [{ currency: 'EUR' }, /currenc/i], [{ name: 'Renamed' }, /name/i], [{ sector: 'Other' }, /sector/i],
  ] as [Partial<Company>, RegExp][]) {
    const result = analyzeCompanyHistory(dataset([{}, { ...change, priorRevenue: 999 }]), 'HISTORY', today);
    const pair = result.comparisons[0]!;
    assert.equal(pair.comparable, false); assert.match(pair.reasons.join(' '), reason);
    assert.equal(pair.warnings.length, 0, 'Mismatches are not inferred across incomparable periods');
    assert.ok(pair.changes.every(change => change.delta === null && change.percentChange === null && change.reason));
    assert.equal(result.periods.length, 2);
  }
});

test('Feb28/29 annual alignment is allowed both ways while52week end-day shifts remain manual', () => {
  for (const dates of [['2023-02-28', '2024-02-29'], ['2024-02-29', '2025-02-28']]) {
    assert.equal(analyzeCompanyHistory(dataset(dates.map(fiscalDate => ({ fiscalDate }))), 'HISTORY', today).comparisons[0]!.comparable, true);
  }
  const pair = analyzeCompanyHistory(dataset([{ fiscalDate: '2023-12-30' }, { fiscalDate: '2024-12-28' }]), 'HISTORY', today).comparisons[0]!;
  assert.equal(pair.comparable, false); assert.match(pair.reasons.join(' '), /align/i);
});

test('zero bases retain absolute changes without fabricated percentages, and zero revenue has no margin', () => {
  const result = analyzeCompanyHistory(dataset([{ revenue: 0, debt: 0 }, { revenue: 10, debt: 2 }]), 'HISTORY', today);
  const changes = result.comparisons[0]!.changes;
  assert.deepEqual(changes.slice(0, 2).map(change => [change.delta, change.percentChange]), [[10, null], [2, null]]);
  assert.ok(changes.slice(0, 2).every(change => /zero/i.test(change.percentReason!)));
  assert.equal(changes[2]!.delta, null); assert.match(changes[2]!.reason!, /margin/i);
  const decline = analyzeCompanyHistory(dataset([{ revenue: 10 }, { revenue: 0 }]), 'HISTORY', today).comparisons[0]!.changes[0]!;
  assert.equal(decline.delta, -10); assert.equal(decline.percentChange, -100);
});

test('missing middle endpoints are never bridged and availability remains metric-specific', () => {
  const result = analyzeCompanyHistory(dataset([{ revenue: 100 }, { revenue: null }, { revenue: 150 }]), 'HISTORY', today);
  assert.equal(result.comparisons.length, 2);
  assert.ok(result.comparisons.every(pair => pair.changes[0]!.delta === null && pair.changes[0]!.reason));
  assert.equal(result.trends[0]!.direction, 'unavailable'); assert.match(result.trends[0]!.reason!, /missing|unavailable|supplied/i);
  assert.equal(result.trends[1]!.direction, 'flat');
  assert.equal(result.trends[2]!.direction, 'unavailable');
});

test('all3to5period summaries use strict directions, keep flat intervals mixed, and never drop older gaps', () => {
  for (const [values, expected] of [ [[100, 120, 150], 'increasing'], [[150, 120, 100], 'decreasing'],
    [[100, 100, 100], 'flat'], [[100, 100, 120], 'mixed'], [[120, 100, 110], 'mixed'] ] as [number[], string][]) {
    const result = analyzeCompanyHistory(dataset(values.map(revenue => ({ revenue }))), 'HISTORY', today);
    assert.equal(result.trends[0]!.direction, expected); assert.equal(result.trends[0]!.reason, null);
  }
  const data = dataset(['2020-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'].map((fiscalDate, index) => ({ fiscalDate, revenue: 100 + index })));
  const result = analyzeCompanyHistory(data, 'HISTORY', today);
  assert.equal(result.comparisons[1]!.comparable, true);
  assert.ok(result.trends.every(trend => trend.direction === 'unavailable' && trend.periodCount === 5 && trend.reason));
});

test('any otherwise-comparable prior-revenue mismatch withholds every trend but preserves pair arithmetic', () => {
  const result = analyzeCompanyHistory(dataset([{ revenue: 100 }, { revenue: 120, priorRevenue: 101 }, { revenue: 150, priorRevenue: 120 }]), 'HISTORY', today);
  assert.equal(result.comparisons[0]!.changes[0]!.delta, 20);
  assert.equal(result.comparisons[1]!.warnings.length, 0);
  assert.ok(result.trends.every(trend => trend.direction === 'unavailable' && /prior revenue/i.test(trend.reason!)));
  for (const rows of [[{}], [{}, {}]]) {
    assert.ok(analyzeCompanyHistory(dataset(rows), 'HISTORY', today).trends.every(trend => trend.direction === 'unavailable' && trend.reason));
  }
});

test('unrounded tiny and large changes remain finite and inputs validate atomically', () => {
  const result = analyzeCompanyHistory(dataset([{ revenue: .000001, netIncome: -.000001 }, { revenue: 1_000_000_000, netIncome: 0 }]), 'HISTORY', today);
  const changes = result.comparisons[0]!.changes;
  assert.equal(changes[0]!.delta, 1_000_000_000 - .000001);
  assert.equal(changes[0]!.percentChange, 100 * (1_000_000_000 - .000001) / .000001);
  assert.equal(changes[2]!.delta, 100);
  assert.throws(() => analyzeCompanyHistory(dataset([{}]), 'history', today));
  assert.throws(() => analyzeCompanyHistory(dataset([{}]), 'MISSING', today));
  assert.throws(() => analyzeCompanyHistory(dataset([{}]), 'HISTORY', '2026-02-30'));
  assert.throws(() => analyzeCompanyHistory(dataset([{ debt: -1 }]), 'HISTORY', today));
});
