import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotebook, editState, parseNotebookJson, serializeNotebook, validateNotebook } from '../src/model.ts';
import { LIMITS } from '../src/types.ts';
import { company, dataset, screen, TODAY } from './model-fixtures.ts';

function legacy(version = 2) {
  return { schemaVersion: version, id: '22222222-2222-4222-8222-222222222222', dataset: dataset(), title: 'Saved research', query: '', screen: screen(), watchlist: ['ALPHA'], comparison: [], notes: [{ ticker: 'ALPHA', text: ' Old\r\nnote ' }] };
}

test('v1 and v2 migrate to detached schema3 without changing old note canonicalization; new projects include briefs', () => {
  const fresh = createNotebook(dataset(), TODAY);
  assert.equal(fresh.schemaVersion, 3); assert.deepEqual(fresh.briefs, []);
  for (const version of [1, 2]) {
    const old = legacy(version), raw = JSON.stringify(old), result = parseNotebookJson(raw, TODAY);
    assert.deepEqual(result, { ...old, schemaVersion: 3, notes: [{ ticker: 'ALPHA', text: 'Old\nnote' }], briefs: [] });
    assert.equal(JSON.stringify(old), raw); result.dataset.companies[0].revenue = 0; assert.equal(old.dataset.companies[0].revenue, 120);
  }
});

test('schema keys remain exact and v1 never gains multi-period acceptance through migration', () => {
  assert.equal(validateNotebook(legacy(), TODAY).schemaVersion, 3);
  const two = { ...legacy(), dataset: dataset([company({ fiscalDate: '2025-01-01' }), company({ sourceLine: 3 })]) };
  assert.equal(validateNotebook(two, TODAY).dataset.companies.length, 2);
  assert.throws(() => validateNotebook({ ...two, schemaVersion: 1 }, TODAY));
  for (const value of [{ ...legacy(), briefs: [] }, { ...legacy(), schemaVersion: 3 }, { ...legacy(), schemaVersion: 4 }, { ...legacy(), schemaVersion: '2' }]) assert.throws(() => validateNotebook(value, TODAY));
});

test('brief literals, references and snapshot-free source research roundtrip in editState and complete JSON', () => {
  const book = createNotebook(dataset(), TODAY);
  book.briefs = [{ ticker: 'ALPHA', statements: [{ id: '00000000-0000-4000-8000-000000000002', section: 'questions', text: '  Why?\r\n📈  ', citationIds: ['00000000-0000-4000-8000-000000000001'] }], citations: [{ id: '00000000-0000-4000-8000-000000000001', kind: 'excerpt', title: ' Title ', author: null, publishedDate: null, url: null, excerpt: '\tLiteral\r\nsource\n' }] }];
  const raw = serializeNotebook(book, TODAY);
  assert.deepEqual(parseNotebookJson(raw, TODAY), book);
  const edit = editState(book); assert.deepEqual(edit.briefs, book.briefs);
  edit.briefs[0].statements[0].text = 'Changed'; assert.equal(book.briefs[0].statements[0].text, '  Why?\r\n📈  ');
  assert.throws(() => parseNotebookJson(raw.replace('"briefs":', '"briefs":[],"briefs":'), TODAY));
});

test('a genuinely accepted near4 MiB canonical v2 notebook migrates above the old cap without truncation', () => {
  const cap = 4 * 1024 * 1024;
  const rows = Array.from({ length: 500 }, (_, i) => company({ ticker: `C${String(i).padStart(3, '0')}`, sourceLine: i + 2, filingUrl: 'https://example.com/' }));
  const old = { schemaVersion: 2, id: '22222222-2222-4222-8222-222222222222', dataset: dataset(rows), title: 'Legacy at the byte bound', query: '', screen: screen(), watchlist: [], comparison: [], notes: rows.slice(0, 100).map(row => ({ ticker: row.ticker, text: 'x'.repeat(4000) })) };
  const size = () => Buffer.byteLength(JSON.stringify(old));
  let low = 0, high = 2000;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2); for (const row of rows) row.filingUrl = 'https://example.com/' + '📈'.repeat(mid);
    if (size() <= cap) low = mid; else high = mid - 1;
  }
  for (const row of rows) row.filingUrl = 'https://example.com/' + '📈'.repeat(low);
  for (const row of rows) { if (size() + 4 > cap) break; row.filingUrl += '📈'; }
  // This exact generated fixture was also admitted by the original schema2
  // validateNotebook/parseNotebookJson before implementation (4194301 bytes).
  const raw = JSON.stringify(old); assert.equal(Buffer.byteLength(raw), 4194301);
  const converted = parseNotebookJson(raw, TODAY), canonical = serializeNotebook(converted, TODAY);
  assert.equal(converted.schemaVersion, 3); assert.deepEqual(converted.briefs, []);
  assert.equal(Buffer.byteLength(canonical), 4194313); assert.ok(Buffer.byteLength(canonical) > cap);
  assert.deepEqual(converted, { ...old, schemaVersion: 3, briefs: [] });
  assert.deepEqual(parseNotebookJson(canonical, TODAY), converted);
  assert.equal(LIMITS.legacyNotebookBytes, cap); assert.equal(LIMITS.notebookBytes, 6 * 1024 * 1024);
  assert.throws(() => parseNotebookJson(raw + ' '.repeat(4), TODAY), /4 MiB/);
  rows[0].filingUrl += '📈'; assert.throws(() => validateNotebook(old, TODAY), /4 MiB/);
});

test('legacy raw limit remains4 MiB while canonical v3 raw limit is6 MiB, including whitespace and multibyte input', () => {
  const old = JSON.stringify(legacy()), fresh = serializeNotebook(createNotebook(dataset(), TODAY), TODAY);
  assert.equal(parseNotebookJson(old + ' '.repeat(LIMITS.legacyNotebookBytes - Buffer.byteLength(old)), TODAY).schemaVersion, 3);
  assert.throws(() => parseNotebookJson(old + ' '.repeat(LIMITS.legacyNotebookBytes - Buffer.byteLength(old) + 1), TODAY), /4 MiB/);
  assert.equal(parseNotebookJson(fresh + ' '.repeat(LIMITS.notebookBytes - Buffer.byteLength(fresh)), TODAY).schemaVersion, 3);
  assert.throws(() => parseNotebookJson(fresh + ' '.repeat(LIMITS.notebookBytes - Buffer.byteLength(fresh) + 1), TODAY), /6 MiB/);
});

test('the complete canonical v3 notebook accepts exactly6 MiB and refuses one extra UTF-8 byte', () => {
  const rows = Array.from({ length: 500 }, (_, i) => company({ ticker: `C${String(i).padStart(3, '0')}`, sourceLine: i + 2,
    name: '📈'.repeat(100), sector: '📈'.repeat(60), filingUrl: 'https://example.com/' + '📈'.repeat(2028) }));
  const groups = [0, 1].map(group => ({ ticker: rows[group].ticker, statements: [], citations: Array.from({ length: 10 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${(group * 10 + i).toString(16).padStart(12, '0')}`, kind: 'excerpt' as const,
    title: 'Source', author: null, publishedDate: null, url: null, excerpt: 'x'.repeat(4000),
  })) }));
  const book = { schemaVersion: 3, id: '22222222-2222-4222-8222-222222222222', dataset: dataset(rows), title: 'Large valid data', query: '', screen: screen(),
    watchlist: [], comparison: [], notes: rows.slice(0, 100).map(row => ({ ticker: row.ticker, text: '📈'.repeat(4000) })), briefs: groups };
  let needed = LIMITS.notebookBytes - Buffer.byteLength(JSON.stringify(book));
  for (const source of groups.flatMap(group => group.citations)) {
    const count = Math.min(4000, Math.floor(needed / 3));
    source.excerpt = '📈'.repeat(count) + 'x'.repeat(4000 - count); needed -= count * 3;
    if (needed > 0 && needed < 3 && count < 4000) { source.excerpt = source.excerpt.slice(0, -1) + (needed === 1 ? 'é' : '€'); needed = 0; }
  }
  assert.equal(needed, 0); assert.equal(Buffer.byteLength(JSON.stringify(book)), 6291456);
  const accepted = validateNotebook(book, TODAY);
  assert.equal(Buffer.byteLength(serializeNotebook(accepted, TODAY)), 6291456);
  const source = groups.flatMap(group => group.citations).find(source => source.excerpt.includes('x'))!;
  source.excerpt = source.excerpt.replace('x', 'é');
  assert.throws(() => validateNotebook(book, TODAY), /6 MiB/);
  assert.equal(Buffer.byteLength(JSON.stringify(accepted)), 6291456);
});
