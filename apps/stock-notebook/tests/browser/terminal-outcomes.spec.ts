import { expect, test } from '@playwright/test';
import type {} from '../storage-harness.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/storage-harness.html');
  await page.waitForFunction(() => Boolean(window.stockStorage));
});

for (const trigger of ['request throws', 'store closes'] as const) {
  test(`${trigger}: admitted write and same-database queue await actual native rollback`, async ({ page }) => {
    const result = await page.evaluate(async trigger => {
      const h = window.stockStorage, name = `terminal-${trigger}`;
      const store = new h.NotebookStore(name), retry = new h.NotebookStore(name);
      const fixture = h.fixture('Original complete research');
      fixture.watchlist = ['AAA']; fixture.comparison = ['AAA'];
      fixture.notes = [{ ticker: 'AAA', text: 'Original literal note\nPreserve every field' }];
      await store.save(fixture, '2026-10-04');
      const before = await h.rawRecord(name);
      const transaction = IDBDatabase.prototype.transaction, put = IDBObjectStore.prototype.put;
      let release!: () => void, aborted!: () => void, captured = false;
      const nativeAbort = new Promise<void>(resolve => { aborted = resolve; });
      IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
        const tx = transaction.apply(this, args);
        if (args[1] === 'readwrite' && !captured) {
          captured = true;
          let callback: ((this: IDBTransaction, event: Event) => unknown) | null = null;
          Object.defineProperty(tx, 'onabort', { configurable: true,
            set(value: typeof callback) { callback = value; }, get() { return callback; } });
          tx.addEventListener('abort', event => {
            release = () => callback?.call(tx, event);
            aborted();
          }, { once: true });
        }
        return tx;
      };
      let once = true;
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
        const request = put.apply(this, args);
        if (once) {
          once = false;
          if (trigger === 'request throws') throw new Error('Private native request detail');
          request.addEventListener('success', () => store.close(), { once: true });
        }
        return request;
      };
      let writeState = 'pending', queueState = 'pending';
      try {
        const write = store.save({ ...fixture, title: 'Must not survive rollback' }, '2026-10-04')
          .then(() => { writeState = 'fulfilled'; return ''; }, error => { writeState = 'rejected'; return (error as Error).message; });
        const queued = retry.exportRaw().then(value => { queueState = 'fulfilled'; return value; });
        await nativeAbort;
        // Actual rollback occurred, but the application's terminal callback is
        // deliberately still queued. Read storage via an independent connection.
        const rawAfterRollback = await h.rawRecord(name);
        const atBarrier = { writeState, queueState };
        release();
        const message = await write, queuedRaw = await queued;
        IDBDatabase.prototype.transaction = transaction; IDBObjectStore.prototype.put = put;
        await retry.save({ ...fixture, title: 'Confirmed retry' }, '2026-10-04');
        return { atBarrier, message, rawPreserved: rawAfterRollback === before,
          queuePreserved: queuedRaw === before, retry: (await retry.load('2026-10-04'))!.title };
      } finally {
        IDBDatabase.prototype.transaction = transaction; IDBObjectStore.prototype.put = put;
        release?.(); store.close(); retry.close();
      }
    }, trigger);
    expect(result.atBarrier).toEqual({ writeState: 'pending', queueState: 'pending' });
    expect(result.message).toMatch(/storage.*backup.*retry/i);
    expect(result.message).not.toContain('Private native request detail');
    expect(result.rawPreserved).toBe(true);
    expect(result.queuePreserved).toBe(true);
    expect(result.retry).toBe('Confirmed retry');
  });
}

test('closing after actual native commit reports the committed write and refuses new work', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage, name = 'closed-after-native-commit';
    const store = new h.NotebookStore(name), transaction = IDBDatabase.prototype.transaction;
    let closedAfterCommit = false;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
      const tx = transaction.apply(this, args);
      if (args[1] === 'readwrite') tx.addEventListener('complete', () => {
        closedAfterCommit = true; store.close();
      }, { once: true });
      return tx;
    };
    const fixture = h.fixture('Durably committed before close');
    fixture.notes = [{ ticker: 'AAA', text: 'Keep the actual committed note' }];
    try {
      const outcome = await store.save(fixture, '2026-10-04').then(() => 'fulfilled', error => (error as Error).message);
      IDBDatabase.prototype.transaction = transaction;
      const raw = await h.rawRecord(name);
      const closed = await store.clear().then(() => 'fulfilled', error => (error as Error).message);
      return { outcome, closedAfterCommit, exact: raw === h.serializeNotebook(fixture, '2026-10-04'), closed };
    } finally { IDBDatabase.prototype.transaction = transaction; store.close(); }
  });
  expect(result.closedAfterCommit).toBe(true);
  expect(result.outcome).toBe('fulfilled');
  expect(result.exact).toBe(true);
  expect(result.closed).toMatch(/closed/i);
});
