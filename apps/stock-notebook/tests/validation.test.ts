import test from 'node:test';
import assert from 'node:assert/strict';
import { validateToday, validateCompany, validateDataset, validateScreen } from '../src/validation.ts';
import { company, dataset, screen, TODAY } from './model-fixtures.ts';

test('real bounded Gregorian dates reject rollover, alternate syntax and nonstrings', () => {
  for (const valid of ['2000-01-01', '2000-02-29', '2024-02-29', '2099-12-31']) assert.equal(validateToday(valid), valid);
  for (const invalid of ['1999-12-31', '2100-01-01', '2025-02-29', '2026-04-31', '2026-1-1', '2026-01-01\n', '2026-01-01T00:00:00Z', true, null]) assert.throws(() => validateToday(invalid));
});

test('large valid six-decimal financial values roundtrip without a scaled epsilon; null never becomes zero', () => {
  for (const amount of [34237.026104, 543113052.487179, 1e9, .000001, 0, -0, null]) {
    const result = validateCompany(company({ revenue: amount }), TODAY);
    assert.equal(result.revenue, Object.is(amount, -0) ? 0 : amount);
  }
  assert.equal(validateCompany(company({ equity: -100, netIncome: -.000001 }), TODAY).equity, -100);
  for (const amount of [NaN, Infinity, 1e9 + 1, .0000001, '12', true]) assert.throws(() => validateCompany(company({ revenue: amount as never }), TODAY));
  for (const key of ['revenue', 'priorRevenue', 'debt']) assert.throws(() => validateCompany({ ...company(), [key]: -1 }, TODAY));
});

test('companies are detached, normalize declared text, and reject shapes and source errors', () => {
  const source = company({ ticker: ' alpha ', name: '  📈Tools  ', sector: ' Industry ' });
  const result = validateCompany(source, TODAY);
  assert.equal(result.ticker, 'ALPHA'); assert.equal(result.name, '📈Tools'); assert.equal(source.ticker, ' alpha ');
  result.name = 'changed'; assert.equal(source.name, '  📈Tools  ');
  for (const patch of [{ ticker: 'A/B' }, { ticker: 'A\n' }, { name: 'a\u0085b' }, { sector: '\ud800' },
    { name: 'x'.repeat(101) }, { currency: 'usd' }, { fiscalDate: '2026-10-05' }, { sourceLine: 1 }, { sourceLine: 502 },
    { sourceLine: 2.5 }, { unknown: 1 }]) assert.throws(() => validateCompany({ ...company(), ...patch }, TODAY));
  assert.equal(validateCompany(company({ name: '📈'.repeat(100) }), TODAY).name, '📈'.repeat(100));
  const accessor = { ...company() }; Object.defineProperty(accessor, 'name', { get() { throw new Error('private source'); }, enumerable: true });
  assert.throws(() => validateCompany(accessor, TODAY), error => error instanceof Error && !error.message.includes('private source'));
});

test('supplied HTTPS links preserve text but reject credentials, local address spellings and unsafe syntax', () => {
  for (const url of ['https://example.com/filing?q=annual', 'https://example.com:443/a%20b', 'https://8.8.8.8/filing', null]) assert.equal(validateCompany(company({ filingUrl: url }), TODAY).filingUrl, url);
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com:444/', 'https://example.com/#',
    'https://localhost/', 'https://sub.localhost/', 'https://LOCALHOST./', 'https://127.1/', 'https://0x7f000001/',
    'https://169.254.1.2/', 'https://[::1]/', 'https://[fe80::1]/', 'https://[febf::1]/', 'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:169.254.1.2]/', 'https://example.com/a b', 'https://example.com/\n', 'https://example.com\\@localhost/',
    'https://example.com/' + 'a'.repeat(2048)]) assert.throws(() => validateCompany(company({ filingUrl: url }), TODAY), error => error instanceof Error && !error.message.includes('secret'));
});

test('ticker normalization rejects Unicode characters that uppercase into ASCII identifiers', () => {
  for (const ticker of ['ß', 'ı', 'ſ', 'AK']) assert.throws(() => validateCompany(company({ ticker }), TODAY));
  assert.equal(validateCompany(company({ ticker: 'brk.b' }), TODAY).ticker, 'BRK.B');
});

test('dataset enforces whole-source identity, dates and monotonically increasing row provenance', () => {
  const source = dataset([company(), company({ ticker: 'BETA', sourceLine: 3 })]);
  const validated = validateDataset(source, TODAY); validated.companies[0].name = 'changed'; assert.equal(source.companies[0].name, 'Alpha Tools');
  for (const patch of [{ id: source.id + '\n' }, { fileName: '../annual.csv' }, { fileName: 'a\\b.csv' },
    { synthetic: 'false' }, { importedDate: '2026-10-05' }, { importedDate: '2025-01-01' }, { basis: 'quarterly' },
    { companies: [] }, { companies: [company(), company({ ticker: 'alpha', sourceLine: 3 })] },
    { companies: [company(), company({ ticker: 'B', sourceLine: 2 })] }, { extra: true }]) assert.throws(() => validateDataset({ ...source, ...patch }, TODAY));
  assert.equal(validateDataset(dataset(Array.from({ length: 500 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2 }))), TODAY).companies.length, 500);
  assert.throws(() => validateDataset(dataset(Array.from({ length: 501 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2 }))), TODAY));
});

test('screen canonicalization checks exact filters, currency units, sectors and immutable input', () => {
  const data = dataset([company(), company({ ticker: 'B', currency: 'EUR', sourceLine: 3 })]);
  const input = screen({ sector: ' industry ', filters: [{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }] });
  assert.equal(validateScreen(input, data).sector, 'Industry'); assert.equal(input.sector, ' industry ');
  for (const patch of [{ sector: 'Unknown' }, { currency: 'GBP' }, { includeStale: 1 }, { sortBy: 'price' }, { direction: 'up' }, { extra: 1 },
    { filters: [{ metric: 'revenue', operator: 'gt', value: 1, currency: null }] },
    { filters: [{ metric: 'growthPct', operator: 'gt', value: 1, currency: 'USD' }] },
    { filters: [{ metric: 'revenue', operator: 'gt', value: 1, currency: 'GBP' }] },
    { filters: [...input.filters, ...input.filters] }]) assert.throws(() => validateScreen({ ...screen(), ...patch }, data));
  const range = [{ metric: 'revenue', operator: 'gt', value: 100, currency: 'USD' }, { metric: 'revenue', operator: 'lt', value: 10, currency: 'USD' }];
  assert.equal(validateScreen(screen({ filters: range as never }), data).filters.length, 2);
  assert.equal(validateScreen(screen({ filters: Array.from({ length: 16 }, (_, i) => ({ metric: 'growthPct', operator: 'gt', value: i, currency: null })) }), data).filters.length, 16);
  assert.throws(() => validateScreen(screen({ filters: Array.from({ length: 17 }, (_, i) => ({ metric: 'growthPct', operator: 'gt', value: i, currency: null })) }), data));
});
