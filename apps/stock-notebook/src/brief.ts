import {
  BRIEF_LIMITS, type AnnualCitation, type AnnualField, type AnnualSnapshot,
  type BriefCitation, type BriefIdentityField, type BriefSection, type BriefSourceField,
  type BriefStatement, type CitationDrift, type CompanyBrief, type Dataset, type ExcerptCitation,
} from './types.ts';
import {
  boundedArray, dataObject, requireValue, validateDataset, validateSourceUrl,
  validateToday, validateUnicode, validateUuid,
} from './validation.ts';

const ANNUAL_FIELDS: AnnualField[] = ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'];
const SECTIONS: BriefSection[] = ['business', 'risks', 'questions'];
const encoder = new TextEncoder();

function literal(value: unknown, maximum: number, multiline = false): string {
  requireValue(typeof value === 'string' && value.length <= maximum * 2, 'Supplied text exceeds its character limit.');
  validateUnicode(multiline ? value.replace(/\r\n/g, '\n') : value, multiline ? 'notes' : 'none');
  requireValue(value.trim().length > 0 && [...value].length <= maximum, 'Supply nonblank text within its character limit.');
  return value;
}

function selectedFields(value: unknown): AnnualField[] {
  const fields = boundedArray(value, ANNUAL_FIELDS.length, 1);
  requireValue(fields.every(field => typeof field === 'string' && ANNUAL_FIELDS.includes(field as AnnualField))
    && new Set(fields).size === fields.length, 'Choose distinct raw annual fields.');
  return ANNUAL_FIELDS.filter(field => fields.includes(field));
}

function snapshot(value: unknown, today: string): AnnualSnapshot {
  const fields = dataObject(value, ['datasetId', 'fileName', 'importedDate', 'basis', 'units', 'synthetic', 'company']);
  const data = validateDataset({ id: fields.datasetId, fileName: fields.fileName, importedDate: fields.importedDate,
    basis: fields.basis, units: fields.units, synthetic: fields.synthetic, companies: [fields.company] }, today);
  return { datasetId: data.id, fileName: data.fileName, importedDate: data.importedDate,
    basis: data.basis, units: data.units, synthetic: data.synthetic, company: data.companies[0] };
}

function excerptFields(input: unknown, today: string): Omit<ExcerptCitation, 'id' | 'kind'> {
  const fields = dataObject(input, ['title', 'author', 'publishedDate', 'url', 'excerpt']);
  const publishedDate = fields.publishedDate === null ? null : validateToday(fields.publishedDate);
  requireValue(publishedDate === null || publishedDate <= today, 'Source publication date cannot be in the future.');
  return { title: literal(fields.title, BRIEF_LIMITS.titleCharacters),
    author: fields.author === null ? null : literal(fields.author, BRIEF_LIMITS.authorCharacters),
    publishedDate, url: validateSourceUrl(fields.url), excerpt: literal(fields.excerpt, BRIEF_LIMITS.excerptCharacters, true) };
}

function citation(value: unknown, today: string): BriefCitation {
  // Read a discriminator only through its descriptor; rejected accessors must
  // never execute before the exact-key validator gets a chance to reject them.
  requireValue(value !== null && typeof value === 'object', 'Expected a citation data object.');
  const kind = Object.getOwnPropertyDescriptor(value, 'kind');
  requireValue(kind && 'value' in kind && (kind.value === 'annual' || kind.value === 'excerpt'), 'Unsupported citation kind.');
  if (kind.value === 'annual') {
    const fields = dataObject(value, ['id', 'kind', 'fields', 'snapshot']);
    return { id: validateUuid(fields.id), kind: 'annual', fields: selectedFields(fields.fields), snapshot: snapshot(fields.snapshot, today) };
  }
  const fields = dataObject(value, ['id', 'kind', 'title', 'author', 'publishedDate', 'url', 'excerpt']);
  return { id: validateUuid(fields.id), kind: 'excerpt', ...excerptFields({ title: fields.title, author: fields.author,
    publishedDate: fields.publishedDate, url: fields.url, excerpt: fields.excerpt }, today) };
}

function statement(value: unknown): BriefStatement {
  const fields = dataObject(value, ['id', 'section', 'text', 'citationIds']);
  requireValue(typeof fields.section === 'string' && SECTIONS.includes(fields.section as BriefSection), 'Choose Business, Risks or Open questions.');
  const citationIds = boundedArray(fields.citationIds, BRIEF_LIMITS.citationsPerStatement).map(validateUuid);
  requireValue(new Set(citationIds).size === citationIds.length, 'Attach each citation at most once to a statement.');
  return { id: validateUuid(fields.id), section: fields.section as BriefSection,
    text: literal(fields.text, BRIEF_LIMITS.statementCharacters, true), citationIds };
}

export function validateBriefs(value: unknown, dataset: Dataset, today: string): CompanyBrief[] {
  const data = validateDataset(dataset, today), known = new Set(data.companies.map(row => row.ticker));
  const ids = new Set<string>(), tickers = new Set<string>();
  let totalCitations = 0;
  function addId(id: string): void {
    requireValue(!ids.has(id), 'Statement and citation IDs must be globally distinct.'); ids.add(id);
  }
  const briefs: CompanyBrief[] = boundedArray(value, BRIEF_LIMITS.briefs).map(item => {
    const fields = dataObject(item, ['ticker', 'statements', 'citations']);
    requireValue(typeof fields.ticker === 'string' && known.has(fields.ticker) && !tickers.has(fields.ticker), 'Briefs require distinct current dataset tickers.');
    tickers.add(fields.ticker);
    const incoming = boundedArray(fields.citations, BRIEF_LIMITS.citationsPerBrief);
    totalCitations += incoming.length;
    requireValue(totalCitations <= BRIEF_LIMITS.totalCitations, 'Use at most 100 citations across the notebook.');
    const citations = incoming.map(item => citation(item, today));
    const local = new Set(citations.map(item => item.id));
    for (const item of citations) {
      addId(item.id);
      requireValue(item.kind !== 'annual' || item.snapshot.company.ticker === fields.ticker, 'Annual citation ticker must match its company brief.');
    }
    const statements = boundedArray(fields.statements, BRIEF_LIMITS.statementsPerBrief).map(statement);
    for (const item of statements) {
      addId(item.id);
      requireValue(item.citationIds.every(id => local.has(id)), 'Every attached citation must exist in this company brief.');
    }
    requireValue(statements.length + citations.length > 0, 'Use Delete brief to remove the final statement or citation.');
    return { ticker: fields.ticker, statements, citations };
  });
  briefs.sort((a, b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
  requireValue(encoder.encode(JSON.stringify(briefs)).length <= BRIEF_LIMITS.bytes, 'Company briefs exceed the 1 MiB evidence limit.');
  return briefs;
}

export function createExcerptCitation(input: { title: string; author: string | null; publishedDate: string | null; url: string | null; excerpt: string }, today: string): ExcerptCitation {
  validateToday(today);
  const fields = excerptFields(input, today);
  return { id: crypto.randomUUID(), kind: 'excerpt', ...fields };
}

export function captureAnnualCitation(dataset: Dataset, ticker: string, fiscalDate: string, fields: AnnualField[], today: string): AnnualCitation {
  const data = validateDataset(dataset, today), selected = selectedFields(fields);
  validateToday(fiscalDate);
  const row = data.companies.find(row => row.ticker === ticker && row.fiscalDate === fiscalDate);
  requireValue(row, 'Choose an exact ticker and annual period from the current dataset.');
  return { id: crypto.randomUUID(), kind: 'annual', fields: selected,
    snapshot: { datasetId: data.id, fileName: data.fileName, importedDate: data.importedDate,
      basis: data.basis, units: data.units, synthetic: data.synthetic, company: row } };
}

export function updateBrief(briefs: CompanyBrief[], next: CompanyBrief, dataset: Dataset, today: string): CompanyBrief[] {
  const current = validateBriefs(briefs, dataset, today);
  const fields = dataObject(next, ['ticker', 'statements', 'citations']);
  const incoming = boundedArray(fields.citations, BRIEF_LIMITS.citationsPerBrief).map(item => citation(item, today));
  const previous = current.find(item => item.ticker === fields.ticker);
  if (previous) for (const old of previous.citations) {
    const replacement = incoming.find(item => item.id === old.id);
    if (replacement) requireValue(JSON.stringify(replacement) === JSON.stringify(old), 'Saved citations are immutable. Add a replacement citation instead.');
    else {
      const references = previous.statements.filter(item => item.citationIds.includes(old.id)).length;
      requireValue(references === 0, `This citation is attached to ${references} statement${references === 1 ? '' : 's'}. Detach it before deleting it.`);
    }
  }
  return validateBriefs([...current.filter(item => item.ticker !== fields.ticker), next], dataset, today);
}

export function removeBrief(briefs: CompanyBrief[], ticker: string, dataset: Dataset, today: string): CompanyBrief[] {
  const current = validateBriefs(briefs, dataset, today);
  requireValue(current.some(item => item.ticker === ticker), 'This company does not have a saved brief.');
  return current.filter(item => item.ticker !== ticker);
}

export function compareAnnualCitation(value: AnnualCitation, dataset: Dataset, today: string): CitationDrift {
  const source = citation(value, today), data = validateDataset(dataset, today);
  requireValue(source.kind === 'annual', 'Current-row comparison requires an annual citation.');
  const captured = source.snapshot, old = captured.company;
  const current = data.companies.find(row => row.ticker === old.ticker && row.fiscalDate === old.fiscalDate) ?? null;
  if (!current) return { state: 'missing', factFields: [], identityFields: [], sourceFields: [], current: null };
  const factFields = source.fields.filter(field => old[field] !== current[field]);
  const identityFields: BriefIdentityField[] = (['name', 'sector', 'currency'] as const).filter(field => old[field] !== current[field]);
  if (captured.synthetic !== data.synthetic) identityFields.push('synthetic');
  const sourceFields: BriefSourceField[] = [];
  if (captured.datasetId !== data.id) sourceFields.push('datasetId');
  if (captured.fileName !== data.fileName) sourceFields.push('fileName');
  if (captured.importedDate !== data.importedDate) sourceFields.push('importedDate');
  if (old.sourceLine !== current.sourceLine) sourceFields.push('sourceLine');
  if (old.filingUrl !== current.filingUrl) sourceFields.push('filingUrl');
  return { state: factFields.length + identityFields.length + sourceFields.length ? 'changed' : 'same',
    factFields, identityFields, sourceFields, current };
}
