import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../src/storage.ts';
import { createImageAsset, createProject } from '../src/model.ts';

function project() { return createProject(createImageAsset({ width: 1, height: 1, rgba: new Uint8ClampedArray([1, 2, 3, 0]) }, { fileName: 'a.png', format: 'png', width: 1, height: 1 })); }

test('missing IndexedDB is a protected load error, never empty state, and rejects writes without throwing synchronously', async () => {
  const store = new ProjectStore();
  await assert.rejects(store.load(), /unavailable|storage/i);
  await assert.rejects(store.save(project()), /unavailable|storage/i);
  await assert.rejects(store.clear(), /unavailable|storage/i);
  await assert.rejects(store.exportRaw(), /unavailable|storage/i);
  store.close();
});

test('closed instances reject new work while independent new stores still report actual storage availability', async () => {
  const store = new ProjectStore(); store.close(); store.close();
  await assert.rejects(store.load(), /closed/i); await assert.rejects(store.save(project()), /closed/i);
  await assert.rejects(store.exportRaw(), /closed/i); await assert.rejects(store.clear(), /closed/i);
  const next = new ProjectStore(); await assert.rejects(next.load(), /unavailable|storage/i); next.close();
});

test('a settled operation releases its queue slot before callers enqueue the next32 operations', async () => {
  const store = new ProjectStore();
  try { await store.clear(); } catch { /* Native storage is absent in Node. */ }
  const outcomes = await Promise.all(Array.from({ length: 32 }, () => store.load().then(() => '', error => String(error))));
  assert.ok(outcomes.every(error => !/too many/i.test(error)));
  store.close();
});
