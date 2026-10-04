import assert from 'node:assert/strict';
import test from 'node:test';
import { NotebookStore } from '../src/storage.ts';
import type { Notebook } from '../src/types.ts';

test('invalid save and read date reject before unavailable IndexedDB', async () => {
  const store = new NotebookStore();
  await assert.rejects(store.save({} as Notebook, '2026-10-04'), /notebook|object|schema|fields/i);
  await assert.rejects(store.load('2026-02-29'), /date|today/i);
  store.close();
});

test('unavailable storage is actionable and failure does not poison the operation queue', async () => {
  const store = new NotebookStore();
  for (const operation of [() => store.load('2026-10-04'), () => store.exportRaw(), () => store.clear()]) {
    await assert.rejects(operation(), /storage.*unavailable.*backup.*retry/i);
  }
  store.close();
});

test('closed store is terminal and queued work rejects without reopening storage', async () => {
  const store = new NotebookStore();
  const pending = store.clear();
  store.close();
  await assert.rejects(pending, /closed/i);
  await assert.rejects(store.exportRaw(), /closed/i);
});
