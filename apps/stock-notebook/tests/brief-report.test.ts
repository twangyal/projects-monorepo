import assert from 'node:assert/strict';
import test from 'node:test';
import { briefReportLines, buildCompanyBriefReport } from '../src/brief-report.ts';
import { buildReport } from '../src/exports.ts';
import { buildRefreshReport } from '../src/refresh-report.ts';
import { serializeNotebook } from '../src/model.ts';
import { LIMITS } from '../src/types.ts';
import type { AnnualCitation, Company, CompanyBrief, Dataset, Notebook } from '../src/types.ts';

const today = '2026-10-04';
const id = (number: number): string => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const statementText = '  <b>Authored, not verified</b>\r\nLiteral 😀\tend  ';
const excerptText = '  Supplied quotation <script>literal</script>\r\n😀\tNo inference.  ';
function row(ticker = 'AAA', sourceLine = 2): Company {
  return { ticker, name: `Original ${ticker}`, sector: 'Software', currency: 'USD', fiscalDate: '2025-06-30',
    revenue: null, priorRevenue: 27, netIncome: -0.000001, debt: 0, equity: -2,
    filingUrl: 'https://example.com/filing?literal=1', sourceLine };
}
function dataset(): Dataset {
  return { id: id(2), fileName: 'captured.csv', importedDate: '2026-10-03',
    basis: 'annual-12-month', units: 'currency-millions', synthetic: false,
    companies: [row(), { ...row('AAA', 3), fiscalDate: '2026-06-30', revenue: 900 }, row('BBB', 4)] };
}
function annual(ticker = 'AAA', citationId = 11): AnnualCitation {
  const data = dataset();
  return { id: id(citationId), kind: 'annual', fields: ['revenue', 'debt'],
    snapshot: { datasetId: data.id, fileName: data.fileName, importedDate: data.importedDate,
      basis: data.basis, units: data.units, synthetic: data.synthetic,
      company: { ...data.companies.find(company => company.ticker === ticker)! } } };
}
function brief(ticker = 'AAA', offset = 0): CompanyBrief {
  return { ticker, statements: [
    { id: id(20 + offset), section: 'risks', text: statementText, citationIds: [id(10 + offset), id(11 + offset)] },
    { id: id(21 + offset), section: 'business', text: 'Business first by section', citationIds: [] },
    { id: id(22 + offset), section: 'questions', text: 'What remains unknown?', citationIds: [id(11 + offset)] },
  ], citations: [
    { id: id(10 + offset), kind: 'excerpt', title: '  Supplied source 😀  ', author: 'Exact author',
      publishedDate: '2025-01-01', url: 'https://example.com/excerpt?x=1', excerpt: excerptText },
    annual(ticker, 11 + offset),
  ] };
}
function notebook(): Notebook {
  return { schemaVersion: 3, id: id(1), title: 'Literal research notebook', dataset: dataset(), query: '',
    screen: { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' },
    watchlist: [], comparison: [], notes: [{ ticker: 'AAA', text: 'Old note\nStill retained' }], briefs: [brief()] };
}
function block(data = dataset(), evidence = brief(), incoming?: Dataset): string {
  return briefReportLines(evidence, data, today, incoming).join('\n') + '\n';
}

test('complete standalone report preserves literal author text and source bytes without markup interpretation', () => {
  const input = notebook(), before = JSON.stringify(input);
  const report = buildCompanyBriefReport(input, 'AAA', today);
  for (const literal of [statementText, excerptText, '  Supplied source 😀  ', 'Exact author', '2025-01-01',
    'https://example.com/excerpt?x=1', input.title, input.id, today]) assert.ok(report.includes(literal), literal);
  assert.ok(report.endsWith('\n'));
  assert.match(report, /Citations do not verify claims/i);
  assert.match(report, /Supplied excerpt.*not fetched or verified/i);
  assert.equal(JSON.stringify(input), before);
});

test('saved sections are readable in order and every citation library entry appears exactly once', () => {
  const report = block();
  assert.ok(report.indexOf('Business\n') < report.indexOf('Risks\n'));
  assert.ok(report.indexOf('Risks\n') < report.indexOf('Open questions\n'));
  assert.match(report, /Uncited statement/);
  for (const number of [10, 11]) assert.equal(report.split(`Citation ID: ${id(number)}\n`).length - 1, 1);
  for (const number of [20, 21, 22]) assert.ok(report.includes(id(number)));
  assert.ok(report.includes(`Citation IDs: ${id(10)}, ${id(11)}`));
});

test('annual sources report selected fields separately from the complete exact captured row', () => {
  const report = block();
  for (const literal of ['Selected annual fields: revenue, debt', 'captured.csv:2', id(2), '2026-10-03',
    '2025-06-30', 'annual-12-month', 'currency-millions', 'USD', 'Original AAA', 'Software',
    'revenue: Not supplied', 'priorRevenue: 27 million USD', 'netIncome: -0.000001 million USD',
    'debt: 0 million USD', 'equity: -2 million USD', 'https://example.com/filing?literal=1']) {
    assert.ok(report.includes(literal), literal);
  }
  assert.match(report, /unselected.*context/i);
  assert.match(report, /Selected values and source metadata match the current row/);
  assert.ok(!report.includes('revenue: 900 million USD'), 'Exact captured date must not become latest');
});

test('financial, issuer and source differences have separate captured/current values', () => {
  const incoming = dataset();
  incoming.id = id(3); incoming.fileName = 'renamed.csv'; incoming.importedDate = today; incoming.synthetic = true;
  incoming.companies[0] = { ...incoming.companies[0]!, revenue: 0, name: 'Changed issuer', currency: 'EUR', filingUrl: null };
  const report = block(dataset(), brief(), incoming);
  for (const literal of ['Selected fact changes: revenue', 'Identity changes: name, currency, synthetic',
    'Source changes: datasetId, fileName, importedDate, filingUrl', 'Not supplied -> 0', 'USD -> EUR',
    'false -> true', 'captured.csv -> renamed.csv', `${id(2)} -> ${id(3)}`, 'renamed.csv:2',
    'revenue: 0 million EUR', 'Captured full annual row', 'Current full annual row']) assert.ok(report.includes(literal), literal);
});

test('unselected fact changes do not claim changed selected financial evidence', () => {
  const incoming = dataset();
  incoming.companies[0]!.netIncome = 99;
  const report = block(dataset(), brief(), incoming);
  assert.match(report, /Selected fact changes: None/);
  assert.match(report, /Selected values and source metadata match the current row/);
  assert.ok(report.includes('netIncome: -0.000001 million USD'));
  assert.ok(report.includes('netIncome: 99 million USD'));
  assert.match(report, /unselected.*not.*compared/i);
});

test('removed captured period and removed issuer retain complete supplied citations without latest substitution', () => {
  const incoming = dataset();
  incoming.companies = incoming.companies.slice(1);
  const report = block(dataset(), brief(), incoming);
  assert.match(report, /Exact captured annual period is missing/);
  assert.ok(report.includes('captured.csv:2'));
  assert.ok(report.includes(excerptText));
  assert.ok(!report.includes('revenue: 900 million USD'));
  incoming.companies = [row('BBB', 2)];
  assert.match(block(dataset(), brief(), incoming), /Exact captured annual period is missing/);
});

test('source-only and uncited-only saved briefs are complete downloadable research', () => {
  const input = notebook();
  input.briefs[0]!.statements = [];
  const sources = buildCompanyBriefReport(input, 'AAA', today);
  assert.ok(sources.includes(excerptText));
  assert.ok(sources.includes('Selected annual fields: revenue, debt'));
  input.briefs[0]!.statements = [{ id: id(25), section: 'questions', text: 'Unanswered original question', citationIds: [] }];
  input.briefs[0]!.citations = [];
  const uncited = buildCompanyBriefReport(input, 'AAA', today);
  assert.ok(uncited.includes('Unanswered original question'));
  assert.match(uncited, /Uncited statement/);
});

test('whole report includes every committed brief outside shortlist while retaining notes and annual history', () => {
  const input = notebook();
  input.screen.sector = 'Software';
  input.screen.filters = [{ metric: 'revenue', operator: 'gt', value: 1000, currency: 'USD' }];
  const report = buildReport(input, today);
  for (const literal of [statementText, excerptText, 'Old note\nStill retained',
    'Annual period: AAA — 2025-06-30', 'Annual period: AAA — 2026-06-30', 'Annual period: BBB — 2025-06-30',
    'No companies match the applied criteria.']) assert.ok(report.includes(literal), literal);
  assert.equal(report.split(`Citation ID: ${id(10)}\n`).length - 1, 1);
});

test('refresh report includes full kept, dropped and removed prior brief graphs with incoming comparisons', () => {
  const input = notebook();
  input.briefs.push(brief('BBB', 30));
  const incoming = dataset();
  incoming.id = id(3); incoming.fileName = 'incoming.csv'; incoming.importedDate = today;
  incoming.companies = [{ ...incoming.companies[0]!, name: 'Different issuer', revenue: 0 },
    { ...incoming.companies[1]!, name: 'Different issuer' }];
  for (const action of ['keep', 'drop'] as const) {
    const before = JSON.stringify({ input, incoming });
    const report = buildRefreshReport(input, incoming, { criteria: 'keep', annotations: [{ ticker: 'AAA', action }] }, today);
    for (const literal of ['Research group: AAA', `Outcome: ${action}`, 'Research group: BBB', 'Outcome: remove',
      id(10), id(40), 'Original BBB', 'captured.csv:4', 'incoming.csv:2', statementText, excerptText, 'Old note\nStill retained']) assert.ok(report.includes(literal), literal);
    assert.equal(report.split(`Citation ID: ${id(10)}\n`).length - 1, 1);
    assert.equal(report.split(`Citation ID: ${id(40)}\n`).length - 1, 1);
    assert.equal(JSON.stringify({ input, incoming }), before);
  }
});

test('public formatters reject malformed graphs, dates and absent brief selection atomically', () => {
  const input = notebook(), before = JSON.stringify(input);
  assert.throws(() => buildCompanyBriefReport(input, 'CCC', today), /brief|ticker/i);
  assert.throws(() => buildCompanyBriefReport(input, 'AAA', '2026-02-29'), /date/i);
  const orphan = brief(); orphan.statements[0]!.citationIds = [id(99)];
  assert.throws(() => briefReportLines(orphan, dataset(), today));
  const unsafe = brief(); unsafe.citations[0] = { ...unsafe.citations[0]!, surprise: 'not admitted' } as unknown as typeof unsafe.citations[0];
  assert.throws(() => briefReportLines(unsafe, dataset(), today));
  assert.equal(JSON.stringify(input), before);
});

function largeNotebook(): Notebook {
  const input = notebook();
  input.dataset.fileName = '😀'.repeat(120);
  input.dataset.companies = Array.from({ length: 500 }, (_, index) => ({ ...row(`X${index}`, index + 2),
    name: '😀'.repeat(100), sector: '😀'.repeat(60), filingUrl: 'https://example.com/' + '😀'.repeat(1700) }));
  input.watchlist = input.dataset.companies.slice(0, 100).map(company => company.ticker);
  input.comparison = input.dataset.companies.slice(0, 4).map(company => company.ticker);
  input.screen.includeStale = true; input.notes = []; input.briefs = [];
  const evidence = brief('X0');
  const source = evidence.citations[1] as AnnualCitation;
  source.snapshot = { datasetId: input.dataset.id, fileName: input.dataset.fileName, importedDate: input.dataset.importedDate,
    basis: input.dataset.basis, units: input.dataset.units, synthetic: false, company: { ...input.dataset.companies[0]! } };
  input.briefs = [evidence];
  return input;
}

test('legal Unicode-rich notebook stays fully JSON-exportable when complete text expansion exceeds 8 MiB', () => {
  const input = largeNotebook(), before = serializeNotebook(input, today);
  assert.ok(new TextEncoder().encode(before).length <= LIMITS.notebookBytes);
  assert.throws(() => buildReport(input, today), /8 MiB.*JSON/i);
  assert.equal(serializeNotebook(input, today), before);
});

test('complete refresh report counts repeated Unicode provenance and refuses oversized output without mutation', () => {
  const input = largeNotebook(), incoming = structuredClone(input.dataset);
  incoming.id = id(3); incoming.fileName = '🧪'.repeat(120);
  const before = serializeNotebook(input, today);
  assert.throws(() => buildRefreshReport(input, incoming, { criteria: 'keep', annotations: [] }, today), /8 MiB.*JSON/i);
  assert.equal(serializeNotebook(input, today), before);
});
