import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAnnualCitation, compareAnnualCitation, createExcerptCitation, removeBrief, updateBrief, validateBriefs } from '../src/brief.ts';
import { BRIEF_LIMITS, type AnnualField, type CompanyBrief, type ExcerptCitation } from '../src/types.ts';
import { company, dataset, TODAY } from './model-fixtures.ts';

function id(n: number): string { return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`; }
function excerpt(n = 1): ExcerptCitation { return { id: id(n), kind: 'excerpt', title: ' Source title ', author: null, publishedDate: null, url: null, excerpt: ' First\r\nsecond\tline 📈 ' }; }
function brief(): CompanyBrief { return { ticker: 'ALPHA', statements: [{ id: id(2), section: 'business', text: ' My claim\r\nwith a question? ', citationIds: [id(1)] }], citations: [excerpt()] }; }

test('literal excerpt and statement text remain exact detached data, with canonical ordering only for tickers', () => {
  const input = brief(), original = structuredClone(input);
  const output = validateBriefs([input], dataset(), TODAY);
  assert.deepEqual(output, [original]);
  output[0].citations[0].id = id(3); output[0].statements[0].citationIds.length = 0;
  assert.deepEqual(input, original);
  const created = createExcerptCitation({ title: ' Literal <script> ', author: ' Author ', publishedDate: '2025-03-01', url: 'https://example.com/a?b=1', excerpt: '  a\r\nb\n\tc  ' }, TODAY);
  assert.match(created.id, /^[a-f0-9-]{36}$/); assert.equal(created.excerpt, '  a\r\nb\n\tc  ');
  assert.equal(created.title, ' Literal <script> '); assert.equal(created.author, ' Author ');
});

test('source-only and uncited briefs are valid, but empty graphs require explicit deletion', () => {
  const data = dataset([company(), company({ ticker: 'BETA', sourceLine: 3 })]);
  const sourceOnly: CompanyBrief = { ticker: 'BETA', statements: [], citations: [excerpt(3)] };
  const uncited: CompanyBrief = { ticker: 'ALPHA', statements: [{ id: id(4), section: 'questions', text: 'What remains unknown?', citationIds: [] }], citations: [] };
  assert.deepEqual(validateBriefs([sourceOnly, uncited], data, TODAY), [uncited, sourceOnly]);
  assert.throws(() => validateBriefs([{ ticker: 'ALPHA', statements: [], citations: [] }], data, TODAY), /Delete brief/i);
  assert.deepEqual(removeBrief([uncited, sourceOnly], 'ALPHA', data, TODAY), [sourceOnly]);
  assert.throws(() => removeBrief([sourceOnly], 'ALPHA', data, TODAY));
});

test('annual capture retains the exact old period and all original raw context without aliasing', () => {
  const data = dataset([company({ fiscalDate: '2024-01-01', revenue: 0, priorRevenue: null, netIncome: -1, equity: -2 }), company({ fiscalDate: '2026-01-01', sourceLine: 501 })]);
  const capture = captureAnnualCitation(data, 'ALPHA', '2024-01-01', ['equity', 'priorRevenue', 'revenue'], TODAY);
  assert.deepEqual(capture.fields, ['revenue', 'priorRevenue', 'equity']);
  assert.deepEqual(capture.snapshot, { datasetId: data.id, fileName: data.fileName, importedDate: TODAY, basis: data.basis, units: data.units, synthetic: false, company: data.companies[0] });
  data.companies[0].revenue = 100; assert.equal(capture.snapshot.company.revenue, 0);
  capture.snapshot.company.name = 'Changed copy'; assert.equal(data.companies[0].name, 'Alpha Tools');
  const last = captureAnnualCitation(data, 'ALPHA', '2026-01-01', ['debt'], TODAY);
  assert.equal(last.snapshot.company.sourceLine, 501);
  for (const fields of [[], ['revenue', 'revenue'], ['growthPct']]) assert.throws(() => captureAnnualCitation(data, 'ALPHA', '2024-01-01', fields as AnnualField[], TODAY));
  assert.throws(() => captureAnnualCitation(data, 'ALPHA', '2025-01-01', ['revenue'], TODAY));
});

test('drift separates selected null/zero and priorRevenue facts from identity and exact source differences', () => {
  const old = dataset([company({ revenue: null, priorRevenue: 0, netIncome: -0.000001, equity: -1 })]);
  const citation = captureAnnualCitation(old, 'ALPHA', '2026-01-01', ['priorRevenue', 'netIncome', 'revenue'], TODAY);
  assert.deepEqual(compareAnnualCitation(citation, old, TODAY), { state: 'same', factFields: [], identityFields: [], sourceFields: [], current: old.companies[0] });
  const incoming = structuredClone(old);
  incoming.id = id(20); incoming.fileName = 'changed.csv'; incoming.importedDate = '2026-10-03'; incoming.synthetic = true;
  Object.assign(incoming.companies[0], { revenue: 0, priorRevenue: 1, netIncome: -0.000002, name: 'New name', sector: 'New sector', currency: 'EUR', sourceLine: 12, filingUrl: 'https://example.com/new' });
  const drift = compareAnnualCitation(citation, incoming, TODAY);
  assert.equal(drift.state, 'changed'); assert.deepEqual(drift.factFields, ['revenue', 'priorRevenue', 'netIncome']);
  assert.deepEqual(drift.identityFields, ['name', 'sector', 'currency', 'synthetic']);
  assert.deepEqual(drift.sourceFields, ['datasetId', 'fileName', 'importedDate', 'sourceLine', 'filingUrl']);
  drift.current!.name = 'Only detached'; assert.equal(incoming.companies[0].name, 'New name');
  assert.equal(citation.snapshot.company.revenue, null);
});

test('new import metadata is not financial drift; unselected fields are contextual, and newer rows never replace missing periods', () => {
  const old = dataset(), citation = captureAnnualCitation(old, 'ALPHA', '2026-01-01', ['revenue'], TODAY);
  const contextual = dataset([company({ debt: 0, equity: -5, netIncome: null, priorRevenue: null })]);
  assert.equal(compareAnnualCitation(citation, contextual, TODAY).state, 'same');
  contextual.id = id(30);
  assert.deepEqual(compareAnnualCitation(citation, contextual, TODAY).factFields, []);
  assert.deepEqual(compareAnnualCitation(citation, contextual, TODAY).sourceFields, ['datasetId']);
  for (const rows of [[company({ fiscalDate: '2026-02-01' })], [company({ ticker: 'BETA' })]]) {
    assert.deepEqual(compareAnnualCitation(citation, dataset(rows), TODAY), { state: 'missing', factFields: [], identityFields: [], sourceFields: [], current: null });
  }
});

test('saved citation edits and cited removal refuse atomically; explicit detach then deletion and whole removal work', () => {
  const original = [brief()], before = structuredClone(original), data = dataset();
  const mutate = structuredClone(original[0]); (mutate.citations[0] as ExcerptCitation).excerpt += ' correction';
  assert.throws(() => updateBrief(original, mutate, data, TODAY), /immutable|replacement/i);
  const removal = structuredClone(original[0]); removal.citations = []; removal.statements[0].citationIds = [];
  assert.throws(() => updateBrief(original, removal, data, TODAY), /1 statement/);
  assert.deepEqual(original, before);
  const detach = structuredClone(original[0]); detach.statements[0].citationIds = [];
  const detached = updateBrief(original, detach, data, TODAY);
  const deleted = updateBrief(detached, removal, data, TODAY);
  assert.equal(deleted[0].citations.length, 0); assert.equal(deleted[0].statements.length, 1);
  assert.deepEqual(removeBrief(original, 'ALPHA', data, TODAY), []);
});

test('exact ordinary graph shapes reject accessors without executing them, sparse arrays, unknown fields and cross-brief references', () => {
  const data = dataset([company(), company({ ticker: 'BETA', sourceLine: 3 })]);
  assert.deepEqual(validateBriefs([brief()], data, TODAY), [brief()]);
  let calls = 0; const accessor = { ...brief() };
  Object.defineProperty(accessor, 'ticker', { enumerable: true, get: () => { calls++; return 'ALPHA'; } });
  for (const value of [[accessor], new Array(1), [{ ...brief(), private: true }], [{ ...brief(), ticker: 'alpha' }],
    [{ ...brief(), statements: new Array(1) }], [{ ...brief(), citations: [Object.assign(excerpt(), { private: true })] }],
    [{ ...brief(), statements: [{ ...brief().statements[0], citationIds: [id(99)] }] }],
    [brief(), { ticker: 'BETA', statements: [], citations: [excerpt()] }],
    [brief(), { ticker: 'BETA', statements: [{ id: id(4), section: 'risks', text: 'Cross', citationIds: [id(1)] }], citations: [] }]]) assert.throws(() => validateBriefs(value, data, TODAY));
  assert.equal(calls, 0);
  const unsafe = { ...excerpt() }; Object.defineProperty(unsafe, 'kind', { enumerable: true, get: () => { calls++; return 'excerpt'; } });
  assert.throws(() => validateBriefs([{ ...brief(), citations: [unsafe] }], data, TODAY)); assert.equal(calls, 0);
});

test('new literal text counts Unicode points, preserves whitespace, and rejects only unsupported controls or invalid scalar values', () => {
  const base = { title: 'Source', author: null, publishedDate: null, url: null, excerpt: '📈'.repeat(4000) };
  assert.equal(createExcerptCitation(base, TODAY).excerpt, base.excerpt);
  const statement = brief(); statement.statements[0].text = '📈'.repeat(1200);
  assert.equal(validateBriefs([statement], dataset(), TODAY)[0].statements[0].text, statement.statements[0].text);
  for (const text of ['📈'.repeat(4001), 'a\rb', 'a\u0000b', 'a\u0085b', '\ud800', '\udc00', ' \r\n\t ']) assert.throws(() => createExcerptCitation({ ...base, excerpt: text }, TODAY));
  for (const patch of [{ title: 'a\nb' }, { title: 'x'.repeat(161) }, { author: '' }, { author: 'a\tb' }, { author: 'x'.repeat(121) }, { publishedDate: '2026-10-05' }, { publishedDate: '2026-02-30' }]) assert.throws(() => createExcerptCitation({ ...base, ...patch }, TODAY));
});

test('source link admission exactly preserves safe supplied spelling and refuses credential/local/malformed URLs', () => {
  const input = { title: 'Source', author: null, publishedDate: null, excerpt: 'Literal source', url: 'https://EXAMPLE.com:443/report?x=1' };
  assert.equal(createExcerptCitation(input, TODAY).url, input.url);
  for (const url of ['http://example.com', 'https://a:b@example.com', 'https://example.com/#a', 'https://127.1/x', 'https://localhost/x', 'https://example.com:444/x', 'https://example.com/ a', 'https://example.com/\\a']) assert.throws(() => createExcerptCitation({ ...input, url }, TODAY));
});

test('snapshots admit original source lines and changed issuer labels but reject impossible dates and foreign ticker binding', () => {
  const data = dataset(), citation = captureAnnualCitation(data, 'ALPHA', '2026-01-01', ['equity'], TODAY);
  const saved: CompanyBrief = { ticker: 'ALPHA', statements: [], citations: [citation] };
  const incoming = dataset([company({ name: 'Replacement issuer' })]);
  assert.equal(validateBriefs([saved], incoming, TODAY)[0].citations.length, 1);
  for (const patch of [{ importedDate: '2025-12-31' }, { importedDate: '2026-10-05' }, { units: 'USD' }, { synthetic: 'false' }]) {
    const broken = structuredClone(saved); Object.assign((broken.citations[0] as typeof citation).snapshot, patch);
    assert.throws(() => validateBriefs([broken], incoming, TODAY));
  }
  const broken = structuredClone(saved); (broken.citations[0] as typeof citation).snapshot.company.ticker = 'BETA';
  assert.throws(() => validateBriefs([broken], incoming, TODAY));
});

test('count quotas include all statements, sources and global IDs without silent eviction', () => {
  const data = dataset(Array.from({ length: 51 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2 })));
  const groups: CompanyBrief[] = data.companies.map((row, i) => ({ ticker: row.ticker, statements: [{ id: id(1000 + i), section: 'risks', text: 'An uncited question', citationIds: [] }], citations: [] }));
  assert.equal(validateBriefs(groups.slice(0, 50), data, TODAY).length, 50);
  assert.throws(() => validateBriefs(groups, data, TODAY));
  const many = structuredClone(groups[0]); many.statements = Array.from({ length: 12 }, (_, i) => ({ id: id(2000 + i), section: 'business', text: 'A statement', citationIds: [] }));
  assert.equal(validateBriefs([many], data, TODAY)[0].statements.length, 12);
  many.statements.push({ id: id(2012), section: 'business', text: 'Too many', citationIds: [] }); assert.throws(() => validateBriefs([many], data, TODAY));
  const sources = structuredClone(groups[0]); sources.citations = Array.from({ length: 12 }, (_, i) => excerpt(3000 + i));
  sources.statements[0].citationIds = sources.citations.slice(0, 6).map(item => item.id);
  assert.equal(validateBriefs([sources], data, TODAY)[0].citations.length, 12);
  sources.statements[0].citationIds.push(sources.citations[6].id); assert.throws(() => validateBriefs([sources], data, TODAY));
  sources.statements[0].citationIds = []; sources.citations.push(excerpt(3012)); assert.throws(() => validateBriefs([sources], data, TODAY));
});

test('the aggregate citation graph admits exactly 1 MiB of UTF-8 and rejects one extra byte atomically', () => {
  const data = dataset(Array.from({ length: 9 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2 })));
  const groups: CompanyBrief[] = data.companies.map(row => ({ ticker: row.ticker, statements: [], citations: [] }));
  for (let i = 0; i < 100; i++) groups[Math.floor(i / 12)].citations.push({ ...excerpt(4000 + i), excerpt: 'x'.repeat(4000) });
  let needed = BRIEF_LIMITS.bytes - Buffer.byteLength(JSON.stringify(groups));
  for (const group of groups) for (const citation of group.citations) {
    const count = Math.min(4000, Math.floor(needed / 3));
    (citation as ExcerptCitation).excerpt = '📈'.repeat(count) + 'x'.repeat(4000 - count); needed -= count * 3;
    if (needed > 0 && needed < 3 && count < 4000) { (citation as ExcerptCitation).excerpt = (citation as ExcerptCitation).excerpt.slice(0, -1) + (needed === 1 ? 'é' : '€'); needed = 0; }
  }
  assert.equal(needed, 0); assert.equal(Buffer.byteLength(JSON.stringify(groups)), BRIEF_LIMITS.bytes);
  const accepted = validateBriefs(groups, data, TODAY); assert.equal(Buffer.byteLength(JSON.stringify(accepted)), BRIEF_LIMITS.bytes);
  const old = JSON.stringify(groups), target = groups.flatMap(group => group.citations).find(item => (item as ExcerptCitation).excerpt.includes('x')) as ExcerptCitation;
  target.excerpt = target.excerpt.replace('x', 'é'); assert.throws(() => validateBriefs(groups, data, TODAY), /1 MiB/);
  assert.equal(Buffer.byteLength(JSON.stringify(accepted)), BRIEF_LIMITS.bytes); assert.equal(Buffer.byteLength(old), BRIEF_LIMITS.bytes);
  const extra = structuredClone(accepted); extra[8].citations.push(excerpt(9999)); assert.throws(() => validateBriefs(extra, data, TODAY), /100|count/);
});
