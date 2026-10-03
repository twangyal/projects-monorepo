import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject, saveProject, STORAGE_KEY } from '../src/storage.ts';
import { createComposition } from '../src/model.ts';

test('autosave round trips a validated project', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const project = createComposition();
  assert.equal(saveProject(storage, project), null);
  assert.deepEqual(loadProject(storage), { project, error: null });
  assert.ok(data.get(STORAGE_KEY));
});

test('unavailable and corrupt storage is reported without deleting saved bytes', () => {
  const storage = { getItem: () => 'broken', setItem: () => { throw new Error('Quota exceeded'); } };
  assert.match(loadProject(storage).error!, /saved project/i);
  assert.equal(loadProject(storage).project, null);
  assert.match(saveProject(storage, createComposition())!, /not saved/i);
  assert.equal(storage.getItem(), 'broken');
  assert.equal(loadProject(null).project, null);
  assert.match(saveProject(null, createComposition())!, /not saved/i);
});
