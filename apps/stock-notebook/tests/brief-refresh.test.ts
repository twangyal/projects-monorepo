import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRefresh, reviewRefresh, type RefreshChoices } from '../src/refresh.ts';
import { createNotebook } from '../src/model.ts';
import type { Company, CompanyBrief, Dataset } from '../src/types.ts';
import { company, dataset, TODAY } from './model-fixtures.ts';

const uuid = (i: number) => `223e4567-e89b-42d3-a456-${String(i).padStart(12, '0')}`;
const keep: RefreshChoices = { criteria: 'keep', annotations: [] };
function brief(ticker = 'ALPHA', id = 1): CompanyBrief {
  return { ticker, statements: [{ id: uuid(id), section: 'business', text: '  Supplied\tstatement\r\n<literal>  ', citationIds: [uuid(id + 1)] }],
    citations: [{ id: uuid(id + 1), kind: 'excerpt', title: ' Original title ', author: null, publishedDate: null, url: null, excerpt: ' Original source\r\nkept exactly ' }] };
}
function incoming(rows: Company[], patch: Partial<Dataset> = {}): Dataset {
  return { ...dataset(rows), id: '33333333-3333-4333-8333-333333333333', fileName: 'incoming.csv', ...patch };
}

test('brief-only companies enter retention review and carry detached complete prior graphs', () => {
  const base = createNotebook(dataset(), TODAY); base.briefs = [brief()];
  const next = incoming([company({ name: 'Changed issuer label' })]);
  const review = reviewRefresh(base, next, TODAY);
  assert.equal(review.annotations.length, 1);
  assert.equal(review.annotations[0].policy, 'decide'); assert.deepEqual(review.annotations[0].reasons, ['name']);
  assert.deepEqual(review.annotations[0].brief, brief());
  review.annotations[0].brief!.statements[0].text = 'External mutation';
  assert.deepEqual(base.briefs, [brief()]);
  assert.throws(() => applyRefresh(base, next, keep, TODAY));
  const kept = applyRefresh(base, next, { criteria: 'keep', annotations: [{ ticker: 'ALPHA', action: 'keep' }] }, TODAY);
  assert.deepEqual(kept.briefs, base.briefs); kept.briefs[0].citations.length = 0; assert.deepEqual(base.briefs, [brief()]);
  assert.deepEqual(applyRefresh(base, next, { criteria: 'keep', annotations: [{ ticker: 'ALPHA', action: 'drop' }] }, TODAY).briefs, []);
});

test('Drop and absent-ticker removal discard whole groups while Keep preserves full sources', () => {
  const base = createNotebook(dataset([company(), company({ ticker: 'DROP', sourceLine: 3 }), company({ ticker: 'GONE', sourceLine: 4 })]), TODAY);
  base.watchlist = ['GONE', 'DROP', 'ALPHA']; base.comparison = ['DROP', 'ALPHA', 'GONE'];
  base.notes = [{ ticker: 'ALPHA', text: 'Keep note' }, { ticker: 'DROP', text: 'Drop note' }, { ticker: 'GONE', text: 'Removed note' }];
  base.briefs = [brief(), brief('DROP', 11), brief('GONE', 21)];
  const next = incoming([company({ name: 'Renamed ALPHA' }), company({ ticker: 'DROP', name: 'Renamed DROP', sourceLine: 3 })]);
  const review = reviewRefresh(base, next, TODAY);
  assert.deepEqual(review.annotations.map(row => [row.ticker, row.policy, !!row.brief]), [['ALPHA', 'decide', true], ['DROP', 'decide', true], ['GONE', 'remove', true]]);
  const result = applyRefresh(base, next, { criteria: 'keep', annotations: [{ ticker: 'ALPHA', action: 'keep' }, { ticker: 'DROP', action: 'drop' }] }, TODAY);
  assert.deepEqual(result.watchlist, ['ALPHA']); assert.deepEqual(result.comparison, ['ALPHA']);
  assert.deepEqual(result.notes, [base.notes[0]]); assert.deepEqual(result.briefs, [brief()]);
  assert.equal(result.id, base.id); assert.equal(result.title, base.title);
});

test('new import provenance and missing captured period never rewrite or remove retained snapshots', () => {
  const rows = [company({ fiscalDate: '2025-01-01', revenue: null }), company({ sourceLine: 3 })];
  const base = createNotebook(dataset(rows), TODAY);
  const captured = { datasetId: base.dataset.id, fileName: base.dataset.fileName, importedDate: base.dataset.importedDate,
    basis: base.dataset.basis, units: base.dataset.units, synthetic: base.dataset.synthetic, company: { ...rows[0] } };
  base.briefs = [{ ticker: 'ALPHA', statements: [], citations: [{ id: uuid(50), kind: 'annual', fields: ['revenue'], snapshot: captured }] }];
  const next = incoming([company({ sourceLine: 9, filingUrl: 'https://example.com/new-source' })]);
  const review = reviewRefresh(base, next, TODAY);
  assert.equal(review.annotations[0].policy, 'keep'); assert.deepEqual(review.annotations[0].brief, base.briefs[0]);
  assert.equal(review.periods.find(row => row.fiscalDate === '2025-01-01')!.kind, 'removed');
  const first = applyRefresh(base, next, keep, TODAY);
  const second = applyRefresh(first, incoming(next.companies, { id: '44444444-4444-4444-8444-444444444444', fileName: 'third.csv' }), keep, TODAY);
  assert.deepEqual(first.briefs, base.briefs); assert.deepEqual(second.briefs, base.briefs);
});

test('all 254 disjoint research groups can be decided including fifty brief-only groups', () => {
  const rows = Array.from({ length: 254 }, (_, i) => company({ ticker: `C${String(i).padStart(3, '0')}`, sourceLine: i + 2 }));
  const base = createNotebook(dataset(rows), TODAY);
  base.watchlist = rows.slice(0, 100).map(row => row.ticker); base.comparison = rows.slice(100, 104).map(row => row.ticker);
  base.notes = rows.slice(104, 204).map(row => ({ ticker: row.ticker, text: 'Original note' }));
  base.briefs = rows.slice(204).map((row, i) => brief(row.ticker, 100 + 2 * i));
  const next = incoming(rows.map(row => ({ ...row, name: `Renamed ${row.ticker}` })));
  const review = reviewRefresh(base, next, TODAY); assert.equal(review.annotations.length, 254);
  assert.equal(review.annotations.filter(row => row.brief).length, 50);
  const result = applyRefresh(base, next, { criteria: 'keep', annotations: rows.map(row => ({ ticker: row.ticker, action: 'keep' })) }, TODAY);
  assert.deepEqual(result.briefs, base.briefs); assert.deepEqual(result.notes, base.notes);
});

test('no-brief annotations explicitly expose null and retain old research semantics', () => {
  const base = createNotebook(dataset(), TODAY); base.watchlist = ['ALPHA'];
  const next = incoming([company()]); const review = reviewRefresh(base, next, TODAY);
  assert.equal(review.annotations[0].brief, null); assert.equal(review.annotations[0].policy, 'keep');
  assert.deepEqual(applyRefresh(base, next, keep, TODAY).watchlist, ['ALPHA']);
});

test('failed criteria or malformed choices cannot mutate complete evidence or incoming data', () => {
  const base = createNotebook(dataset(), TODAY); base.briefs = [brief()];
  base.query = 'companies in "Industry"';
  const next = incoming([company({ name: 'Changed', sector: 'Software' })]);
  const original = JSON.stringify([base, next]);
  const choices: RefreshChoices = { criteria: 'keep', annotations: [{ ticker: 'ALPHA', action: 'keep' }] };
  assert.throws(() => applyRefresh(base, next, choices, TODAY));
  assert.equal(JSON.stringify([base, next]), original);
  assert.deepEqual(applyRefresh(base, next, { ...choices, criteria: 'clearQuery' }, TODAY).briefs, base.briefs);
  assert.throws(() => applyRefresh(base, next, { criteria: 'clearQuery', annotations: [choices.annotations[0], choices.annotations[0]] }, TODAY));
  assert.equal(JSON.stringify([base, next]), original);
});
