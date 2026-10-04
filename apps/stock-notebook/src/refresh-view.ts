import type { Company, Dataset, Notebook, Screen } from './types.ts';
import type { CriteriaAction, RefreshChoices, RefreshReview } from './refresh.ts';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
}
function action(text: string, callback: () => void): HTMLButtonElement {
  const button = node('button', text); button.type = 'button'; button.addEventListener('click', callback); return button;
}
function checkbox(id: string, text: string): [HTMLLabelElement, HTMLInputElement] {
  const label = node('label', '', 'checkbox'), input = node('input'); input.type = 'checkbox'; input.id = id;
  label.append(input, node('span', text)); return [label, input];
}
const fieldNames: Record<string, string> = { name: 'Name', sector: 'Sector', currency: 'Currency', revenue: 'Revenue', priorRevenue: 'Prior revenue', netIncome: 'Net income', debt: 'Gross debt', equity: 'Equity', fileName: 'Filename', sourceLine: 'Source line', filingUrl: 'Filing URL' };
const metricNames: Record<string, string> = { ...fieldNames, growthPct: 'Revenue growth', marginPct: 'Net margin', debtEquity: 'Debt / equity', ticker: 'Ticker' };
const operatorNames: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };
function screenText(screen: Screen): string {
  const filters = screen.filters.map(filter => `${metricNames[filter.metric]} ${operatorNames[filter.operator]} ${filter.value}${filter.currency ? ` ${filter.currency} million` : ['growthPct', 'marginPct'].includes(filter.metric) ? '%' : ['revenue', 'netIncome', 'debt', 'equity'].includes(filter.metric) ? ' million (zero sign test)' : ''}`);
  return `Sector: ${screen.sector ?? 'all'} · currency: ${screen.currency ?? 'all'} · ${screen.includeStale ? 'include stale periods' : 'exclude stale periods'} · ${filters.length ? filters.join('; ') : 'no numeric predicates'} · sort ${metricNames[screen.sortBy]} ${screen.direction}`;
}
function source(row: Company, dataset: Dataset): HTMLElement {
  const section = node('div', '', 'refresh-source');
  section.append(node('p', `${dataset.fileName}:${row.sourceLine}`, 'hint'));
  if (row.filingUrl) { const disclosure = node('details'); disclosure.append(node('summary', 'Supplied filing URL')); const link = node('a', row.filingUrl); link.href = row.filingUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; disclosure.append(link); section.append(disclosure); }
  else section.append(node('p', 'No filing URL supplied', 'hint'));
  return section;
}
function endpoint(row: Company | null, dataset: Dataset): HTMLElement {
  const block = node('div', '', 'refresh-endpoint');
  if (!row) { block.append(node('p', 'Not present')); return block; }
  block.append(node('p', `${row.ticker} · ${row.name}`), node('p', `${row.fiscalDate} · ${row.sector} · ${row.currency}`));
  const facts = node('dl');
  for (const key of ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'] as const) facts.append(node('dt', fieldNames[key]), node('dd', row[key] === null ? 'Not supplied' : `${String(row[key])} ${row.currency} million`));
  block.append(facts, source(row, dataset)); return block;
}
export interface RefreshViewState { active: boolean; loading: boolean; stale: boolean; drafts: boolean; error: string }
export interface RefreshViewCallbacks {
  apply(): void; rebuild(): void; cancel(): void; previous(): void; report(): void; discard(): void; change(): void;
}
export function mountRefreshView(root: HTMLElement, callbacks: RefreshViewCallbacks) {
  root.id = 'refresh-review'; root.className = 'panel refresh-review'; root.hidden = true;
  root.append(node('p', 'REVIEW BEFORE REPLACING', 'eyebrow'), node('h2', 'Refresh financial data'), node('p', 'Compare the complete incoming CSV with your current data, then choose which research to carry forward. Figures and company identities remain supplied and unverified.', 'hint'));
  const status = node('p', '', 'notice'); status.id = 'refresh-status'; status.setAttribute('role', 'status');
  const errors = node('p', '', 'message error'); errors.id = 'refresh-errors'; errors.setAttribute('role', 'alert'); errors.hidden = true;
  const summary = node('div'); summary.id = 'refresh-summary';
  const body = node('div');
  const criteria = node('fieldset', '', 'refresh-criteria'); criteria.append(node('legend', 'Criteria for the refreshed data'));
  const criteriaContent = node('div'); criteria.append(criteriaContent);
  const annotations = node('section', '', 'refresh-annotations'); annotations.append(node('h3', 'Research to retain'));
  const annotationContent = node('div', '', 'refresh-annotation-list'); annotationContent.tabIndex = 0; annotationContent.setAttribute('role', 'region'); annotationContent.setAttribute('aria-label', 'Research retention decisions'); annotations.append(annotationContent);
  const changes = node('section', '', 'refresh-changes'); changes.append(node('h3', 'Supplied annual inputs — before and after'), node('p', 'All added, removed, changed and unchanged periods are included. Different inputs are not proof of a restatement. Amounts are currency millions; missing is distinct from zero.', 'hint'));
  const scroll = node('div', '', 'refresh-table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Annual input changes; scroll horizontally');
  const table = node('table', '', 'refresh-table'); table.append(node('caption', 'Previous and incoming annual rows, with their original source references'));
  const head = node('thead'), headings = node('tr'); for (const text of ['Period / change', 'Previous supplied inputs', 'Incoming supplied inputs']) headings.append(node('th', text)); head.append(headings);
  const rows = node('tbody'); table.append(head, rows); scroll.append(table); changes.append(scroll);
  const pager = node('nav', '', 'refresh-pager'); pager.setAttribute('aria-label', 'Annual change pages');
  const previous = action('Previous changes', () => { page--; renderPeriods(); }), next = action('Next changes', () => { page++; renderPeriods(); });
  const pageLabel = node('span'); pageLabel.id = 'refresh-period-page'; pager.append(previous, pageLabel, next); changes.append(pager);
  const [unitsLabel, units] = checkbox('refresh-units-confirm', 'I confirm the refreshed CSV uses currency millions and comparable 12-month annual periods');
  const [lossLabel, losses] = checkbox('refresh-losses-confirm', 'I reviewed the annual periods and research that will be removed');
  const lossSummary = node('p', '', 'refresh-loss-summary');
  body.append(summary, criteria, annotations, changes, node('p', 'This replaces the whole dataset and starts a new undo history. Retained notes are not rewritten for the new figures. Review them against the incoming evidence. Download the proposed review before applying if you want to keep a change log.', 'notice'), unitsLabel, lossSummary, lossLabel);
  const buttons = node('div', '', 'refresh-actions');
  const apply = action('Apply reviewed refresh', callbacks.apply); apply.className = 'primary';
  const rebuild = action('Rebuild refresh review', callbacks.rebuild), cancel = action('Cancel refresh', callbacks.cancel);
  const backup = action('Download previous notebook', callbacks.previous), report = action('Download refresh review', callbacks.report), discard = action('Discard editor drafts for refresh', callbacks.discard);
  buttons.append(apply, rebuild, cancel, backup, report, discard);
  root.append(status, errors, body, buttons, node('p', 'Notebook backups contain committed research, not unsent editor drafts. Nothing from this proposed review is applied or saved until you choose Apply reviewed refresh.', 'hint'));
  let review: RefreshReview | null = null, base: Notebook | null = null, incoming: Dataset | null = null, page = 0;
  let selectedCriteria: CriteriaAction = 'keep';
  const retention = new Map<string, 'keep' | 'drop'>();
  let state: RefreshViewState = { active: false, loading: false, stale: false, drafts: false, error: '' };
  function getChoices(): RefreshChoices | null {
    if (!review) return null;
    const proposed = review.criteria.find(item => item.action === selectedCriteria);
    if (!proposed || proposed.screenError || proposed.queryError) return null;
    const needed = review.annotations.filter(item => item.policy === 'decide');
    if (needed.some(item => !retention.has(item.ticker))) return null;
    return { criteria: selectedCriteria, annotations: needed.map(item => ({ ticker: item.ticker, action: retention.get(item.ticker)! })) };
  }
  function lossCounts() {
    return { periods: review?.periods.filter(item => item.kind === 'removed').length ?? 0, annotations: review?.annotations.filter(item => item.policy === 'remove' || item.policy === 'decide' && retention.get(item.ticker) === 'drop').length ?? 0 };
  }
  function text(element: HTMLElement, value: string) { if (element.textContent !== value) element.textContent = value; }
  function update() {
    root.hidden = !state.active; body.hidden = !review;
    text(errors, state.error); errors.hidden = !state.error;
    const counts = lossCounts(), hasLoss = counts.periods > 0 || counts.annotations > 0;
    const fresh = !!review && !state.loading && !state.stale, choices = getChoices();
    text(status, state.loading ? 'Reading the complete CSV. Current research is unchanged.' : state.stale ? 'This review is out of date. Rebuild it against your current notebook before applying or downloading the proposed review.' : !review ? 'No refresh has been applied. Choose a complete CSV again or cancel; your current work is kept.' : state.drafts ? 'Unsent editor drafts block Apply. Save or apply them, then rebuild this review; or explicitly discard those drafts. Your typed work is kept.' : `Review prepared ${review.today} UTC. Check the data, criteria and research decisions below.`);
    text(lossSummary, `${counts.periods} annual periods and ${counts.annotations} research groups will be removed${review?.annotations.some(item => item.policy === 'decide' && !retention.has(item.ticker)) ? '; additional research decisions are still required' : ''}.`);
    lossLabel.hidden = !hasLoss;
    apply.disabled = !fresh || state.drafts || !choices || !units.checked || hasLoss && !losses.checked;
    report.disabled = !fresh || !choices;
    rebuild.hidden = !review; rebuild.disabled = state.loading;
    backup.disabled = !review; discard.hidden = !state.drafts || !review; discard.disabled = state.loading;
  }
  units.addEventListener('change', callbacks.change); losses.addEventListener('change', callbacks.change);
  function renderPeriods() {
    rows.replaceChildren(); if (!review || !base || !incoming) return;
    for (const period of review.periods.slice(page * 50, (page + 1) * 50)) {
      const row = node('tr'); row.dataset.refreshPeriodKey = `${period.ticker}:${period.fiscalDate}`;
      const label = node('th'); label.scope = 'row';
      const kind = period.kind === 'unchanged' && period.sourceFields.length ? 'Source-only change' : period.kind === 'changed' ? 'Reported facts changed' : period.kind[0].toUpperCase() + period.kind.slice(1);
      label.append(node('strong', `${period.ticker} · ${period.fiscalDate}`), node('p', kind));
      if (period.factFields.length) label.append(node('p', `Facts: ${period.factFields.map(field => fieldNames[field]).join(', ')}`, 'hint'));
      if (period.sourceFields.length) label.append(node('p', `Source references: ${period.sourceFields.map(field => fieldNames[field]).join(', ')}`, 'hint'));
      const before = node('td'), after = node('td'); before.append(endpoint(period.previous, base.dataset)); after.append(endpoint(period.incoming, incoming)); row.append(label, before, after); rows.append(row);
    }
    previous.disabled = page === 0; next.disabled = (page + 1) * 50 >= review.periods.length;
    pageLabel.textContent = `${review.periods.length ? page * 50 + 1 : 0}–${Math.min((page + 1) * 50, review.periods.length)} of ${review.periods.length} annual periods`;
  }
  return {
    setReview(previousNotebook: Notebook, dataset: Dataset, nextReview: RefreshReview) {
      base = previousNotebook; incoming = dataset; review = nextReview; page = 0; selectedCriteria = 'keep'; retention.clear(); units.checked = false; losses.checked = false;
      const companyAdded = review.companies.filter(item => !item.previous).length, companyRemoved = review.companies.filter(item => !item.incoming).length;
      const added = review.periods.filter(item => item.kind === 'added').length, removed = review.periods.filter(item => item.kind === 'removed').length, changed = review.periods.filter(item => item.kind === 'changed').length, sourceOnly = review.periods.filter(item => item.kind === 'unchanged' && item.sourceFields.length).length;
      summary.replaceChildren(node('h3', 'Complete dataset replacement'), node('p', `Previous: ${base.dataset.fileName} · ${base.dataset.companies.length} annual rows · ${new Set(base.dataset.companies.map(item => item.ticker)).size} unique companies · imported ${base.dataset.importedDate} · ${base.dataset.synthetic ? 'synthetic demonstration' : 'supplied, unverified data'}`), node('p', `Incoming: ${incoming.fileName} · ${incoming.companies.length} annual rows · ${new Set(incoming.companies.map(item => item.ticker)).size} unique companies · imported ${incoming.importedDate} · ${incoming.synthetic ? 'synthetic demonstration' : 'supplied, unverified data'}`), node('p', `${companyAdded} added companies · ${companyRemoved} removed companies · ${added} added annual periods · ${removed} removed annual periods · ${changed} reported-fact changes · ${sourceOnly} source-only changes`));
      summary.append(node('p', `Added companies: ${review.companies.filter(item => !item.previous).map(item => item.ticker).join(', ') || 'none'}`, 'hint'), node('p', `Removed companies: ${review.companies.filter(item => !item.incoming).map(item => item.ticker).join(', ') || 'none'}`, 'hint'));
      const identifiers = node('details'); identifiers.append(node('summary', 'Dataset references'), node('p', `Previous dataset ${base.dataset.id}; incoming dataset ${incoming.id}.`)); summary.append(identifiers);
      if (review.previousSynthetic !== review.incomingSynthetic) summary.append(node('p', 'The data provenance changes between synthetic and supplied figures. Decide explicitly whether to retain research for matching tickers; supplied does not mean verified.', 'notice'));
      const backward = review.companies.filter(item => item.latestDateMovedBackward);
      if (backward.length) summary.append(node('p', `Incoming latest dates move backward for: ${backward.map(item => `${item.ticker} (${item.previous!.fiscalDate} → ${item.incoming!.fiscalDate})`).join(', ')}.`, 'warning'));
      criteriaContent.replaceChildren(node('p', `Previous applied screen: ${screenText(base.screen)}`, 'hint'), node('p', `Previous saved interpretation: ${base.query || '(none)'}`, 'hint'));
      const labels = { keep: 'Keep applied criteria and interpretation', clearQuery: 'Keep applied criteria, clear saved interpretation', reset: 'Reset criteria and interpretation' };
      for (const item of review.criteria) {
        const option = node('div', '', 'refresh-criteria-option'), label = node('label', '', 'checkbox'), radio = node('input'); radio.type = 'radio'; radio.name = 'refresh-criteria'; radio.value = item.action; radio.checked = item.action === 'keep'; label.append(radio, node('span', labels[item.action]));
        option.append(label, node('p', screenText(item.screen), 'hint'), node('p', `Saved interpretation: ${item.query || '(none)'}`, 'hint'));
        if (item.screenError) option.append(node('p', item.screenError, 'warning'));
        if (item.queryError) option.append(node('p', item.queryError, 'warning'));
        if (item.matchedTickers) option.append(node('p', `${item.matchedTickers.length} companies match this proposed screen.`, 'hint'));
        radio.addEventListener('change', () => { selectedCriteria = item.action; callbacks.change(); }); criteriaContent.append(option);
      }
      annotationContent.replaceChildren();
      if (!review.annotations.length) annotationContent.append(node('p', 'No committed watchlist, comparison or notes to carry forward.', 'hint'));
      for (const item of review.annotations) {
        const group = node('article', '', 'refresh-annotation'); group.dataset.refreshAnnotationTicker = item.ticker;
        group.append(node('h4', item.ticker), node('p', `Previous: ${item.previous.name} · ${item.previous.sector} · ${item.previous.currency} · latest ${item.previous.fiscalDate}`), source(item.previous, base.dataset));
        if (item.incoming) group.append(node('p', `Incoming: ${item.incoming.name} · ${item.incoming.sector} · ${item.incoming.currency} · latest ${item.incoming.fiscalDate}`), source(item.incoming, incoming));
        else group.append(node('p', 'Absent from the incoming dataset.'));
        group.append(node('p', `${item.watchlisted ? 'Watchlisted' : 'Not watchlisted'} · ${item.comparisonIndex !== null ? `comparison position ${item.comparisonIndex + 1}` : 'not in comparison'} · ${item.note !== null ? 'saved note included' : 'no saved note'}`, 'hint'));
        if (item.note !== null) { const note = node('details'); note.append(node('summary', 'Read complete saved note'), node('p', item.note, 'refresh-note')); group.append(note); }
        if (item.policy === 'decide') {
          group.append(node('p', `Review changed details: ${item.reasons.join(', ')}. A matching ticker alone does not establish the same issuer.`, 'notice'));
          const label = node('label', `Research retention for ${item.ticker}`, 'field'), select = node('select'); select.name = `retention-${item.ticker}`;
          for (const [value, text] of [['', 'Choose research retention'], ['keep', 'Keep research'], ['drop', 'Drop research']]) { const option = node('option', text); option.value = value; select.append(option); }
          select.addEventListener('change', () => { if (select.value) retention.set(item.ticker, select.value as 'keep' | 'drop'); else retention.delete(item.ticker); losses.checked = false; callbacks.change(); }); label.append(select); group.append(label);
        } else group.append(node('p', item.policy === 'keep' ? 'Keep committed research automatically; latest company details are unchanged.' : 'Remove this research group because the ticker is absent from the incoming dataset.', item.policy === 'remove' ? 'warning' : 'hint'));
        annotationContent.append(group);
      }
      renderPeriods(); update();
    },
    setState(nextState: RefreshViewState) { state = nextState; update(); },
    clear() { review = null; base = null; incoming = null; retention.clear(); units.checked = false; losses.checked = false; rows.replaceChildren(); update(); },
    choices: getChoices, losses: lossCounts,
    confirmed() { const counts = lossCounts(); return units.checked && (!(counts.periods || counts.annotations) || losses.checked); },
  };
}
