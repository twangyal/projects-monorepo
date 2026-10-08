import { validateCompany, validateDataset, validateScreen, validateToday, boundedArray } from './validation.ts';
import { LIMITS } from './types.ts';
import { latestCompanies } from './periods.ts';
import type { Company, Dataset, Screen, Derived, ResearchRow, ScreenResult, Comparison, Metric, Filter, Observation, ScreenDecision, ScreenReason } from './types.ts';

type Amount = 'revenue' | 'priorRevenue' | 'netIncome' | 'debt' | 'equity';
const amounts: Amount[] = ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'];
const labels: Record<Amount, string> = { revenue: 'Revenue', priorRevenue: 'Prior revenue', netIncome: 'Net income', debt: 'Gross debt', equity: 'Equity' };
const money = (metric: string): boolean => ['revenue', 'netIncome', 'debt', 'equity'].includes(metric);
const order = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('The supplied figures produce an unsupported arithmetic result. Check the financial inputs.');
  return Object.is(value, -0) ? 0 : value;
}
function derived(company: Company): Derived {
  const { revenue, priorRevenue, netIncome, debt, equity } = company;
  return {
    growthPct: revenue !== null && priorRevenue !== null && priorRevenue > 0 ? finite(100 * (revenue - priorRevenue) / priorRevenue) : null,
    marginPct: netIncome !== null && revenue !== null && revenue > 0 ? finite(100 * netIncome / revenue) : null,
    debtEquity: debt !== null && equity !== null && equity > 0 ? finite(debt / equity) : null,
  };
}
export function calculateDerived(company: Company): Derived { return derived(validateCompany(company, LIMITS.maxDate)); }
function stale(company: Company, today: string): boolean {
  return (Date.parse(today + 'T00:00:00Z') - Date.parse(company.fiscalDate + 'T00:00:00Z')) / 86_400_000 > LIMITS.staleDays;
}
function analyze(company: Company, today: string): ResearchRow {
  const result = derived(company), isStale = stale(company, today), observations: Observation[] = [];
  const add = (kind: Observation['kind'], code: string, text: string, fields: (keyof Company)[]): void => { observations.push({ kind, code, text, fields }); };
  if (result.growthPct !== null && result.growthPct > 0) add('strength', 'growth-positive', 'Revenue exceeds the supplied prior annual period', ['revenue', 'priorRevenue']);
  if (result.marginPct !== null && result.marginPct >= 10) add('strength', 'margin-high', 'Calculated net margin is at least 10%', ['netIncome', 'revenue']);
  if (result.debtEquity !== null && result.debtEquity <= 1) add('strength', 'leverage-low', 'Calculated debt/equity is at most 1', ['debt', 'equity']);
  if (result.growthPct !== null && result.growthPct < 0) add('risk', 'growth-negative', 'Revenue is below the supplied prior annual period', ['revenue', 'priorRevenue']);
  if (result.marginPct !== null && result.marginPct < 0) add('risk', 'margin-negative', 'Calculated net margin is negative', ['netIncome', 'revenue']);
  if (result.debtEquity !== null && result.debtEquity > 2) add('risk', 'leverage-high', 'Calculated debt/equity exceeds 2', ['debt', 'equity']);
  if (company.equity !== null && company.equity <= 0) add('risk', 'equity-nonpositive', 'Reported equity is nonpositive; debt/equity is undefined', ['equity']);
  const undefinedRatio = (metric: keyof Derived, code: string, name: string, numerator: Amount, denominator: Amount): void => {
    if (result[metric] !== null) return;
    const missing = [numerator, denominator].filter(field => company[field] === null);
    const reason = missing.length ? `${missing.map(field => labels[field]).join(' and ')} not supplied`
      : denominator === 'equity' ? 'reported equity is nonpositive' : `${labels[denominator].toLowerCase()} denominator is zero`;
    add('uncertainty', code, `${name} is undefined: ${reason}`, [numerator, denominator]);
  };
  undefinedRatio('growthPct', 'growth-undefined', 'Revenue growth', 'revenue', 'priorRevenue');
  undefinedRatio('marginPct', 'margin-undefined', 'Net margin', 'netIncome', 'revenue');
  undefinedRatio('debtEquity', 'leverage-undefined', 'Debt/equity', 'debt', 'equity');
  for (const field of amounts) if (company[field] === null) add('uncertainty', `missing-${field}`, `${labels[field]} was not supplied`, [field]);
  if (isStale) add('uncertainty', 'stale-period', 'The supplied fiscal year end is more than 548 days old; this measures the period end, not filing recency', ['fiscalDate']);
  if (company.filingUrl === null) add('uncertainty', 'missing-source', 'No filing link supplied', ['filingUrl']);
  add('uncertainty', 'unverified-inputs', 'Figures and period comparability are supplied by the importer and have not been independently verified', ['fiscalDate', 'priorRevenue']);
  return { company, derived: result, stale: isStale, observations };
}
export function analyzeCompany(company: Company, today: string): ResearchRow {
  const date = validateToday(today); return analyze(validateCompany(company, date), date);
}
function value(row: ResearchRow, metric: Metric): number | null {
  if (metric === 'growthPct' || metric === 'marginPct' || metric === 'debtEquity') return row.derived[metric];
  return row.company[metric];
}
function matches(actual: number, filter: Filter): boolean {
  switch (filter.operator) {
    case 'gt': return actual > filter.value;
    case 'gte': return actual >= filter.value;
    case 'lt': return actual < filter.value;
    case 'lte': return actual <= filter.value;
    case 'eq': return actual === filter.value;
  }
}
const metricFields: Record<Metric, (keyof Company)[]> = {
  revenue: ['revenue'], netIncome: ['netIncome'], debt: ['debt'], equity: ['equity'],
  growthPct: ['revenue', 'priorRevenue'], marginPct: ['netIncome', 'revenue'], debtEquity: ['debt', 'equity'],
};
const operators = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' } as const;
function decisions(data: Dataset, criteria: Screen, date: string): ScreenDecision[] {
  return latestCompanies(data.companies).map(company => {
    const row = analyze(company, date), reasons: ScreenReason[] = [];
    const add = (kind: ScreenReason['kind'], text: string, fields: (keyof Company)[], filterIndex: number | null = null): void => {
      reasons.push({ kind, text, fields: [...fields], filterIndex });
    };
    if (!criteria.includeStale && row.stale) {
      const age = (Date.parse(date + 'T00:00:00Z') - Date.parse(company.fiscalDate + 'T00:00:00Z')) / 86_400_000;
      add('stale', `Fiscal period age ${age} UTC days exceeds the applied 548-day limit.`, ['fiscalDate']);
    }
    if (criteria.sector !== null && company.sector.toLowerCase() !== criteria.sector.toLowerCase()) {
      add('sector', `Supplied sector ${company.sector} does not match applied sector ${criteria.sector}.`, ['sector']);
    }
    if (criteria.currency !== null && company.currency !== criteria.currency) {
      add('currency', `Supplied currency ${company.currency} does not match applied universe currency ${criteria.currency}.`, ['currency']);
    }
    criteria.filters.forEach((filter, index) => {
      const fields = metricFields[filter.metric], actual = value(row, filter.metric);
      if (filter.currency !== null && company.currency !== filter.currency) {
        add('filter-currency', `Supplied currency ${company.currency} does not match filter ${index + 1} currency ${filter.currency}; monetary values are not compared.`, ['currency'], index);
        return;
      }
      if (actual === null) {
        const absent = fields.filter(field => company[field] === null);
        const denominator = filter.metric === 'growthPct' ? 'priorRevenue' : filter.metric === 'marginPct' ? 'revenue' : 'equity';
        const why = absent.length ? `${absent.join(' and ')} not supplied` : `${denominator} denominator is ${denominator === 'equity' ? 'nonpositive' : 'zero'}`;
        add('undefined', `Filter ${index + 1}: ${filter.metric} is undefined (${why}); missing or undefined values never pass.`, fields, index);
      } else if (!matches(actual, filter)) {
        const units = money(filter.metric) ? ` million ${company.currency}` : filter.metric === 'debtEquity' ? ' (ratio)' : '%';
        add('threshold', `Filter ${index + 1}: ${filter.metric} ${actual}${units} does not satisfy ${operators[filter.operator]} ${filter.value}${units}.`, fields, index);
      }
    });
    return { row, matched: reasons.length === 0, reasons };
  });
}
/** All failed applied rules, with unrounded values; no older-period fallback. */
export function auditScreen(dataset: Dataset, screen: Screen, today: string): ScreenDecision[] {
  const date = validateToday(today), data = validateDataset(dataset, date), criteria = validateScreen(screen, data);
  return decisions(data, criteria, date).sort((a, b) => order(a.row.company.ticker, b.row.company.ticker));
}
export function screenDataset(dataset: Dataset, screen: Screen, today: string): ScreenResult {
  const date = validateToday(today), data = validateDataset(dataset, date), criteria = validateScreen(screen, data);
  const rows: ResearchRow[] = []; let excludedStale = 0, excludedMissing = 0;
  for (const decision of decisions(data, criteria, date)) {
    if (decision.matched) { rows.push(decision.row); continue; }
    // Preserve the established mutually exclusive count precedence, while the
    // audit retains every failure (including failures beyond the first gate).
    if (decision.reasons.some(reason => reason.kind === 'stale')) { excludedStale++; continue; }
    if (decision.reasons.some(reason => ['sector', 'currency', 'filter-currency'].includes(reason.kind))) continue;
    if (decision.reasons.some(reason => reason.kind === 'undefined')) excludedMissing++;
  }
  if (money(criteria.sortBy) && new Set(rows.map(row => row.company.currency)).size > 1) {
    throw new Error('Cannot sort monetary amounts across different currencies. Choose a currency filter or sort by a ratio or ticker.');
  }
  rows.sort((a, b) => {
    if (criteria.sortBy === 'ticker') return order(a.company.ticker, b.company.ticker) * (criteria.direction === 'asc' ? 1 : -1);
    const av = value(a, criteria.sortBy), bv = value(b, criteria.sortBy);
    if (av === null && bv !== null) return 1;
    if (av !== null && bv === null) return -1;
    if (av !== null && bv !== null && av !== bv) return (av < bv ? -1 : 1) * (criteria.direction === 'asc' ? 1 : -1);
    return order(a.company.ticker, b.company.ticker);
  });
  return { rows, excludedStale, excludedMissing };
}
export function compareCompanies(dataset: Dataset, tickers: string[], today: string): Comparison {
  const date = validateToday(today), data = validateDataset(dataset, date);
  const companies = latestCompanies(data.companies);
  boundedArray(tickers, LIMITS.comparison);
  if (new Set(tickers).size !== tickers.length
      || tickers.some(ticker => typeof ticker !== 'string' || !companies.some(company => company.ticker === ticker))) {
    throw new Error('Choose up to four distinct tickers present in the current dataset.');
  }
  const rows = tickers.map(ticker => analyze(companies.find(company => company.ticker === ticker)!, date));
  if (!rows.length) return { rows, warnings: [], monetaryComparable: false };
  const monetaryComparable = new Set(rows.map(row => row.company.currency)).size === 1;
  const warnings: string[] = [];
  if (!monetaryComparable) warnings.push('Different currencies: amounts are not directly comparable');
  if (new Set(rows.map(row => row.company.fiscalDate)).size > 1) warnings.push('Different fiscal year ends: periods may not align');
  return { rows, warnings, monetaryComparable };
}
