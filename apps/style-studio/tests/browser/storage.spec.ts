import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  const body = await readFile(new URL('../../dist/tests/storage-harness.html', import.meta.url), 'utf8');
  await page.route('**/tests/storage-harness.html', route => route.fulfill({ contentType: 'text/html', body }));
  await page.goto('/tests/storage-harness.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.storageHarness))).toBe(true);
});

test('real IndexedDB opens the version-one singleton and persists across store reopen', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.storageHarness;
    const store = await h.openProjectStore();
    const empty = await store.load();
    await store.save(h.createProject('Persistent profile'));
    await store.close();
    const reopened = await h.openProjectStore();
    const loaded = await reopened.load();
    const raw = await h.rawDatabase();
    const schema = { name: raw.name, version: raw.version, stores: Array.from(raw.objectStoreNames) };
    raw.close(); await reopened.close();
    return { empty, title: loaded?.title, schema };
  });
  expect(result).toEqual({ empty: null, title: 'Persistent profile', schema: { name: 'style-studio', version: 1, stores: ['profiles'] } });
});

test('an existing incompatible database is reported without silently replacing it', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const raw = await window.storageHarness.rawDatabase();
    raw.close();
    const message = await window.storageHarness.openProjectStore().then(store => store.close().then(() => ''), error => String(error));
    const unchanged = await window.storageHarness.rawDatabase();
    const stores = Array.from(unchanged.objectStoreNames); unchanged.close();
    return { message, stores };
  });
  expect(result.message).toMatch(/schema|storage|database|profile/i);
  expect(result.stores).toEqual([]);
});

test('queued saves capture nested data at call time before earlier transactions finish', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.storageHarness, store = await h.openProjectStore();
    const gate = h.holdNextWrite();
    let firstSettled = false;
    const first = store.save(h.createProject('Blocking')).then(() => { firstSettled = true; });
    await gate.started;
    const next = h.createProject('Captured');
    next.pieces.push({ id: '1'.repeat(32), name: 'Original piece', category: 'top', photoId: null,
      tags: { palette: 'neutral', fit: 'regular', style: 'classic', formality: 'casual' } });
    const queued = store.save(next);
    next.title = 'Mutated later'; next.pieces[0].name = 'Mutated piece'; next.pieces[0].tags.style = 'sporty';
    await Promise.resolve();
    const settledBeforeComplete = firstSettled;
    gate.release(); await first; await queued;
    const saved = await store.load();
    saved!.pieces[0].name = 'Mutated load';
    const fresh = await store.load(); await store.close();
    return { settledBeforeComplete, title: fresh?.title, piece: fresh?.pieces[0].name, style: fresh?.pieces[0].tags.style };
  });
  expect(result).toEqual({ settledBeforeComplete: false, title: 'Captured', piece: 'Original piece', style: 'classic' });
});

test('save and clear commit in invocation order and do not resurrect an older profile', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.storageHarness, store = await h.openProjectStore();
    const first = store.save(h.createProject('Old'));
    const clear = store.clear();
    await Promise.all([first, clear]);
    const cleared = await store.load();
    const saves = [store.save(h.createProject('First')), store.clear(), store.save(h.createProject('Newest'))];
    await Promise.all(saves);
    const latest = await store.load(); await store.close();
    return { cleared, title: latest?.title };
  });
  expect(result).toEqual({ cleared: null, title: 'Newest' });
});

test('a real aborted write and invalid save do not poison later queued operations', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.storageHarness, store = await h.openProjectStore();
    await store.save(h.createProject('Original'));
    h.abortNextWrite();
    const failed = store.save(h.createProject('Aborted'));
    const recovered = store.save(h.createProject('Recovered'));
    const outcomes = await Promise.allSettled([failed, recovered]);
    const failedMessage = outcomes[0].status === 'rejected' ? String(outcomes[0].reason) : '';
    const invalid = await store.save({ ...h.createProject(), title: '' }).then(() => false, () => true);
    await store.save(h.createProject('After invalid'));
    const latest = await store.load(); await store.close();
    return { statuses: outcomes.map(outcome => outcome.status), failedMessage, invalid, title: latest?.title };
  });
  expect(result.statuses).toEqual(['rejected', 'fulfilled']);
  expect(result.failedMessage).toMatch(/storage|save|export/i);
  expect(result.invalid).toBe(true); expect(result.title).toBe('After invalid');
});

test('close waits for accepted writes and immediately rejects all new operations', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.storageHarness, store = await h.openProjectStore();
    const gate = h.holdNextWrite();
    const first = store.save(h.createProject('First'));
    await gate.started;
    const second = store.save(h.createProject('Accepted latest'));
    let closed = false;
    const closing = store.close().then(() => { closed = true; });
    const rejected = await Promise.all([
      store.load().then(() => false, () => true),
      store.save(h.createProject('Too late')).then(() => false, () => true),
      store.clear().then(() => false, () => true),
    ]);
    const closedBeforeRelease = closed;
    gate.release(); await Promise.all([first, second, closing]); await store.close();
    const reopened = await h.openProjectStore(), latest = await reopened.load(); await reopened.close();
    return { rejected, closedBeforeRelease, title: latest?.title };
  });
  expect(result).toEqual({ rejected: [true, true, true], closedBeforeRelease: false, title: 'Accepted latest' });
});

test('corrupt records including undefined remain untouched after failed loads', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.storageHarness, store = await h.openProjectStore(), raw = await h.rawDatabase();
    const cases: unknown[] = [null, undefined, { schemaVersion: 99 }, { ...h.createProject('Bad'), unknownField: true }];
    const results = [];
    for (const value of cases) {
      await h.rawWrite(raw, value);
      const message = await store.load().then(() => '', error => String(error));
      const unchanged = JSON.stringify(await h.rawRead(raw)) === JSON.stringify(value);
      results.push({ message, unchanged });
    }
    await store.clear();
    const empty = await store.load();
    raw.close(); await store.close();
    return { results, empty };
  });
  expect(result.empty).toBeNull();
  expect(result.results).toHaveLength(4);
  for (const item of result.results) {
    expect(item.message).toMatch(/saved|profile|corrupt|invalid/i);
    expect(item.unchanged).toBe(true);
  }
});
