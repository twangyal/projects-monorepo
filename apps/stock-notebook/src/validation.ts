import { LIMITS, type Company, type Dataset, type Filter, type Metric, type Operator, type Screen } from './types.ts';

export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function dataObject(value: unknown, keys: string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a plain data object.');
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null, 'Unsupported object prototype.');
  const own = Reflect.ownKeys(value);
  requireValue(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)), 'Unexpected or missing data fields.');
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireValue('value' in descriptor && descriptor.enumerable, 'Use ordinary JSON data fields.');
  }
  return value as Record<string, unknown>;
}
export function boundedArray(value: unknown, maximum: number, minimum = 0): unknown[] {
  requireValue(Array.isArray(value) && value.length >= minimum && value.length <= maximum, 'Collection exceeds supported count bounds.');
  requireValue(Reflect.ownKeys(value).length === value.length + 1, 'Use a dense JSON array without extra fields.');
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    requireValue(descriptor && 'value' in descriptor && descriptor.enumerable, 'Use a dense array of ordinary values.');
  }
  return value;
}
export function validateUnicode(value: string, allow: 'none' | 'notes' | 'query' = 'none'): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    requireValue(point < 0xd800 || point > 0xdfff, 'Text must contain valid Unicode.');
    requireValue((point >= 32 || (point === 9 && allow !== 'none') || (point === 10 && allow === 'notes'))
      && (point < 127 || point > 159), 'Text contains unsupported controls.');
  }
}
export function validateText(value: unknown, maximum: number, allow: 'none' | 'notes' | 'query' = 'none', empty = false): string {
  requireValue(typeof value === 'string' && value.length <= LIMITS.notebookBytes, 'Text exceeds supported bounds.');
  const normalized = allow === 'notes' ? value.replace(/\r\n/g, '\n') : value;
  validateUnicode(normalized, allow);
  const result = normalized.trim();
  requireValue((empty || result.length > 0) && [...result].length <= maximum, 'Text length is outside supported bounds.');
  return result;
}
export function validateUuid(value: unknown): string {
  requireValue(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/.test(value), 'Use a canonical lowercase UUID.');
  return value;
}
export function validateAmount(value: unknown): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMITS.amount
    && Number(value.toFixed(LIMITS.amountDecimals)) === value, 'Financial value must be finite, within one billion millions and use at most six decimals.');
  return value === 0 ? 0 : value;
}
export function validateToday(value: unknown): string {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?![\s\S])/.test(value)
    && value >= LIMITS.minDate && value <= LIMITS.maxDate, 'Use a date from 2000-01-01 through 2099-12-31.');
  const parsed = new Date(value + 'T00:00:00.000Z');
  requireValue(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, 'Use a real Gregorian date.');
  return value;
}
function currency(value: unknown): string {
  requireValue(typeof value === 'string' && /^[A-Z]{3}(?![\s\S])/.test(value), 'Currency must be three uppercase ASCII letters.');
  return value;
}
function localAddress(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(name);
  if (ipv4) return Number(ipv4[1]) === 127 || Number(ipv4[1]) === 169 && Number(ipv4[2]) === 254;
  if (!name.startsWith('[')) return false;
  const raw = name.slice(1, -1), parts = raw.split('::');
  const left = parts[0] ? parts[0].split(':').map(part => parseInt(part, 16)) : [];
  const right = parts[1] ? parts[1].split(':').map(part => parseInt(part, 16)) : [];
  const words = parts.length === 2 ? [...left, ...new Array(8 - left.length - right.length).fill(0), ...right] : left;
  if (words.length !== 8) return true;
  if (words.slice(0, 7).every(word => word === 0) && words[7] === 1) return true;
  if ((words[0] & 0xffc0) === 0xfe80) return true;
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    const first = words[6] >>> 8, second = words[6] & 255;
    return first === 127 || first === 169 && second === 254;
  }
  return false;
}
function filingUrl(value: unknown): string | null {
  if (value === null) return null;
  requireValue(typeof value === 'string' && [...value].length <= LIMITS.urlCharacters && value.length > 0, 'Supplied source URL exceeds supported bounds.');
  validateUnicode(value);
  requireValue(!/\s/.test(value) && !value.includes('\\') && !value.includes('#'), 'Use a safe absolute HTTPS source URL without credentials or fragments.');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Use a valid absolute HTTPS source URL.'); }
  requireValue(/^https:\/\//i.test(value) && parsed.protocol === 'https:' && parsed.hostname.length > 0
    && !parsed.username && !parsed.password && !value.slice(value.indexOf('//') + 2).split(/[/?]/, 1)[0].includes('@')
    && !parsed.port && !localAddress(parsed.hostname), 'Use a safe HTTPS source URL without credentials, local addresses or nondefault ports.');
  return value;
}
export function validateCompany(value: unknown, today: string): Company {
  validateToday(today);
  const row = dataObject(value, ['ticker', 'name', 'sector', 'currency', 'fiscalDate', 'revenue', 'priorRevenue', 'netIncome', 'debt', 'equity', 'filingUrl', 'sourceLine']);
  const suppliedTicker = validateText(row.ticker, LIMITS.tickerCharacters);
  requireValue(/^[A-Za-z0-9][A-Za-z0-9.-]{0,15}(?![\s\S])/.test(suppliedTicker), 'Ticker has unsupported characters.');
  const ticker = suppliedTicker.toUpperCase();
  const fiscalDate = validateToday(row.fiscalDate);
  requireValue(fiscalDate <= today, 'Fiscal date cannot be after the supplied date.');
  requireValue(typeof row.sourceLine === 'number' && Number.isInteger(row.sourceLine) && row.sourceLine >= 2 && row.sourceLine <= LIMITS.companies + 1, 'Source line must be an integer from 2 through 501.');
  const amounts: Record<string, number | null> = {};
  for (const key of ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity']) {
    const amount = row[key] === null ? null : validateAmount(row[key]);
    requireValue(amount === null || !['revenue', 'priorRevenue', 'debt'].includes(key) || amount >= 0, 'Revenue and gross debt cannot be negative.');
    amounts[key] = amount;
  }
  return { ticker, name: validateText(row.name, LIMITS.nameCharacters), sector: validateText(row.sector, LIMITS.sectorCharacters),
    currency: currency(row.currency), fiscalDate, revenue: amounts.revenue, priorRevenue: amounts.priorRevenue,
    netIncome: amounts.netIncome, debt: amounts.debt, equity: amounts.equity, filingUrl: filingUrl(row.filingUrl), sourceLine: row.sourceLine };
}
export function validateDataset(value: unknown, today: string): Dataset {
  validateToday(today);
  const data = dataObject(value, ['id', 'fileName', 'importedDate', 'basis', 'units', 'synthetic', 'companies']);
  const id = validateUuid(data.id), fileName = validateText(data.fileName, LIMITS.fileNameCharacters), importedDate = validateToday(data.importedDate);
  requireValue(!/[\\/]/.test(fileName), 'Source filename must not contain directory components.');
  requireValue(importedDate <= today, 'Import date cannot be in the future.');
  requireValue(data.basis === 'annual-12-month' && data.units === 'currency-millions', 'Dataset must declare annual twelve-month periods in currency millions.');
  requireValue(typeof data.synthetic === 'boolean', 'Synthetic provenance must be a boolean.');
  const companies = boundedArray(data.companies, LIMITS.companies, 1).map(row => validateCompany(row, importedDate));
  const tickers = new Set<string>(); let previous = 1;
  for (const row of companies) {
    requireValue(!tickers.has(row.ticker), 'Dataset contains duplicate normalized tickers.'); tickers.add(row.ticker);
    requireValue(row.sourceLine > previous, 'Source lines must be strictly increasing in dataset order.'); previous = row.sourceLine;
  }
  return { id, fileName, importedDate, basis: 'annual-12-month', units: 'currency-millions', synthetic: data.synthetic, companies };
}
export function validateScreen(value: unknown, dataset: Dataset): Screen {
  const data = validateDataset(dataset, LIMITS.maxDate), screen = dataObject(value, ['sector', 'currency', 'filters', 'includeStale', 'sortBy', 'direction']);
  const currencies = new Set(data.companies.map(row => row.currency));
  let sector: string | null = null;
  if (screen.sector !== null) {
    const supplied = validateText(screen.sector, LIMITS.sectorCharacters);
    sector = data.companies.find(row => row.sector.toLowerCase() === supplied.toLowerCase())?.sector ?? null;
    requireValue(sector !== null, 'Sector must exist in the supplied dataset.');
  }
  const selectedCurrency = screen.currency === null ? null : currency(screen.currency);
  requireValue(selectedCurrency === null || currencies.has(selectedCurrency), 'Currency must exist in the supplied dataset.');
  const metrics: Metric[] = ['revenue', 'netIncome', 'debt', 'equity', 'growthPct', 'marginPct', 'debtEquity'];
  const operators: Operator[] = ['gt', 'gte', 'lt', 'lte', 'eq'];
  const money: Metric[] = ['revenue', 'netIncome', 'debt', 'equity'];
  const seen = new Set<string>();
  const filters: Filter[] = boundedArray(screen.filters, LIMITS.filters).map(value => {
    const filter = dataObject(value, ['metric', 'operator', 'value', 'currency']);
    requireValue(typeof filter.metric === 'string' && metrics.includes(filter.metric as Metric), 'Unsupported screening metric.');
    requireValue(typeof filter.operator === 'string' && operators.includes(filter.operator as Operator), 'Unsupported comparison operator.');
    const metric = filter.metric as Metric, operator = filter.operator as Operator, amount = validateAmount(filter.value);
    const unit = filter.currency === null ? null : currency(filter.currency);
    requireValue(money.includes(metric) ? unit === null ? amount === 0 : currencies.has(unit) : unit === null, 'Money filters require a supplied currency except cross-currency zero; ratios require no currency.');
    const result: Filter = { metric, operator, value: amount, currency: unit }, key = JSON.stringify(result);
    requireValue(!seen.has(key), 'Duplicate filters are not supported.'); seen.add(key); return result;
  });
  requireValue(typeof screen.includeStale === 'boolean', 'Stale inclusion must be a boolean.');
  requireValue(screen.sortBy === 'ticker' || typeof screen.sortBy === 'string' && metrics.includes(screen.sortBy as Metric), 'Unsupported sort metric.');
  requireValue(screen.direction === 'asc' || screen.direction === 'desc', 'Unsupported sort direction.');
  return { sector, currency: selectedCurrency, filters, includeStale: screen.includeStale, sortBy: screen.sortBy as Screen['sortBy'], direction: screen.direction };
}
