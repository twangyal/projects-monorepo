import { LIMITS } from './types.ts';
import type { Company, Notebook, ResearchRow, Screen } from './types.ts';
import { validateToday } from './validation.ts';
import { validateNotebook } from './model.ts';
import { parseQuery } from './query.ts';
import { analyzeCompany, compareCompanies, screenDataset } from './research.ts';

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
  const lines: string[] = [
    'Stock Notebook research report', current.title, `Export/evaluation UTC date: ${date}`,
    dataset.synthetic ? 'Synthetic demonstration — not real companies or filings' : 'User-supplied annual figures — not independently verified',
    `Source filename: ${dataset.fileName}`, `Imported UTC date: ${dataset.importedDate}`,
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
  ];
  if (!screen.filters.length) lines.push('Filters: None');
  for (const filter of screen.filters) {
    const units = monetary.has(filter.metric)
      ? filter.currency ? ` million ${filter.currency}` : ' (all currencies; sign comparison)'
      : filter.metric === 'debtEquity' ? '' : '%';
    lines.push(`Filter: ${filter.metric} ${operators[filter.operator]} ${String(filter.value)}${units}`);
  }
  lines.push(`Shortlist: ${shortlist.rows.length}; excluded stale: ${shortlist.excludedStale}; excluded missing required metrics: ${shortlist.excludedMissing}`, '', 'Shortlist facts, derived formulas and observations');
  function companyBlock(row: ResearchRow): void {
    const company = row.company;
    const age = Math.round((new Date(`${date}T00:00:00.000Z`).getTime() - new Date(`${company.fiscalDate}T00:00:00.000Z`).getTime()) / 86_400_000);
    lines.push('', `${company.ticker} — ${company.name}`, `Sector: ${company.sector}; currency: ${company.currency}`,
      `Fiscal period end: ${company.fiscalDate}; age ${age} days; ${row.stale ? 'stale' : 'fresh'}`,
      `Source row: ${dataset.fileName}:${company.sourceLine}`,
      company.filingUrl ? `Supplied source link: ${company.filingUrl}` : 'No filing link supplied',
      'Reported facts (currency millions):');
    for (const field of ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'] as const) lines.push(`${field}: ${raw(company[field])}${company[field] === null ? '' : ` million ${company.currency}`}`);
    lines.push('Derived formulas (unrounded IEEE754 results):', ...formulas(company, row), 'Derived observations (fixed rules, with raw-field provenance):');
    if (!row.observations.some(observation => observation.kind === 'strength' || observation.kind === 'risk')) lines.push('No rule-based strengths/risks found');
    for (const observation of row.observations) lines.push(`${observation.kind} [${observation.code}] ${observation.text} (fields: ${observation.fields.join(', ')}; source ${dataset.fileName}:${company.sourceLine})`);
  }
  if (!shortlist.rows.length) lines.push('No companies match the applied criteria.');
  for (const row of shortlist.rows) companyBlock(row);
  lines.push('', 'Selected comparison', `Comparison order: ${current.comparison.length ? current.comparison.join(', ') : '(none)'}`,
    `Monetary amounts directly comparable: ${comparison.monetaryComparable ? 'Yes; same supplied currency' : 'No'}`);
  for (const warning of comparison.warnings) lines.push(`Comparison warning: ${warning}`);
  for (const row of comparison.rows) companyBlock(row);
  lines.push('', `Watchlist: ${current.watchlist.length ? current.watchlist.join(', ') : '(none)'}`,
    'Watchlist and comparison are manual research choices; stale entries are retained.');
  for (const ticker of current.watchlist) companyBlock(analyzeCompany(dataset.companies.find(company => company.ticker === ticker)!, date));
  lines.push('', 'Research notes (literal supplied text)');
  if (!current.notes.length) lines.push('(none)');
  for (const note of current.notes) lines.push(`${note.ticker}:`, note.text, '');
  lines.push('Figures and period comparability are supplied by the importer and have not been independently verified.');
  const report = lines.join('\n') + '\n';
  if (new TextEncoder().encode(report).length > LIMITS.reportBytes) throw new Error('The research report exceeds the 8 MiB text limit. Reduce watchlist/comparison selections or shorten research notes and retry.');
  return report;
}
