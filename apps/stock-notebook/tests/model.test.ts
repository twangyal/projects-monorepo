import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotebook, editState, parseNotebookJson, serializeNotebook, validateNotebook } from '../src/model.ts';
import { LIMITS } from '../src/types.ts';
import { company, dataset, screen, TODAY } from './model-fixtures.ts';

test('notebooks begin with detached dataset and empty annotations, query and default screen', () => {
  const input = dataset(), notebook = createNotebook(input, TODAY);
  assert.equal(notebook.schemaVersion, 3); assert.match(notebook.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(notebook.id, createNotebook(input, TODAY).id);
  assert.equal(notebook.title, 'Stock notebook'); assert.equal(notebook.query, '');
  assert.deepEqual(notebook.screen, screen()); assert.deepEqual(notebook.watchlist, []);
  assert.deepEqual(notebook.comparison, []); assert.deepEqual(notebook.notes, []); assert.deepEqual(notebook.briefs, []);
  input.companies[0].revenue = 0; assert.equal(notebook.dataset.companies[0].revenue, 120);
  const edited = editState(notebook); edited.screen.filters.push({ metric: 'netIncome', operator: 'gt', value: 0, currency: null });
  assert.deepEqual(notebook.screen.filters, []); assert.equal('dataset' in edited, false);
});

test('notes normalize line endings, remove empty entries and sort by known canonical ticker', () => {
  const data = dataset([company(), company({ ticker: 'BETA', sourceLine: 3 })]);
  const notebook = createNotebook(data, TODAY);
  notebook.notes = [{ ticker: 'BETA', text: '  Second\r\nLine\tC  ' }, { ticker: 'ALPHA', text: 'First' }];
  const result = validateNotebook(notebook, TODAY);
  assert.deepEqual(result.notes, [{ ticker: 'ALPHA', text: 'First' }, { ticker: 'BETA', text: 'Second\nLine\tC' }]);
  assert.equal(notebook.notes[0].text, '  Second\r\nLine\tC  ');
  assert.deepEqual(validateNotebook({ ...notebook, notes: [{ ticker: 'ALPHA', text: ' \n\t ' }] }, TODAY).notes, []);
  for (const patch of [{ notes: [{ ticker: 'ALPHA', text: 'a\rb' }] }, { notes: [{ ticker: 'ALPHA', text: '\ud800' }] },
    { notes: [{ ticker: 'ALPHA', text: 'x'.repeat(4001) }] }, { notes: [{ ticker: 'MISSING', text: 'Note' }] },
    { notes: [{ ticker: 'ALPHA', text: 'A' }, { ticker: 'ALPHA', text: 'B' }] },
    { watchlist: ['ALPHA', 'ALPHA'] }, { comparison: ['UNKNOWN'] }, { watchlist: ['alpha'] },
    { title: 'A\nB' }, { id: notebook.id + '\n' }, { schemaVersion: 4 }, { private: 1 }]) assert.throws(() => validateNotebook({ ...notebook, ...patch }, TODAY));
});

test('watchlist, comparison and notes obey exact reference/count bounds including astral note text', () => {
  const data = dataset(Array.from({ length: 101 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2 })));
  const notebook = createNotebook(data, TODAY), tickers = data.companies.map(row => row.ticker);
  const accepted = validateNotebook({ ...notebook, watchlist: tickers.slice(0, 100), comparison: tickers.slice(0, 4), notes: [{ ticker: tickers[0], text: '📈'.repeat(4000) }] }, TODAY);
  assert.equal(accepted.watchlist.length, 100); assert.equal(accepted.comparison.length, 4);
  for (const patch of [{ watchlist: tickers }, { comparison: tickers.slice(0, 5) },
    { notes: tickers.map(ticker => ({ ticker, text: 'N' })) }]) assert.throws(() => validateNotebook({ ...notebook, ...patch }, TODAY));
});

test('saved query must parse completely while effective manual filters remain authoritative', () => {
  const notebook = createNotebook(dataset(), TODAY);
  const changed = { ...notebook, query: 'companies with profitable', screen: screen({ filters: [{ metric: 'revenue', operator: 'gt', value: 200, currency: 'USD' }] }) };
  assert.equal(validateNotebook(changed, TODAY).query, changed.query);
  for (const query of ['companies or anything', 'companies with profitable please', 'x'.repeat(501)]) assert.throws(() => validateNotebook({ ...notebook, query }, TODAY));
});

test('operational validation rejects a mixed-currency money sort but accepts an explicit matching-currency filter', () => {
  const notebook = createNotebook(dataset([company(), company({ ticker: 'BETA', currency: 'EUR', sourceLine: 3 })]), TODAY);
  assert.throws(() => validateNotebook({ ...notebook, screen: screen({ sortBy: 'revenue' }) }, TODAY));
  assert.equal(validateNotebook({ ...notebook, screen: screen({ sortBy: 'revenue', currency: 'USD' }) }, TODAY).screen.currency, 'USD');
});

test('strict JSON rejects duplicate decoded keys, malformed Unicode, unsafe numbers and excessive depth/bytes', () => {
  const notebook = createNotebook(dataset(), TODAY), text = serializeNotebook(notebook, TODAY);
  assert.deepEqual(parseNotebookJson(text, TODAY), notebook); assert.equal(text, JSON.stringify(notebook));
  for (const raw of [text.replace('"schemaVersion":3', '"schemaVersion":3,"schema\\u0056ersion":3'),
    text.replace('"revenue":120', '"revenue":1e999'), text.replace('"revenue":120', '"revenue":NaN'),
    text.replace('"revenue":120', '"revenue":9007199254740992'), text + '{}',
    '['.repeat(25) + '0' + ']'.repeat(25), '{"__proto__":{},"__proto__":{}}', '\ud800',
    ' '.repeat(LIMITS.notebookBytes + 1), text.replace('"title":"Stock notebook"', '"title":"\\ud800"')]) assert.throws(() => parseNotebookJson(raw, TODAY));
  assert.throws(() => validateNotebook(notebook, '2025-01-01'));
});

test('valid legacy notebooks migrate to v3 without changing data, IDs or annotations', () => {
  const legacy = { schemaVersion: 1, id: '22222222-2222-4222-8222-222222222222', dataset: dataset([company(), company({ ticker: 'BETA', sourceLine: 3 })]), title: 'Saved legacy research', query: 'companies with profitable', screen: screen({ currency: 'USD' }), watchlist: ['BETA'], comparison: ['BETA', 'ALPHA'], notes: [{ ticker: 'ALPHA', text: 'Evidence stays literal <b>text</b>' }] };
  const raw = JSON.stringify(legacy), migrated = parseNotebookJson(raw, TODAY);
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated, { ...legacy, schemaVersion: 3, briefs: [] });
  assert.equal(JSON.stringify(legacy), raw);
  migrated.dataset.companies[0].revenue = 999; assert.equal(legacy.dataset.companies[0].revenue, 120);
  assert.equal(parseNotebookJson(serializeNotebook(validateNotebook(legacy, TODAY), TODAY), TODAY).schemaVersion, 3);
  for (const schemaVersion of [0, 4, true, '2', null]) assert.throws(() => validateNotebook({ ...legacy, schemaVersion }, TODAY));
});

test('v1 unique-ticker semantics remain strict while v2 accepts dated annual history', () => {
  const source = dataset([company({ fiscalDate: '2026-01-01' }), company({ ticker: 'alpha', fiscalDate: '2024-01-01', sourceLine: 3 })]);
  const incoming = { schemaVersion: 2, id: '22222222-2222-4222-8222-222222222222', dataset: source, title: 'Annual history', query: '', screen: screen(), watchlist: ['ALPHA'], comparison: ['ALPHA'], notes: [{ ticker: 'ALPHA', text: 'Ticker-level notes' }] };
  assert.deepEqual(validateNotebook(incoming, TODAY).dataset.companies.map(row => row.sourceLine), [2, 3]);
  assert.throws(() => validateNotebook({ ...incoming, schemaVersion: 1 }, TODAY));
  assert.throws(() => parseNotebookJson(JSON.stringify({ ...incoming, schemaVersion: 1 }), TODAY));
  assert.deepEqual(parseNotebookJson(JSON.stringify(incoming), TODAY).notes, incoming.notes);
});
