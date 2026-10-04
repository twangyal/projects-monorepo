import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDerived, analyzeCompany, screenDataset, compareCompanies } from '../src/research.ts';
import type { Company, Dataset, Screen } from '../src/types.ts';

const today = '2026-10-04';
function company(overrides: Partial<Company> = {}): Company {
  return { ticker: 'ALPHA', name: 'Original Alpha', sector: 'Software', currency: 'USD', fiscalDate: '2025-12-31',
    revenue: 120, priorRevenue: 100, netIncome: 12, debt: 40, equity: 80, filingUrl: 'https://example.com/filing', sourceLine: 2, ...overrides };
}
function dataset(rows: Partial<Company>[] = [{}]): Dataset {
  return { id: '11111111-1111-4111-8111-111111111111', fileName: 'annual.csv', importedDate: today,
    basis: 'annual-12-month', units: 'currency-millions', synthetic: false,
    companies: rows.map((row, index) => company({ ticker: `T${index}`, sourceLine: index + 2, ...row })) };
}
function screen(overrides: Partial<Screen> = {}): Screen { return { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc', ...overrides }; }

test('independent reference ratios use supplied raw inputs and retain zero and signed profit', () => {
  assert.deepEqual(calculateDerived(company()), { growthPct: 20, marginPct: 10, debtEquity: 0.5 });
  assert.deepEqual(calculateDerived(company({ revenue: 100, priorRevenue: 100, netIncome: -10, debt: 0 })), { growthPct: 0, marginPct: -10, debtEquity: 0 });
  assert.deepEqual(calculateDerived(company({ revenue: 0, priorRevenue: 100, netIncome: 0, debt: 0, equity: -1 })), { growthPct: -100, marginPct: null, debtEquity: null });
  assert.deepEqual(calculateDerived(company({ revenue: null, priorRevenue: 0, netIncome: null, debt: null, equity: 0 })), { growthPct: null, marginPct: null, debtEquity: null });
  assert.equal(calculateDerived(company({ debt: 34237.026104, equity: 1 })).debtEquity, 34237.026104);
});

test('strength and risk rules are ordered, threshold-exact, and cite only their raw evidence fields', () => {
  const observations = analyzeCompany(company(), today).observations;
  assert.deepEqual(observations.map(o => [o.code, o.fields]), [
    ['growth-positive', ['revenue', 'priorRevenue']], ['margin-high', ['netIncome', 'revenue']],
    ['leverage-low', ['debt', 'equity']], ['unverified-inputs', ['fiscalDate', 'priorRevenue']],
  ]);
  assert.ok(observations.slice(0, 3).every(o => o.kind === 'strength'));
  const risk = analyzeCompany(company({ revenue: 80, netIncome: -1, debt: 161 }), today);
  assert.deepEqual(risk.observations.map(o => o.code), ['growth-negative', 'margin-negative', 'leverage-high', 'unverified-inputs']);
  const neutral = analyzeCompany(company({ revenue: 100, netIncome: 9.999999, debt: 160 }), today);
  assert.deepEqual(neutral.observations.map(o => o.code), ['unverified-inputs']);
  const zero = analyzeCompany(company({ debt: 0, equity: 0 }), today);
  assert.ok(!zero.observations.some(o => o.code === 'leverage-low'));
  assert.deepEqual(zero.observations.find(o => o.code === 'equity-nonpositive')?.fields, ['equity']);
});

test('undefined diagnostics distinguish absent input from nonpositive denominator in stable order', () => {
  const row = analyzeCompany(company({ revenue: null, priorRevenue: 0, netIncome: null, debt: null, equity: 0, filingUrl: null, fiscalDate: '2025-04-03' }), today);
  assert.deepEqual(row.observations.map(o => o.code), ['equity-nonpositive', 'growth-undefined', 'margin-undefined', 'leverage-undefined', 'missing-revenue', 'missing-netIncome', 'missing-debt', 'stale-period', 'missing-source', 'unverified-inputs']);
  assert.ok(row.observations.filter(o => o.code.endsWith('-undefined')).every(o => /not supplied|missing/i.test(o.text)));
  const zeros = analyzeCompany(company({ revenue: 0, priorRevenue: 0, equity: 0 }), today);
  assert.match(zeros.observations.find(o => o.code === 'growth-undefined')!.text, /zero/i);
  assert.match(zeros.observations.find(o => o.code === 'margin-undefined')!.text, /zero/i);
  assert.match(zeros.observations.find(o => o.code === 'leverage-undefined')!.text, /nonpositive/i);
  const missing = analyzeCompany(company({ revenue: null, priorRevenue: null, netIncome: null, debt: null, equity: null }), today);
  assert.deepEqual(missing.observations.filter(o => o.code.startsWith('missing-')).map(o => o.code), ['missing-revenue', 'missing-priorRevenue', 'missing-netIncome', 'missing-debt', 'missing-equity']);
});

test('548 days is fresh, 549 is stale and exclusions do not depend on financial filter order', () => {
  assert.equal(analyzeCompany(company({ fiscalDate: '2025-04-04' }), today).stale, false);
  assert.equal(analyzeCompany(company({ fiscalDate: '2025-04-03' }), today).stale, true);
  const data = dataset([{ ticker: 'STALE', fiscalDate: '2025-04-03' }, { ticker: 'MISS', netIncome: null, revenue: 1 },
    { ticker: 'EUR', currency: 'EUR', netIncome: null }, { ticker: 'MATCH' }, { ticker: 'OTHER', sector: 'Other', netIncome: null }]);
  const filter = screen({ sector: 'software', filters: [{ metric: 'revenue', operator: 'gt', value: 100, currency: 'USD' }, { metric: 'netIncome', operator: 'gte', value: 0, currency: null }] });
  const result = screenDataset(data, filter, today);
  assert.deepEqual(result.rows.map(r => r.company.ticker), ['MATCH']); assert.equal(result.excludedStale, 1); assert.equal(result.excludedMissing, 1);
  assert.deepEqual(screenDataset(data, { ...filter, filters: filter.filters.slice().reverse() }, today), result);
});

test('each comparison operator uses unrounded metrics and null never passes even equality to zero', () => {
  const data = dataset([{ ticker: 'LOW', netIncome: -1 }, { ticker: 'ZERO', netIncome: 0 }, { ticker: 'HIGH', netIncome: 1 }, { ticker: 'NULL', netIncome: null }]);
  const expected = { gt: ['HIGH'], gte: ['HIGH', 'ZERO'], lt: ['LOW'], lte: ['LOW', 'ZERO'], eq: ['ZERO'] };
  for (const operator of ['gt', 'gte', 'lt', 'lte', 'eq'] as const) {
    const result = screenDataset(data, screen({ filters: [{ metric: 'netIncome', operator, value: 0, currency: null }] }), today);
    assert.deepEqual(result.rows.map(r => r.company.ticker), expected[operator]); assert.equal(result.excludedMissing, 1);
  }
  const exact = dataset([{ revenue: 3, netIncome: 1 }]);
  assert.equal(screenDataset(exact, screen({ filters: [{ metric: 'marginPct', operator: 'gt', value: 33.333333, currency: null }] }), today).rows.length, 1);
});

test('monetary sorts reject mixed matched currencies while ratio sorts and explicit currency filters work', () => {
  const data = dataset([{ ticker: 'USD', currency: 'USD' }, { ticker: 'EUR', currency: 'EUR', revenue: null }]); const before = JSON.stringify(data);
  for (const sortBy of ['revenue', 'netIncome', 'debt', 'equity'] as const) assert.throws(() => screenDataset(data, screen({ sortBy }), today), /currenc/i);
  assert.equal(screenDataset(data, screen({ sortBy: 'revenue', currency: 'USD' }), today).rows.length, 1);
  assert.equal(screenDataset(data, screen({ sortBy: 'marginPct' }), today).rows.length, 2);
  assert.equal(JSON.stringify(data), before);
});

test('null numeric values sort last both ways, ties use ticker ascending, ticker uses code-unit order', () => {
  const data = dataset([{ ticker: 'Z', netIncome: 1 }, { ticker: 'A', netIncome: 1 }, { ticker: 'N', netIncome: null }, { ticker: 'B', netIncome: 2 }]);
  assert.deepEqual(screenDataset(data, screen({ sortBy: 'netIncome', direction: 'asc' }), today).rows.map(r => r.company.ticker), ['A', 'Z', 'B', 'N']);
  assert.deepEqual(screenDataset(data, screen({ sortBy: 'netIncome', direction: 'desc' }), today).rows.map(r => r.company.ticker), ['B', 'A', 'Z', 'N']);
  assert.deepEqual(screenDataset(data, screen({ sortBy: 'ticker', direction: 'desc' }), today).rows.map(r => r.company.ticker), ['Z', 'N', 'B', 'A']);
});

test('comparison preserves manual order and stale rows with explicit date/currency warnings and detached data', () => {
  const data = dataset([{ ticker: 'USD' }, { ticker: 'EUR', currency: 'EUR', fiscalDate: '2025-04-03' }]);
  const result = compareCompanies(data, ['EUR', 'USD'], today);
  assert.deepEqual(result.rows.map(r => r.company.ticker), ['EUR', 'USD']); assert.equal(result.rows[0]!.stale, true); assert.equal(result.monetaryComparable, false);
  assert.deepEqual(result.warnings, ['Different currencies: amounts are not directly comparable', 'Different fiscal year ends: periods may not align']);
  result.rows[0]!.company.name = 'Changed'; assert.equal(data.companies[1]!.name, 'Original Alpha');
  assert.deepEqual(compareCompanies(data, [], today), { rows: [], warnings: [], monetaryComparable: false });
  for (const tickers of [new Array<string>(1), ['USD', 'USD'], ['MISSING'], ['USD', 'EUR', 'USD', 'EUR', 'USD']]) assert.throws(() => compareCompanies(data, tickers, today));
});

test('all direct research APIs enforce supplied shapes, dates and financial bounds without echoing data', () => {
  assert.throws(() => calculateDerived(company({ debt: -1 })));
  assert.throws(() => analyzeCompany(company(), '2026-02-30'));
  assert.throws(() => screenDataset(dataset(), screen({ includeStale: 'yes' as never }), today));
  assert.throws(() => screenDataset(dataset(), screen({ filters: [{ metric: 'netIncome', operator: 'gt', value: 1, currency: null }] }), today));
  assert.throws(() => compareCompanies(dataset(), ['PRIVATE_INPUT'], today), error => error instanceof Error && !error.message.includes('PRIVATE_INPUT'));
});

test('latest rows are chosen before every financial filter and stale/missing counts count companies once', () => {
  const data = dataset([
    { ticker: 'A', fiscalDate: '2020-12-31', revenue: 200, netIncome: 20, currency: 'EUR', sector: 'Legacy' },
    { ticker: 'B', revenue: 200 },
    { ticker: 'A', fiscalDate: '2025-12-31', revenue: null, netIncome: -1 },
  ]);
  const result = screenDataset(data, screen({ filters: [{ metric: 'revenue', operator: 'gt', value: 100, currency: 'USD' }] }), today);
  assert.deepEqual(result.rows.map(row => row.company.ticker), ['B']);
  assert.equal(result.excludedStale, 0); assert.equal(result.excludedMissing, 1);
  assert.deepEqual(screenDataset(data, screen({ includeStale: true, filters: [{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }] }), today).rows.map(row => row.company.ticker), ['B']);
  assert.deepEqual(screenDataset(data, screen({ sortBy: 'revenue', includeStale: true }), today).rows.map(row => row.company.ticker), ['B', 'A']);
});

test('current comparison uses latest reported identity and its own prior revenue without historical fallback', () => {
  const data = dataset([
    { ticker: 'A', fiscalDate: '2024-12-31', name: 'Older name', currency: 'EUR', revenue: 100 },
    { ticker: 'A', fiscalDate: '2025-12-31', name: 'Current name', revenue: 150, priorRevenue: 120 },
    { ticker: 'B', revenue: null },
  ]);
  const result = compareCompanies(data, ['B', 'A'], today);
  assert.equal(result.rows[1]!.company.name, 'Current name');
  assert.equal(result.rows[1]!.derived.growthPct, 25);
  assert.equal(result.rows[0]!.company.revenue, null);
  assert.equal(result.monetaryComparable, true); assert.deepEqual(result.warnings, []);
  result.rows[1]!.company.revenue = 0; assert.equal(data.companies[1]!.revenue, 150);
});
