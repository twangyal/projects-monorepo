import { LIMITS } from './types.ts';
import type { AnnualCitation, AnnualSnapshot, Company, CompanyBrief, Dataset, Notebook } from './types.ts';
import { compareAnnualCitation, validateBriefs } from './brief.ts';
import { validateDataset, validateToday, requireValue } from './validation.ts';
import { validateNotebook } from './model.ts';

const annualFields = ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'] as const;
const sections = [['business', 'Business'], ['risks', 'Risks'], ['questions', 'Open questions']] as const;
const supplied = (value: string | number | boolean | null): string => value === null ? 'Not supplied' : String(value);
const provenance = (synthetic: boolean): string => synthetic
  ? 'Synthetic demonstration — not real companies or filings'
  : 'User-supplied data — not independently verified';

/** Count every emitted UTF-8 byte and its LF before retaining the complete line. */
function reportWriter(): { append: (...values: string[]) => void; lines: string[] } {
  const lines: string[] = [], encoder = new TextEncoder();
  let bytes = 0;
  function append(...values: string[]): void {
    for (const value of values) {
      const size = encoder.encode(value).length + 1;
      requireValue(bytes + size <= LIMITS.reportBytes,
        'The complete company brief report exceeds the 8 MiB text limit. No partial report was created; the complete notebook remains available in a JSON backup.');
      bytes += size;
      lines.push(value);
    }
  }
  return { append, lines };
}

/** Complete plain-text brief block; a fourth dataset compares a proposed refresh. */
export function briefReportLines(
  brief: CompanyBrief, dataset: Dataset, today: string, comparisonDataset?: Dataset,
): string[] {
  const date = validateToday(today), capturedUniverse = validateDataset(dataset, date);
  const currentUniverse = comparisonDataset === undefined ? capturedUniverse : validateDataset(comparisonDataset, date);
  const admitted = validateBriefs([brief], capturedUniverse, date)[0]!;
  const { append, lines } = reportWriter();
  function metadata(label: string, source: Dataset | AnnualSnapshot): void {
    const datasetId = 'datasetId' in source ? source.datasetId : source.id;
    append(`${label} dataset ID: ${datasetId}`, `${label} filename: ${source.fileName}`,
      `${label} import UTC date: ${source.importedDate}`, `${label} basis: ${source.basis}`,
      `${label} units: ${source.units}`, `${label} synthetic: ${source.synthetic}`,
      `${label} provenance: ${provenance(source.synthetic)}`);
  }
  function annualRow(label: string, company: Company, source: Dataset | AnnualSnapshot): void {
    append(label, `ticker: ${company.ticker}`, `name: ${company.name}`, `sector: ${company.sector}`,
      `currency: ${company.currency}`, `fiscalDate: ${company.fiscalDate}`,
      `Source row: ${source.fileName}:${company.sourceLine}`, `sourceLine: ${company.sourceLine}`,
      `Supplied filing URL: ${supplied(company.filingUrl)}`);
    for (const field of annualFields) {
      append(`${field}: ${supplied(company[field])}${company[field] === null ? '' : ` million ${company.currency}`}`);
    }
  }
  function annualSource(citation: AnnualCitation): void {
    const { snapshot, fields } = citation, captured = snapshot.company;
    const drift = compareAnnualCitation(citation, currentUniverse, date);
    append('Annual citation — supplied captured data, not independently verified',
      `Selected annual fields: ${fields.join(', ')}`,
      'Only selected financial fields are compared; unselected financial fields are not compared for drift.',
      'All unselected captured fields below are context, not additional supporting claims.');
    for (const field of fields) append(`Selected ${field}: ${supplied(captured[field])}${captured[field] === null ? '' : ` million ${captured.currency}`}`);
    metadata('Captured', snapshot);
    annualRow('Captured full annual row', captured, snapshot);
    append(`Current-source comparison: ${drift.state}`,
      `Selected fact changes: ${drift.factFields.join(', ') || 'None'}`,
      `Identity changes: ${drift.identityFields.join(', ') || 'None'}`,
      `Source changes: ${drift.sourceFields.join(', ') || 'None'}`);
    if (drift.current === null) {
      append('Exact captured annual period is missing in the comparison dataset. The captured evidence remains unchanged; no latest-row substitute is used.');
      return;
    }
    const current = drift.current;
    if (drift.state === 'same') append('Selected values and source metadata match the current row. Matching supplied values do not verify claims.');
    for (const field of drift.factFields) {
      append(`Selected fact ${field}: ${supplied(captured[field])} -> ${supplied(current[field])}; captured currency ${captured.currency}, current currency ${current.currency}; amounts in currency millions`);
    }
    for (const field of drift.identityFields) {
      const before = field === 'synthetic' ? snapshot.synthetic : captured[field];
      const after = field === 'synthetic' ? currentUniverse.synthetic : current[field];
      append(`Identity ${field}: ${supplied(before)} -> ${supplied(after)}`);
    }
    for (const field of drift.sourceFields) {
      const before = field === 'sourceLine' || field === 'filingUrl' ? captured[field] : snapshot[field];
      const after = field === 'sourceLine' || field === 'filingUrl' ? current[field]
        : field === 'datasetId' ? currentUniverse.id : currentUniverse[field];
      append(`Source ${field}: ${supplied(before)} -> ${supplied(after)}`);
    }
    annualRow('Current full annual row (exact captured ticker and fiscal date)', current, currentUniverse);
  }

  append(`Company brief: ${admitted.ticker}`, 'Your statements and supplied citations. Citations do not verify claims.',
    'User-authored research, not investment advice, issuer verification or an assessment of whether a source supports a statement.',
    `Comparison/evaluation UTC date: ${date}`);
  metadata('Comparison', currentUniverse);
  for (const [section, label] of sections) {
    append('', label);
    const statements = admitted.statements.filter(statement => statement.section === section);
    if (!statements.length) append('(No saved statements)');
    for (const statement of statements) {
      append(`Statement ID: ${statement.id}`, statement.text,
        statement.citationIds.length ? `Citation IDs: ${statement.citationIds.join(', ')}` : 'Uncited statement');
    }
  }
  append('', 'Supplied citation library (each saved source appears once)');
  if (!admitted.citations.length) append('(No saved citations)');
  for (const citation of admitted.citations) {
    append('', `Citation ID: ${citation.id}`);
    if (citation.kind === 'annual') annualSource(citation);
    else append('Supplied excerpt — not fetched or verified', `Source title: ${citation.title}`,
      `Source author: ${supplied(citation.author)}`, `Source publication date: ${supplied(citation.publishedDate)}`,
      `Supplied source HTTPS link: ${supplied(citation.url)}`, 'Full literal supplied excerpt:', citation.excerpt);
  }
  append('Captured and supplied content is retained literally. Backup fields are declared data, not proof of source authenticity or logical support.');
  return lines;
}

/** A bounded, complete report ending in LF; never mutates or fetches sources. */
export function buildCompanyBriefReport(notebook: Notebook, ticker: string, today: string): string {
  const date = validateToday(today), current = validateNotebook(notebook, date);
  requireValue(typeof ticker === 'string', 'Choose the exact ticker of an existing company brief.');
  const brief = current.briefs.find(item => item.ticker === ticker);
  requireValue(brief !== undefined, 'No saved company brief exists for that exact ticker.');
  const { append, lines } = reportWriter();
  append('Stock Notebook company brief report', `Notebook title: ${current.title}`,
    `Notebook ID: ${current.id}`, `Export/evaluation UTC date: ${date}`, '');
  for (const line of briefReportLines(brief, current.dataset, date)) append(line);
  return lines.join('\n') + '\n';
}
