import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDerived, analyzeCompany, screenDataset, compareCompanies } from '../src/research.ts';
import { parseQuery } from '../src/query.ts';
import { parseCsv, createDataset } from '../src/csv.ts';
import { company, dataset, screen, originalCsv, today } from './oracle/fixtures.ts';
import type { Observation } from '../src/types.ts';

function close(actual: number | null, expected: number) {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) <= Math.max(1, Math.abs(expected)) * 1e-12);
}
function codes(observations: Observation[]) { return observations.map(value => value.code); }
function fields(observations: Observation[], code: string) { return observations.find(value => value.code === code)!.fields.slice().sort(); }

test('raw annual arithmetic uses supplied inputs, full precision and gross debt', () => {
  assert.deepEqual(calculateDerived(company()), { growthPct: 20, marginPct: 10, debtEquity: .5 });
  const raw = company({ revenue: 34237.026104, priorRevenue: 31456.778912, netIncome: 543.123456, debt: 543113052.487179, equity: 34237.026104 });
  const actual = calculateDerived(raw);
  close(actual.growthPct, (34237.026104 / 31456.778912 - 1) * 100);
  close(actual.marginPct, 543.123456 / 34237.026104 * 100);
  close(actual.debtEquity, 543113052.487179 / 34237.026104);
  assert.throws(() => calculateDerived(company({ revenue: 34237.0261041 })));
  assert.throws(() => calculateDerived(company({ debt: -1 })));
});

test('null numerators, zero denominators and negative equity remain explicitly undefined', () => {
  for (const patch of [{ revenue: null }, { priorRevenue: null }, { priorRevenue: 0 }]) assert.equal(calculateDerived(company(patch)).growthPct, null);
  for (const patch of [{ revenue: null }, { netIncome: null }, { revenue: 0 }]) assert.equal(calculateDerived(company(patch)).marginPct, null);
  for (const patch of [{ debt: null }, { equity: null }, { equity: 0 }, { equity: -1 }]) assert.equal(calculateDerived(company(patch)).debtEquity, null);
  assert.equal(calculateDerived(company({ debt: 0, equity: 80 })).debtEquity, 0);
  for (const equity of [0, -1]) {
    const row = analyzeCompany(company({ debt: 0, equity }), today);
    assert.ok(codes(row.observations).includes('leverage-undefined'));
    assert.ok(codes(row.observations).includes('equity-nonpositive'));
    assert.ok(!codes(row.observations).includes('leverage-low'));
  }
});

test('548 days is fresh, 549 is stale, and freshness follows operation today', () => {
  const fresh = analyzeCompany(company({ fiscalDate: '2025-04-04' }), today);
  const stale = analyzeCompany(company({ fiscalDate: '2025-04-03' }), today);
  assert.equal(fresh.stale, false); assert.equal(stale.stale, true);
  assert.equal(analyzeCompany(company({ fiscalDate: '2025-04-04' }), '2026-10-05').stale, true);
  assert.ok(!codes(fresh.observations).includes('stale-period'));
  assert.deepEqual(fields(stale.observations, 'stale-period'), ['fiscalDate']);
});

test('defined observation boundaries and raw-field provenance are independent rules', () => {
  const positive = analyzeCompany(company(), today);
  assert.deepEqual(codes(positive.observations), ['growth-positive', 'margin-high', 'leverage-low', 'unverified-inputs']);
  assert.deepEqual(fields(positive.observations, 'growth-positive'), ['priorRevenue', 'revenue']);
  assert.deepEqual(fields(positive.observations, 'margin-high'), ['netIncome', 'revenue']);
  assert.deepEqual(fields(positive.observations, 'leverage-low'), ['debt', 'equity']);
  assert.deepEqual(fields(positive.observations, 'unverified-inputs'), ['fiscalDate', 'priorRevenue']);
  const risks = analyzeCompany(company({ revenue: 90, priorRevenue: 100, netIncome: -9, debt: 201, equity: 100 }), today);
  assert.deepEqual(codes(risks.observations), ['growth-negative', 'margin-negative', 'leverage-high', 'unverified-inputs']);
  assert.deepEqual(fields(risks.observations, 'growth-negative'), ['priorRevenue', 'revenue']);
  assert.deepEqual(fields(risks.observations, 'margin-negative'), ['netIncome', 'revenue']);
  assert.deepEqual(fields(risks.observations, 'leverage-high'), ['debt', 'equity']);
  const neutral = analyzeCompany(company({ revenue: 100, priorRevenue: 100, netIncome: 0, debt: 200, equity: 100 }), today);
  assert.deepEqual(codes(neutral.observations), ['unverified-inputs']);
  assert.ok(codes(analyzeCompany(company({ debt: 100, equity: 100 }), today).observations).includes('leverage-low'));
});

test('undefined reasons prioritize missing inputs and each missing raw fact appears once', () => {
  const missing = analyzeCompany(company({ revenue: null, priorRevenue: 0, netIncome: null, debt: null, equity: 0, filingUrl: null }), today);
  assert.deepEqual(codes(missing.observations), ['equity-nonpositive', 'growth-undefined', 'margin-undefined', 'leverage-undefined', 'missing-revenue', 'missing-netIncome', 'missing-debt', 'missing-source', 'unverified-inputs']);
  for (const [code, expected] of [
    ['growth-undefined', ['revenue', 'priorRevenue']], ['margin-undefined', ['netIncome', 'revenue']],
    ['leverage-undefined', ['debt', 'equity']], ['equity-nonpositive', ['equity']],
    ['missing-revenue', ['revenue']], ['missing-netIncome', ['netIncome']], ['missing-debt', ['debt']],
    ['missing-source', ['filingUrl']],
  ] as const) assert.deepEqual(fields(missing.observations, code), [...expected].sort());
  for (const code of ['growth-undefined', 'margin-undefined', 'leverage-undefined']) assert.match(missing.observations.find(value => value.code === code)!.text, /missing|not supplied|unavailable/i);
  const zeros = analyzeCompany(company({ revenue: 0, priorRevenue: 0, netIncome: 0, equity: 0, debt: 0 }), today);
  assert.match(zeros.observations.find(value => value.code === 'growth-undefined')!.text, /zero|0/i);
  assert.match(zeros.observations.find(value => value.code === 'margin-undefined')!.text, /zero|0/i);
  assert.match(zeros.observations.find(value => value.code === 'leverage-undefined')!.text, /nonpositive|positive|zero/i);
  const absent = analyzeCompany(company({ priorRevenue: null, equity: null }), today);
  assert.deepEqual(fields(absent.observations, 'missing-priorRevenue'), ['priorRevenue']);
  assert.deepEqual(fields(absent.observations, 'missing-equity'), ['equity']);
});

test('null metrics never pass and currency eligibility precedes missing counts', () => {
  const data = dataset([
    company({ ticker: 'A', currency: 'EUR', revenue: null, equity: null }),
    company({ ticker: 'B', revenue: null }), company({ ticker: 'C', revenue: 100, netIncome: null }),
    company({ ticker: 'D', revenue: 200, netIncome: 10 }),
    company({ ticker: 'E', revenue: null, fiscalDate: '2025-04-03' }),
  ]);
  const result = screenDataset(data, screen({ filters: [
    { metric: 'revenue', operator: 'gt', value: 150, currency: 'USD' },
    { metric: 'netIncome', operator: 'gte', value: 0, currency: null },
  ] }), today);
  assert.deepEqual(result.rows.map(row => row.company.ticker), ['D']);
  assert.equal(result.excludedStale, 1); assert.equal(result.excludedMissing, 2);
  const equality = screenDataset(data, screen({ currency: 'USD', filters: [{ metric: 'revenue', operator: 'eq', value: 0, currency: null }] }), today);
  assert.deepEqual(equality.rows, []); assert.equal(equality.excludedMissing, 1);
});

test('metric nulls are last in both directions and ties use ticker code-unit ascending', () => {
  const data = dataset([company({ ticker: 'B', netIncome: 12 }), company({ ticker: 'A', netIncome: 12 }), company({ ticker: 'C', netIncome: 24 }), company({ ticker: 'Z', netIncome: null }), company({ ticker: 'D', netIncome: null })]);
  assert.deepEqual(screenDataset(data, screen({ sortBy: 'marginPct', direction: 'desc' }), today).rows.map(row => row.company.ticker), ['C', 'A', 'B', 'D', 'Z']);
  assert.deepEqual(screenDataset(data, screen({ sortBy: 'marginPct', direction: 'asc' }), today).rows.map(row => row.company.ticker), ['A', 'B', 'C', 'D', 'Z']);
  const punctuation = dataset([company({ ticker: 'A.1' }), company({ ticker: 'A1' }), company({ ticker: 'A-1' })]);
  for (const direction of ['asc', 'desc'] as const) assert.deepEqual(screenDataset(punctuation, screen({ sortBy: 'marginPct', direction }), today).rows.map(row => row.company.ticker), ['A-1', 'A.1', 'A1']);
});

test('money sorting refuses mixed matched currencies without discarding provenance or comparison order', () => {
  const data = dataset([company({ ticker: 'A' }), company({ ticker: 'B', currency: 'EUR', revenue: null, fiscalDate: '2025-04-03' })]);
  const before = structuredClone(data);
  assert.throws(() => screenDataset(data, screen({ includeStale: true, sortBy: 'revenue' }), today));
  assert.deepEqual(data, before);
  assert.deepEqual(screenDataset(data, screen({ includeStale: true, currency: 'USD', sortBy: 'revenue' }), today).rows.map(row => row.company.ticker), ['A']);
  const compared = compareCompanies(data, ['B', 'A'], today);
  assert.deepEqual(compared.rows.map(row => row.company.ticker), ['B', 'A']);
  assert.equal(compared.monetaryComparable, false);
  assert.ok(compared.warnings.includes('Different currencies: amounts are not directly comparable'));
  assert.ok(compared.warnings.includes('Different fiscal year ends: periods may not align'));
  assert.deepEqual(compareCompanies(data, [], today), { rows: [], warnings: [], monetaryComparable: false });
});

test('supported language expands exact units/thresholds and rejects unsupported suffixes completely', () => {
  const data = dataset([company(), company({ ticker: 'B', currency: 'EUR' })]);
  const parsed = parseQuery('companies with profitable and growing and low debt and high margin sorted by profit margin descending', data);
  assert.deepEqual(parsed.screen, screen({ filters: [
    { metric: 'netIncome', operator: 'gt', value: 0, currency: null },
    { metric: 'growthPct', operator: 'gt', value: 0, currency: null },
    { metric: 'debtEquity', operator: 'lte', value: 1, currency: null },
    { metric: 'marginPct', operator: 'gte', value: 10, currency: null },
  ], sortBy: 'marginPct', direction: 'desc' }));
  for (const query of ['companies with profitable OR growing', 'companies with profitable tomorrow', 'companies with revenue above 100', 'companies with profit margin above 10', 'companies with profitable.']) assert.throws(() => parseQuery(query, data));
});

test('actual original CRLF CSV retains quotes, six-decimal facts, missing cells and physical row sources', () => {
  const preview = parseCsv(new TextEncoder().encode('\uFEFF' + originalCsv), 'original-research.csv', today);
  const data = createDataset(preview, today);
  assert.equal(data.synthetic, false); assert.equal(data.units, 'currency-millions');
  assert.equal(data.companies[0]!.ticker, 'ALFA');
  assert.equal(data.companies[1]!.name, 'Original, quoted company');
  assert.deepEqual(data.companies.map(row => row.sourceLine), [2, 3, 4, 5, 6, 7]);
  assert.equal(data.companies[3]!.revenue, 34237.026104);
  assert.equal(data.companies[4]!.revenue, null); assert.equal(data.companies[4]!.priorRevenue, 0);
  const result = screenDataset(data, screen({ filters: [
    { metric: 'netIncome', operator: 'gt', value: 0, currency: null },
    { metric: 'growthPct', operator: 'gt', value: 0, currency: null },
    { metric: 'debtEquity', operator: 'lte', value: 1, currency: null },
  ], sortBy: 'marginPct', direction: 'desc' }), today);
  assert.deepEqual(result.rows.map(row => row.company.ticker), ['ALFA', 'DELTA']);
  assert.equal(result.excludedStale, 1); assert.equal(result.excludedMissing, 2);
  assert.equal(result.rows[0]!.company.filingUrl, 'https://example.com/alfa');
});
