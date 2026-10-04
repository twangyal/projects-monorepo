import { expect, test } from '@playwright/test';
import type {} from '../storage-harness.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/storage-harness.html');
  await page.waitForFunction(() => Boolean(window.stockStorage));
});

test('native storage stores exact validated JSON text and detached round trips', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage;
    const store = new h.NotebookStore();
    const missing = await store.load('2026-10-04');
    const notebook = h.fixture();
    await store.save(notebook, '2026-10-04');
    const raw = await h.rawRecord('stock-notebook-v1');
    const expected = h.serializeNotebook(notebook, '2026-10-04');
    const loaded = (await store.load('2026-10-04'))!;
    loaded.title = 'Detached edit';
    const title = (await store.load('2026-10-04'))!.title;
    const exportEqual = await store.exportRaw() === expected;
    await store.clear();
    const cleared = await store.load('2026-10-04');
    store.close();
    return { missing, storedText: typeof raw === 'string', exact: raw === expected, title, exportEqual, cleared };
  });
  expect(result).toEqual({ missing: null, storedText: true, exact: true, title: 'Captured study', exportEqual: true, cleared: null });
});

test('captured snapshots and writes from multiple instances stay ordered through committed transactions', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage;
    const first = new h.NotebookStore('ordered-native');
    const second = new h.NotebookStore('ordered-native');
    const original = IDBDatabase.prototype.transaction;
    let hold = true;
    let once = true;
    let starts = 0;
    let completed = false;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite') {
        starts++;
        if (once) {
          once = false;
          const keepAlive = () => {
            const request = tx.objectStore('notebooks').get('current');
            request.onsuccess = () => { if (hold) keepAlive(); };
          };
          keepAlive();
        }
      }
      return tx;
    };
    try {
      const notebook = h.fixture('First');
      const a = first.save(notebook, '2026-10-04').then(() => { completed = true; });
      notebook.title = 'Second captured';
      const b = second.save(notebook, '2026-10-04');
      notebook.title = 'Unsaved mutation';
      await new Promise(resolve => setTimeout(resolve, 50));
      const pending = !completed && starts === 1;
      hold = false;
      await Promise.all([a, b]);
      const title = (await first.load('2026-10-04'))!.title;
      await Promise.all([first.save(notebook, '2026-10-04'), second.clear()]);
      return { pending, title, cleared: await first.load('2026-10-04') };
    } finally { hold = false; IDBDatabase.prototype.transaction = original; first.close(); second.close(); }
  });
  expect(result).toEqual({ pending: true, title: 'Second captured', cleared: null });
});

test('aborted save and clear roll back, retain committed data and recover the queue', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage;
    const store = new h.NotebookStore('abort-native');
    const notebook = h.fixture('Prior committed');
    await store.save(notebook, '2026-10-04');
    const original = IDBDatabase.prototype.transaction;
    const errors: string[] = [];
    for (const operation of [() => store.save({ ...notebook, title: 'Rejected replacement' }, '2026-10-04'), () => store.clear()]) {
      IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
        const tx = original.apply(this, args);
        if (args[1] === 'readwrite') tx.objectStore('notebooks').get('current').onsuccess = () => tx.abort();
        return tx;
      };
      try { await operation(); } catch (error) { errors.push((error as Error).message); }
      finally { IDBDatabase.prototype.transaction = original; }
    }
    const retained = (await store.load('2026-10-04'))!.title;
    await store.save({ ...notebook, title: 'Retry committed' }, '2026-10-04');
    const retry = (await store.load('2026-10-04'))!.title;
    store.close();
    return { errors, retained, retry };
  });
  expect(result.errors).toHaveLength(2);
  for (const message of result.errors) expect(message).toMatch(/storage.*backup.*retry/i);
  expect(result.retained).toBe('Prior committed');
  expect(result.retry).toBe('Retry committed');
});

test('malformed, future-dated and legacy records stay untouched and raw backups remain recoverable', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage;
    const store = new h.NotebookStore('raw-native');
    const records = ['{"schemaVersion":1,"schemaVersion":2}', '{ broken original text', { legacy: 'Original recovery data' }, null, h.serializeNotebook(h.fixture(), '2026-10-04')];
    const recovered: boolean[] = [];
    for (const record of records) {
      await h.rawRecord('raw-native', record, true);
      let rejected = false;
      try { await store.load('2026-10-03'); } catch { rejected = true; }
      const raw = await store.exportRaw();
      const expected = typeof record === 'string' ? record : JSON.stringify(record);
      recovered.push(rejected && raw === expected && JSON.stringify(await h.rawRecord('raw-native')) === JSON.stringify(record));
    }
    store.close();
    return recovered;
  });
  expect(result).toEqual([true, true, true, true, true]);
});

test('raw export has exact UTF-8 bounds and rejects invalid Unicode or unserializable records', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage;
    const store = new h.NotebookStore('raw-limits');
    const limit = 4 * 1024 * 1024;
    await h.rawRecord('raw-limits', 'x'.repeat(limit), true);
    const exact = (await store.exportRaw())!.length;
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const values = ['x'.repeat(limit - 1) + 'é', '\ud800', cycle, undefined, 1n];
    const errors: string[] = [];
    for (const value of values) {
      await h.rawRecord('raw-limits', value, true);
      try { await store.exportRaw(); } catch (error) { errors.push((error as Error).message); }
    }
    store.close();
    return { exact, errors };
  });
  expect(result.exact).toBe(4 * 1024 * 1024);
  expect(result.errors).toHaveLength(5);
  for (const message of result.errors) expect(message).toMatch(/raw.*backup.*(invalid|large|serializ)|raw.*(invalid|large|serializ).*backup/i);
});

test('close aborts active native writes and rejects queued work without deleting prior data', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage;
    const store = new h.NotebookStore('close-native');
    const notebook = h.fixture('Prior to close');
    await store.save(notebook, '2026-10-04');
    const original = IDBDatabase.prototype.transaction;
    let started = false;
    let hold = true;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite') {
        started = true;
        const keepAlive = () => {
          const request = tx.objectStore('notebooks').get('current');
          request.onsuccess = () => { if (hold) keepAlive(); };
        };
        keepAlive();
      }
      return tx;
    };
    try {
      const write = store.save({ ...notebook, title: 'Must roll back' }, '2026-10-04');
      const clear = store.clear();
      // Attach rejection handlers before close aborts the active transaction.
      const settled = Promise.allSettled([write, clear]);
      for (let tries = 0; !started && tries < 100; tries++) await new Promise(resolve => setTimeout(resolve, 5));
      store.close(); hold = false;
      const results = await settled;
      IDBDatabase.prototype.transaction = original;
      const reopened = new h.NotebookStore('close-native');
      const title = (await reopened.load('2026-10-04'))!.title;
      reopened.close();
      return { started, statuses: results.map(item => item.status), errors: results.map(item => item.status === 'rejected' ? (item.reason as Error).message : ''), title };
    } finally { hold = false; IDBDatabase.prototype.transaction = original; store.close(); }
  });
  expect(result.started).toBe(true);
  expect(result.statuses).toEqual(['rejected', 'rejected']);
  for (const message of result.errors) expect(message).toMatch(/closed/i);
  expect(result.title).toBe('Prior to close');
});

test('quota and unavailable failures give safe backup guidance and preserve old text', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage;
    const store = new h.NotebookStore('quota-native');
    const notebook = h.fixture('Retained');
    await store.save(notebook, '2026-10-04');
    const put = IDBObjectStore.prototype.put;
    const open = indexedDB.open;
    const errors: string[] = [];
    IDBObjectStore.prototype.put = () => { throw new DOMException('Private fixture string', 'QuotaExceededError'); };
    try { await store.save({ ...notebook, title: 'Quota edit' }, '2026-10-04'); }
    catch (error) { errors.push((error as Error).message); }
    finally { IDBObjectStore.prototype.put = put; }
    indexedDB.open = () => { throw new DOMException('Private fixture string', 'SecurityError'); };
    try { await store.exportRaw(); }
    catch (error) { errors.push((error as Error).message); }
    finally { indexedDB.open = open; }
    const title = (await store.load('2026-10-04'))!.title;
    store.close();
    return { errors, title };
  });
  expect(result.errors).toHaveLength(2);
  for (const message of result.errors) { expect(message).toMatch(/storage.*backup.*retry/i); expect(message).not.toContain('Private fixture'); }
  expect(result.title).toBe('Retained');
});

test('blocked real IDB upgrade rejects and releases its late-opened connection', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const name = 'blocked-native';
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('notebooks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    blocker.onversionchange = () => {};
    const original = indexedDB.open;
    indexedDB.open = (database: string) => original.call(indexedDB, database, 2);
    const store = new window.stockStorage.NotebookStore(name);
    let error = '';
    try { await store.exportRaw(); } catch (value) { error = (value as Error).message; }
    finally { indexedDB.open = original; blocker.close(); store.close(); }
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Leaked late connection')), 3000)),
    ]);
    return error;
  });
  expect(result).toMatch(/storage.*blocked.*backup.*retry/i);
});
