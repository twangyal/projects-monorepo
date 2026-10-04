import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuery } from '../src/query.ts';
import type { Dataset, Metric, Operator } from '../src/types.ts';
const data: Dataset = { id: '11111111-1111-4111-8111-111111111111', fileName: 'annual.csv', importedDate: '2026-10-04',
  basis: 'annual-12-month', units: 'currency-millions', synthetic: false,
  companies: ['Software', 'Research "and" Development\\Tools', 'Consumer  Goods'].map((sector, index) => ({
    ticker: `T${index}`, name: `Original ${index}`, sector, currency: index === 1 ? 'EUR' : 'USD', fiscalDate: '2025-12-31',
    revenue: 120, priorRevenue: 100, netIncome: 12, debt: 40, equity: 80, filingUrl: null, sourceLine: index + 2,
  })) };

test('empty and bare companies queries give explicit default screen without hidden filters', () => {
  const expected = { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' };
  assert.deepEqual(parseQuery('', data).screen, expected); assert.deepEqual(parseQuery(' Companies ', data).screen, expected);
});

test('all four shortcuts expand visible numeric thresholds without quality or AI claims', () => {
  const result = parseQuery('companies with profitable and growing and low debt and high margin', data);
  assert.deepEqual(result.screen.filters, [
    { metric: 'netIncome', operator: 'gt', value: 0, currency: null }, { metric: 'growthPct', operator: 'gt', value: 0, currency: null },
    { metric: 'debtEquity', operator: 'lte', value: 1, currency: null }, { metric: 'marginPct', operator: 'gte', value: 10, currency: null },
  ]);
  assert.match(result.interpretation.join('\n'), /net income.*0/i); assert.match(result.interpretation.join('\n'), /growth.*0%/i);
  assert.match(result.interpretation.join('\n'), /debt.*equity.*1/i); assert.match(result.interpretation.join('\n'), /margin.*10%/i);
  assert.doesNotMatch(result.interpretation.join('\n'), /\bAI\b|recommended investment|best investment|prediction/i);
});

test('every metric/operator/unit and sorting branch parses without prefix ambiguity', () => {
  const metrics: [string, Metric, string][] = [['revenue', 'revenue', ' million USD'], ['net income', 'netIncome', ' million USD'],
    ['debt', 'debt', ' million USD'], ['equity', 'equity', ' million USD'], ['revenue growth', 'growthPct', '%'],
    ['profit margin', 'marginPct', '%'], ['debt to equity', 'debtEquity', '']];
  const operators: [string, Operator][] = [['above', 'gt'], ['at least', 'gte'], ['below', 'lt'], ['at most', 'lte'], ['equal to', 'eq']];
  for (const [word, metric, suffix] of metrics) for (const [comparison, operator] of operators) {
    const result = parseQuery(`companies with ${word} ${comparison} -1.25${suffix} sorted by ${word} descending`, data);
    assert.deepEqual(result.screen.filters, [{ metric, operator, value: -1.25, currency: suffix.includes('USD') ? 'USD' : null }]);
    assert.equal(result.screen.sortBy, metric); assert.equal(result.screen.direction, 'desc');
  }
});

test('quoted sectors preserve internal spacing and allowed escapes, currency/keywords are normalized', () => {
  const result = parseQuery('COMPANIES\tIN "Research \\"and\\" Development\\\\Tools" USING\tcurrency eur WITH net\tincome above 0 million eUr SORTED BY equity ASCENDING', data);
  assert.equal(result.screen.sector, 'Research "and" Development\\Tools'); assert.equal(result.screen.currency, 'EUR');
  assert.equal(result.screen.filters[0]!.currency, 'EUR'); assert.equal(result.screen.direction, 'asc');
  assert.equal(parseQuery('companies in "consumer  goods"', data).screen.sector?.toLowerCase(), 'consumer  goods');
  assert.throws(() => parseQuery('companies in "consumer goods"', data));
});

test('unsupported suffixes, prose, OR, negation and partial numbers never yield a partial interpretation', () => {
  const bad = ['companies with profitable or growing', 'companies with not profitable', 'companies with profitable.',
    'companies with profitable please', 'companies with revenue above 100', 'companies with revenue growth above 10',
    'companies with debt to equity below 1%', 'companies with equity above 0 USD', 'companies with profitable and',
    'companies sorted by revenue', 'companies with revenue above 1e3 million USD', 'companies with revenue above 01 million USD',
    'companies with revenue above +1 million USD', 'companies with revenue above 1.0000001 million USD',
    'companies using currency XYZ', 'companies in "Unknown"', 'companies in "Soft\\u0077are"',
    'companies\nwith profitable', 'companies with (profitable)', 'companies using currency USD trailing', 'companiesXYZ', 'companies with profitable PRIVATE_INPUT'];
  const before = JSON.stringify(data);
  for (const query of bad) assert.throws(() => parseQuery(query, data), error => error instanceof Error && /supported|syntax|example/i.test(error.message) && !error.message.includes('PRIVATE_INPUT'));
  assert.equal(JSON.stringify(data), before);
});

test('exact filter and query limits reject duplicates but permit contradictory bounds', () => {
  const sixteen = `companies with ${Array.from({ length: 16 }, (_, index) => `debt to equity above ${index}`).join(' and ')}`;
  assert.ok(sixteen.length <= 500); assert.equal(parseQuery(sixteen, data).screen.filters.length, 16);
  assert.throws(() => parseQuery(sixteen + ' and debt to equity above 16', data));
  assert.throws(() => parseQuery('companies with profitable and profitable', data));
  assert.equal(parseQuery('companies with debt to equity above 10 and debt to equity below 1', data).screen.filters.length, 2);
  assert.throws(() => parseQuery(' '.repeat(501), data));
  assert.throws(() => parseQuery('companies\ud800', data));
});

test('valid large six-decimal thresholds roundtrip and returned screens are detached', () => {
  const result = parseQuery('companies with revenue above 543113052.487179 million USD', data);
  assert.equal(result.screen.filters[0]!.value, 543113052.487179);
  result.screen.filters[0]!.value = 1;
  assert.equal(parseQuery('companies with revenue above 543113052.487179 million USD', data).screen.filters[0]!.value, 543113052.487179);
});

test('interpretation explicitly selects latest supplied periods and historical-only vocabulary is rejected', () => {
  const history: Dataset = { ...data, companies: [
    { ...data.companies[0]!, fiscalDate: '2024-12-31', sector: 'Former sector', currency: 'CAD', sourceLine: 2 },
    { ...data.companies[0]!, fiscalDate: '2025-12-31', sector: 'Current sector', currency: 'USD', sourceLine: 3 },
  ] };
  const result = parseQuery('companies in "Current sector" using currency USD', history);
  assert.match(result.interpretation.join('\n'), /latest supplied annual period.*ticker/i);
  for (const query of ['companies in "Former sector"', 'companies using currency CAD', 'companies with revenue above 1 million CAD']) {
    assert.throws(() => parseQuery(query, history));
  }
});
