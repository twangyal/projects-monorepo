import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookHistory } from '../src/history.ts';
import { createNotebook, editState } from '../src/model.ts';
import { LIMITS, type CompanyBrief } from '../src/types.ts';
import { company, dataset, TODAY } from './model-fixtures.ts';

const uuid = (i: number) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, '0')}`;
function brief(): CompanyBrief {
  return { ticker: 'ALPHA', statements: [{ id: uuid(1), section: 'risks', text: '  Original\tstatement\r\nSecond line 📈  ', citationIds: [uuid(2)] }],
    citations: [{ id: uuid(2), kind: 'excerpt', title: ' Original title ', author: null, publishedDate: '2026-01-01',
      url: 'https://example.com/source', excerpt: '  Supplied\r\nexcerpt\t<script>literal</script>  ' },
    { id: uuid(3), kind: 'annual', fields: ['revenue', 'priorRevenue'], snapshot: {
      datasetId: dataset().id, fileName: 'annual.csv', importedDate: TODAY, basis: 'annual-12-month', units: 'currency-millions',
      synthetic: false, company: company({ revenue: 0, priorRevenue: null }) } }] };
}

test('brief-only edits are real history states and restore complete literal and annual snapshots', () => {
  const original = createNotebook(dataset(), TODAY), history = new NotebookHistory(original, TODAY);
  history.commit({ ...history.current, briefs: [brief()] }, TODAY);
  assert.equal(history.canUndo, true); assert.deepEqual(history.current.briefs, [brief()]);
  const next = history.current; next.briefs[0].statements[0].text = 'A changed statement';
  history.commit(next, TODAY); next.briefs[0].citations.length = 0;
  assert.deepEqual(history.undo(TODAY).briefs, [brief()]);
  assert.deepEqual(history.undo(TODAY).briefs, []);
  assert.equal(history.redo(TODAY).briefs[0].statements[0].text, brief().statements[0].text);
  assert.equal(history.redo(TODAY).briefs[0].statements[0].text, 'A changed statement');
});

test('caller and returned graph mutations cannot rewrite current, undo or redo evidence', () => {
  const input = createNotebook(dataset(), TODAY); input.briefs = [brief()];
  const history = new NotebookHistory(input, TODAY);
  input.briefs[0].statements[0].citationIds.length = 0;
  const original = history.current;
  original.briefs[0].citations[0].id = uuid(99);
  const edited = history.current; edited.briefs[0].statements[0].section = 'questions'; history.commit(edited, TODAY);
  edited.briefs[0].statements[0].text = 'External mutation';
  const prior = history.undo(TODAY); assert.deepEqual(prior.briefs, [brief()]);
  prior.briefs[0].statements.length = 0;
  const restored = history.redo(TODAY); assert.equal(restored.briefs[0].statements[0].section, 'questions');
  assert.deepEqual(restored.briefs[0].citations, brief().citations);
  assert.deepEqual(history.undo(TODAY).briefs, [brief()]);
});

test('brief no-ops preserve redo; invalid quotas leave the state and redo intact', () => {
  const history = new NotebookHistory(createNotebook(dataset(), TODAY), TODAY);
  history.commit({ ...history.current, briefs: [brief()] }, TODAY);
  history.commit({ ...history.current, title: 'Later' }, TODAY); history.undo(TODAY);
  const before = history.current; history.commit(structuredClone(before), TODAY); assert.equal(history.canRedo, true);
  const invalid = history.current; invalid.briefs[0].statements[0].text = '📈'.repeat(1201);
  assert.throws(() => history.commit(invalid, TODAY));
  assert.deepEqual(history.current, before); assert.equal(history.canRedo, true);
  assert.equal(history.redo(TODAY).title, 'Later');
});

test('thirty-state trimming preserves every citation of each retained brief', () => {
  const input = createNotebook(dataset(), TODAY); input.briefs = [brief()];
  const history = new NotebookHistory(input, TODAY);
  for (let i = 1; i <= 35; i++) {
    const next = history.current; next.briefs[0].statements[0].text = `Original revision ${i}`; history.commit(next, TODAY);
  }
  let states = 1;
  while (history.canUndo) { const previous = history.undo(TODAY); states++; assert.deepEqual(previous.briefs[0].citations, brief().citations); }
  assert.equal(states, 30); assert.equal(history.current.briefs[0].statements[0].text, 'Original revision 6');
});

test('UTF-8 brief bytes count toward eight-MiB history without shortening retained graphs', () => {
  const input = createNotebook(dataset(Array.from({ length: 5 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2 }))), TODAY);
  input.title = '00';
  input.briefs = input.dataset.companies.map((row, i) => ({ ticker: row.ticker, statements: [], citations: Array.from({ length: 12 }, (_, j) => ({
    id: uuid(100 + i * 12 + j), kind: 'excerpt' as const, title: `Original ${i}/${j}`, author: null, publishedDate: null, url: null, excerpt: '📈'.repeat(4000),
  })) }));
  const history = new NotebookHistory(input, TODAY), bytes = new TextEncoder().encode(JSON.stringify(editState(input))).length;
  assert.ok(bytes > 900000);
  for (let i = 1; i <= 11; i++) history.commit({ ...history.current, title: String(i).padStart(2, '0') }, TODAY);
  let states = 1;
  while (history.canUndo) { history.undo(TODAY); states++; assert.deepEqual(history.current.briefs, input.briefs); }
  assert.equal(states, Math.floor(LIMITS.historyBytes / bytes));
  assert.equal(history.current.title, String(12 - states).padStart(2, '0'));
});
