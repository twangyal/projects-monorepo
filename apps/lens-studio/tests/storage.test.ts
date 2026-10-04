import assert from 'node:assert/strict';
import test from 'node:test';
import { clearProject, loadProject, saveProject } from '../src/storage.ts';
import type { Project } from '../src/types.ts';

test('invalid save rejects before attempting unavailable browser storage', async () => {
  await assert.rejects(saveProject({} as Project), /object|project|schema/i);
});

test('missing IndexedDB reports backup and retry guidance for read and clear', async () => {
  for (const operation of [loadProject, clearProject]) {
    await assert.rejects(operation(), /local.*storage.*unavailable.*download.*project.*retry/i);
  }
});

test('failed operations do not poison subsequent queued operations', async () => {
  await assert.rejects(clearProject(), /storage/i);
  await assert.rejects(loadProject(), /storage/i);
});
