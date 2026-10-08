import { LIMITS } from './types.ts';
import type { Company, Notebook, ResearchRow, Screen } from './types.ts';
import { validateToday } from './validation.ts';
import { validateNotebook } from './model.ts';
import { parseQuery } from './query.ts';
import { analyzeCompany, compareCompanies, screenDataset, auditScreen } from './research.ts';
import { latestCompanies } from './periods.ts';
import { analyzeCompanyHistory } from './annual-history.ts';
import type { PeriodComparison } from './annual-history.ts';
import { briefReportLines } from './brief-report.ts';

const operators = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' } as const;
const monetary = new Set(['revenue', 'netIncome', 'debt', 'equity']);
function screenKey(screen: Screen): string {
  return JSON.stringify([screen.sector, screen.currency, screen.includeStale, screen.sortBy, screen.direction,
    screen.filters.map(filter => [filter.metric, filter.operator, filter.value, filter.currency])]);
}
const raw = (number: number | null): string => number === null ? 'Not supplied' : String(number);
function formulas(company: Company, row: ResearchRow): string[] {
  const { revenue, priorRevenue, netIncome, debt, equity } = company;
  const growth = row.derived.growthPct === null
    ? `growthPct: Undefined (${revenue === null || priorRevenue === null ? 'missing revenue or priorRevenue input' : 'priorRevenue is zero'})`
    : `growthPct = 100 * (${raw(revenue)} - ${raw(priorRevenue)}) / ${raw(priorRevenue)} = ${String(row.derived.growthPct)}%`;
  const margin = row.derived.marginPct === null
    ? `marginPct: Undefined (${netIncome === null || revenue === null ? 'missing netIncome or revenue input' : 'revenue is zero'})`
    : `marginPct = 100 * ${raw(netIncome)} / ${raw(revenue)} = ${String(row.derived.marginPct)}%`;
  const leverage = row.derived.debtEquity === null
    ? `debtEquity: Undefined (${debt === null || equity === null ? 'missing debt or equity input' : 'equity is nonpositive'})`
    : `debtEquity = ${raw(debt)} / ${raw(equity)} = ${String(row.derived.debtEquity)}`;
  return [growth, margin, leverage];
}

/** Bounded plain text based on the applied screen and evaluation date, never HTML or CSV. */
export function buildReport(notebook: Notebook, today: string): string {
  const date = validateToday(today);
  const current = validateNotebook(notebook, date);
  const { dataset, screen } = current;
  const shortlist = screenDataset(dataset, screen, date);
  const comparison = compareCompanies(dataset, current.comparison, date);
  const interpreted = parseQuery(current.query, dataset).screen;
  const latest = latestCompanies(dataset.companies);
  const lines: string[] = [];
  let reportBytes = 0;
  const encoder = new TextEncoder();
  function append(...values: string[]): void {
    for (const value of values) {
      reportBytes += encoder.encode(value).length + 1;
      if (reportBytes > LIMITS.reportBytes) throw new Error('The research report exceeds the 8 MiB text limit. Reduce watchlist/comparison selections or shorten research notes and retry. The complete supplied history remains available in a JSON backup.');
      lines.push(value);
    }
  }
  append(
    'Stock Notebook research report', current.title, `Export/evaluation UTC date: ${date}`,
    dataset.synthetic ? 'Synthetic demonstration — not real companies or filings' : 'User-supplied annual figures — not independently verified',
    `Source filename: ${dataset.fileName}`, `Imported UTC date: ${dataset.importedDate}`,
    `Supplied annual rows: ${dataset.companies.length}; unique companies: ${latest.length}`,
    `Declared basis: ${dataset.basis}`, `Declared units: ${dataset.units}`,
    'All financial amounts are currency millions. Different currencies are not converted or ranked against each other.',
    'Rows represent supplied 12-month fiscal years on the same reporting basis. priorRevenue is the supplied comparable preceding 12-month period.',
    'Restatements, acquisitions, changed fiscal lengths and accounting bases can defeat period comparability.',
    'Reported facts are supplied inputs; derived ratios and rule-based observations are separate. No forecasts, valuation or investment recommendations are provided.',
    '', 'Applied screening criteria', `Last successfully applied screening language: ${current.query || '(empty; default interpretation)'}`,
    screenKey(screen) === screenKey(interpreted) ? 'Applied criteria match the last interpretation.' : 'Filters edited after interpretation — applied criteria below drive this report.',
    `Sector: ${screen.sector ?? 'All sectors'}`, `Currency: ${screen.currency ?? 'All supplied currencies'}`,
    `Freshness policy: ${screen.includeStale ? 'Include stale' : 'Exclude stale'}; fiscal period is stale only when age exceeds 548 UTC days.`,
    `Sort: ${screen.sortBy} ${screen.direction === 'asc' ? 'ascending' : 'descending'}; nulls last, ties by ticker ascending.`,
  );
  if (!screen.filters.length) append('Filters: None');
  for (const filter of screen.filters) {
    const units = monetary.has(filter.metric)
      ? filter.currency ? ` million ${filter.currency}` : ' (all currencies; sign comparison)'
      : filter.metric === 'debtEquity' ? '' : '%';
    append(`Filter: ${filter.metric} ${operators[filter.operator]} ${String(filter.value)}${units}`);
  }
  append(`Shortlist: ${shortlist.rows.length}; excluded stale: ${shortlist.excludedStale}; excluded missing required metrics: ${shortlist.excludedMissing}`, '', 'Shortlist facts, derived formulas and observations');
  function companyBlock(row: ResearchRow): void {
    const company = row.company;
    const age = Math.round((new Date(`${date}T00:00:00.000Z`).getTime() - new Date(`${company.fiscalDate}T00:00:00.000Z`).getTime()) / 86_400_000);
    append('', `${company.ticker} — ${company.name}`, `Sector: ${company.sector}; currency: ${company.currency}`,
      `Fiscal period end: ${company.fiscalDate}; age ${age} days; ${row.stale ? 'stale' : 'fresh'}`,
      `Source row: ${dataset.fileName}:${company.sourceLine}`,
      company.filingUrl ? `Supplied source link: ${company.filingUrl}` : 'No filing link supplied',
      'Reported facts (currency millions):');
    for (const field of ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'] as const) append(`${field}: ${raw(company[field])}${company[field] === null ? '' : ` million ${company.currency}`}`);
    append('Derived formulas (unrounded IEEE754 results):', ...formulas(company, row), 'Derived observations (fixed rules, with raw-field provenance):');
    if (!row.observations.some(observation => observation.kind === 'strength' || observation.kind === 'risk')) append('No rule-based strengths/risks found');
    for (const observation of row.observations) append(`${observation.kind} [${observation.code}] ${observation.text} (fields: ${observation.fields.join(', ')}; source ${dataset.fileName}:${company.sourceLine})`);
  }
  if (!shortlist.rows.length) append('No companies match the applied criteria.');
  for (const row of shortlist.rows) companyBlock(row);
  append('', 'Screening exclusion audit (latest supplied period only)',
    'Every failed applied rule is retained; one company may have multiple reasons. Draft controls do not affect these decisions.',
    'Missing/undefined metrics never pass; different monetary currencies are not numerically compared. Values are unrounded.');
  const excluded = auditScreen(dataset, screen, date).filter(decision => !decision.matched);
  if (!excluded.length) append('No companies excluded by the applied criteria.');
  for (const decision of excluded) {
    const company = decision.row.company;
    append('', `Excluded: ${company.ticker}; fiscal ${company.fiscalDate}; source ${dataset.fileName}:${company.sourceLine}`,
      company.filingUrl ? `Supplied source link: ${company.filingUrl}` : 'No filing link supplied');
    // Every reason in this block refers to the source in its company header.
    for (const reason of decision.reasons) append(`[${reason.kind}] ${reason.text} (fields: ${reason.fields.join(', ')})`);
  }
  append('', 'Selected comparison', `Comparison order: ${current.comparison.length ? current.comparison.join(', ') : '(none)'}`,
    `Monetary amounts directly comparable: ${comparison.monetaryComparable ? 'Yes; same supplied currency' : 'No'}`);
  for (const warning of comparison.warnings) append(`Comparison warning: ${warning}`);
  for (const row of comparison.rows) companyBlock(row);
  append('', `Watchlist: ${current.watchlist.length ? current.watchlist.join(', ') : '(none)'}`,
    'Watchlist and comparison are manual research choices; stale entries are retained.');
  const byTicker = new Map(latest.map(company => [company.ticker, company]));
  // The complete notebook was validated above. Keep each ticker's original
  // source order so the public analyzer can validate its bounded 1–5 rows
  // without rescanning unrelated annual rows and links for every company.
  const annualRows = new Map<string, Company[]>();
  for (const row of dataset.companies) {
    const rows = annualRows.get(row.ticker);
    if (rows) rows.push(row); else annualRows.set(row.ticker, [row]);
  }
  for (const ticker of current.watchlist) companyBlock(analyzeCompany(byTicker.get(ticker)!, date));
  append('', 'Research notes (literal supplied text)');
  if (!current.notes.length) append('(none)');
  for (const note of current.notes) append(`${note.ticker}:`, note.text, '');
  append('', 'Annual-history appendix (all supplied annual rows, including excluded companies)',
    dataset.synthetic ? 'Synthetic demonstration — not real companies or filings' : 'User-supplied history — not independently verified',
    'Grouped by ticker and ascending fiscal date. Every supplied annual row appears once in this appendix.',
    'Adjacent stored-row changes are separate from growthPct calculated from each row’s declared priorRevenue.',
    'Automatic comparability uses consecutive calendar years, aligned fiscal month/day (February 28/29 allowed), and unchanged currency, company name and sector.',
    'This calendar rule is a conservative heuristic. No missing periods, accounting-basis verification, annualization or currency conversion are inferred.',
    '52/53-week fiscal years and identity changes may require manual comparison; they are not declared invalid.');

  function pairBlock(pair: PeriodComparison): void {
    const { previous, current: later } = pair;
    append('', `Adjacent supplied periods: ${previous.ticker} — ${previous.fiscalDate} to ${later.fiscalDate}`,
      `Previous source: ${dataset.fileName}:${previous.sourceLine}; fiscal date ${previous.fiscalDate}; currency ${previous.currency}`,
      previous.filingUrl ? `Previous supplied source link: ${previous.filingUrl}` : 'Previous supplied source link: Not supplied',
      `Current source: ${dataset.fileName}:${later.sourceLine}; fiscal date ${later.fiscalDate}; currency ${later.currency}`,
      later.filingUrl ? `Current supplied source link: ${later.filingUrl}` : 'Current supplied source link: Not supplied',
      `Automatic comparison: ${pair.comparable ? 'Available under the disclosed heuristic' : 'Withheld'}`);
    for (const reason of pair.reasons) append(`Comparison reason: ${reason}`);
    for (const warning of pair.warnings) append(`Comparison warning: ${warning}`);
    if (pair.comparable && previous.revenue !== null && later.priorRevenue !== null) {
      append(`Comparable-pair priorRevenue input: ${raw(later.priorRevenue)} million ${later.currency} (${dataset.fileName}:${later.sourceLine}); preceding stored revenue: ${raw(previous.revenue)} million ${previous.currency} (${dataset.fileName}:${previous.sourceLine}). Neither input is replaced.`);
    }
    for (const change of pair.changes) {
      if (change.delta === null) append(`${change.metric} delta: Unavailable (${change.reason})`);
      else if (change.metric === 'marginPct') {
        append(`marginPct delta = (100 * ${raw(later.netIncome)} / ${raw(later.revenue)}) - (100 * ${raw(previous.netIncome)} / ${raw(previous.revenue)}) = ${String(change.delta)} percentage points`);
      } else {
        append(`${change.metric} delta = ${raw(later[change.metric])} - ${raw(previous[change.metric])} = ${String(change.delta)} million ${later.currency}`);
      }
      if (change.metric === 'marginPct') append(`marginPct relative percentage: Not calculated (${change.percentReason})`);
      else if (change.percentChange === null) append(`${change.metric} relative change: Unavailable (${change.percentReason})`);
      else append(`${change.metric} relative change = 100 * (${raw(later[change.metric])} - ${raw(previous[change.metric])}) / ${raw(previous[change.metric])} = ${String(change.percentChange)}%`);
    }
  }
  for (const company of latest) {
    const history = analyzeCompanyHistory({ ...dataset, companies: annualRows.get(company.ticker)! }, company.ticker, date);
    append('', `Supplied history: ${history.ticker}; ${history.periods.length} annual periods`);
    for (const row of history.periods) {
      const period = row.company;
      append('', `Annual period: ${period.ticker} — ${period.fiscalDate}`, `Company name: ${period.name}`,
        `Sector: ${period.sector}; currency: ${period.currency}`, `Source row: ${dataset.fileName}:${period.sourceLine}`,
        period.filingUrl ? `Supplied source link: ${period.filingUrl}` : 'No filing link supplied',
        'Reported annual facts (currency millions):');
      for (const field of ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'] as const) append(`${field}: ${raw(period[field])}${period[field] === null ? '' : ` million ${period.currency}`}`);
      append('Per-period derived formulas (unrounded IEEE754 results):', ...formulas(period, row));
    }
    if (!history.comparisons.length) append('No adjacent supplied pair is available.');
    for (const pair of history.comparisons) pairBlock(pair);
    append('Retrospective directions over every supplied period; these are not strengths, forecasts or recommendations.');
    const first = history.periods[0]!.company.fiscalDate, last = history.periods.at(-1)!.company.fiscalDate;
    for (const trend of history.trends) {
      const direction = trend.direction === 'mixed' ? 'mixed or unchanged intervals' : trend.direction;
      append(`All-period ${trend.metric} direction: ${direction} (${trend.periodCount} supplied periods; ${first} through ${last})${trend.reason ? `; reason: ${trend.reason}` : ''}`);
    }
  }
  append('Figures and period comparability are supplied by the importer and have not been independently verified.');
  append('', 'Company briefs (all committed user-authored research, including companies outside the shortlist)');
  if (!current.briefs.length) append('(none)');
  for (const brief of current.briefs) {
    append('');
    for (const line of briefReportLines(brief, dataset, date)) append(line);
  }
  return lines.join('\n') + '\n';
}
