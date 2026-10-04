import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnnualCitation, Company, CompanyBrief, Dataset, Notebook } from '../src/types.ts';
import { validateBriefs, captureAnnualCitation, createExcerptCitation, compareAnnualCitation, updateBrief, removeBrief } from '../src/brief.ts';
import { validateNotebook, parseNotebookJson, serializeNotebook } from '../src/model.ts';
import { NotebookHistory } from '../src/history.ts';
import { reviewRefresh, applyRefresh } from '../src/refresh.ts';
import { buildReport } from '../src/exports.ts';
import { buildRefreshReport } from '../src/refresh-report.ts';
import { briefReportLines, buildCompanyBriefReport } from '../src/brief-report.ts';

// Original fixtures and expected field lists authored from the reviewed contract,
// before reading any new brief producer implementation or producer tests.
const TODAY = '2026-10-04';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = <T>(value: T): T => structuredClone(value);
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function row(overrides: Partial<Company> = {}): Company {
  return { ticker: 'A', name: 'Original Issuer', sector: 'Tools', currency: 'USD', fiscalDate: '2024-12-31', revenue: 125.000001, priorRevenue: 50, netIncome: -0.000001, debt: null, equity: 0, filingUrl: 'https://source.example/annual?edition=old', sourceLine: 19, ...overrides };
}
function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return { id: id(1), fileName: 'original.csv', importedDate: '2026-09-01', basis: 'annual-12-month', units: 'currency-millions', synthetic: false, companies: [row(), row({ fiscalDate: '2025-12-31', revenue: 777, sourceLine: 31 })], ...overrides };
}
function annual(): AnnualCitation {
  return { id: id(20), kind: 'annual', fields: ['revenue', 'priorRevenue', 'debt'], snapshot: { datasetId: id(1), fileName: 'original.csv', importedDate: '2026-09-01', basis: 'annual-12-month', units: 'currency-millions', synthetic: false, company: row() } };
}
const literal = '  User supplied 😀\r\nSecond\tline\n<not-markup>&  ';
function brief(): CompanyBrief {
  return { ticker: 'A', statements: [ { id: id(10), section: 'business', text: literal, citationIds: [id(20), id(21)] }, { id: id(11), section: 'questions', text: 'What remains unknown?', citationIds: [] } ], citations: [ annual(), { id: id(21), kind: 'excerpt', title: '  Original source  ', author: ' Named Author ', publishedDate: '2024-02-29', url: 'https://source.example/text?x=1&y=2', excerpt: '  Literal excerpt 😀\r\n<script>never execute</script>\n  ' } ] };
}
function notebook(data = dataset(), briefs = [brief()]): Notebook {
  return { schemaVersion: 3, id: id(2), dataset: data, title: 'Independent notebook', query: '', screen: { sector: null, currency: null, filters: [], includeStale: true, sortBy: 'ticker', direction: 'asc' }, watchlist: [], comparison: [], notes: [], briefs };
}
function assertValid(): void { assert.deepEqual(validateBriefs([brief()], dataset(), TODAY), [brief()]); }

test('oracle: annual capture binds literal old period, all raw fields and provenance, not latest', () => {
  const input = dataset();
  const result = captureAnnualCitation(input, 'A', '2024-12-31', ['debt', 'revenue', 'priorRevenue'], TODAY);
  assert.match(result.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.deepEqual({ ...result, id: id(20) }, annual());
  input.companies[0].revenue = 999;
  assert.equal(result.snapshot.company.revenue, 125.000001);
  assert.equal(result.snapshot.company.priorRevenue, 50);
  assert.equal(result.snapshot.company.debt, null);
  assert.equal(result.snapshot.company.equity, 0);
  assert.throws(() => captureAnnualCitation(dataset(), 'A', '2023-12-31', ['revenue'], TODAY));
});

test('oracle: selected versus contextual financial fields and source-only import drift', () => {
  const citation = annual(), source = dataset();
  assert.deepEqual(compareAnnualCitation(citation, source, TODAY), { state: 'same', factFields: [], identityFields: [], sourceFields: [], current: row() });
  source.companies[0].netIncome = 90;
  assert.equal(compareAnnualCitation(citation, source, TODAY).state, 'same');
  source.id = id(3); source.fileName = 'renamed.csv'; source.importedDate = '2026-09-02';
  source.companies[0].sourceLine = 20; source.companies[0].filingUrl = 'https://source.example/revised';
  const drift = compareAnnualCitation(citation, source, TODAY);
  assert.deepEqual(drift.sourceFields, ['datasetId', 'fileName', 'importedDate', 'sourceLine', 'filingUrl']);
  assert.deepEqual(drift.factFields, []); assert.deepEqual(drift.identityFields, []);
  assert.equal(drift.state, 'changed');
  drift.current!.revenue = 0;
  assert.equal(source.companies[0].revenue, 125.000001);
});

test('oracle: null-to-zero facts, independent priorRevenue and identity are distinct categories', () => {
  const incoming = dataset({ synthetic: true });
  Object.assign(incoming.companies[0], { name: 'Different Issuer', sector: 'Services', currency: 'EUR', priorRevenue: 125.000001, debt: 0 });
  const drift = compareAnnualCitation(annual(), incoming, TODAY);
  assert.deepEqual(drift.factFields, ['priorRevenue', 'debt']);
  assert.deepEqual(drift.identityFields, ['name', 'sector', 'currency', 'synthetic']);
  assert.deepEqual(drift.sourceFields, []);
  assert.deepEqual(annual().snapshot.company, row());
});

test('oracle: missing exact year or ticker never substitutes a newer row', () => {
  for (const companies of [[row({ fiscalDate: '2025-12-31' })], [row({ ticker: 'B' })]]) {
    assert.deepEqual(compareAnnualCitation(annual(), dataset({ companies }), TODAY), { state: 'missing', factFields: [], identityFields: [], sourceFields: [], current: null });
  }
});

test('oracle: literal Unicode and CRLF survive creation, validation and complete JSON', () => {
  const source = brief().citations[1]; assert.equal(source.kind, 'excerpt');
  if (source.kind !== 'excerpt') throw Error('fixture');
  const { id: ignored, kind: ignoredKind, ...input } = source; void ignored; void ignoredKind;
  assert.deepEqual({ ...createExcerptCitation(input, TODAY), id: source.id }, source);
  const value = notebook();
  assert.deepEqual(parseNotebookJson(serializeNotebook(value, TODAY), TODAY), value);
  const detached = validateBriefs(value.briefs, value.dataset, TODAY);
  detached[0].statements[0].citationIds.pop();
  assert.equal(value.briefs[0].statements[0].citationIds.length, 2);
  for (const text of ['bad\rbreak', 'bad\u0000', 'bad\u0085', 'bad\ud800', ' \t\r\n ']) {
    const bad = brief(); bad.statements[0].text = text;
    assert.throws(() => validateBriefs([bad], dataset(), TODAY));
  }
});

test('oracle: code-point boundary accepts 1200 astral characters, rejects one more', () => {
  const value = brief(); value.statements[0].text = '😀'.repeat(1200);
  assert.equal(validateBriefs([value], dataset(), TODAY)[0].statements[0].text, value.statements[0].text);
  value.statements[0].text += '😀';
  assert.throws(() => validateBriefs([value], dataset(), TODAY));
  const source = brief().citations[1]; if (source.kind !== 'excerpt') throw Error('fixture');
  source.excerpt = '😀'.repeat(4000);
  const data = brief(); data.citations[1] = source;
  assert.equal(validateBriefs([data], dataset(), TODAY)[0].citations.length, 2);
  source.excerpt += '😀'; assert.throws(() => validateBriefs([data], dataset(), TODAY));
});

test('oracle: malformed source graph rejects atomically without invoking getters', () => {
  assertValid(); let getterCalls = 0;
  const mutations: ((b: CompanyBrief) => void)[] = [
    b => { b.citations[0].id = b.statements[0].id; },
    b => { b.statements[0].citationIds.push(id(999)); },
    b => { b.statements[0].citationIds.push(id(20)); },
    b => { (b.citations[0] as AnnualCitation).snapshot.company.ticker = 'B'; },
    b => { (b.citations[0] as AnnualCitation).snapshot.company.sourceLine = 502; },
    b => { (b.citations[0] as AnnualCitation).snapshot.company.priorRevenue = -50; },
    b => { (b.citations[0] as AnnualCitation).snapshot.importedDate = '2023-01-01'; },
    b => { Object.defineProperty(b.citations[0], 'fields', { enumerable: true, get() { getterCalls++; return ['revenue']; } }); },
    b => { Object.assign(b.citations[0], { extra: true }); },
    b => { delete b.citations[1]; },
  ];
  for (const mutate of mutations) { const value = brief(); mutate(value); assert.throws(() => validateBriefs([value], dataset(), TODAY)); }
  assert.equal(getterCalls, 0);
  const other = brief(); other.ticker = 'B'; other.citations = []; other.statements = [{ id: id(50), section: 'risks', text: 'Cross company', citationIds: [id(21)] }];
  assert.throws(() => validateBriefs([brief(), other], dataset({ companies: [row(), row({ ticker: 'B', sourceLine: 20 })] }), TODAY));
});

test('oracle: citation edits refuse; detach then delete is explicit and leaves unrelated evidence', () => {
  const before = [brief()], original = clone(before), edited = brief();
  (edited.citations[0] as AnnualCitation).snapshot.company.revenue = 12;
  assert.throws(() => updateBrief(before, edited, dataset(), TODAY));
  const simultaneous = brief(); simultaneous.statements[0].citationIds = [id(21)]; simultaneous.citations.shift();
  assert.throws(() => updateBrief(before, simultaneous, dataset(), TODAY));
  const detached = brief(); detached.statements[0].citationIds = [id(21)];
  const first = updateBrief(before, detached, dataset(), TODAY);
  const deleted = clone(first[0]); deleted.citations.shift();
  const second = updateBrief(first, deleted, dataset(), TODAY);
  assert.deepEqual(second, [simultaneous]); assert.deepEqual(before, original);
  assert.deepEqual(removeBrief(second, 'A', dataset(), TODAY), []);
  assert.throws(() => removeBrief(second, 'B', dataset(), TODAY));
});

test('oracle: brief-only history commits preserve exact snapshots, no-op redo and failed edit atomicity', () => {
  const initial = validateNotebook(notebook(), TODAY), history = new NotebookHistory(initial, TODAY);
  const changed = clone(initial); changed.briefs[0].statements[0].text = 'Changed 😀\r\n';
  history.commit(changed, TODAY); assert.equal(history.canUndo, true);
  assert.deepEqual(history.undo(TODAY), initial); assert.equal(history.canRedo, true);
  history.commit(clone(initial), TODAY); assert.equal(history.canRedo, true);
  const bad = clone(initial); bad.briefs[0].statements[0].text = 'x'.repeat(1201);
  assert.throws(() => history.commit(bad, TODAY)); assert.deepEqual(history.current, initial); assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(TODAY), changed);
});

test('oracle: brief-only identity decisions keep original snapshots or drop the entire graph', () => {
  const before = validateNotebook(notebook(), TODAY), incoming = dataset({ id: id(3), synthetic: true });
  incoming.companies.forEach(c => { c.name = 'Renamed Issuer'; });
  const review = reviewRefresh(before, incoming, TODAY);
  assert.equal(review.annotations.length, 1); assert.equal(review.annotations[0].policy, 'decide');
  assert.deepEqual(review.annotations[0].brief, brief());
  review.annotations[0].brief!.statements[0].text = 'detached';
  assert.equal(before.briefs[0].statements[0].text, literal);
  const kept = applyRefresh(before, incoming, { criteria: 'keep', annotations: [{ ticker: 'A', action: 'keep' }] }, TODAY);
  assert.deepEqual(kept.briefs, before.briefs);
  assert.deepEqual(applyRefresh(before, incoming, { criteria: 'keep', annotations: [{ ticker: 'A', action: 'drop' }] }, TODAY).briefs, []);
  assert.throws(() => applyRefresh(before, incoming, { criteria: 'keep', annotations: [] }, TODAY));
});

test('oracle: repeated refresh retains missing-period evidence; absent ticker removes graph', () => {
  const before = validateNotebook(notebook(), TODAY);
  const incoming = dataset({ id: id(3), companies: [row({ fiscalDate: '2025-12-31', revenue: 777, sourceLine: 31 })] });
  const kept = applyRefresh(before, incoming, { criteria: 'keep', annotations: [] }, TODAY);
  assert.deepEqual(kept.briefs, before.briefs);
  assert.equal(compareAnnualCitation(kept.briefs[0].citations[0] as AnnualCitation, incoming, TODAY).state, 'missing');
  const again = applyRefresh(kept, { ...incoming, id: id(4) }, { criteria: 'keep', annotations: [] }, TODAY);
  assert.deepEqual(again.briefs, before.briefs);
  const absent = dataset({ id: id(5), companies: [row({ ticker: 'B' })] });
  assert.equal(reviewRefresh(before, absent, TODAY).annotations[0].policy, 'remove');
  assert.deepEqual(applyRefresh(before, absent, { criteria: 'keep', annotations: [] }, TODAY).briefs, []);
});

test('oracle: standalone/full/proposed reports preserve literal dropped evidence and all raw captured facts', () => {
  const value = validateNotebook(notebook(), TODAY), absent = dataset({ id: id(3), companies: [row({ ticker: 'B' })] });
  const reports = [briefReportLines(brief(), dataset(), TODAY).join('\n'), buildCompanyBriefReport(value, 'A', TODAY), buildReport(value, TODAY), buildRefreshReport(value, absent, { criteria: 'keep', annotations: [] }, TODAY)];
  for (const report of reports) {
    assert.ok(report.includes(literal));
    assert.ok(report.includes('  Literal excerpt 😀\r\n<script>never execute</script>\n  '));
    for (const expected of [id(10), id(20), id(21), '125.000001', '50', '-0.000001', 'original.csv', '2024-12-31', 'https://source.example/annual?edition=old']) assert.ok(report.includes(expected), expected);
    assert.match(report, /uncited/i); assert.match(report, /not.*verif|unverified/i);
  }
  assert.match(reports[3], /missing|not present/i);
  assert.match(reports[3], /remove/i);
  const short = clone(value); short.screen.filters = [{ metric: 'revenue', operator: 'gt', value: 999999, currency: 'USD' }];
  assert.ok(buildReport(short, TODAY).includes(literal));
});

function largeBriefs(count: number, excerpt: string): { data: Dataset; briefs: CompanyBrief[] } {
  const briefs: CompanyBrief[] = [], companies: Company[] = [];
  for (let offset = 0; offset < count; offset += 12) {
    const ticker = `T${offset}`, citations = Array.from({ length: Math.min(12, count - offset) }, (_, n) => ({ id: id(1000 + offset + n), kind: 'excerpt' as const, title: `Source ${offset + n}`, author: null, publishedDate: null, url: null, excerpt }));
    companies.push(row({ ticker, sourceLine: companies.length + 2 })); briefs.push({ ticker, statements: [], citations });
  }
  return { data: dataset({ companies }), briefs };
}

test('oracle: total citation and independent UTF-8 graph bounds distinguish valid maxima', () => {
  const maxCount = largeBriefs(100, 'Small source');
  assert.equal(validateBriefs(maxCount.briefs, maxCount.data, TODAY).reduce((n, b) => n + b.citations.length, 0), 100);
  const overCount = largeBriefs(101, 'Small source'); assert.throws(() => validateBriefs(overCount.briefs, overCount.data, TODAY));
  const below = largeBriefs(60, '😀'.repeat(4000)); assert.ok(size(below.briefs) < 1024 * 1024);
  assert.equal(validateBriefs(below.briefs, below.data, TODAY).length, 5);
  const over = largeBriefs(72, '😀'.repeat(4000)); assert.ok(size(over.briefs) > 1024 * 1024);
  assert.throws(() => validateBriefs(over.briefs, over.data, TODAY));
});

function legacyAtCap(): Record<string, unknown> {
  const companies = Array.from({ length: 500 }, (_, n) => row({ ticker: `T${n}`, sourceLine: n + 2, filingUrl: 'https://source.example/' + '😀'.repeat(1000) }));
  const value = notebook(dataset({ companies }), []);
  const { briefs: ignored, ...old } = value; void ignored;
  const legacy = { ...old, schemaVersion: 2, notes: companies.slice(0, 100).map(c => ({ ticker: c.ticker, text: '😀'.repeat(4000) })).sort((a, b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0) };
  let remaining = 4 * 1024 * 1024 - size(legacy);
  assert.ok(remaining > 0);
  for (const company of companies) {
    const room = 2048 - [...company.filingUrl!].length;
    const extra = Math.min(room, Math.floor(remaining / 4));
    company.filingUrl += '😀'.repeat(extra); remaining -= extra * 4;
    if (remaining > 0 && remaining < 4 && room > extra) { company.filingUrl += 'x'.repeat(remaining); remaining = 0; }
    if (!remaining) break;
  }
  assert.equal(remaining, 0); assert.equal(size(legacy), 4 * 1024 * 1024);
  return legacy;
}

test('oracle: genuine exact 4 MiB canonical v2 migrates without wrapper overhead rejection', () => {
  const legacy = legacyAtCap(), raw = JSON.stringify(legacy);
  const migrated = parseNotebookJson(raw, TODAY);
  assert.equal(migrated.schemaVersion, 3); assert.deepEqual(migrated.briefs, []);
  const { briefs: ignored, ...old } = migrated; void ignored;
  assert.deepEqual({ ...old, schemaVersion: 2 }, legacy);
  assert.ok(Buffer.byteLength(serializeNotebook(migrated, TODAY)) > 4 * 1024 * 1024);
  assert.throws(() => parseNotebookJson(raw + ' ', TODAY));
});

test('oracle: v1 unique-ticker rule survives migration and unknown versions/keys reject', () => {
  const { briefs: ignored, ...old } = notebook(dataset({ companies: [row()] }), []); void ignored;
  assert.deepEqual(validateNotebook({ ...old, schemaVersion: 1 }, TODAY).briefs, []);
  assert.throws(() => validateNotebook({ ...old, schemaVersion: 1, dataset: dataset() }, TODAY));
  assert.throws(() => validateNotebook({ ...old, schemaVersion: 2, briefs: [] }, TODAY));
  assert.throws(() => validateNotebook({ ...notebook(), schemaVersion: 4 }, TODAY));
});

test('oracle: legal v3 source-rich notebook refuses oversized complete text without mutating evidence', () => {
  const companies = Array.from({ length: 500 }, (_, n) => row({ ticker: `T${n}`, sourceLine: n + 2, filingUrl: 'https://source.example/' + '😀'.repeat(2000) }));
  const value = notebook(dataset({ companies }), []);
  value.watchlist = companies.slice(0, 100).map(c => c.ticker);
  value.notes = companies.slice(0, 100).map(c => ({ ticker: c.ticker, text: 'x'.repeat(4000) }));
  const validated = validateNotebook(value, TODAY);
  assert.ok(size(validated) > 4 * 1024 * 1024 && size(validated) < 6 * 1024 * 1024);
  const snapshot = JSON.stringify(validated);
  assert.throws(() => buildReport(validated, TODAY), /8 MiB|limit|large/i);
  assert.equal(JSON.stringify(validated), snapshot);
  assert.equal(serializeNotebook(validated, TODAY), snapshot);
});
