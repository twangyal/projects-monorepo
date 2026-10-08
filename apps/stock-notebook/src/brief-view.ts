import { captureAnnualCitation, compareAnnualCitation, createExcerptCitation, removeBrief, updateBrief } from './brief.ts';
import { buildCompanyBriefReport } from './brief-report.ts';
import { BRIEF_LIMITS } from './types.ts';
import type { AnnualField, BriefCitation, BriefSection, CompanyBrief, Notebook } from './types.ts';

const fields: readonly AnnualField[] = ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'];
const names: Record<AnnualField, string> = { revenue: 'Revenue', priorRevenue: 'Prior revenue', netIncome: 'Net income', debt: 'Gross debt', equity: 'Equity' };
const sections: readonly [BriefSection, string][] = [['business', 'Business'], ['risks', 'Risks'], ['questions', 'Open questions']];
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
function action(text: string, id: string, run: () => void): HTMLButtonElement { const node = el('button', text); node.type = 'button'; if (id) node.id = id; node.addEventListener('click', run); return node; }
function field(parent: HTMLElement, id: string, caption: string, multiline = false): HTMLInputElement | HTMLTextAreaElement { const label = el('label', caption, 'field'); const node = multiline ? el('textarea') : el('input'); node.id = id; if (node instanceof HTMLTextAreaElement) node.rows = 4; label.append(node); parent.append(label); return node; }
function select(parent: HTMLElement, id: string, caption: string): HTMLSelectElement { const label = el('label', caption, 'field'), node = el('select'); node.id = id; label.append(node); parent.append(label); return node; }
function choice(parent: HTMLElement, caption: string, value: string): HTMLInputElement { const label = el('label', '', 'checkbox'), input = el('input'); input.type = 'checkbox'; input.value = value; label.append(input, el('span', caption)); parent.append(label); return input; }
function link(url: string): HTMLAnchorElement { const node = el('a', url); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; }
function title(citation: BriefCitation): string { return citation.kind === 'excerpt' ? citation.title : `${citation.snapshot.company.fiscalDate} · ${citation.fields.map(key => names[key]).join(', ')}`; }
interface Draft {
  statement: { id: string | null; section: BriefSection; text: string; citationIds: string[]; dirty: boolean };
  source: { title: string; author: string; date: string; url: string; excerpt: string; dirty: boolean };
  annual: { period: string; fields: AnnualField[]; dirty: boolean };
}
function emptyDraft(): Draft { return { statement: { id: null, section: 'business', text: '', citationIds: [], dirty: false }, source: { title: '', author: '', date: '', url: '', excerpt: '', dirty: false }, annual: { period: '', fields: [], dirty: false } }; }
function dirty(draft: Draft): boolean { return draft.statement.dirty || draft.source.dirty || draft.annual.dirty; }
interface Callbacks {
  notebook: () => Notebook | null;
  receipt: () => string;
  intent: () => void;
  changed: () => void;
  commit: (briefs: CompanyBrief[], day: string) => void;
  download: (text: string, name: string, mime: string) => void;
}
export function mountBriefView(parent: HTMLElement, callbacks: Callbacks) {
  const root = el('section', '', 'company-brief'); root.id = 'company-brief'; root.hidden = true; parent.append(root);
  const heading = el('h3', 'Company brief'); root.append(heading, el('p', 'Your statements and supplied citations. Citations do not verify claims.', 'notice'));
  const saved = el('div', '', 'brief-statements'); root.append(saved);
  const statementForm = el('form', '', 'brief-form'); statementForm.noValidate = true;
  const section = select(statementForm, 'brief-section', 'Statement section'); for (const [value, caption] of sections) { const option = el('option', caption); option.value = value; section.append(option); }
  const text = field(statementForm, 'brief-text', 'Statement text', true) as HTMLTextAreaElement;
  const options = el('fieldset'); options.id = 'brief-citation-options'; options.append(el('legend', 'Explicit citation attachments')); statementForm.append(options);
  const save = action('Save statement', 'brief-save-statement', () => {}); save.type = 'submit'; save.className = 'primary';
  statementForm.append(save, action('Cancel statement edit', 'brief-cancel-statement', cancelStatement)); statementForm.addEventListener('submit', event => { event.preventDefault(); saveStatement(); }); root.append(statementForm);
  const sourceForm = el('form', '', 'brief-form'); sourceForm.noValidate = true; sourceForm.append(el('h4', 'Add a supplied source'));
  const sourceTitle = field(sourceForm, 'brief-source-title', 'Source title') as HTMLInputElement;
  const author = field(sourceForm, 'brief-source-author', 'Source author (optional)') as HTMLInputElement;
  const date = field(sourceForm, 'brief-source-date', 'Source date (optional)') as HTMLInputElement; date.placeholder = 'YYYY-MM-DD';
  const url = field(sourceForm, 'brief-source-url', 'Source HTTPS link (optional)') as HTMLInputElement;
  const excerpt = field(sourceForm, 'brief-source-excerpt', 'Supplied excerpt', true) as HTMLTextAreaElement;
  const addExcerpt = action('Add excerpt citation', 'brief-add-excerpt', () => {}); addExcerpt.type = 'submit'; sourceForm.append(addExcerpt); sourceForm.addEventListener('submit', event => { event.preventDefault(); saveSource(); }); root.append(sourceForm);
  const annualForm = el('form', '', 'brief-form'); annualForm.append(el('h4', 'Capture supplied annual fields'));
  const period = select(annualForm, 'brief-period', 'Annual period to cite');
  const annualFields = el('fieldset'); annualFields.id = 'brief-fields'; annualFields.append(el('legend', 'Raw annual fields to cite')); const fieldInputs = fields.map(key => [key, choice(annualFields, names[key], key)] as const); annualForm.append(annualFields);
  const addAnnual = action('Capture annual fields', 'brief-add-annual', () => {}); addAnnual.type = 'submit'; annualForm.append(addAnnual); annualForm.addEventListener('submit', event => { event.preventDefault(); saveAnnual(); }); root.append(annualForm);
  const library = el('div'); library.id = 'brief-citations'; root.append(library);
  const controls = el('div', '', 'brief-actions'); const deleteButton = action('Delete brief', 'brief-delete', deleteBrief); const exportButton = action('Download company brief', 'brief-download', exportBrief); controls.append(deleteButton, action('Discard brief drafts', 'brief-discard-drafts', discard), exportButton); root.append(controls);
  const status = el('p', '', 'brief-status'); status.id = 'brief-status'; status.setAttribute('aria-live', 'polite'); root.append(status);
  const drafts = new Map<string, Draft>(); let ticker: string | null = null; let optionKey = ''; let periodKey = '';
  function day(): string { return new Date().toISOString().slice(0, 10); }
  function currentDraft(): Draft | null { if (!ticker) return null; let draft = drafts.get(ticker); if (!draft) { draft = emptyDraft(); drafts.set(ticker, draft); } return draft; }
  function brief(): CompanyBrief | null { return callbacks.notebook()?.briefs.find(item => item.ticker === ticker) ?? null; }
  function say(message: string, error = false): void { status.textContent = message; status.classList.toggle('error', error); }
  function inputStatement(): void { const draft = currentDraft(); if (!draft) return; const checked = Array.from(options.querySelectorAll<HTMLInputElement>('input:checked'), node => node.value); draft.statement = { ...draft.statement, section: section.value as BriefSection, text: text.value, citationIds: [...draft.statement.citationIds.filter(id => checked.includes(id)), ...checked.filter(id => !draft.statement.citationIds.includes(id))], dirty: true }; callbacks.intent(); }
  statementForm.addEventListener('input', inputStatement); statementForm.addEventListener('change', inputStatement);
  function inputSource(): void { const draft = currentDraft(); if (!draft) return; draft.source = { title: sourceTitle.value, author: author.value, date: date.value, url: url.value, excerpt: excerpt.value, dirty: true }; callbacks.intent(); }
  sourceForm.addEventListener('input', inputSource); sourceForm.addEventListener('change', inputSource);
  function inputAnnual(): void { const draft = currentDraft(); if (!draft) return; draft.annual = { period: period.value, fields: fieldInputs.filter(([, input]) => input.checked).map(([key]) => key), dirty: true }; callbacks.intent(); }
  annualForm.addEventListener('input', inputAnnual); annualForm.addEventListener('change', inputAnnual);
  function value(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, next: string): void { if (node.value !== next) node.value = next; }
  function syncForms(): void {
    const draft = currentDraft(); if (!draft) return;
    value(section, draft.statement.section); value(text, draft.statement.text);
    value(sourceTitle, draft.source.title); value(author, draft.source.author); value(date, draft.source.date); value(url, draft.source.url); value(excerpt, draft.source.excerpt);
    value(period, draft.annual.period); for (const [key, input] of fieldInputs) input.checked = draft.annual.fields.includes(key);
    for (const input of options.querySelectorAll<HTMLInputElement>('input')) input.checked = draft.statement.citationIds.includes(input.value);
  }
  function update(next: CompanyBrief, today: string): void { const notebook = callbacks.notebook(); if (!notebook) throw new Error('Open a notebook first.'); callbacks.commit(updateBrief(notebook.briefs, next, notebook.dataset, today), today); }
  function failure(error: unknown): void { say(`${error instanceof Error && error.message.length <= 240 ? error.message : 'Brief edit rejected.'} Your draft, saved evidence and history were kept.`, true); }
  function saveStatement(): void {
    const draft = currentDraft(), notebook = callbacks.notebook(); if (!draft || !notebook || !ticker) return; callbacks.intent(); const today = day();
    try {
      if (draft.statement.text.length > BRIEF_LIMITS.statementCharacters * 2) throw new Error('Statement text exceeds 1200 Unicode characters.');
      const submitted = structuredClone(draft.statement), next = structuredClone(brief() ?? { ticker, statements: [], citations: [] });
      const item = { id: submitted.id ?? crypto.randomUUID(), section: submitted.section, text: submitted.text, citationIds: submitted.citationIds };
      if (submitted.id) { const index = next.statements.findIndex(row => row.id === submitted.id); if (index < 0) throw new Error('The edited statement is no longer present.'); next.statements[index] = item; } else next.statements.push(item);
      update(next, today); if (JSON.stringify(draft.statement) === JSON.stringify(submitted)) draft.statement = emptyDraft().statement;
      syncForms(); render(); callbacks.changed(); say('Statement saved. Attachments are explicit citations, not verification. Local save status is shown above.');
    } catch (error) { failure(error); }
  }
  function saveSource(): void {
    const draft = currentDraft(); if (!draft || !ticker) return; callbacks.intent();
    try {
      const submitted = { ...draft.source }; if (submitted.title.length > BRIEF_LIMITS.titleCharacters * 2 || submitted.author.length > BRIEF_LIMITS.authorCharacters * 2 || submitted.excerpt.length > BRIEF_LIMITS.excerptCharacters * 2) throw new Error('Source text exceeds its Unicode character limit.');
      const today = day(), citation = createExcerptCitation({ title: submitted.title, author: submitted.author || null, publishedDate: submitted.date || null, url: submitted.url || null, excerpt: submitted.excerpt }, today);
      const next = structuredClone(brief() ?? { ticker, statements: [], citations: [] }); next.citations.push(citation); update(next, today);
      if (JSON.stringify(draft.source) === JSON.stringify(submitted)) draft.source = emptyDraft().source;
      syncForms(); render(); callbacks.changed(); say('Excerpt citation added to the source library. Choose its attachment explicitly when saving a statement.');
    } catch (error) { failure(error); }
  }
  function saveAnnual(): void {
    const draft = currentDraft(), notebook = callbacks.notebook(); if (!draft || !ticker || !notebook) return; callbacks.intent();
    try { const submitted = structuredClone(draft.annual), today = day(); const citation = captureAnnualCitation(notebook.dataset, ticker, submitted.period, submitted.fields, today); const next = structuredClone(brief() ?? { ticker, statements: [], citations: [] }); next.citations.push(citation); update(next, today); if (JSON.stringify(draft.annual) === JSON.stringify(submitted)) { draft.annual.fields = []; draft.annual.dirty = false; } syncForms(); render(); callbacks.changed(); say('Annual snapshot captured. Only the selected raw fields are cited; attachments remain your explicit choice.'); } catch (error) { failure(error); }
  }
  function cancelStatement(): void { const draft = currentDraft(); if (!draft) return; callbacks.intent(); draft.statement = emptyDraft().statement; syncForms(); callbacks.changed(); say('Statement draft canceled. Saved statements and source drafts were kept.'); }
  function block(): boolean { if (currentDraft() && dirty(currentDraft()!)) { say('Apply, Cancel or Discard brief drafts before deleting evidence or changing its history.', true); return true; } return false; }
  function editStatement(id: string): void { const draft = currentDraft(); if (!draft) return; callbacks.intent(); if (draft.statement.dirty) { say('Save or Cancel the current statement draft before editing another statement.', true); return; } const item = brief()?.statements.find(row => row.id === id); if (!item) return; draft.statement = { ...structuredClone(item), dirty: true }; syncForms(); text.focus(); say('Editing the saved statement. Sources remain immutable.'); }
  function deleteStatement(id: string): void { callbacks.intent(); if (block()) return; const next = structuredClone(brief()); if (!next) return; next.statements = next.statements.filter(item => item.id !== id); if (!next.statements.length && !next.citations.length) { say('This is the final item. Use Delete brief to remove the complete brief explicitly.', true); return; } try { update(next, day()); say('Statement deleted. Its sources remain in the library.'); } catch (error) { failure(error); } }
  function deleteCitation(id: string): void { callbacks.intent(); if (block()) return; const next = structuredClone(brief()); if (!next) return; const count = next.statements.filter(item => item.citationIds.includes(id)).length; if (count) { say(`Citation is attached to ${count} statement${count === 1 ? '' : 's'}. Edit those attachments first; the source was kept.`, true); return; } next.citations = next.citations.filter(item => item.id !== id); if (!next.statements.length && !next.citations.length) { say('This is the final item. Use Delete brief to remove the complete brief explicitly.', true); return; } try { update(next, day()); say('Unreferenced citation deleted. Other evidence was kept.'); } catch (error) { failure(error); } }
  function deleteBrief(): void { callbacks.intent(); if (block()) return; const current = brief(), notebook = callbacks.notebook(); if (!current || !notebook) return; const today = day(), receipt = callbacks.receipt(); if (!confirm(`Delete the complete ${current.ticker} brief: ${current.statements.length} statements and ${current.citations.length} citations? Other research stays intact. Undo can restore this edit.`)) return; if (day() !== today || callbacks.receipt() !== receipt) { say('The editor changed during confirmation. Nothing was deleted.', true); return; } try { callbacks.commit(removeBrief(notebook.briefs, current.ticker, notebook.dataset, today), today); say('Complete brief deleted. Other research was kept; Undo restores the brief.'); } catch (error) { failure(error); } }
  function discard(): void { const draft = currentDraft(); if (!draft || !dirty(draft)) return; const receipt = callbacks.receipt(), today = day(), selected = ticker; if (!confirm(`Discard all unsent statement, citation, excerpt and annual-field drafts for ${ticker}? Saved evidence is kept.`)) return; if (receipt !== callbacks.receipt() || today !== day() || selected !== ticker) return; callbacks.intent(); drafts.delete(ticker!); syncForms(); callbacks.changed(); say('Brief drafts discarded. Committed statements and citations were kept.'); }
  function exportBrief(): void { const notebook = callbacks.notebook(); if (!notebook || !ticker) return; try { callbacks.download(buildCompanyBriefReport(notebook, ticker, day()), `stock-notebook-${ticker}-brief.txt`, 'text/plain;charset=utf-8'); say('Company brief downloaded from committed evidence. Unsent drafts are not included.'); } catch (error) { failure(error); } }
  function renderCitation(citation: BriefCitation, notebook: Notebook, today: string): HTMLElement {
    const card = el('article', '', 'brief-citation'); card.dataset.briefCitation = citation.id; card.id = `brief-citation-${citation.id}`; card.append(el('h5', title(citation)));
    const inspection = el('details'); inspection.append(el('summary', 'Inspect citation'));
    if (citation.kind === 'excerpt') {
      card.append(el('p', 'Supplied excerpt — not fetched or verified', 'hint'));
      inspection.append(el('p', `Citation ID: ${citation.id}`), el('p', `Author: ${citation.author ?? 'Unknown'} · Publication date: ${citation.publishedDate ?? 'Unknown'}`), el('pre', citation.excerpt, 'brief-literal')); if (citation.url) inspection.append(link(citation.url));
    } else {
      const snapshot = citation.snapshot, company = snapshot.company, drift = compareAnnualCitation(citation, notebook.dataset, today); card.dataset.citationState = drift.state;
      card.append(el('p', drift.state === 'same' ? 'Selected values and source metadata match the current row' : drift.state === 'missing' ? 'Captured annual period is missing from the current dataset' : 'Captured values or source metadata differ from the current row', 'hint'));
      card.append(el('p', 'Comparison covers only selected financial fields plus issuer identity and source metadata. Unselected raw amounts are context, not cited claims.', 'hint'));
      const current = drift.current;
      const categories = [ ['Selected financial differences', drift.factFields, (key: string) => [company[key as AnnualField], current?.[key as AnnualField]]], ['Identity differences', drift.identityFields, (key: string) => key === 'synthetic' ? [snapshot.synthetic, notebook.dataset.synthetic] : [company[key as 'name' | 'sector' | 'currency'], current?.[key as 'name' | 'sector' | 'currency']]], ['Source differences', drift.sourceFields, (key: string) => key === 'sourceLine' || key === 'filingUrl' ? [company[key], current?.[key]] : [snapshot[key as 'datasetId' | 'fileName' | 'importedDate'], key === 'datasetId' ? notebook.dataset.id : notebook.dataset[key as 'fileName' | 'importedDate']]] ] as const;
      for (const [caption, keys, values] of categories) { const group = el('div', '', 'brief-differences'); group.append(el('h6', caption)); const list = el('ul'); for (const key of keys) { const [captured, now] = values(key); list.append(el('li', `${key}: captured ${captured === null ? 'Not supplied' : String(captured)} → current ${now === null ? 'Not supplied' : String(now)}`)); } if (!keys.length) list.append(el('li', 'None')); group.append(list); card.append(group); }
      inspection.append(el('p', `Citation ID: ${citation.id}`), el('p', `Captured import: ${snapshot.datasetId} · ${snapshot.fileName}:${company.sourceLine} · imported ${snapshot.importedDate}`), el('p', `Basis: ${snapshot.basis} · units: ${snapshot.units} · synthetic: ${snapshot.synthetic}`), el('p', `${company.ticker} · ${company.name} · ${company.sector} · ${company.currency} · fiscal ${company.fiscalDate}`), el('p', `Selected raw fields: ${citation.fields.join(', ')}`));
      const values = el('dl'); for (const key of fields) values.append(el('dt', names[key]), el('dd', company[key] === null ? 'Not supplied' : String(company[key]))); inspection.append(values); if (company.filingUrl) inspection.append(link(company.filingUrl)); else inspection.append(el('p', 'No captured filing link supplied.'));
    }
    card.append(inspection, action('Delete citation', '', () => { deleteCitation(citation.id); })); return card;
  }
  function render(): void {
    const notebook = callbacks.notebook(), draft = currentDraft(); if (!notebook || !ticker || !draft) { root.hidden = true; return; } root.hidden = false; heading.textContent = `Company brief · ${ticker}`;
    const current = brief(), citations = current?.citations ?? []; saved.replaceChildren();
    for (const [value, caption] of sections) { const group = el('section'); group.append(el('h4', caption)); const rows = current?.statements.filter(item => item.section === value) ?? []; if (!rows.length) group.append(el('p', 'No saved statements.', 'hint')); for (const item of rows) { const row = el('article', '', 'brief-statement'); row.dataset.briefStatement = item.id; row.dataset.section = item.section; row.append(el('p', item.text, 'brief-literal')); if (!item.citationIds.length) row.append(el('p', 'Uncited statement', 'hint')); else { const attachments = el('p', 'Explicit citations: '); item.citationIds.forEach((id, index) => { if (index) attachments.append(document.createTextNode(' · ')); const source = citations.find(citation => citation.id === id); const anchor = el('a', source ? title(source) : id); anchor.href = `#brief-citation-${id}`; attachments.append(anchor); }); row.append(attachments); } row.append(action('Edit statement', '', () => { editStatement(item.id); }), action('Delete statement', '', () => { deleteStatement(item.id); })); group.append(row); } saved.append(group); }
    const nextOptionKey = JSON.stringify(citations.map(item => [item.id, title(item)])); if (nextOptionKey !== optionKey) { optionKey = nextOptionKey; options.replaceChildren(el('legend', 'Explicit citation attachments')); for (const citation of citations) { const input = choice(options, title(citation), citation.id); input.checked = draft.statement.citationIds.includes(citation.id); } if (!citations.length) options.append(el('p', 'No saved citations. An uncited statement is permitted.', 'hint')); }
    const dates = notebook.dataset.companies.filter(company => company.ticker === ticker).map(company => company.fiscalDate).sort(); const nextPeriodKey = JSON.stringify([ticker, dates]); if (nextPeriodKey !== periodKey) { periodKey = nextPeriodKey; period.replaceChildren(); for (const date of dates) { const option = el('option', date); option.value = date; period.append(option); } if (!draft.annual.period) draft.annual.period = dates[0] ?? ''; period.value = draft.annual.period; }
    const today = day(); library.replaceChildren(el('h4', 'Source library'), ...citations.map(citation => renderCitation(citation, notebook, today))); if (!citations.length) library.append(el('p', 'No saved citations.', 'hint')); deleteButton.disabled = !current; exportButton.disabled = !current;
  }
  return {
    setState(_notebook: Notebook | null, selected: string | null): void { const changed = ticker !== selected; ticker = selected; if (changed) { optionKey = ''; periodKey = ''; status.textContent = ''; } render(); if (changed) syncForms(); },
    hasDrafts(): boolean { return [...drafts.values()].some(dirty); },
    clearDrafts(): void { drafts.clear(); optionKey = ''; periodKey = ''; ticker = null; root.hidden = true; },
    guardHistory(): boolean { if (![...drafts.values()].some(dirty)) return true; say('Apply, Cancel or Discard brief drafts before Undo or Redo. Drafts in other companies are kept too.', true); return false; },
  };
}
