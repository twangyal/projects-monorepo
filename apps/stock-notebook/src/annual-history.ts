import type { Company, Dataset, ResearchRow } from './types.ts';
import { validateDataset, validateToday } from './validation.ts';
import { periodsForTicker } from './periods.ts';
import { analyzeCompany } from './research.ts';

export type HistoryMetric = 'revenue' | 'debt' | 'marginPct';
export interface HistoricalChange {
  metric: HistoryMetric; delta: number | null; percentChange: number | null;
  reason: string | null; percentReason: string | null;
}
export interface PeriodComparison {
  previous: Company; current: Company; comparable: boolean;
  reasons: string[]; warnings: string[]; changes: HistoricalChange[];
}
export interface HistoryTrend {
  metric: HistoryMetric;
  direction: 'increasing' | 'decreasing' | 'flat' | 'mixed' | 'unavailable';
  reason: string | null; periodCount: number;
}
export interface CompanyHistory {
  ticker: string; periods: ResearchRow[]; comparisons: PeriodComparison[]; trends: HistoryTrend[];
}

const metrics: HistoryMetric[] = ['revenue', 'debt', 'marginPct'];
const marginPercentReason = 'Net margin changes use percentage points; relative percentage change is not calculated.';
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Historical arithmetic exceeds the supported finite range.');
  return value === 0 ? 0 : value;
}
function comparison(previous: ResearchRow, current: ResearchRow): PeriodComparison {
  const older = previous.company, newer = current.company, reasons: string[] = [], warnings: string[] = [];
  if (Number(newer.fiscalDate.slice(0, 4)) !== Number(older.fiscalDate.slice(0, 4)) + 1) {
    reasons.push('Fiscal end dates are not in consecutive calendar years; missing periods are not interpolated.');
  }
  const beforeDay = older.fiscalDate.slice(5), afterDay = newer.fiscalDate.slice(5);
  const februaryEnds = new Set(['02-28', '02-29']);
  if (beforeDay !== afterDay && !(februaryEnds.has(beforeDay) && februaryEnds.has(afterDay))) {
    reasons.push('Fiscal end-date alignment changed; automatic comparison is withheld.');
  }
  if (older.currency !== newer.currency) reasons.push('Currency changed; no currency conversion is inferred.');
  if (older.name !== newer.name) reasons.push('Supplied company name changed; identity continuity is not inferred.');
  if (older.sector !== newer.sector) reasons.push('Supplied sector changed; automatic comparison is withheld.');
  const comparable = reasons.length === 0;
  if (comparable && newer.priorRevenue !== null && older.revenue !== null && newer.priorRevenue !== older.revenue) {
    warnings.push(`Supplied prior revenue ${newer.priorRevenue} at ${newer.fiscalDate} (CSV row ${newer.sourceLine}) differs from stored revenue ${older.revenue} at ${older.fiscalDate} (CSV row ${older.sourceLine}). Both supplied figures are retained without adjustment.`);
  }
  const changes = metrics.map((metric): HistoricalChange => {
    if (!comparable) return { metric, delta: null, percentChange: null, reason: reasons.join(' '),
      percentReason: metric === 'marginPct' ? marginPercentReason : reasons.join(' ') };
    if (metric === 'marginPct') {
      const before = previous.derived.marginPct, after = current.derived.marginPct;
      const absent = [before === null ? older.fiscalDate : null, after === null ? newer.fiscalDate : null].filter(date => date !== null);
      return { metric, delta: before === null || after === null ? null : finite(after - before), percentChange: null,
        reason: absent.length ? `Net margin is unavailable at ${absent.join(' and ')}; positive revenue and supplied net income are required.` : null,
        percentReason: marginPercentReason };
    }
    const before = older[metric], after = newer[metric], label = metric === 'revenue' ? 'Revenue' : 'Gross debt';
    if (before === null || after === null) {
      const absent = [before === null ? older.fiscalDate : null, after === null ? newer.fiscalDate : null].filter(date => date !== null);
      const reason = `${label} was not supplied at ${absent.join(' and ')}.`;
      return { metric, delta: null, percentChange: null, reason, percentReason: reason };
    }
    const delta = finite(after - before);
    return { metric, delta, percentChange: before > 0 ? finite(100 * delta / before) : null, reason: null,
      percentReason: before > 0 ? null : `Previous ${label.toLowerCase()} is zero; relative percentage change is undefined.` };
  });
  return { previous: { ...older }, current: { ...newer }, comparable, reasons, warnings, changes };
}
function trend(metric: HistoryMetric, comparisons: PeriodComparison[], periodCount: number): HistoryTrend {
  const unavailable = (reason: string): HistoryTrend => ({ metric, direction: 'unavailable', reason, periodCount });
  if (periodCount < 3) return unavailable('At least three supplied annual periods are required for an all-period direction summary.');
  if (comparisons.some(pair => !pair.comparable)) return unavailable('One or more adjacent supplied periods are not automatically comparable; no periods are omitted from this summary.');
  if (comparisons.some(pair => pair.warnings.length > 0)) return unavailable('Supplied prior revenue differs from stored revenue; an all-period direction is withheld.');
  const changes = comparisons.map(pair => pair.changes.find(change => change.metric === metric)!.delta);
  if (changes.some(change => change === null)) return unavailable('A required metric is missing or unavailable in the supplied periods; missing values are not bridged.');
  const deltas = changes as number[];
  const direction = deltas.every(delta => delta > 0) ? 'increasing' : deltas.every(delta => delta < 0) ? 'decreasing'
    : deltas.every(delta => delta === 0) ? 'flat' : 'mixed';
  return { metric, direction, reason: null, periodCount };
}
/** Retrospective arithmetic over all supplied periods; never repairs their facts. */
export function analyzeCompanyHistory(dataset: Dataset, ticker: string, today: string): CompanyHistory {
  const date = validateToday(today), data = validateDataset(dataset, date);
  if (typeof ticker !== 'string') throw new Error('Choose an exact ticker present in this dataset.');
  const rows = periodsForTicker(data.companies, ticker);
  if (!rows.length) throw new Error('Choose an exact ticker present in this dataset.');
  const periods = rows.map(company => analyzeCompany(company, date));
  const comparisons = periods.slice(1).map((current, index) => comparison(periods[index]!, current));
  return { ticker, periods, comparisons, trends: metrics.map(metric => trend(metric, comparisons, periods.length)) };
}
