import { BRIEF_LIMITS, LIMITS, type Company, type CompanyBrief, type Dataset, type Notebook, type Screen } from './types.ts';
import { boundedArray, dataObject, requireValue, validateDataset, validateScreen, validateToday } from './validation.ts';
import { validateNotebook } from './model.ts';
import { latestCompanies } from './periods.ts';
import { parseQuery } from './query.ts';
import { screenDataset } from './research.ts';

export type CriteriaAction = 'keep' | 'clearQuery' | 'reset';
export type AnnotationAction = 'keep' | 'drop';
export type RefreshFactField =
  | 'name' | 'sector' | 'currency' | 'revenue' | 'priorRevenue'
  | 'netIncome' | 'debt' | 'equity';
export type RefreshSourceField = 'fileName' | 'sourceLine' | 'filingUrl';
export type RefreshIdentityReason = 'name' | 'sector' | 'currency' | 'synthetic';

export interface RefreshChoices {
  criteria: CriteriaAction;
  annotations: { ticker: string; action: AnnotationAction }[];
}
export interface RefreshPeriodChange {
  ticker: string; fiscalDate: string;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  previous: Company | null; incoming: Company | null;
  factFields: RefreshFactField[]; sourceFields: RefreshSourceField[];
}
export interface RefreshCompanyChange {
  ticker: string; previous: Company | null; incoming: Company | null;
  latestDateMovedBackward: boolean;
}
export interface RefreshAnnotation {
  ticker: string;
  watchlisted: boolean; comparisonIndex: number | null; note: string | null;
  brief: CompanyBrief | null;
  previous: Company; incoming: Company | null;
  policy: 'keep' | 'remove' | 'decide';
  reasons: RefreshIdentityReason[];
}
export interface RefreshCriteriaPreview {
  action: CriteriaAction; screen: Screen; query: string;
  screenError: string | null; queryError: string | null;
  matchedTickers: string[] | null;
}
export interface RefreshReview {
  notebookId: string; previousDatasetId: string; incomingDatasetId: string;
  today: string; previousFileName: string; incomingFileName: string;
  previousSynthetic: boolean; incomingSynthetic: boolean;
  companies: RefreshCompanyChange[];
  periods: RefreshPeriodChange[];
  annotations: RefreshAnnotation[];
  criteria: RefreshCriteriaPreview[];
}

const factFields: RefreshFactField[] = ['name', 'sector', 'currency', 'revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'];
const identityFields = ['name', 'sector', 'currency'] as const;
const actions: CriteriaAction[] = ['keep', 'clearQuery', 'reset'];
const order = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const copyRow = (row: Company | undefined): Company | null => row ? { ...row } : null;
const copyScreen = (screen: Screen): Screen => ({ ...screen, filters: screen.filters.map(filter => ({ ...filter })) });
const defaultScreen = (): Screen => ({ sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' });
function union(a: Iterable<string>, b: Iterable<string>): string[] {
  return [...new Set([...a, ...b])].sort(order);
}
function preview(base: Notebook, incoming: Dataset, action: CriteriaAction, today: string): RefreshCriteriaPreview {
  let screen = action === 'reset' ? defaultScreen() : copyScreen(base.screen);
  const query = action === 'keep' ? base.query : '';
  let screenError: string | null = null, queryError: string | null = null, matchedTickers: string[] | null = null;
  try {
    const validated = validateScreen(screen, incoming);
    const result = screenDataset(incoming, validated, today);
    screen = validated;
    matchedTickers = result.rows.map(row => row.company.ticker);
  } catch {
    screenError = 'Applied criteria cannot run on the incoming universe. Review sector/currency filters and monetary sorting, or choose Reset criteria and interpretation.';
  }
  try { parseQuery(query, incoming); }
  catch { queryError = 'The saved interpretation is incompatible with the incoming universe. Clear the saved interpretation or reset criteria and interpretation.'; }
  if (screenError !== null || queryError !== null) matchedTickers = null;
  return { action, screen, query, screenError, queryError, matchedTickers };
}
/** Both arguments are already validated detached snapshots with one explicit date. */
function review(base: Notebook, incoming: Dataset, today: string): RefreshReview {
  const oldLatest = new Map(latestCompanies(base.dataset.companies).map(row => [row.ticker, row]));
  const newLatest = new Map(latestCompanies(incoming.companies).map(row => [row.ticker, row]));
  const companies: RefreshCompanyChange[] = union(oldLatest.keys(), newLatest.keys()).map(ticker => {
    const previous = oldLatest.get(ticker), next = newLatest.get(ticker);
    return { ticker, previous: copyRow(previous), incoming: copyRow(next), latestDateMovedBackward: !!previous && !!next && next.fiscalDate < previous.fiscalDate };
  });
  const periodKey = (row: Company): string => `${row.ticker}:${row.fiscalDate}`;
  const oldPeriods = new Map(base.dataset.companies.map(row => [periodKey(row), row]));
  const newPeriods = new Map(incoming.companies.map(row => [periodKey(row), row]));
  const periods: RefreshPeriodChange[] = union(oldPeriods.keys(), newPeriods.keys()).map(key => {
    const previous = oldPeriods.get(key), next = newPeriods.get(key), row = previous ?? next!;
    const facts = previous && next ? factFields.filter(field => previous[field] !== next[field]) : [];
    const sources: RefreshSourceField[] = [];
    if (previous && next) {
      if (base.dataset.fileName !== incoming.fileName) sources.push('fileName');
      if (previous.sourceLine !== next.sourceLine) sources.push('sourceLine');
      if (previous.filingUrl !== next.filingUrl) sources.push('filingUrl');
    }
    return { ticker: row.ticker, fiscalDate: row.fiscalDate, kind: !previous ? 'added' : !next ? 'removed' : facts.length ? 'changed' : 'unchanged',
      previous: copyRow(previous), incoming: copyRow(next), factFields: facts, sourceFields: sources };
  });
  // Sort the tuple explicitly: delimiters must not change prefix-ticker order.
  periods.sort((a, b) => order(a.ticker, b.ticker) || order(a.fiscalDate, b.fiscalDate));
  const notes = new Map(base.notes.map(note => [note.ticker, note.text]));
  const briefs = new Map(base.briefs.map(brief => [brief.ticker, brief]));
  const annotated = new Set([...base.watchlist, ...base.comparison, ...notes.keys(), ...briefs.keys()]);
  const annotations: RefreshAnnotation[] = [...annotated].sort(order).map(ticker => {
    const previous = oldLatest.get(ticker)!, next = newLatest.get(ticker);
    const reasons: RefreshIdentityReason[] = next ? identityFields.filter(field => previous[field] !== next[field]) : [];
    if (next && base.dataset.synthetic !== incoming.synthetic) reasons.push('synthetic');
    const index = base.comparison.indexOf(ticker);
    return { ticker, watchlisted: base.watchlist.includes(ticker), comparisonIndex: index < 0 ? null : index,
      note: notes.get(ticker) ?? null, brief: briefs.has(ticker) ? structuredClone(briefs.get(ticker)!) : null, previous: { ...previous }, incoming: copyRow(next),
      policy: !next ? 'remove' : reasons.length ? 'decide' : 'keep', reasons };
  });
  return { notebookId: base.id, previousDatasetId: base.dataset.id, incomingDatasetId: incoming.id, today,
    previousFileName: base.dataset.fileName, incomingFileName: incoming.fileName,
    previousSynthetic: base.dataset.synthetic, incomingSynthetic: incoming.synthetic,
    companies, periods, annotations, criteria: actions.map(action => preview(base, incoming, action, today)) };
}
export function reviewRefresh(base: Notebook, incoming: Dataset, today: string): RefreshReview {
  const date = validateToday(today);
  return review(validateNotebook(base, date), validateDataset(incoming, date), date);
}
export function applyRefresh(base: Notebook, incoming: Dataset, choices: RefreshChoices, today: string): Notebook {
  const date = validateToday(today), current = validateNotebook(base, date), next = validateDataset(incoming, date);
  const reviewed = review(current, next, date), fields = dataObject(choices, ['criteria', 'annotations']);
  requireValue(typeof fields.criteria === 'string' && actions.includes(fields.criteria as CriteriaAction), 'Choose a supported refresh criteria action.');
  const selected = reviewed.criteria.find(item => item.action === fields.criteria)!;
  requireValue(selected.screenError === null && selected.queryError === null, 'The selected refresh criteria are incompatible. Review the criteria errors and choose a valid action.');
  const required = new Set(reviewed.annotations.filter(group => group.policy === 'decide').map(group => group.ticker));
  const decisions = new Map<string, AnnotationAction>();
  for (const value of boundedArray(fields.annotations, LIMITS.watchlist + LIMITS.comparison + LIMITS.notes + BRIEF_LIMITS.briefs)) {
    const decision = dataObject(value, ['ticker', 'action']);
    requireValue(typeof decision.ticker === 'string' && required.has(decision.ticker) && !decisions.has(decision.ticker), 'Supply one decision per research group requiring review, using its exact normalized ticker.');
    requireValue(decision.action === 'keep' || decision.action === 'drop', 'Choose Keep research or Drop research.');
    decisions.set(decision.ticker, decision.action);
  }
  requireValue(decisions.size === required.size, 'Choose research retention for every group requiring review.');
  const retained = new Set(reviewed.annotations.filter(group => group.policy === 'keep' || group.policy === 'decide' && decisions.get(group.ticker) === 'keep').map(group => group.ticker));
  return validateNotebook({ ...current, dataset: next, query: selected.query, screen: selected.screen,
    watchlist: current.watchlist.filter(ticker => retained.has(ticker)), comparison: current.comparison.filter(ticker => retained.has(ticker)),
    notes: current.notes.filter(note => retained.has(note.ticker)),
    briefs: current.briefs.filter(brief => retained.has(brief.ticker)) }, date);
}
