import type { Company, Dataset, Notebook, Screen } from './types.ts';
import { LIMITS } from './types.ts';
import { validateToday, validateDataset } from './validation.ts';
import { validateNotebook } from './model.ts';
import { reviewRefresh, applyRefresh } from './refresh.ts';
import type { RefreshChoices } from './refresh.ts';

const moneyFields = ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'] as const;
const format = (value: string | number | null): string => typeof value === 'string' ? JSON.stringify(value) : String(value);

/** Complete proposed review; never publishes, saves, fetches, or reads a clock. */
export function buildRefreshReport(
  base: Notebook, incoming: Dataset, choices: RefreshChoices, today: string,
): string {
  const date = validateToday(today);
  const previous = validateNotebook(base, date);
  const nextDataset = validateDataset(incoming, date);
  const review = reviewRefresh(previous, nextDataset, date);
  const proposed = applyRefresh(previous, nextDataset, choices, date);
  const selected = review.criteria.find(option => option.action === choices.criteria)!;
  const decisions = new Map(choices.annotations.map(decision => [decision.ticker, decision.action]));
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let bytes = 0;
  function append(...values: string[]): void {
    for (const value of values) {
      const size = encoder.encode(value).length + 1;
      if (bytes + size > LIMITS.reportBytes) {
        throw new Error('The complete refresh report exceeds the 8 MiB text limit. No partial report was created; preserve the previous and proposed notebooks with JSON backups.');
      }
      bytes += size;
      lines.push(value);
    }
  }
  function datasetHeader(label: string, dataset: Dataset): void {
    append(`${label} dataset ID: ${dataset.id}`, `${label} source filename: ${dataset.fileName}`,
      `${label} imported UTC date: ${dataset.importedDate}`,
      `${label} provenance: ${dataset.synthetic ? 'Synthetic demonstration — not real companies or filings' : 'User-supplied annual figures — not independently verified'}`,
      `${label} declared basis: ${dataset.basis}; units: ${dataset.units}`,
      `${label} supplied annual rows: ${dataset.companies.length}; unique companies: ${review.companies.filter(company => label === 'Previous' ? company.previous !== null : company.incoming !== null).length}`);
  }
  function criteria(label: string, screen: Screen, query: string): void {
    append(`${label} saved interpretation: ${JSON.stringify(query)}`, `${label} applied screen: ${JSON.stringify(screen)}`,
      `${label} sector: ${screen.sector === null ? 'All sectors' : screen.sector}; currency: ${screen.currency ?? 'All supplied currencies'}`,
      `${label} freshness: ${screen.includeStale ? 'Include stale' : 'Exclude stale'}; stale only when fiscal age exceeds ${LIMITS.staleDays} UTC days`,
      `${label} sort: ${screen.sortBy} ${screen.direction}; nulls last, ties by ticker ascending`);
  }
  function endpoint(label: string, company: Company | null, dataset: Dataset): void {
    append(`${label} endpoint`);
    if (company === null) { append('Not present in this dataset'); return; }
    append(`ticker: ${company.ticker}`, `fiscalDate: ${company.fiscalDate}`,
      `name: ${company.name}`, `sector: ${company.sector}`, `currency: ${company.currency}`,
      `Source row: ${dataset.fileName}:${company.sourceLine}`,
      `Supplied filing URL: ${company.filingUrl ?? 'Not supplied'}`);
    for (const field of moneyFields) append(`${field}: ${company[field] === null ? 'Not supplied' : String(company[field])}${company[field] === null ? '' : ` million ${company.currency}`}`);
  }

  append('Proposed CSV refresh review — not an applied or saved transaction',
    `Review UTC date: ${date}`, `Notebook ID: ${previous.id}`, `Notebook title: ${previous.title}`,
    'Complete incoming CSV replacement; financial rows are not merged with the old dataset.',
    'All financial amounts are currency millions, for supplied comparable 12-month annual periods.',
    'Names, issuer continuity, reporting basis, figures and source links are not independently verified.',
    'Differences below are supplied-input differences, not confirmed restatements or investment analysis.',
    'This is research tooling, not investment advice or issuer verification.',
    'Currencies are not converted. No generated outlook, forecast or investment recommendation is provided.', '');
  datasetHeader('Previous', previous.dataset);
  datasetHeader('Incoming', nextDataset);
  append('', `Selected criteria resolution: ${choices.criteria}`);
  criteria('Previous', previous.screen, previous.query);
  criteria('Proposed', proposed.screen, proposed.query);
  append('Applied screen and saved interpretation are independent; no predicates were silently synchronized.',
    `Proposed matched ticker order: ${selected.matchedTickers!.length ? selected.matchedTickers!.join(', ') : '(none)'}`,
    '', `Previous watchlist order: ${previous.watchlist.join(', ') || '(none)'}`,
    `Proposed watchlist order: ${proposed.watchlist.join(', ') || '(none)'}`,
    `Previous comparison order: ${previous.comparison.join(', ') || '(none)'}`,
    `Proposed comparison order: ${proposed.comparison.join(', ') || '(none)'}`);
  const removedPeriods = review.periods.filter(period => period.kind === 'removed').length;
  const removedCompanies = review.companies.filter(company => company.incoming === null).length;
  append(`Annual periods removed: ${removedPeriods}; tickers removed: ${removedCompanies}`);
  for (const company of review.companies) {
    if (company.latestDateMovedBackward) append(`Backward latest-date warning: ${company.ticker}; ${company.previous!.fiscalDate} -> ${company.incoming!.fiscalDate}`);
  }

  append('', 'Annual period changes begin', 'Every union period appears once; source-only differences are not fact changes.');
  for (const period of review.periods) {
    append('', `Refresh period: ${period.ticker} — ${period.fiscalDate}`, `Period status: ${period.kind}`,
      `Fact changes: ${period.factFields.length ? period.factFields.join(', ') : 'None'}`,
      `Source changes: ${period.sourceFields.length ? period.sourceFields.join(', ') : 'None'}`);
    if (period.previous && period.incoming) {
      for (const field of period.factFields) append(`${field}: ${format(period.previous[field])} -> ${format(period.incoming[field])}`);
      for (const field of period.sourceFields) {
        const before = field === 'fileName' ? previous.dataset.fileName : period.previous[field];
        const after = field === 'fileName' ? nextDataset.fileName : period.incoming[field];
        append(`${field}: ${format(before)} -> ${format(after)}`);
      }
    }
    endpoint('Previous', period.previous, previous.dataset);
    endpoint('Incoming', period.incoming, nextDataset);
  }
  append('Annual period changes end', '', 'Committed research retention (literal saved notes)');
  if (!review.annotations.length) append('No committed watchlist, comparison or note groups.');
  for (const annotation of review.annotations) {
    const outcome = annotation.policy === 'decide' ? decisions.get(annotation.ticker)! : annotation.policy;
    append('', `Research group: ${annotation.ticker}`, `Outcome: ${outcome}`,
      `Previous watchlisted: ${annotation.watchlisted ? 'Yes' : 'No'}; comparison index: ${annotation.comparisonIndex ?? 'Not selected'}`,
      `Decision reasons: ${annotation.reasons.join(', ') || 'None'}`,
      outcome === 'keep' ? 'Research is retained unchanged; review it against updated supplied evidence.' : 'This committed research group will not be in the proposed notebook.');
    endpoint('Previous latest research reference', annotation.previous, previous.dataset);
    endpoint('Incoming latest research reference', annotation.incoming, nextDataset);
    append('Full literal saved note:', annotation.note ?? '(No saved note)');
  }
  append('', 'Applying this proposal starts fresh history for the replaced dataset; Undo cannot reverse this refresh.',
    'Download the previous notebook JSON backup before applying. Notebook backups exclude unsent editor drafts.',
    'This proposed review is session-only and is not a persisted audit or proof that a transaction was applied or saved.',
    'After applying, saving is complete only when the matching native storage transaction succeeds.');
  return lines.join('\n') + '\n';
}
