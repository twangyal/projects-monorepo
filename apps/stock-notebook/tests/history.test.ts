import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookHistory } from '../src/history.ts';
import { createNotebook, editState } from '../src/model.ts';
import { LIMITS } from '../src/types.ts';
import { company, dataset, screen, TODAY } from './model-fixtures.ts';

test('history detaches snapshots, preserves redo across no-ops and discards it after a new branch', () => {
  const original = createNotebook(dataset(), TODAY), history = new NotebookHistory(original, TODAY);
  original.dataset.companies[0].name = 'Mutated elsewhere'; assert.equal(history.current.dataset.companies[0].name, 'Alpha Tools');
  const first = history.current; first.title = 'First'; history.commit(first, TODAY); first.title = 'Untracked';
  const second = history.current; second.title = 'Second'; history.commit(second, TODAY);
  assert.equal(history.undo(TODAY).title, 'First'); history.commit(history.current, TODAY); assert.equal(history.canRedo, true);
  assert.equal(history.redo(TODAY).title, 'Second'); history.undo(TODAY);
  const branch = history.current; branch.watchlist = ['ALPHA']; history.commit(branch, TODAY); assert.equal(history.canRedo, false);
  assert.deepEqual(history.redo(TODAY).watchlist, ['ALPHA']);
});

test('history cannot alter dataset or notebook identity and failures preserve state/cursor', () => {
  const notebook = createNotebook(dataset(), TODAY), history = new NotebookHistory(notebook, TODAY);
  history.commit({ ...history.current, title: 'Edit' }, TODAY); history.undo(TODAY);
  for (const candidate of [{ ...notebook, id: crypto.randomUUID() }, { ...notebook, dataset: { ...notebook.dataset, synthetic: true } },
    { ...notebook, dataset: dataset([company({ revenue: 999 })]) }, { ...notebook, title: '' }]) {
    assert.throws(() => history.commit(candidate, TODAY)); assert.deepEqual(history.current, notebook); assert.equal(history.canRedo, true);
  }
});

test('history retains thirty edit states and excludes the immutable dataset from the edit budget', () => {
  const notebook = createNotebook(dataset(Array.from({ length: 500 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2, name: 'N'.repeat(100), sector: 'S'.repeat(60), filingUrl: 'https://example.com/' + 'a'.repeat(1900) }))), TODAY);
  const history = new NotebookHistory(notebook, TODAY);
  for (let i = 1; i <= 35; i++) history.commit({ ...history.current, title: String(i) }, TODAY);
  let count = 0; while (history.canUndo) { history.undo(TODAY); count++; }
  assert.equal(count, 29); assert.equal(history.current.title, '6');
});

test('UTF-8 edit byte cap trims oldest notes states while retaining current', () => {
  const notebook = createNotebook(dataset(Array.from({ length: 100 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2 }))), TODAY);
  notebook.notes = notebook.dataset.companies.map(row => ({ ticker: row.ticker, text: '📈'.repeat(4000) }));
  notebook.title = '00'; const history = new NotebookHistory(notebook, TODAY);
  const bytes = new TextEncoder().encode(JSON.stringify(editState(notebook))).length;
  for (let i = 1; i <= 9; i++) history.commit({ ...history.current, title: String(i).padStart(2, '0') }, TODAY);
  let states = 1; while (history.canUndo) { history.undo(TODAY); states++; }
  assert.equal(states, Math.floor(LIMITS.historyBytes / bytes)); assert.equal(history.current.title, String(10 - states).padStart(2, '0'));
});

test('UTC midnight uses each operation date: an aged EUR row no longer blocks a fresh USD money sort', () => {
  const notebook = createNotebook(dataset([company({ ticker: 'EURCO', currency: 'EUR', fiscalDate: '2025-04-04' }),
    company({ ticker: 'USDCO', sourceLine: 3 })]), TODAY);
  const history = new NotebookHistory(notebook, TODAY), nextDay = '2026-10-05';
  const next = { ...history.current, screen: screen({ sortBy: 'revenue' }) };
  history.commit(next, nextDay); assert.equal(history.current.screen.sortBy, 'revenue');
  history.undo(nextDay); assert.equal(history.current.screen.sortBy, 'ticker');
  assert.throws(() => history.redo(TODAY)); assert.equal(history.current.screen.sortBy, 'ticker'); assert.equal(history.canRedo, true);
  assert.equal(history.redo(nextDay).screen.sortBy, 'revenue');
  history.commit({ ...history.current, screen: screen() }, nextDay);
  assert.throws(() => history.undo(TODAY)); assert.equal(history.current.screen.sortBy, 'ticker');
  assert.equal(history.undo(nextDay).screen.sortBy, 'revenue');
});
