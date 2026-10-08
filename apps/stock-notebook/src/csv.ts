import { LIMITS, type Company, type CsvPreview, type Dataset } from './types.ts';
import { validateCompany, validateDataset, validateToday } from './validation.ts';

const HEADERS = ['ticker', 'name', 'sector', 'currency', 'fiscal_date', 'revenue', 'prior_revenue', 'net_income', 'debt', 'equity', 'filing_url'];
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
// Cells must reject control characters before whitespace trimming.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const INVALID_UNICODE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function csvError(line: number, reason: string): never {
  throw new Error(`CSV row ${line}: ${reason}.`);
}
function sourceName(value: string): string {
  if (typeof value !== 'string' || INVALID_UNICODE.test(value) || CONTROL.test(value)) throw new Error('CSV source filename is invalid.');
  const name = value.split(/[\\/]/).at(-1)?.trim() ?? '';
  if (!name || [...name].length > LIMITS.fileNameCharacters) throw new Error('CSV source filename must contain 1–120 characters.');
  return name;
}
/** Complete restricted RFC4180 parsing: records/cells cannot contain embedded line breaks. */
function records(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [], cell = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let line = 1;
  function field(): void { cells.push(cell); cell = ''; state = 'start'; }
  function record(): void {
    field();
    if (cells.length === 1 && !cells[0]) csvError(line, 'blank records are not allowed');
    rows.push(cells); cells = [];
    if (rows.length > LIMITS.companies + 1) csvError(line, 'at most 500 annual records are allowed');
    line++;
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\r' || char === '\n') {
      if (state === 'quoted') csvError(line, 'quoted cells cannot contain line breaks');
      if (char === '\r') {
        if (text[index + 1] !== '\n') csvError(line, 'use LF or CRLF record endings');
        index++;
      }
      record(); continue;
    }
    if (CONTROL.test(char)) csvError(line, 'cell controls are not allowed');
    if (state === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else state = 'closed';
      } else cell += char;
    } else if (char === ',') {
      field();
      if (cells.length >= HEADERS.length) csvError(line, 'unexpected extra column');
    } else if (char === '"') {
      if (state !== 'start') csvError(line, 'quotes must enclose the complete cell');
      state = 'quoted';
    } else {
      if (state === 'closed') csvError(line, 'unexpected characters after a closing quote');
      cell += char; state = 'plain';
    }
  }
  if (state === 'quoted') csvError(line, 'unterminated quoted cell');
  if (cells.length || cell || state !== 'start') record();
  return rows;
}
function amount(value: string, line: number, column: string): number | null {
  if (!value) return null;
  if (!NUMBER.test(value)) csvError(line, `${column} must be a decimal amount with at most six decimal places`);
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > LIMITS.amount) csvError(line, `${column} exceeds the amount limit`);
  return Object.is(number, -0) ? 0 : number;
}

/** Never returns a partial universe; no facts, units or periods are inferred. */
export function parseCsv(bytes: Uint8Array, fileName: string, today: string): CsvPreview {
  const date = validateToday(today), name = sourceName(fileName);
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > LIMITS.csvBytes) throw new Error('Choose a nonempty CSV of at most 2 MiB.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('CSV must contain valid UTF-8.'); }
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  const rows = records(text), header = rows.shift();
  if (!header || header.length !== HEADERS.length || header.some((value, index) => value !== HEADERS[index])) throw new Error('CSV header must match the eleven documented columns in order.');
  if (!rows.length) throw new Error('CSV must contain at least one annual record.');
  const periods = new Map<string, Set<string>>();
  const companies = rows.map((fields, index): Company => {
    const line = index + 2;
    if (fields.length !== HEADERS.length) csvError(line, 'expected exactly eleven columns');
    const cells = fields.map(value => value.trim());
    const candidate = {
      ticker: cells[0], name: cells[1], sector: cells[2], currency: cells[3], fiscalDate: cells[4],
      revenue: amount(cells[5], line, 'revenue'), priorRevenue: amount(cells[6], line, 'prior_revenue'),
      netIncome: amount(cells[7], line, 'net_income'), debt: amount(cells[8], line, 'debt'),
      equity: amount(cells[9], line, 'equity'), filingUrl: cells[10] || null, sourceLine: line,
    };
    let company: Company;
    try { company = validateCompany(candidate, date); }
    catch { return csvError(line, 'invalid reported facts, date, identity or source link'); }
    const dates = periods.get(company.ticker) ?? new Set<string>();
    if (dates.has(company.fiscalDate)) csvError(line, 'duplicate normalized ticker and fiscal date');
    if (dates.size >= LIMITS.periodsPerTicker) csvError(line, 'at most five annual periods per ticker are allowed');
    dates.add(company.fiscalDate);
    periods.set(company.ticker, dates);
    return company;
  });
  return { fileName: name, companies };
}
/** Revalidate even hand-built previews before assigning independent dataset provenance. */
export function createDataset(preview: CsvPreview, today: string, synthetic = false): Dataset {
  const date = validateToday(today);
  if (typeof synthetic !== 'boolean') throw new Error('Synthetic provenance must be a boolean.');
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) throw new Error('CSV preview must contain exact plain data fields.');
  const prototype = Object.getPrototypeOf(preview), descriptors = Object.getOwnPropertyDescriptors(preview), keys = Reflect.ownKeys(preview);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== 2 || keys.some(key => key !== 'fileName' && key !== 'companies') || ['fileName', 'companies'].some(key => !descriptors[key]?.enumerable || !('value' in descriptors[key]))) throw new Error('CSV preview must contain exact plain data fields.');
  return validateDataset({
    id: crypto.randomUUID(), fileName: descriptors.fileName.value, importedDate: date,
    basis: 'annual-12-month', units: 'currency-millions', synthetic, companies: descriptors.companies.value,
  }, date);
}
export function blankCsvTemplate(): string { return HEADERS.join(',') + '\n'; }
