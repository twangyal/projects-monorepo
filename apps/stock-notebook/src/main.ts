import './style.css';
import { parseCsv, createDataset, blankCsvTemplate } from './csv.ts';
import { createNotebook, validateNotebook, parseNotebookJson, serializeNotebook, editState } from './model.ts';
import { NotebookHistory } from './history.ts';
import { parseQuery } from './query.ts';
import { analyzeCompany, screenDataset, compareCompanies, auditScreen } from './research.ts';
import { latestCompanies } from './periods.ts';
import { analyzeCompanyHistory, type CompanyHistory, type PeriodComparison } from './annual-history.ts';
import { NotebookStore } from './storage.ts';
import { buildReport } from './exports.ts';
import { reviewRefresh, applyRefresh, type RefreshReview } from './refresh.ts';
import { buildRefreshReport } from './refresh-report.ts';
import { mountRefreshView } from './refresh-view.ts';
import { mountBriefView } from './brief-view.ts';
import { createDemoDataset } from './demo.ts';
import { LIMITS } from './types.ts';
import type { Company, CsvPreview, Dataset, Filter, Metric, Notebook, Operator, ResearchRow, Screen, ScreenResult } from './types.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; }
function button(text: string, action: () => void, cls = ''): HTMLButtonElement { const n = el('button', text, cls); n.type = 'button'; n.addEventListener('click', action); return n; }
function panel(title: string, hint = ''): HTMLElement { const n = el('section', '', 'panel'); n.append(el('h2', title)); if (hint) n.append(el('p', hint, 'hint')); return n; }
function field(parent: HTMLElement, name: string, caption: string, multiline = false, type = 'text'): HTMLInputElement | HTMLTextAreaElement {
  const label = el('label', caption, 'field'); const n = multiline ? el('textarea') : el('input'); n.name = name; if (n instanceof HTMLInputElement) n.type = type; else n.rows = 3; label.append(n); parent.append(label); return n;
}
function select(parent: HTMLElement, name: string, caption: string, choices: readonly (readonly [string, string])[]): HTMLSelectElement {
  const label = el('label', caption, 'field'); const n = el('select'); n.name = name; fillOptions(n, choices); label.append(n); parent.append(label); return n;
}
function fillOptions(n: HTMLSelectElement, choices: readonly (readonly [string, string])[]): void { n.replaceChildren(); for (const [value, text] of choices) { const option = el('option', text); option.value = value; n.append(option); } }
function utcToday(): string { return new Date().toISOString().slice(0, 10); }
const metricNames: Record<Metric, string> = { revenue: 'Revenue', netIncome: 'Net income', debt: 'Gross debt', equity: 'Equity', growthPct: 'Revenue growth', marginPct: 'Net margin', debtEquity: 'Debt / equity' };
const moneyMetrics = new Set<Metric>(['revenue', 'netIncome', 'debt', 'equity']);
const operators: Record<Operator, string> = { gt: 'above', gte: 'at least', lt: 'below', lte: 'at most', eq: 'equal to' };
const metricOptions = Object.entries(metricNames) as [Metric, string][];
function pretty(n: number): string { if (n === 0) return '0'; const rounded = n.toFixed(2); return Number(rounded) === 0 ? n.toExponential(2) : String(Number(rounded)); }
function amount(value: number | null, currency: string, exact = false): string { return value === null ? 'Not supplied' : `${currency} ${exact ? String(value) : pretty(value)} million`; }
function ratio(value: number | null, percent = false): string { return value === null ? 'Undefined' : `${pretty(value)}${percent ? '%' : ''}`; }
function download(text: string, name: string, mime: string): void { const url = URL.createObjectURL(new Blob([text], { type: mime })); const a = el('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

const app = document.querySelector<HTMLDivElement>('#app'); if (!app) throw new Error('Missing notebook root.');
const header = el('header', '', 'site-header'); header.append(el('span', 'Stock Notebook', 'brand'), el('span', 'Annual figures. Visible reasoning.', 'brand-note'));
const main = el('main'); app.append(header, main);
const message = el('p', '', 'message'); message.id = 'message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.hidden = true; main.append(message);
function announce(text: string, error = false): void { message.textContent = text; message.hidden = !text; message.classList.toggle('error', error); }
const intro = el('div', '', 'introduction'); intro.append(el('p', 'LOCAL RESEARCH DESK', 'eyebrow'), el('h1', 'From annual figures to a clear shortlist.'), el('p', 'Import your company universe, inspect the screening criteria, and trace each observation to its inputs. This notebook uses deterministic filters and formulas, with no live feeds or predictions.')); main.append(intro);
const importBar = el('div', '', 'import-bar'); const csvInput = field(importBar, 'csv', 'Import CSV', false, 'file') as HTMLInputElement; csvInput.id = 'csv-import'; csvInput.accept = '.csv,text/csv'; const jsonInput = field(importBar, 'backup', 'Import notebook backup', false, 'file') as HTMLInputElement; jsonInput.id = 'notebook-import'; jsonInput.accept = '.json,application/json';
importBar.append(button('Download blank template', () => { download(blankCsvTemplate(), 'stock-notebook-template.csv', 'text/csv;charset=utf-8'); }), button('Load synthetic demo', () => { void stageInput(async () => ({ kind: 'dataset', dataset: createDemoDataset(utcToday()) })); })); main.append(importBar);
const refreshInput = field(importBar, 'refresh', 'Refresh financial data', false, 'file') as HTMLInputElement; refreshInput.id = 'refresh-csv'; refreshInput.accept = '.csv,text/csv'; refreshInput.disabled = true;
const refreshPanel = el('section'); main.append(refreshPanel);
const refreshView = mountRefreshView(refreshPanel, { apply: applyReviewedRefresh, rebuild: rebuildRefresh, cancel: cancelRefresh, previous: downloadPreviousNotebook, report: downloadProposedRefresh, discard: discardRefreshDrafts, change: () => { refreshError = ''; updateRefresh(); } });
const recovery = panel('Saved-record recovery', 'An unreadable saved record is kept untouched until you explicitly reset it.'); recovery.id = 'recovery-panel'; recovery.hidden = true;
recovery.append(button('Download raw saved record', () => { void downloadRaw(); }), button('Reset saved record', () => { void resetSaved(); })); main.append(recovery);
const importReview = panel('Review the incoming universe', 'All money columns must be in currency millions. Rows must represent comparable 12-month annual periods; prior revenue must be the comparable preceding annual period.'); importReview.id = 'import-review'; importReview.hidden = true;
const importSummary = el('div'); importSummary.id = 'import-summary'; const unitLabel = el('label', '', 'checkbox'); const unitsConfirm = el('input'); unitsConfirm.type = 'checkbox'; unitsConfirm.id = 'units-confirm'; unitLabel.append(unitsConfirm, el('span', 'I confirm currency millions and comparable 12-month annual periods'));
const replaceButton = button('Replace universe', replaceUniverse, 'primary'); const backupCurrent = button('Download current backup', downloadBackup); const cancelImport = button('Cancel import', cancelStaging);
importReview.append(importSummary, el('p', 'Restatements, acquisitions, different fiscal lengths and changed accounting bases can defeat comparability. Supplied filing links do not verify figures.', 'notice'), unitLabel, el('p', 'Replacing the universe clears current watchlist, notes, comparison, company briefs and undo history. Download the current backup before proceeding if needed.', 'hint'), replaceButton, backupCurrent, cancelImport); unitsConfirm.addEventListener('change', () => { replaceButton.disabled = !unitsConfirm.checked || !!loading; }); main.append(importReview);
const empty = panel('Bring your own annual data', 'One CSV can contain up to 500 annual rows, five periods per ticker, and 2 MiB. Blank amounts remain missing. No source link is fetched.'); empty.append(el('p', 'No universe has been loaded. Download the blank template or stage the fictional demo to explore the workflow.', 'empty')); main.append(empty);
const workspace = el('div', '', 'workspace'); workspace.hidden = true; main.append(workspace);
const sourceHeader = el('div', '', 'source-header'); const sourceText = el('p'); sourceText.id = 'dataset-summary'; const syntheticLabel = el('p', 'Synthetic demonstration — not real companies or filings', 'synthetic'); syntheticLabel.id = 'synthetic-label'; sourceHeader.append(sourceText, syntheticLabel); workspace.append(sourceHeader);
const titleForm = el('form', '', 'title-form'); titleForm.id = 'title-form'; const titleInput = field(titleForm, 'title', 'Notebook title') as HTMLInputElement; titleInput.maxLength = LIMITS.titleCharacters * 2; titleInput.required = true; const titleButton = button('Save title', () => {}); titleButton.type = 'submit'; titleForm.append(titleButton); titleInput.addEventListener('input', () => { titleDirty = true; draftIntent(); }); titleForm.addEventListener('submit', (e) => { e.preventDefault(); if (!notebook) return; try { const day = utcToday(); commit({ ...notebook, title: titleInput.value.trim() }, day); titleDirty = false; titleInput.value = notebook.title; updateRefresh(); } catch { announce('Use a notebook title with 1–80 characters. Your draft was kept.', true); } }); workspace.append(titleForm);
const toolbar = el('div', '', 'toolbar'); const undoButton = button('Undo', undo); const redoButton = button('Redo', redo); toolbar.append(undoButton, redoButton, button('Download notebook backup', downloadBackup), button('Download research report', downloadReport)); workspace.append(toolbar);
const saveStrip = el('div', '', 'save-strip'); const saveStatus = el('p'); saveStatus.id = 'save-status'; saveStatus.setAttribute('role', 'status'); const retryButton = button('Retry saving', retrySaving); retryButton.hidden = true; saveStrip.append(saveStatus, retryButton); workspace.append(saveStrip);
const researchLayout = el('div', '', 'research-layout'); const editor = el('aside', '', 'editor'); const research = el('div', '', 'research'); researchLayout.append(editor, research); workspace.append(researchLayout);
const queryPanel = panel('Supported screening language', 'Interpret first, inspect the expanded thresholds, then apply. Unsupported text is rejected in full.'); const queryForm = el('form'); queryForm.id = 'query-form'; const queryInput = field(queryForm, 'query', 'Screening sentence', true) as HTMLTextAreaElement; queryInput.maxLength = LIMITS.queryCharacters * 2; queryInput.placeholder = 'companies with profitable and revenue growth at least 10% sorted by profit margin descending'; const interpretButton = button('Interpret criteria', () => {}, 'primary'); interpretButton.type = 'submit'; queryForm.append(interpretButton);
const interpretation = el('div', '', 'interpretation'); interpretation.id = 'staged-interpretation'; interpretation.hidden = true; queryInput.addEventListener('input', () => { queryDirty = true; stagedQuery = null; interpretation.hidden = true; draftIntent(); }); queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); queryForm.requestSubmit(); } }); queryForm.addEventListener('submit', (e) => { e.preventDefault(); interpretCriteria(); }); queryPanel.append(queryForm, interpretation, el('p', 'Shortcuts are conventions: profitable = net income > 0; growing = growth > 0%; low debt = debt/equity ≤ 1; high margin = margin ≥ 10%. They are not universal definitions of financial health.', 'hint')); editor.append(queryPanel);
const screenPanel = panel('Editable filters', 'Every predicate uses AND. Ratios may screen mixed currencies; money thresholds require their explicit currency.'); const screenForm = el('form'); screenForm.id = 'screen-form'; screenForm.noValidate = true;
const sectorInput = select(screenForm, 'sector', 'Sector', [['', 'All sectors']]); const currencyInput = select(screenForm, 'currency', 'Universe currency', [['', 'All currencies']]);
sectorInput.id = 'screen-sector'; currencyInput.id = 'screen-currency';
const filterList = el('div', '', 'filter-list'); filterList.id = 'filter-list'; screenForm.append(filterList); const addFilterButton = button('Add filter', () => { if (filterEditors.length >= LIMITS.filters) { announce('At most 16 filters can be staged.', true); return; } addFilter({ metric: 'growthPct', operator: 'gte', value: 10, currency: null }); markScreenDraft(); }); screenForm.append(addFilterButton);
const sortInput = select(screenForm, 'sortBy', 'Sort by', [['ticker', 'Ticker'], ...metricOptions]); const directionInput = select(screenForm, 'direction', 'Sort direction', [['asc', 'Ascending'], ['desc', 'Descending']]);
const staleLabel = el('label', '', 'checkbox'); const staleInput = el('input'); staleInput.type = 'checkbox'; staleInput.name = 'includeStale'; staleLabel.append(staleInput, el('span', 'Include stale companies')); screenForm.append(staleLabel);
const screenError = el('p', '', 'field-error'); screenError.id = 'screen-error'; screenError.hidden = true; screenError.setAttribute('role', 'status'); const applyButton = button('Apply filters', () => {}, 'primary'); applyButton.type = 'submit'; screenForm.append(screenError, applyButton, button('Clear filters', clearFilters));
screenForm.addEventListener('input', markScreenDraft); screenForm.addEventListener('change', markScreenDraft); screenForm.addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); }); screenPanel.append(screenForm); editor.append(screenPanel);
const appliedPanel = panel('Applied criteria', 'These effective filters drive the shortlist and exports. Draft controls do not.'); const appliedCriteria = el('div'); appliedCriteria.id = 'applied-criteria'; appliedPanel.append(appliedCriteria); research.append(appliedPanel);
const tabs = el('div', '', 'tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Research views');
const tabButtons = new Map<string, HTMLButtonElement>(); const tabPanels = new Map<string, HTMLElement>();
for (const label of ['Shortlist', 'Comparison', 'Watchlist', 'Excluded companies']) { const key = label.toLowerCase().replaceAll(' ', '-'); const b = button(label, () => { activeTab = key; renderTabs(); }); b.id = `tab-${key}`; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', `panel-${key}`); tabs.append(b); tabButtons.set(key, b); const p = panel(label); p.id = `panel-${key}`; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', b.id); tabPanels.set(key, p); }
research.append(tabs, ...tabPanels.values());
const screenStatus = el('p', '', 'hint'); screenStatus.id = 'screen-status'; const resultList = el('div', '', 'company-list'); resultList.id = 'results'; tabPanels.get('shortlist')!.append(screenStatus, resultList);
const comparisonContent = el('div'); comparisonContent.id = 'comparison-content'; tabPanels.get('comparison')!.append(comparisonContent);
const watchlistContent = el('div', '', 'company-list'); watchlistContent.id = 'watchlist-content'; tabPanels.get('watchlist')!.append(watchlistContent);
const exclusionSummary = el('p', '', 'hint'); const exclusionContent = el('div', '', 'company-list'); exclusionContent.id = 'exclusion-content';
tabPanels.get('excluded-companies')!.append(exclusionSummary, exclusionContent);
const detail = panel('Company evidence', 'Reported figures are supplied by the importer, not independently verified. Ratios and observations are calculated from those figures.'); detail.id = 'company-detail'; detail.hidden = true; const detailContent = el('div'); detail.append(detailContent);
const noteForm = el('form'); noteForm.id = 'note-form'; const noteInput = field(noteForm, 'note', 'Research note', true) as HTMLTextAreaElement; noteInput.maxLength = LIMITS.noteCharacters * 2; const noteButton = button('Save note', () => {}, 'primary'); noteButton.type = 'submit'; noteForm.append(noteButton); noteInput.addEventListener('input', () => { if (selectedTicker) noteDrafts.set(selectedTicker, noteInput.value); draftIntent(); }); noteForm.addEventListener('submit', (e) => { e.preventDefault(); saveNote(); }); detail.append(noteForm); research.append(detail);
main.append(el('footer', 'Local browser storage · no account · download a notebook backup for recovery elsewhere.'));

let notebook: Notebook | null = null; let notebookHistory: NotebookHistory | null = null; let results: ScreenResult | null = null;
let selectedTicker: string | null = null; let activeTab = 'shortlist'; let generation = 0; let intentGeneration = 0; let operationSequence = 0;
type Staged = { kind: 'csv'; preview: CsvPreview } | { kind: 'dataset'; dataset: Dataset } | { kind: 'notebook'; notebook: Notebook };
let staged: Staged | null = null; let loading: { id: number; intent: number } | null = null; let stagedQuery: { text: string; interpretation: string[] } | null = null;
let titleDirty = false; let queryDirty = false; let screenDirty = false; let restoreFailed = false; let saveFailed = false; let savedGeneration = -1;
let saveTimer: ReturnType<typeof setTimeout> | undefined; let saveQueue = Promise.resolve(); const store = new NotebookStore(); const noteDrafts = new Map<string, string>();
type FilterEditor = { id: number; node: HTMLElement; metric: HTMLSelectElement; operator: HTMLSelectElement; value: HTMLInputElement; currency: HTMLSelectElement };
let filterSequence = 0; const filterEditors: FilterEditor[] = [];
interface RefreshSession { base: Notebook; incoming: Dataset; review: RefreshReview; generation: number; intent: number; stale: boolean }
let refreshSession: RefreshSession | null = null;
let refreshPending: { id: number; generation: number; intent: number } | null = null;
let refreshActive = false; let refreshError = '';
const briefView = mountBriefView(detail, { notebook: () => notebook, receipt: () => `${generation}/${intentGeneration}/${selectedTicker}`, intent: draftIntent, changed: updateRefresh, commit: (briefs, day) => { if (notebook) commit({ ...notebook, briefs }, day); }, download });
function editorDrafts(): boolean { return titleDirty || queryDirty || screenDirty || noteDrafts.size > 0 || briefView.hasDrafts(); }
function freshRefresh(session: RefreshSession, day: string): boolean {
  return !session.stale && session.generation === generation && session.intent === intentGeneration && session.review.today === day
    && session.review.incomingDatasetId === session.incoming.id && session.base.id === notebook?.id;
}
function updateRefresh(): void {
  refreshInput.disabled = !notebook;
  if (refreshSession && !freshRefresh(refreshSession, utcToday())) refreshSession.stale = true;
  refreshView.setState({ active: refreshActive, loading: !!refreshPending, stale: !!refreshSession?.stale, drafts: editorDrafts(), error: refreshError });
}
function invalidateRefresh(): void {
  refreshPending = null;
  if (refreshSession) refreshSession.stale = true;
  updateRefresh();
}
function clearRefresh(): void {
  refreshSession = null; refreshPending = null; refreshActive = false; refreshError = ''; refreshView.clear(); updateRefresh();
}
function cancelRefresh(): void { clearRefresh(); announce('Refresh canceled. Current notebook, drafts, history and saved data were kept.'); }
function prepareRefresh(incoming: Dataset, day: string): void {
  if (!notebook) throw new Error('Open a notebook first.');
  const base = structuredClone(notebook), review = reviewRefresh(base, incoming, day);
  // Construct the complete review before replacing any previously staged review.
  refreshSession = { base, incoming, review, generation, intent: intentGeneration, stale: false };
  refreshActive = true; refreshError = ''; refreshView.setReview(base, incoming, review); updateRefresh();
}
async function readRefresh(file: File): Promise<void> {
  if (!notebook) return;
  // A single read owns the import UI. Superseded native File reads may finish,
  // but their results cannot replace the newer review or committed notebook.
  loading = null; staged = null; unitsConfirm.checked = false; renderImport();
  refreshView.clear(); refreshSession = null; refreshError = ''; refreshActive = true;
  const operation = { id: ++operationSequence, generation, intent: intentGeneration }; refreshPending = operation; updateRefresh();
  try {
    if (!file.size || file.size > LIMITS.csvBytes) throw new Error('CSV size');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (refreshPending !== operation || operation.generation !== generation || operation.intent !== intentGeneration || !notebook) return;
    const day = utcToday();
    const incoming = createDataset(parseCsv(bytes, file.name, day), day, false);
    prepareRefresh(incoming, day); refreshPending = null; updateRefresh();
    announce('Refresh review prepared. Your current data and research remain unchanged.');
  } catch {
    if (refreshPending !== operation || operation.generation !== generation || operation.intent !== intentGeneration) return;
    refreshPending = null;
    refreshError = 'Refresh rejected in full. Check the complete CSV header, UTF-8, annual rows, dates, duplicates and 2 MiB limit. Current data, drafts, history and saved record were kept.';
    updateRefresh();
  }
}
refreshInput.addEventListener('change', () => { const file = refreshInput.files?.[0]; refreshInput.value = ''; if (file) void readRefresh(file); });
function rebuildRefresh(): void {
  if (!refreshSession || refreshPending || !notebook) return;
  try { prepareRefresh(refreshSession.incoming, utcToday()); announce('Refresh review rebuilt against committed research. Decisions and confirmations have been reset.'); }
  catch { refreshSession.stale = true; refreshError = 'Could not rebuild this refresh under today’s data rules. Current work and the incoming dataset were kept; check current criteria or choose a new CSV.'; updateRefresh(); }
}
function discardRefreshDrafts(): void {
  if (!notebook || !refreshSession || !editorDrafts()) return;
  const receipt = `${generation}/${intentGeneration}`, session = refreshSession, day = utcToday();
  if (!confirm('Discard all unsent title, screening, filter, note, brief and citation drafts for this refresh? Unsent drafts are absent from notebook backups. Committed research and saved evidence will be kept.')) return;
  if (receipt !== `${generation}/${intentGeneration}` || refreshSession !== session || utcToday() !== day) return;
  briefView.clearDrafts(); briefView.setState(notebook, selectedTicker);
  titleDirty = false; queryDirty = false; screenDirty = false; noteDrafts.clear(); stagedQuery = null;
  titleInput.value = notebook.title; queryInput.value = notebook.query; fillScreen(notebook.screen); interpretation.hidden = true;
  noteInput.value = notebook.notes.find(item => item.ticker === selectedTicker)?.text ?? '';
  draftIntent(); rebuildRefresh();
}
function downloadPreviousNotebook(): void {
  const session = refreshSession; if (!session) return;
  try { download(serializeNotebook(session.base, session.review.today), 'stock-notebook-previous.json', 'application/json'); announce('Previous notebook downloaded from the reviewed committed snapshot. Unsent editor drafts are not included.'); }
  catch { refreshError = 'Could not create the previous-notebook backup. The reviewed snapshot and current work were kept.'; updateRefresh(); }
}
function downloadProposedRefresh(): void {
  const session = refreshSession, day = utcToday(), choices = refreshView.choices();
  if (!session || refreshPending || !freshRefresh(session, day) || !choices) { updateRefresh(); return; }
  try { download(buildRefreshReport(session.base, session.incoming, choices, day), 'stock-notebook-refresh-review.txt', 'text/plain;charset=utf-8'); announce('Proposed refresh review downloaded. It is not an applied or saved transaction; unsent drafts are not included.'); }
  catch { refreshError = 'The proposed review could not be exported. Check compatible criteria, complete research decisions and report size. No data was applied; both notebook backups remain available.'; updateRefresh(); }
}
function applyReviewedRefresh(): void {
  const session = refreshSession, day = utcToday(), choices = refreshView.choices();
  if (!session || refreshPending || !freshRefresh(session, day) || editorDrafts() || !choices || !refreshView.confirmed()) { updateRefresh(); return; }
  const losses = refreshView.losses();
  if (!confirm(`Replace the complete financial dataset with ${session.incoming.fileName}? ${losses.periods} annual periods and ${losses.annotations} research groups will be removed. Research is retained only as reviewed. A fresh undo history starts; Undo cannot restore the previous dataset. Download the previous notebook first if needed.`)) return;
  // Native confirmation can remain open across midnight. Recheck after consent;
  // never treat consent to a different day or notebook as current approval.
  const confirmedDay = utcToday();
  if (refreshSession !== session || confirmedDay !== day || !freshRefresh(session, confirmedDay) || editorDrafts()) { if (refreshSession) refreshSession.stale = true; updateRefresh(); return; }
  try {
    const candidate = applyRefresh(session.base, session.incoming, choices, confirmedDay);
    publish(candidate, false, confirmedDay); clearRefresh();
    announce('Reviewed refresh applied. Retained research uses the incoming evidence; undo history starts here. Local save status above confirms when browser storage completes.');
  } catch { refreshError = 'Refresh could not be applied. Check the complete decisions, compatible criteria and notebook size. Current notebook, drafts, history and saved record were kept.'; updateRefresh(); }
}
// Clock changes while this tab is idle do not make old consent current. Every
// action also checks synchronously, including after native confirmation.
const refreshClock = setInterval(updateRefresh, 1000);
window.addEventListener('focus', updateRefresh);
document.addEventListener('visibilitychange', updateRefresh);
window.addEventListener('pagehide', event => { if (!event.persisted) clearInterval(refreshClock); });

function currentSectors(): string[] { if (!notebook) return []; const seen = new Map<string, string>(); for (const c of latestCompanies(notebook.dataset.companies)) if (!seen.has(c.sector.toLowerCase())) seen.set(c.sector.toLowerCase(), c.sector); return [...seen.values()].sort(); }
function currentCurrencies(): string[] { return notebook ? [...new Set(latestCompanies(notebook.dataset.companies).map((c) => c.currency))].sort() : []; }
function markScreenDraft(): void { screenDirty = true; screenError.hidden = true; draftIntent(); }
function draftIntent(): void { intentGeneration += 1; invalidateRefresh(); if (loading) { loading = null; announce('Pending import or restore canceled because you edited the notebook. Your draft was kept.'); renderImport(); } }
function filterCaption(f: Filter): string { return `${metricNames[f.metric]} ${operators[f.operator]} ${String(f.value)}${moneyMetrics.has(f.metric) ? ` ${f.currency ?? 'any currency (zero sign test)'} million` : f.metric === 'debtEquity' ? '' : '%'}`; }
function addFilter(f: Filter): void {
  const node = el('fieldset', '', 'filter-row'); const id = ++filterSequence; node.dataset.filterId = String(id); node.append(el('legend', `Filter ${filterEditors.length + 1}`)); const metric = select(node, 'metric', 'Metric', metricOptions); const operator = select(node, 'operator', 'Comparison', Object.entries(operators)); const val = field(node, 'value', 'Threshold') as HTMLInputElement; val.inputMode = 'decimal'; val.maxLength = 64; const currency = select(node, 'currency', 'Threshold currency', [['', 'No currency (ratio / zero sign)'], ...currentCurrencies().map((c) => [c, c] as [string, string])]);
  metric.value = f.metric; operator.value = f.operator; val.value = String(f.value); currency.value = f.currency ?? '';
  const item = { id, node, metric, operator, value: val, currency }; filterEditors.push(item); node.append(button('Remove filter', () => { const index = filterEditors.indexOf(item); if (index >= 0) filterEditors.splice(index, 1); node.remove(); markScreenDraft(); })); filterList.append(node);
}
function fillScreen(screen: Screen): void {
  fillOptions(sectorInput, [['', 'All sectors'], ...currentSectors().map((s) => [s, s] as [string, string])]); fillOptions(currencyInput, [['', 'All currencies'], ...currentCurrencies().map((c) => [c, c] as [string, string])]); sectorInput.value = screen.sector ?? ''; currencyInput.value = screen.currency ?? '';
  filterEditors.splice(0); filterList.replaceChildren(); for (const f of screen.filters) addFilter(f); sortInput.value = screen.sortBy; directionInput.value = screen.direction; staleInput.checked = screen.includeStale; screenDirty = false; screenError.hidden = true;
}
function readScreen(): Screen {
  const filters: Filter[] = filterEditors.map((f) => { const raw = f.value.value.trim(); if (!/^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(raw)) throw new Error('Invalid filter number'); return { metric: f.metric.value as Metric, operator: f.operator.value as Operator, value: Number(raw), currency: f.currency.value || null }; });
  return { sector: sectorInput.value || null, currency: currencyInput.value || null, filters, includeStale: staleInput.checked, sortBy: sortInput.value as Screen['sortBy'], direction: directionInput.value as Screen['direction'] };
}
function interpretCriteria(): void {
  if (!notebook) return; try { const parsed = parseQuery(queryInput.value, notebook.dataset); draftIntent(); stagedQuery = { text: queryInput.value.trim(), interpretation: parsed.interpretation }; fillScreen(parsed.screen); screenDirty = true; interpretation.replaceChildren(el('h3', 'Staged interpretation — not applied'), ...parsed.interpretation.map((s) => el('p', s))); interpretation.hidden = false; updateRefresh(); announce('Interpretation staged. Inspect or edit the filters, then Apply filters.'); }
  catch { stagedQuery = null; interpretation.hidden = true; announce('Unsupported screening sentence. Nothing was applied. Try: companies with profitable and revenue growth at least 10% sorted by profit margin descending. Use quoted sectors, explicit million XXX for money, and no extra prose.', true); }
}
function applyFilters(): void {
  if (!notebook) return; try { const day = utcToday(); const screen = readScreen(); const query = stagedQuery?.text ?? notebook.query; const candidate = validateNotebook({ ...notebook, screen, query }, day); const computed = screenDataset(candidate.dataset, candidate.screen, day); commit(candidate, day, computed); screenDirty = false; stagedQuery = null; interpretation.hidden = true; screenError.hidden = true; if (queryInput.value.trim() === candidate.query) queryDirty = false; updateRefresh(); announce('Criteria applied. The shortlist and exports use these effective filters.'); }
  catch { screenError.textContent = 'Filters were not applied. Use valid thresholds (up to six decimals), valid sectors/currencies, and a single matched currency for money sorting. Try ticker or ratio sorting, or choose one currency. Your drafts and previous results were kept.'; screenError.hidden = false; }
}
function clearFilters(): void { if (!notebook) return; try { const day = utcToday(); const candidate = validateNotebook({ ...notebook, query: '', screen: { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' } }, day); commit(candidate, day); queryInput.value = ''; queryDirty = false; stagedQuery = null; interpretation.hidden = true; fillScreen(candidate.screen); updateRefresh(); announce('Filters cleared. Stale companies remain excluded unless you include them.'); } catch { announce('Could not clear filters. Current work was kept.', true); } }
function commit(candidate: Notebook, day: string, computed?: ScreenResult): void {
  if (!notebook || !notebookHistory) return; const next = validateNotebook(candidate, day); const nextResults = computed ?? screenDataset(next.dataset, next.screen, day); if (JSON.stringify(editState(next)) === JSON.stringify(editState(notebook))) { results = nextResults; renderNotebook(day); return; }
  notebookHistory.commit(next, day); notebook = notebookHistory.current; results = nextResults; generation += 1; draftIntent(); queueSave(); renderNotebook(day);
}
function undo(): void { if (!notebookHistory?.canUndo || !briefView.guardHistory()) return; const day = utcToday(); try { const next = notebookHistory.undo(day); notebook = next; results = screenDataset(next.dataset, next.screen, day); generation += 1; draftIntent(); if (!screenDirty) fillScreen(next.screen); if (!queryDirty) queryInput.value = next.query; queueSave(); renderNotebook(day); } catch { announce('Undo could not be applied with today’s data rules. Current work was kept.', true); } }
function redo(): void { if (!notebookHistory?.canRedo || !briefView.guardHistory()) return; const day = utcToday(); try { const next = notebookHistory.redo(day); notebook = next; results = screenDataset(next.dataset, next.screen, day); generation += 1; draftIntent(); if (!screenDirty) fillScreen(next.screen); if (!queryDirty) queryInput.value = next.query; queueSave(); renderNotebook(day); } catch { announce('Redo could not be applied with today’s data rules. Current work was kept.', true); } }
function publish(candidate: Notebook, restored = false, day = utcToday()): void {
  const next = validateNotebook(candidate, day); const computed = screenDataset(next.dataset, next.screen, day); const history = new NotebookHistory(next, day);
  briefView.clearDrafts();
  notebook = next; notebookHistory = history; results = computed; generation += 1; intentGeneration += 1; selectedTicker = null; noteDrafts.clear(); titleDirty = false; queryDirty = false; screenDirty = false; stagedQuery = null; staged = null; loading = null; restoreFailed = false; saveFailed = false; recovery.hidden = true; titleInput.value = next.title; queryInput.value = next.query; fillScreen(next.screen); interpretation.hidden = true; activeTab = 'shortlist'; savedGeneration = restored ? generation : -1;
  saveStatus.textContent = restored ? 'Saved locally · notebook restored' : 'Saving locally…'; invalidateRefresh(); renderImport(); renderNotebook(day); if (!restored) queueSave();
}
async function stageInput(task: () => Promise<Staged>): Promise<void> {
  invalidateRefresh();
  const op = { id: ++operationSequence, intent: intentGeneration }; loading = op; staged = null; unitsConfirm.checked = false; renderImport(); announce('Reading and validating the complete input…');
  try { const next = await task(); if (loading !== op || op.intent !== intentGeneration) return; staged = next; loading = null; renderImport(); announce('Input validated. Review units, periods and replacement before applying.'); }
  catch (error) { if (loading === op && op.intent === intentGeneration) { loading = null; renderImport(); const diagnostic = error instanceof Error && /^(CSV row [0-9]{1,3}: |CSV must |CSV header |CSV source filename |Choose a nonempty CSV)/.test(error.message) && error.message.length <= 220 ? `${error.message} ` : ''; announce(`${diagnostic}Input rejected in full. Check UTF-8, the exact CSV header/values, dates, duplicates and size limits. Current notebook, drafts and saved record were kept.`, true); } }
}
csvInput.addEventListener('change', () => { const file = csvInput.files?.[0]; csvInput.value = ''; if (file) void stageInput(async () => { if (!file.size || file.size > LIMITS.csvBytes) throw new Error('CSV size'); return { kind: 'csv', preview: parseCsv(new Uint8Array(await file.arrayBuffer()), file.name, utcToday()) }; }); });
jsonInput.addEventListener('change', () => { const file = jsonInput.files?.[0]; jsonInput.value = ''; if (file) void stageInput(async () => { if (!file.size || file.size > LIMITS.notebookBytes) throw new Error('JSON size'); const bytes = new Uint8Array(await file.arrayBuffer()); const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); return { kind: 'notebook', notebook: parseNotebookJson(text, utcToday()) }; }); });
function cancelStaging(): void { invalidateRefresh(); loading = null; staged = null; operationSequence += 1; unitsConfirm.checked = false; renderImport(); announce('Import canceled. Current notebook and saved data were kept.'); }
function renderImport(): void {
  importReview.hidden = !loading && !staged; replaceButton.disabled = !!loading || !staged || !unitsConfirm.checked; backupCurrent.hidden = !notebook; unitLabel.hidden = !!loading;
  if (loading) { importSummary.replaceChildren(el('p', 'Validating the complete incoming file…')); return; } if (!staged) return;
  const dataset = staged.kind === 'csv' ? null : staged.kind === 'dataset' ? staged.dataset : staged.notebook.dataset; const rows = staged.kind === 'csv' ? staged.preview.companies : dataset!.companies; const name = staged.kind === 'csv' ? staged.preview.fileName : dataset!.fileName; const day = utcToday(); const missingCount = rows.reduce((n, c) => n + ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'].filter((k) => c[k as keyof Company] === null).length, 0); const dates = rows.map((c) => c.fiscalDate).sort(); const current = latestCompanies(rows); const staleCount = current.filter((c) => analyzeCompany(c, day).stale).length;
  importSummary.replaceChildren(el('h3', name), el('p', `${rows.length} annual rows · ${current.length} unique companies · supplied currencies ${[...new Set(rows.map((c) => c.currency))].sort().join(', ')} · ${missingCount} missing amounts`), el('p', `Fiscal dates ${dates[0]} to ${dates[dates.length - 1]} · ${staleCount} companies with stale latest periods as of ${day} UTC`, 'hint'), el('p', dataset?.synthetic ? 'Synthetic demonstration — not real companies or filings' : 'Imported figures and source links are supplied by you; they have not been verified.', dataset?.synthetic ? 'synthetic' : 'hint'));
}
function replaceUniverse(): void {
  const incoming = staged, day = utcToday(), receipt = `${generation}/${intentGeneration}`;
  if (!incoming || loading || !unitsConfirm.checked) return;
  if ((notebook || restoreFailed) && !confirm('Replace the current universe? Watchlist, notes, comparison, briefs, citations, unsent drafts and undo history will be replaced. Download the current backup first if needed. Replacement happens only after full validation.')) return;
  if (staged !== incoming || loading || !unitsConfirm.checked || day !== utcToday() || receipt !== `${generation}/${intentGeneration}`) { announce('The incoming review or editor changed during confirmation. Nothing was replaced.', true); return; }
  try { const candidate = incoming.kind === 'notebook' ? validateNotebook(incoming.notebook, day) : createNotebook(incoming.kind === 'dataset' ? incoming.dataset : createDataset(incoming.preview, day), day); publish(candidate, false, day); announce('Universe replaced. All figures use declared currency millions and annual periods.'); } catch { announce('Replacement failed validation. Current notebook, drafts and saved data were kept.', true); }
}
function queueSave(): void { clearTimeout(saveTimer); saveStatus.textContent = saveFailed ? 'Not saved · new edits kept in this page; retrying local storage…' : 'Unsaved changes · saving locally…'; retryButton.hidden = !saveFailed; saveTimer = setTimeout(persist, 300); }
function persist(): void {
  if (!notebook) return; const captured = notebook; const epoch = generation; const day = utcToday(); saveQueue = saveQueue.then(async () => { if (epoch !== generation) return; saveStatus.textContent = saveFailed ? 'Not saved · retrying local storage…' : 'Saving locally…'; try { await store.save(captured, day); if (epoch !== generation) return; savedGeneration = epoch; saveFailed = false; saveStrip.classList.remove('unsaved'); saveStatus.textContent = 'Saved locally · browser storage'; retryButton.hidden = true; } catch { if (epoch !== generation) return; saveFailed = true; saveStrip.classList.add('unsaved'); saveStatus.textContent = 'Not saved · current notebook stays in this page. Download notebook backup before closing.'; retryButton.hidden = false; announce('Local save failed. Your notebook is usable in memory; download a backup or Retry saving.', true); } }).catch(() => {});
}
function retrySaving(): void { if (!notebook) return; clearTimeout(saveTimer); persist(); }
function downloadBackup(): void { if (!notebook) return; try { download(serializeNotebook(notebook, utcToday()), 'stock-notebook.json', 'application/json'); announce('Notebook backup downloaded, including the applied filters, source data and saved annotations. Unsent drafts are not included.'); } catch { announce('Could not export this notebook under today’s validation rules. Current work was kept.', true); } }
function downloadReport(): void { if (!notebook) return; try { download(buildReport(notebook, utcToday()), 'stock-notebook-report.txt', 'text/plain;charset=utf-8'); announce('Research report downloaded. It uses applied criteria and supplied figures, with no predictions.'); } catch { announce('Could not build the report under today’s data rules. Current work was kept.', true); } }
async function downloadRaw(): Promise<void> { try { const raw = await store.exportRaw(); if (raw === null) { announce('No saved record was found.'); return; } download(raw, 'stock-notebook-raw-recovery.json', 'application/json'); announce('Raw saved record downloaded without changing it. It may need repair before import.'); } catch { announce('This saved record could not be exported safely. It was kept unchanged.', true); } }
async function resetSaved(): Promise<void> {
  if (!confirm('Reset the saved record? This deletes only this browser’s saved notebook. Download its raw record first if needed. Current in-memory work and drafts will be kept.')) return;
  const epoch = generation; const intent = ++intentGeneration; invalidateRefresh(); loading = null; clearTimeout(saveTimer);
  try { await saveQueue; await store.clear(); if (epoch !== generation || intent !== intentGeneration) return; restoreFailed = false; recovery.hidden = true; savedGeneration = -1; if (notebook) { saveFailed = true; saveStatus.textContent = 'Saved record reset · current notebook is in memory. Retry saving or download a backup.'; retryButton.hidden = false; } announce('Saved record reset. Current in-memory work was kept.'); }
  catch { if (epoch === generation && intent === intentGeneration) announce('Could not reset the saved record. Existing data and current work were kept.', true); }
}
function toggleWatch(ticker: string): void { if (!notebook) return; try { const current = notebook.watchlist; commit({ ...notebook, watchlist: current.includes(ticker) ? current.filter((t) => t !== ticker) : [...current, ticker] }, utcToday()); } catch { announce('Watchlist change rejected. Keep at most 100 known companies; current work was kept.', true); } }
function toggleComparison(ticker: string): void { if (!notebook) return; try { const current = notebook.comparison; commit({ ...notebook, comparison: current.includes(ticker) ? current.filter((t) => t !== ticker) : [...current, ticker] }, utcToday()); } catch { announce('Comparison supports at most four known companies. Current selection was kept.', true); } }
function saveNote(): void { if (!notebook || !selectedTicker) return; try { const text = noteInput.value; const notes = notebook.notes.filter((n) => n.ticker !== selectedTicker); if (text.trim()) notes.push({ ticker: selectedTicker, text }); commit({ ...notebook, notes }, utcToday()); noteDrafts.delete(selectedTicker); noteInput.value = notebook.notes.find((n) => n.ticker === selectedTicker)?.text ?? ''; updateRefresh(); announce('Research note saved in the notebook. Local save status is shown above.'); } catch { announce('Note was not applied. Use at most 4000 characters and 100 annotated companies. Your draft was kept.', true); } }
function openCompany(ticker: string): void { selectedTicker = ticker; renderDetail(utcToday()); detail.tabIndex = -1; detail.focus({ preventScroll: true }); detail.scrollIntoView({ behavior: 'auto', block: 'nearest' }); }
function sourceLink(company: Company): HTMLElement { if (!company.filingUrl) return el('p', 'No filing link supplied', 'hint'); const n = el('a', 'Supplied source link (external; not verified)'); n.href = company.filingUrl; n.target = '_blank'; n.rel = 'noopener noreferrer'; return n; }
function ageInDays(company: Company, day: string): number { return Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${company.fiscalDate}T00:00:00Z`)) / 86400000); }
function companyCard(row: ResearchRow, day: string): HTMLElement {
  const c = row.company; const card = el('article', '', 'company-card'); card.dataset.ticker = c.ticker; const head = el('div', '', 'company-card-heading'); head.append(el('h3', `${c.ticker} · ${c.name}`), el('span', row.stale ? 'Stale' : 'Fresh period', row.stale ? 'badge stale' : 'badge')); card.append(head, el('p', `${c.sector} · ${c.currency} · fiscal ${c.fiscalDate} · ${ageInDays(c, day)} days old`, 'hint'), el('p', `Revenue ${amount(c.revenue, c.currency)} · Growth ${ratio(row.derived.growthPct, true)} · Margin ${ratio(row.derived.marginPct, true)} · Debt/equity ${ratio(row.derived.debtEquity)}`, 'card-metrics'), el('p', `${notebook!.dataset.fileName}:${c.sourceLine} · supplied annual figures`, 'hint'));
  const actions = el('div', '', 'card-actions'); const view = button('View evidence', () => { openCompany(c.ticker); }); view.dataset.action = 'view'; const watch = button(notebook!.watchlist.includes(c.ticker) ? 'Remove from watchlist' : 'Add to watchlist', () => { toggleWatch(c.ticker); }); watch.dataset.action = 'watch'; const compare = button(notebook!.comparison.includes(c.ticker) ? 'Remove from comparison' : 'Add to comparison', () => { toggleComparison(c.ticker); }); compare.dataset.action = 'compare'; actions.append(view, watch, compare); card.append(actions); return card;
}
function facts(row: ResearchRow, scope = 'detail'): HTMLElement {
  const c = row.company; const fieldId = (key: string): string => `fact-${scope}-${c.ticker}-${key}`; const content = el('div', '', 'facts'); content.append(el('h3', 'Reported facts'), el('p', `${c.ticker} · ${c.name}`), el('p', `Sector: ${c.sector} · Currency: ${c.currency} · Fiscal year end: ${c.fiscalDate}`), el('p', `Source: ${notebook!.dataset.fileName}:${c.sourceLine} · imported ${notebook!.dataset.importedDate}`, 'hint'), el('p', 'Declared basis: comparable 12-month annual periods; prior revenue is supplied for the preceding comparable annual period.', 'hint'));
  content.querySelectorAll('p')[1]!.id = fieldId('fiscalDate');
  const dl = el('dl'); for (const [key, label] of [['revenue', 'Revenue'], ['priorRevenue', 'Prior revenue'], ['netIncome', 'Net income'], ['debt', 'Gross interest-bearing debt'], ['equity', 'Equity']] as const) { const dt = el('dt', label); dt.id = fieldId(key); dl.append(dt, el('dd', amount(c[key], c.currency, true))); } const suppliedLink = sourceLink(c); suppliedLink.id = fieldId('filingUrl'); content.append(dl, suppliedLink, el('h3', 'Derived ratios'));
  for (const [key, formula, inputs] of [
    ['growthPct', '100 × (revenue − prior revenue) / prior revenue', `revenue=${c.revenue ?? 'missing'}, prior revenue=${c.priorRevenue ?? 'missing'}`],
    ['marginPct', '100 × net income / revenue', `net income=${c.netIncome ?? 'missing'}, revenue=${c.revenue ?? 'missing'}`],
    ['debtEquity', 'gross debt / equity', `gross debt=${c.debt ?? 'missing'}, equity=${c.equity ?? 'missing'}`],
  ] as const) { const n = row.derived[key]; content.append(el('p', `${metricNames[key]}: ${n === null ? 'Undefined — see the uncertainty below' : `${String(n)}${key === 'debtEquity' ? '' : '%'}`} · ${formula} · supplied inputs ${inputs}`)); }
  content.append(el('h3', 'Derived observations')); if (!row.observations.some((o) => o.kind === 'strength' || o.kind === 'risk')) content.append(el('p', 'No rule-based strengths/risks found.', 'hint'));
  for (const kind of ['strength', 'risk', 'uncertainty'] as const) { const group = row.observations.filter((o) => o.kind === kind); const block = el('div', '', `observation-group ${kind}`); block.append(el('h4', kind === 'strength' ? 'Rule-based strengths' : kind === 'risk' ? 'Rule-based risks' : 'Uncertainties')); if (!group.length) block.append(el('p', kind === 'uncertainty' ? 'No additional uncertainty rules found.' : kind === 'strength' ? 'No rule-based strengths found.' : 'No rule-based risks found.', 'hint')); for (const o of group) { const item = el('p'); item.dataset.observationCode = o.code; item.append(el('span', o.text), el('span', ` · ${notebook!.dataset.fileName}:${c.sourceLine} · inputs: `, 'hint')); o.fields.forEach((key, i) => { if (i) item.append(document.createTextNode(', ')); const link = el('a', key); link.href = `#${fieldId(key)}`; item.append(link); }); block.append(item); } content.append(block); } return content;
}
function periodAnchor(company: Company): string { return `period-detail-${company.ticker}-${company.fiscalDate}`; }
function periodReference(company: Company): HTMLAnchorElement {
  const link = el('a', `${company.fiscalDate} · ${notebook!.dataset.fileName}:${company.sourceLine}`);
  link.href = `#${periodAnchor(company)}`;
  return link;
}
function historicalComparison(pair: PeriodComparison): HTMLElement {
  const section = el('section', '', 'period-comparison');
  section.dataset.previousDate = pair.previous.fiscalDate;
  section.dataset.currentDate = pair.current.fiscalDate;
  section.append(el('h4', `${pair.previous.fiscalDate} → ${pair.current.fiscalDate}`));
  const sources = el('p', 'Supplied rows: ', 'hint');
  sources.append(periodReference(pair.previous), document.createTextNode(' → '), periodReference(pair.current));
  section.append(sources);
  if (!pair.comparable) section.append(el('p', 'Automatic comparison unavailable', 'warning'));
  for (const reason of pair.reasons) section.append(el('p', reason, 'hint'));
  for (const warning of pair.warnings) section.append(el('p', warning, 'warning'));
  const raw = (value: number | null): string => value === null ? 'Not supplied' : String(value);
  for (const change of pair.changes) {
    const block = el('div', '', 'historical-change'); block.dataset.metric = change.metric;
    block.append(el('h5', metricNames[change.metric]));
    if (change.metric === 'marginPct') {
      block.append(el('p', `Previous inputs: net income ${amount(pair.previous.netIncome, pair.previous.currency, true)}; revenue ${amount(pair.previous.revenue, pair.previous.currency, true)}.`),
        el('p', `Current inputs: net income ${amount(pair.current.netIncome, pair.current.currency, true)}; revenue ${amount(pair.current.revenue, pair.current.currency, true)}.`));
      if (change.delta !== null) block.append(el('p', `Net margin change = (100 × ${raw(pair.current.netIncome)} / ${raw(pair.current.revenue)}) − (100 × ${raw(pair.previous.netIncome)} / ${raw(pair.previous.revenue)}) = ${String(change.delta)} percentage points.`));
      else block.append(el('p', `Net margin change unavailable: ${change.reason ?? 'Inputs cannot be compared.'}`));
      if (change.percentReason) block.append(el('p', change.percentReason, 'hint'));
    } else {
      const previous = pair.previous[change.metric], current = pair.current[change.metric];
      block.append(el('p', `Previous input: ${amount(previous, pair.previous.currency, true)}. Current input: ${amount(current, pair.current.currency, true)}.`));
      if (change.delta !== null) block.append(el('p', `Absolute change = ${raw(current)} − ${raw(previous)} = ${amount(change.delta, pair.current.currency, true)}.`));
      else block.append(el('p', `Absolute change unavailable: ${change.reason ?? 'Inputs cannot be compared.'}`));
      if (change.percentChange !== null) block.append(el('p', `Relative change = 100 × (${raw(current)} − ${raw(previous)}) / ${raw(previous)} = ${String(change.percentChange)}%.`));
      else block.append(el('p', `Relative change unavailable: ${change.percentReason ?? 'Inputs cannot be compared.'}`, 'hint'));
    }
    section.append(block);
  }
  return section;
}
function annualHistory(history: CompanyHistory): HTMLElement {
  const section = el('section', '', 'annual-history'); section.id = 'annual-history';
  const first = history.periods[0]!.company.fiscalDate, last = history.periods.at(-1)!.company.fiscalDate;
  section.append(el('h3', 'Supplied annual history'),
    el('p', `${history.periods.length} supplied periods · ${first} to ${last}. Current screens use only the latest supplied row.`, 'hint'),
    el('p', 'Historical comparisons use adjacent supplied rows, never interpolated years. Calendar alignment and matching currency, company name and sector are conservative checks, not verification of accounting comparability. 52/53-week reporters and changed names may need manual comparison.', 'notice'));
  const scroll = el('div', '', 'history-table-scroll'); scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', `${history.ticker} supplied annual history`);
  const table = el('table', '', 'history-table'); table.append(el('caption', `${history.ticker} supplied annual history — amounts in currency millions; scroll horizontally for all inputs and sources.`));
  const head = el('thead'), headings = el('tr');
  for (const title of ['Fiscal year end', 'Ticker', 'Company name', 'Sector', 'Currency', 'Revenue', 'Prior revenue', 'Net income', 'Gross debt', 'Equity', 'Declared-input growth', 'Net margin', 'Debt / equity', 'Original source']) {
    const cell = el('th', title); cell.scope = 'col'; headings.append(cell);
  }
  head.append(headings); table.append(head); const body = el('tbody');
  for (const period of history.periods) {
    const c = period.company, row = el('tr'); row.id = periodAnchor(c); row.dataset.fiscalDate = c.fiscalDate;
    const date = el('th', c.fiscalDate); date.scope = 'row'; row.append(date);
    for (const text of [c.ticker, c.name, c.sector, c.currency]) row.append(el('td', text));
    for (const key of ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'] as const) {
      const cell = el('td', c[key] === null ? 'Not supplied' : String(c[key])); cell.id = `${row.id}-${key}`; row.append(cell);
    }
    for (const key of ['growthPct', 'marginPct', 'debtEquity'] as const) {
      const value = period.derived[key]; row.append(el('td', value === null ? 'Undefined' : `${String(value)}${key === 'debtEquity' ? '' : '%'}`));
    }
    const source = el('td'); source.append(el('p', `${notebook!.dataset.fileName}:${c.sourceLine}`), sourceLink(c)); row.append(source); body.append(row);
  }
  table.append(body); scroll.append(table); section.append(scroll,
    el('p', 'Declared-input growth = 100 × (revenue − prior revenue) / prior revenue. Net margin = 100 × net income / revenue. Debt / equity = gross debt / equity. Missing inputs or a nonpositive denominator make a ratio undefined. Stored-row changes below use the preceding stored revenue, which can differ from declared prior revenue.', 'hint'));
  const comparisons = el('div'); comparisons.id = 'annual-comparisons'; comparisons.append(el('h3', 'Adjacent supplied-period changes'));
  if (!history.comparisons.length) comparisons.append(el('p', 'A second supplied period is needed for an adjacent comparison.', 'hint'));
  for (const pair of history.comparisons) comparisons.append(historicalComparison(pair));
  section.append(comparisons);
  const summaries = el('div', '', 'history-summaries'); summaries.id = 'annual-trends';
  summaries.append(el('h3', 'All-period direction summaries'), el('p', `All ${history.periods.length} supplied periods, ${first} to ${last}. These are retrospective descriptions, not strengths, forecasts or recommendations.`, 'hint'));
  const labels = { increasing: 'Increasing', decreasing: 'Decreasing', flat: 'Unchanged throughout', mixed: 'Mixed or unchanged intervals', unavailable: 'Unavailable' };
  for (const trend of history.trends) {
    const item = el('p'); item.dataset.metric = trend.metric; item.dataset.direction = trend.direction;
    item.append(el('strong', `${metricNames[trend.metric]}: ${labels[trend.direction]}`), document.createTextNode(` · ${trend.periodCount} supplied periods`));
    if (trend.reason) item.append(document.createTextNode(` · ${trend.reason}`)); summaries.append(item);
  }
  section.append(summaries); return section;
}
function renderDetail(day: string): void {
  if (!notebook || !selectedTicker) { detail.hidden = true; briefView.setState(notebook, null); return; } const company = latestCompanies(notebook.dataset.companies).find((c) => c.ticker === selectedTicker); if (!company) { selectedTicker = null; detail.hidden = true; return; }
  detail.hidden = false; detailContent.replaceChildren(el('h3', 'Latest supplied period'), facts(analyzeCompany(company, day)), annualHistory(analyzeCompanyHistory(notebook.dataset, selectedTicker, day))); const text = noteDrafts.get(selectedTicker) ?? notebook.notes.find((n) => n.ticker === selectedTicker)?.text ?? ''; if (noteInput.value !== text) noteInput.value = text; briefView.setState(notebook, selectedTicker);
}
function comparisonRemoveButton(ticker: string): HTMLButtonElement { const n = button('Remove from comparison', () => { toggleComparison(ticker); }); n.dataset.action = 'compare'; return n; }
function renderTabs(): void { for (const [key, b] of tabButtons) { const selected = key === activeTab; b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1; tabPanels.get(key)!.hidden = !selected; } }
tabs.addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; const keys = [...tabButtons.keys()]; const index = keys.indexOf(activeTab); activeTab = e.key === 'Home' ? keys[0]! : e.key === 'End' ? keys[keys.length - 1]! : keys[(index + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]!; e.preventDefault(); renderTabs(); tabButtons.get(activeTab)!.focus(); });
function renderNotebook(day: string): void {
  const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null; const focusedCard = focused?.closest<HTMLElement>('[data-ticker]'); const focusedPanel = focused?.closest<HTMLElement>('[role=tabpanel]'); const focusKey = focused?.dataset.action && focusedCard && focusedPanel ? { action: focused.dataset.action, ticker: focusedCard.dataset.ticker, panel: focusedPanel.id } : null;
  workspace.hidden = !notebook; empty.hidden = !!notebook; retryButton.hidden = !saveFailed; saveStrip.classList.toggle('unsaved', saveFailed); if (!notebook || !results) return; if (!titleDirty) titleInput.value = notebook.title; undoButton.disabled = !notebookHistory?.canUndo; redoButton.disabled = !notebookHistory?.canRedo;
  const ds = notebook.dataset; const current = latestCompanies(ds.companies); const currentByTicker = new Map(current.map(c => [c.ticker, c])); sourceText.textContent = `${ds.fileName} · ${ds.companies.length} annual rows · ${current.length} unique companies · imported ${ds.importedDate} · currency millions · annual 12-month basis`; syntheticLabel.hidden = !ds.synthetic;
  const screen = notebook.screen; appliedCriteria.replaceChildren(el('p', `Evaluated ${day} UTC · sector ${screen.sector ?? 'all'} · currency ${screen.currency ?? 'all'} · ${screen.includeStale ? 'including stale companies' : 'excluding fiscal periods older than 548 days'}`), ...screen.filters.map((f) => el('p', filterCaption(f))), el('p', `Sort: ${screen.sortBy === 'ticker' ? 'Ticker' : metricNames[screen.sortBy]} ${screen.direction}`, 'hint'));
  if (!screen.filters.length) appliedCriteria.append(el('p', 'No numeric predicates.', 'hint')); if (notebook.query) { appliedCriteria.append(el('p', `Last applied interpretation: ${notebook.query}`, 'hint')); try { if (JSON.stringify(parseQuery(notebook.query, ds).screen) !== JSON.stringify(screen)) appliedCriteria.append(el('p', 'Filters edited after interpretation', 'edited-label')); } catch { /* Validated notebooks have a fully consumed saved query. */ } }
  screenStatus.textContent = `${results.rows.length} matched · ${results.excludedStale} excluded as stale · ${results.excludedMissing} excluded with required metrics missing`;
  resultList.replaceChildren(...results.rows.map((row) => companyCard(row, day))); if (!results.rows.length) resultList.append(el('p', 'No companies match the applied criteria. Inspect missing/stale counts or Clear filters.', 'empty'));
  const excluded = auditScreen(ds, screen, day).filter(decision => !decision.matched);
  exclusionSummary.textContent = `${excluded.length} excluded companies · latest supplied periods only · every failed applied rule is shown. Multiple reasons can apply to one company; missing/stale summary counts use the first applicable gate. Draft filters do not affect this view.`;
  exclusionContent.replaceChildren(...excluded.map(decision => {
    const c = decision.row.company, card = el('article', '', 'company-card'); card.dataset.ticker = c.ticker;
    card.append(el('h3', `${c.ticker} · ${c.name}`), el('p', `${c.sector} · ${c.currency} · fiscal ${c.fiscalDate} · ${ds.fileName}:${c.sourceLine}`, 'hint'), sourceLink(c));
    const reasons = el('ul');
    for (const reason of decision.reasons) {
      const item = el('li'); item.append(el('p', reason.text), el('p', `Source fields: ${reason.fields.join(', ')} · ${ds.fileName}:${c.sourceLine}`, 'hint')); reasons.append(item);
    }
    const view = button('View excluded evidence', () => { openCompany(c.ticker); }); view.dataset.action = 'excluded-view';
    card.append(reasons, view); return card;
  }));
  if (!excluded.length) exclusionContent.append(el('p', 'No companies excluded by the applied criteria.', 'empty'));
  const comparison = compareCompanies(ds, notebook.comparison, day); comparisonContent.replaceChildren(...comparison.warnings.map((s) => el('p', s, 'warning'))); if (comparison.rows.length < 2) comparisonContent.append(el('p', 'Select at least two companies to compare, up to four. Selections remain manual research choices, including stale companies.', 'empty'));
  else { const grid = el('div', '', 'comparison-grid'); for (const row of comparison.rows) { const card = el('article', '', 'comparison-card'); card.dataset.ticker = row.company.ticker; card.append(el('h3', row.company.ticker), el('p', `${row.stale ? 'Stale' : 'Fresh'} fiscal period · ${ageInDays(row.company, day)} days old`, 'hint'), comparisonRemoveButton(row.company.ticker), button('View evidence', () => { openCompany(row.company.ticker); }), facts(row, 'comparison')); grid.append(card); } comparisonContent.append(grid); }
  watchlistContent.replaceChildren(...notebook.watchlist.map((ticker) => companyCard(analyzeCompany(currentByTicker.get(ticker)!, day), day))); if (!notebook.watchlist.length) watchlistContent.append(el('p', 'No watchlist companies yet. Add companies from the shortlist.', 'empty')); renderDetail(day); renderTabs();
  if (focusKey) { const candidate = document.getElementById(focusKey.panel)?.querySelector<HTMLButtonElement>(`[data-ticker="${focusKey.ticker}"] [data-action="${focusKey.action}"]`); (candidate ?? tabButtons.get(activeTab))?.focus({ preventScroll: true }); }
}
window.addEventListener('beforeunload', (e) => { if (loading || refreshPending || editorDrafts() || notebook && savedGeneration !== generation) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('keydown', (e) => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); });
async function start(): Promise<void> { const op = { id: ++operationSequence, intent: intentGeneration }; loading = op; try { const restored = await store.load(utcToday()); if (loading !== op || op.intent !== intentGeneration) return; loading = null; if (restored) publish(restored, true); } catch { if (loading === op && op.intent === intentGeneration) { loading = null; restoreFailed = true; recovery.hidden = false; announce('Saved notebook could not be restored. Its raw record is preserved. Download raw saved record or explicitly Reset saved record before starting over.', true); } } }
renderTabs(); void start();
