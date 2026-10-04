import { expect, test } from '@playwright/test';
import type {} from '../storage-harness.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/storage-harness.html');
  await page.waitForFunction(() => Boolean(window.stockStorage));
});

test('a held native write times out, rolls back and releases the same-store queue', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage, name = 'held-write-timeout';
    const store = new h.NotebookStore(name), fixture = h.fixture('Before held write');
    await store.save(fixture, '2026-10-04');
    const before = await h.rawRecord(name), original = IDBDatabase.prototype.transaction;
    let hold = true, once = true;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite' && once) {
        once = false;
        const keepAlive = () => {
          const request = tx.objectStore('notebooks').get('current');
          request.onsuccess = () => { if (hold) keepAlive(); };
        };
        keepAlive();
      }
      return tx;
    };
    try {
      const write = store.save({ ...fixture, title: 'Must roll back after deadline' }, '2026-10-04')
        .then(() => ({ status: 'fulfilled', message: '' }), error => ({ status: 'rejected', message: (error as Error).message }));
      // This read must wait for either native commit or timeout rollback.
      const queued = store.exportRaw();
      let timer: ReturnType<typeof setTimeout>;
      const outcome = await Promise.race([write, new Promise<{ status: string; message: string }>(resolve => {
        timer = setTimeout(() => resolve({ status: 'still waiting', message: '' }), 12000);
      })]);
      clearTimeout(timer!); hold = false;
      await write;
      IDBDatabase.prototype.transaction = original;
      const queuedRaw = await queued;
      const raw = await h.rawRecord(name);
      await store.save({ ...fixture, title: 'Retry committed' }, '2026-10-04');
      const retry = (await store.load('2026-10-04'))!.title;
      return { outcome, queuedPreserved: queuedRaw === before, rawPreserved: raw === before, retry };
    } finally { hold = false; IDBDatabase.prototype.transaction = original; store.close(); }
  });
  expect(result.outcome.status).toBe('rejected');
  expect(result.outcome.message).toMatch(/storage.*(respond|timed out).*backup.*retry/i);
  expect(result.queuedPreserved).toBe(true);
  expect(result.rawPreserved).toBe(true);
  expect(result.retry).toBe('Retry committed');
});

test('another connection cannot hold readonly recovery and a queued clear indefinitely', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage, name = 'blocked-read-timeout';
    const store = new h.NotebookStore(name);
    await store.save(h.fixture('Cross-tab original'), '2026-10-04');
    const before = await h.rawRecord(name);
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    let hold = true;
    const tx = blocker.transaction('notebooks', 'readwrite');
    const completed = new Promise<void>(resolve => { tx.oncomplete = () => resolve(); tx.onabort = () => resolve(); });
    await new Promise<void>(resolve => {
      let first = true;
      const keepAlive = () => {
        const request = tx.objectStore('notebooks').get('current');
        request.onsuccess = () => { if (first) { first = false; resolve(); } if (hold) keepAlive(); };
      };
      keepAlive();
    });
    try {
      const load = store.load('2026-10-04').then(() => 'fulfilled', error => (error as Error).message);
      const clear = store.clear().then(() => 'fulfilled', error => (error as Error).message);
      let timer: ReturnType<typeof setTimeout>;
      const outcomes = await Promise.race([Promise.all([load, clear]), new Promise<string[]>(resolve => {
        timer = setTimeout(() => resolve(['still waiting']), 23000);
      })]);
      clearTimeout(timer!); hold = false; await completed;
      await Promise.all([load, clear]);
      const retained = await h.rawRecord(name) === before;
      const title = (await store.load('2026-10-04'))?.title ?? 'missing';
      await store.clear();
      const cleared = await store.load('2026-10-04');
      return { outcomes, retained, title, cleared };
    } finally { hold = false; try { tx.abort(); } catch { /* Already finished. */ } blocker.close(); store.close(); }
  });
  expect(result.outcomes).toHaveLength(2);
  for (const message of result.outcomes) expect(message).toMatch(/storage.*(respond|timed out).*backup.*retry/i);
  expect(result.retained).toBe(true);
  expect(result.title).toBe('Cross-tab original');
  expect(result.cleared).toBeNull();
});
