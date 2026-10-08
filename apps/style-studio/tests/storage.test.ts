import assert from 'node:assert/strict';
import test from 'node:test';
import { openProjectStore, SavedCopyProtected } from '../src/storage.ts';

test('unavailable IndexedDB rejects with export and memory-only guidance', async () => {
  assert.equal(globalThis.indexedDB, undefined);
  await assert.rejects(openProjectStore(), error => error instanceof SavedCopyProtected && /storage|IndexedDB/i.test(error.message));
  await assert.rejects(openProjectStore(), /export|memory.only/i);
});

test('a browser security failure while accessing IndexedDB is an asynchronous actionable error', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new DOMException('Private storage policy detail', 'SecurityError'); } });
  try {
    await assert.rejects(openProjectStore(), error => error instanceof SavedCopyProtected
      && /storage|IndexedDB|export/i.test(error.message) && !error.message.includes('Private storage policy detail'));
  }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});
