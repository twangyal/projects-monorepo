import assert from 'node:assert/strict';
import test from 'node:test';
import { blankCsvTemplate, createDataset, parseCsv } from '../src/csv.ts';

const TODAY = '2026-10-04';
const HEADER = 'ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url';
const row = (ticker = 'ALFA') => [ticker, 'Original Test Company', 'Software', 'USD', '2025-12-31', '120', '100', '12', '40', '80', 'https://example.com/filing'];
const bytes = (text: string) => new TextEncoder().encode(text);
const file = (rows: string[][], newline = '\n') => bytes(HEADER + newline + rows.map(cells => cells.join(',')).join(newline) + newline);
const parse = (rows: string[][]) => parseCsv(file(rows), 'annual.csv', TODAY);

test('real BOM/CRLF and quoted commas/escaped quotes preserve trimmed facts and physical provenance', () => {
  const data = bytes('\uFEFF' + HEADER + '\r\n' + ' alfa ," A, ""Quoted"" Company ", Software ,USD,2025-12-31,120,100,12,40,80,https://example.com/filing\r\n' + row('BRAVO').join(',') + '\r\n');
  const result = parseCsv(data, 'C:\\fakepath\\annual.csv', TODAY);
  assert.equal(result.fileName, 'annual.csv');
  assert.equal(result.companies[0].ticker, 'ALFA');
  assert.equal(result.companies[0].name, 'A, "Quoted" Company');
  assert.equal(result.companies[0].sector, 'Software');
  assert.deepEqual(result.companies.map(company => company.sourceLine), [2, 3]);
  assert.equal(result.companies[1].debt, 40);
  assert.equal(parseCsv(file([row()]), '/tmp/folder/source.csv', TODAY).fileName, 'source.csv');
});

test('missing amounts are null; real zero, signed income/equity and six decimals are preserved', () => {
  const cells = row(); cells[5] = ''; cells[6] = '0'; cells[7] = '-0'; cells[8] = ''; cells[9] = '-1.000001'; cells[10] = '';
  const company = parse([cells]).companies[0];
  assert.equal(company.revenue, null); assert.equal(company.priorRevenue, 0);
  assert.equal(company.netIncome, 0); assert.equal(Object.is(company.netIncome, -0), false);
  assert.equal(company.debt, null); assert.equal(company.equity, -1.000001); assert.equal(company.filingUrl, null);
  for (const value of ['34237.026104', '543113052.487179', '1000000000', '0.000001']) {
    const sample = row(); sample[5] = value; assert.equal(parse([sample]).companies[0].revenue, Number(value));
  }
});

test('complete strict CSV rejects invalid UTF8, controls, blank records and malformed quoting without returning partial facts', () => {
  const malformed = [HEADER, HEADER + '\n', HEADER + '\n\n', HEADER + '\r' + row().join(','), HEADER + '\n' + row().join(',') + '\n\n', HEADER + '\n"unfinished', HEADER + '\n' + row().join(',') + ',extra', HEADER + '\n' + row().slice(0, 10).join(','), HEADER + '\n' + row().join(',') + '\n"bad\nnewline",x', HEADER + '\n' + 'ALFA,"name"suffix,' + row().slice(2).join(','), HEADER + '\n' + 'ALFA,na"me,' + row().slice(2).join(',')];
  for (const text of malformed) assert.throws(() => parseCsv(bytes(text), 'source.csv', TODAY));
  assert.throws(() => parseCsv(Uint8Array.of(0xff), 'source.csv', TODAY));
  assert.throws(() => parseCsv(new Uint8Array(), 'source.csv', TODAY));
  const nul = row(); nul[1] = 'Private\0Name'; assert.throws(() => parse([nul]));
  for (const control of ['\t', '\u0001', '\r', '\n']) {
    const cells = row(); cells[1] = 'a' + control + 'b'; assert.throws(() => parse([cells]));
  }
});

test('strict header, numeric tokens, real dates, identities and supplied URLs validate the whole universe', () => {
  for (const header of [HEADER.toUpperCase(), HEADER.replace('prior_revenue', 'revenue'), HEADER.replace('debt,equity', 'equity,debt'), HEADER + ',unknown']) assert.throws(() => parseCsv(bytes(header + '\n' + row().join(',')), 'source.csv', TODAY));
  for (const value of ['NA', 'N/A', 'null', '1e2', '+1', '01', '1.0000001', '1000000000.000001', '1,000', '$10', '10%', '-1']) {
    const cells = row(); cells[5] = value; assert.throws(() => parse([cells]));
  }
  for (const date of ['2026-10-05', '2025-02-29', '2024-02-30', '1999-12-31', '2025-1-01']) {
    const cells = row(); cells[4] = date; assert.throws(() => parse([cells]));
  }
  const leap = row(); leap[4] = '2024-02-29'; assert.equal(parse([leap]).companies[0].fiscalDate, '2024-02-29');
  assert.throws(() => parse([row('alfa'), row('ALFA')]));
  for (const ticker of ['BAD TICKER', '=EVIL', 'TOO-LONG-TICKER-NAME', '_BAD']) assert.throws(() => parse([row(ticker)]));
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://a:b@example.com', 'https://example.com/#part', 'https://localhost/filing', 'https://127.0.0.1/file', 'https://example.com:8080/file']) {
    const cells = row(); cells[10] = url; assert.throws(() => parse([cells]));
  }
  assert.throws(() => parseCsv(file([row()]), 'source.csv', '2025-02-29'));
});

test('exact 500 rows and twoMiB limits hold; path provenance and errors remain bounded and safe', () => {
  const rows = Array.from({ length: 500 }, (_, index) => row('C' + index));
  assert.equal(parse(rows).companies.length, 500);
  assert.equal(parse(rows).companies[499].sourceLine, 501);
  assert.throws(() => parse([...rows, row('EXTRA')]));
  assert.throws(() => parseCsv(new Uint8Array(2 * 1024 * 1024 + 1), 'source.csv', TODAY));
  assert.throws(() => parseCsv(file([row()]), 'x'.repeat(121), TODAY));
  assert.throws(() => parseCsv(file([row()]), '/', TODAY));
  const privateCells = row(); privateCells[5] = 'PRIVATE_FINANCIAL_VALUE';
  try { parse([privateCells]); assert.fail('expected invalid input'); } catch (error) {
    assert.equal(String(error).includes('PRIVATE_FINANCIAL_VALUE'), false);
  }
});

test('createDataset revalidates exact previews, dates and booleans, assigns provenance, and returns detached data', () => {
  const preview = parse([row()]);
  const result = createDataset(preview, TODAY);
  assert.match(result.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(result.importedDate, TODAY); assert.equal(result.basis, 'annual-12-month');
  assert.equal(result.units, 'currency-millions'); assert.equal(result.synthetic, false);
  assert.equal(createDataset(preview, TODAY, true).synthetic, true);
  preview.companies[0].revenue = 999; assert.equal(result.companies[0].revenue, 120);
  assert.throws(() => createDataset({ ...preview, extra: 1 } as never, TODAY));
  assert.throws(() => createDataset({ fileName: '../bad.csv', companies: preview.companies }, TODAY));
  assert.throws(() => createDataset({ fileName: 'source.csv', companies: [] }, TODAY));
  assert.throws(() => createDataset(preview, '2024-01-01'));
  assert.throws(() => createDataset(preview, TODAY, 1 as never));
  const unsafe = { fileName: 'source.csv', get companies() { throw new Error('PRIVATE_ACCESSOR_EXECUTED'); } };
  assert.throws(() => createDataset(unsafe as never, TODAY), error => !String(error).includes('PRIVATE_ACCESSOR_EXECUTED'));
});

test('blankCsvTemplate is the exact header and one newline, with no fabricated facts', () => {
  assert.equal(blankCsvTemplate(), HEADER + '\n');
});

test('exact byte limit, terminal blank field and Unicode text have real data semantics', () => {
  const cells = row(); cells[1] = 'Original 🧪 company'; cells[10] = '';
  const withoutFinalNewline = HEADER + '\n' + cells.join(',');
  assert.equal(parseCsv(bytes(withoutFinalNewline), 'original.csv', TODAY).companies[0].filingUrl, null);
  const padded = row(); padded[1] += ' '.repeat(2 * 1024 * 1024 - file([padded]).length);
  assert.equal(file([padded]).length, 2 * 1024 * 1024);
  assert.equal(parseCsv(file([padded]), 'bounded.csv', TODAY).companies[0].name, 'Original Test Company');
  for (const column of [6, 8]) {
    const invalid = row(); invalid[column] = '-0.000001'; assert.throws(() => parse([invalid]));
  }
  const lowerCurrency = row(); lowerCurrency[3] = 'usd'; assert.throws(() => parse([lowerCurrency]));
  const literal = row(); literal[1] = '=NotASpreadsheetFormula()';
  assert.equal(parse([literal]).companies[0].name, '=NotASpreadsheetFormula()');
});

test('Unicode identities cannot become ASCII tickers by case expansion', () => {
  for (const ticker of ['ß', 'ı', 'ſ', 'AK']) assert.throws(() => parse([row(ticker)]));
});

test('annual periods accept normalized ticker across distinct dates and preserve physical source order', () => {
  const years = [2024, 2022, 2025, 2021, 2023];
  const rows = years.map((year, index) => {
    const cells = row(index % 2 ? ' alfa ' : 'ALFA');
    cells[4] = `${year}-12-31`; cells[5] = String(100 + index);
    return cells;
  });
  const preview = parse(rows);
  assert.deepEqual(preview.companies.map(company => company.ticker), Array(5).fill('ALFA'));
  assert.deepEqual(preview.companies.map(company => company.fiscalDate), years.map(year => `${year}-12-31`));
  assert.deepEqual(preview.companies.map(company => company.sourceLine), [2, 3, 4, 5, 6]);
  const dataset = createDataset(preview, TODAY);
  assert.deepEqual(dataset.companies, preview.companies);
  preview.companies[0].revenue = 1;
  assert.equal(dataset.companies[0].revenue, 100);
});

test('duplicate normalized ticker/date and sixth annual period reject the entire CSV with safe row guidance', () => {
  const first = row('alfa'), sameDate = row(' ALFA ');
  sameDate[5] = '999';
  assert.throws(() => parse([first, sameDate]), /CSV row 3: duplicate normalized ticker and fiscal date/);
  const six = Array.from({ length: 6 }, (_, index) => {
    const cells = row(index % 2 ? 'alfa' : 'ALFA'); cells[4] = `${2020 + index}-12-31`; return cells;
  });
  assert.throws(() => parse(six), /CSV row 7: at most five annual periods per ticker/);
  assert.throws(() => createDataset({ fileName: 'annual.csv', companies: six.map((cells, index) => ({
    ...parse([cells]).companies[0], sourceLine: index + 2,
  })) }, TODAY));
});

test('500 raw annual rows from 100 tickers remain bounded independently of unique-company count', () => {
  const annual = Array.from({ length: 500 }, (_, index) => {
    const cells = row(`C${Math.floor(index / 5)}`); cells[4] = `${2025 - index % 5}-12-31`; return cells;
  });
  const preview = parse(annual);
  assert.equal(preview.companies.length, 500);
  assert.equal(new Set(preview.companies.map(company => company.ticker)).size, 100);
  assert.equal(preview.companies[499].sourceLine, 501);
  assert.throws(() => parse([...annual, row('EXTRA')]), /500 annual records/);
});
