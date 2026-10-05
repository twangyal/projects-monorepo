import assert from 'node:assert/strict';
import test from 'node:test';
import { openProjectStore, SavedCopyProtected } from '../src/storage.ts';

test('denied IndexedDB access reports protected guidance without private exception details', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true,
    get() { throw new Error('private browser exception details'); } });
  try {
    await assert.rejects(openProjectStore(), (error: unknown) => {
      assert.ok(error instanceof SavedCopyProtected);
      assert.match(error.message, /storage.*unavailable.*download.*project.*retry/i);
      assert.doesNotMatch(error.message, /private browser exception/);
      return true;
    });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});

test('missing IndexedDB reports protected backup and retry guidance before opening', async () => {
  await assert.rejects(openProjectStore(), (error: unknown) => {
    assert.ok(error instanceof SavedCopyProtected);
    assert.match(error.message, /local.*storage.*unavailable.*download.*project.*retry/i);
    return true;
  });
});

test('a failed open does not poison subsequent independent storage admission', async () => {
  await assert.rejects(openProjectStore(), SavedCopyProtected);
  await assert.rejects(openProjectStore(), SavedCopyProtected);
});
