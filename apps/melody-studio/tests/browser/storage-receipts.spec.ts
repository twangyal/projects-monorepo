import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { ReferenceStorage, SavedCopyConflict } from '../../src/reference-storage.ts';
import type { ReferenceBundle } from '../../src/reference-types.ts';

// Original descriptors/PCM. No producer encoder/validator creates expectations.
const DB = 'melody-studio.projects';
const pcmA = [0, 0, 255, 127, 0, 128, 1, 0, 255, 255, 52, 18, 204, 237, 0, 0];
const pcmB = [1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0];
function literal(title: string, suffix: string, pcm: number[]) {
  const id = `00000000-0000-4000-8000-0000000000${suffix}`;
  return { document: { schemaVersion: 1 as const, composition: { version: 1 as const, title, tempo: 108,
    tracks: [{ id: 'original-track', name: 'Original voice', instrument: 'triangle' as const, volume: .7, muted: false,
      notes: [{ id: 'original-note', pitch: 69, start: .03125, duration: .8125, velocity: .63 }] }] },
  references: [{ trackId: 'original-track', assetId: id }] },
  asset: { id, kind: 'audio-file' as const, captureTempo: 108, decodedSampleRate: 22050, decodedChannels: 1,
    decodedFrames: 8, analyzedFrames: 8, frameCount: 8,
    sha256: createHash('sha256').update(Buffer.from(pcm)).digest('hex'), pcm } };
}
const fixtures = [literal('Original saved A', '98', pcmA), literal('Independent winner B', '99', pcmB),
  literal('Newest memory C', '97', [...pcmA].reverse())];
type Fixture = ReturnType<typeof literal>;
type StoredSnapshot = { exists: boolean; rowType: string; row: unknown;
  assets: { id: string; declared: string; hash: string; pcm: number[]; size: number; type: string }[] };
interface BrowserOracle {
  store(): ReferenceStorage;
  bundle(index: number): ReferenceBundle;
  seed(index: number, row?: 'legacy' | 'undefined'): Promise<void>;
  snapshot(): Promise<StoredSnapshot>;
  alterPcm(index: number, damaged: boolean): Promise<void>;
}
type ReceiptWindow = Window & { storageReceiptHarness: { ReferenceStorage: typeof ReferenceStorage; SavedCopyConflict: typeof SavedCopyConflict };
  receiptOracle: BrowserOracle };

async function initialize(page: Page) {
  await page.goto('/tests/storage-receipts-harness.html');
  await expect(page.locator('#storage-receipts-ready')).toHaveText('Storage receipt harness ready');
  await page.evaluate(async ({ name, originals }) => {
    const target = window as unknown as ReceiptWindow;
    const open = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('projects'); request.result.createObjectStore('assets'); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error('Native transaction aborted'));
      tx.onerror = () => { /* Native abort is authoritative. */ };
    });
    const assetRow = (fixture: Fixture) => {
      const { pcm, ...metadata } = fixture.asset; return { ...metadata, pcm: new Blob([new Uint8Array(pcm)]) };
    };
    target.receiptOracle = {
      store: () => new target.storageReceiptHarness.ReferenceStorage(indexedDB),
      bundle: index => {
        const fixture = structuredClone(originals[index]); const { sha256: ignored, pcm, ...asset } = fixture.asset;
        void ignored; return { document: fixture.document, assets: [{ ...asset, pcm: new Uint8Array(pcm) }] };
      },
      async seed(index, row = 'legacy') {
        const db = await open();
        try {
          const tx = db.transaction(['projects', 'assets'], 'readwrite'), done = complete(tx);
          tx.objectStore('assets').clear();
          tx.objectStore('projects').put(row === 'undefined' ? undefined :
            { schemaVersion: 1, document: structuredClone(originals[index].document) }, 'current');
          if (row !== 'undefined') tx.objectStore('assets').put(assetRow(originals[index]), originals[index].asset.id);
          await done;
        } finally { db.close(); }
      },
      async snapshot() {
        const db = await open();
        try {
          const tx = db.transaction(['projects', 'assets'], 'readonly'), done = complete(tx);
          const key = tx.objectStore('projects').getKey('current'), descriptor = tx.objectStore('projects').get('current');
          const rows = tx.objectStore('assets').getAll(); await done;
          const assets = await Promise.all(rows.result.map(async (entry: { id: string; sha256: string; pcm: Blob }) => {
            const bytes = new Uint8Array(await entry.pcm.arrayBuffer());
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
            return { id: entry.id, declared: entry.sha256, hash, pcm: Array.from(bytes), size: entry.pcm.size, type: entry.pcm.type };
          }));
          return { exists: key.result !== undefined, rowType: typeof descriptor.result,
            row: descriptor.result === undefined ? null : descriptor.result, assets };
        } finally { db.close(); }
      },
      async alterPcm(index, damaged) {
        const db = await open();
        try {
          const tx = db.transaction('assets', 'readwrite'), done = complete(tx), row = assetRow(originals[index]);
          if (damaged) row.pcm = new Blob([new Uint8Array(16)]);
          tx.objectStore('assets').put(row, row.id); await done;
        } finally { db.close(); }
      },
    };
  }, { name: DB, originals: fixtures });
}
async function snapshot(page: Page) { return page.evaluate(() => (window as unknown as ReceiptWindow).receiptOracle.snapshot()); }
function expectAsset(actual: StoredSnapshot, index: number) {
  const fixture = fixtures[index];
  expect(actual.assets).toEqual([{ id: fixture.asset.id, declared: fixture.asset.sha256,
    hash: fixture.asset.sha256, pcm: fixture.asset.pcm, size: 16, type: '' }]);
}

test('native CAS: two accepted instances race, exactly one complete graph wins without losing PCM', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle; await oracle.seed(0);
    const a = oracle.store(), b = oracle.store();
    try {
      a.acceptLoad((await a.load()).receipt); b.acceptLoad((await b.load()).receipt);
      const saves = await Promise.allSettled([a.save(oracle.bundle(1)), b.save(oracle.bundle(2))]);
      return saves.map(item => ({ status: item.status, error: item.status === 'rejected' ? item.reason instanceof (window as unknown as ReceiptWindow).storageReceiptHarness.SavedCopyConflict ? 'SavedCopyConflict' : 'OtherError' : null }));
    } finally { a.close(); b.close(); }
  });
  expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter(item => item.error === 'SavedCopyConflict')).toHaveLength(1);
  const winner = result[0].status === 'fulfilled' ? 1 : 2, actual = await snapshot(page);
  expect(actual.row).toMatchObject({ schemaVersion: 2, document: fixtures[winner].document }); expectAsset(actual, winner);
});

test('native legacy load: complete descriptor and Blob bytes stay untouched until an accepted edit', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle; await oracle.seed(0); const before = await oracle.snapshot();
    const store = oracle.store();
    try {
      const loaded = await store.load(); const afterLoad = await oracle.snapshot(); store.acceptLoad(loaded.receipt);
      const afterAccept = await oracle.snapshot(); await store.save(oracle.bundle(1));
      return { before, afterLoad, afterAccept, loadedTitle: loaded.bundle?.document.composition.title };
    } finally { store.close(); }
  });
  expect(result.loadedTitle).toBe('Original saved A'); expect(result.afterLoad).toEqual(result.before);
  expect(result.afterAccept).toEqual(result.before); expect(result.before.row).toEqual({ schemaVersion: 1, document: fixtures[0].document });
  const actual = await snapshot(page); expect(actual.row).toMatchObject({ schemaVersion: 2, document: fixtures[1].document }); expectAsset(actual, 1);
});

test('native authority: an unaccepted newer load cannot silently authorize overwriting another writer', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle; await oracle.seed(0);
    const stale = oracle.store(), writer = oracle.store();
    try {
      stale.acceptLoad((await stale.load()).receipt); writer.acceptLoad((await writer.load()).receipt);
      await writer.save(oracle.bundle(1)); const unaccepted = await stale.load();
      let rejected = ''; try { await stale.save(oracle.bundle(2)); } catch (error) { rejected = error instanceof (window as unknown as ReceiptWindow).storageReceiptHarness.SavedCopyConflict ? 'SavedCopyConflict' : 'OtherError'; }
      return { rejected, loadedTitle: unaccepted.bundle?.document.composition.title };
    } finally { stale.close(); writer.close(); }
  });
  expect(result).toEqual({ rejected: 'SavedCopyConflict', loadedTitle: 'Independent winner B' }); expectAsset(await snapshot(page), 1);
});

test('native failed hash read does not erase earlier authority or adopt the damaged snapshot', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle; await oracle.seed(0); const store = oracle.store();
    try {
      store.acceptLoad((await store.load()).receipt); await oracle.alterPcm(0, true);
      let failed = false; try { await store.load(); } catch { failed = true; }
      const damaged = await oracle.snapshot(); await oracle.alterPcm(0, false);
      await store.save(oracle.bundle(1)); return { failed, damaged };
    } finally { store.close(); }
  });
  expect(result.failed).toBe(true); expect(result.damaged.assets[0].hash).not.toBe(fixtures[0].asset.sha256);
  expectAsset(await snapshot(page), 1);
});

test('native presence: proven absence permits first save, present undefined remains protected', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle, first = oracle.store();
    try { const absent = await first.load(); first.acceptLoad(absent.receipt); await first.save(oracle.bundle(0)); }
    finally { first.close(); }
    await oracle.seed(0, 'undefined'); const before = await oracle.snapshot(), corrupt = oracle.store();
    try {
      let loadFailed = false, saveFailed = false; try { await corrupt.load(); } catch { loadFailed = true; }
      try { await corrupt.save(oracle.bundle(1)); } catch { saveFailed = true; }
      return { before, after: await oracle.snapshot(), loadFailed, saveFailed };
    } finally { corrupt.close(); }
  });
  expect(result.loadFailed).toBe(true); expect(result.saveFailed).toBe(true);
  expect(result.before).toEqual({ exists: true, rowType: 'undefined', row: null, assets: [] }); expect(result.after).toEqual(result.before);
});

test('native private receipts: cloned, foreign and consumed replacement receipts never grant write authority', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle; await oracle.seed(0);
    const a = oracle.store(), b = oracle.store(); let rejected = 0;
    try {
      const loaded = await a.load();
      for (const action of [() => a.acceptLoad(structuredClone(loaded.receipt)), () => b.acceptLoad(loaded.receipt)]) {
        try { action(); } catch { rejected++; }
      }
      a.acceptLoad(loaded.receipt); const review = await a.reviewReplacement();
      for (const action of [() => a.replace(oracle.bundle(1), structuredClone(review.receipt)), () => b.replace(oracle.bundle(1), review.receipt)]) {
        try { await action(); } catch { rejected++; }
      }
      const unchanged = await oracle.snapshot(); await a.replace(oracle.bundle(1), review.receipt);
      try { await a.replace(oracle.bundle(2), review.receipt); } catch { rejected++; }
      return { rejected, unchanged, summary: review.summary };
    } finally { a.close(); b.close(); }
  });
  expect(result.rejected).toBe(5); expectAsset(result.unchanged, 0);
  expect(result.summary).toEqual({ readable: true, title: 'Original saved A', tracks: 1, references: 1 }); expectAsset(await snapshot(page), 1);
});

test('native replacement CAS: a winner written after review invalidates that exact reviewed receipt', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle; await oracle.seed(0);
    const a = oracle.store(), b = oracle.store();
    try {
      a.acceptLoad((await a.load()).receipt); b.acceptLoad((await b.load()).receipt);
      const review = await b.reviewReplacement(); await a.save(oracle.bundle(1));
      let error = ''; try { await b.replace(oracle.bundle(2), review.receipt); } catch (caught) { error = caught instanceof (window as unknown as ReceiptWindow).storageReceiptHarness.SavedCopyConflict ? 'SavedCopyConflict' : 'OtherError'; }
      const winner = await oracle.snapshot(); const fresh = await b.reviewReplacement(); await b.replace(oracle.bundle(2), fresh.receipt);
      return { error, winner };
    } finally { a.close(); b.close(); }
  });
  expect(result.error).toBe('SavedCopyConflict'); expectAsset(result.winner, 1); expectAsset(await snapshot(page), 2);
});

test('native transaction rollback: abort after put success leaves graph and expected receipt unchanged for retry', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle; await oracle.seed(0); const store = oracle.store();
    const original = IDBObjectStore.prototype.put; let successes = 0, aborts = 0;
    try {
      store.acceptLoad((await store.load()).receipt); const before = await oracle.snapshot();
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const request = original.apply(this, args);
        if (this.name === 'projects' && aborts === 0) request.addEventListener('success', () => {
          successes++; aborts++; this.transaction.abort();
        }, { once: true });
        return request;
      };
      let failed = false; try { await store.save(oracle.bundle(1)); } catch { failed = true; }
      IDBObjectStore.prototype.put = original; const afterAbort = await oracle.snapshot();
      await store.save(oracle.bundle(2)); return { before, afterAbort, failed, successes, aborts };
    } finally { IDBObjectStore.prototype.put = original; store.close(); }
  });
  expect(result.failed).toBe(true); expect(result.successes).toBe(1); expect(result.aborts).toBe(1);
  expect(result.afterAbort).toEqual(result.before); expectAsset(result.before, 0); expectAsset(await snapshot(page), 2);
});

test('native input atomicity: invalid bundle and save before acceptance cannot clear retained audio', async ({ page }) => {
  await initialize(page);
  const result = await page.evaluate(async () => {
    const oracle = (window as unknown as ReceiptWindow).receiptOracle; await oracle.seed(0); const store = oracle.store();
    try {
      const loaded = await store.load(), before = await oracle.snapshot(); let unaccepted = false, invalid = false;
      try { await store.save(oracle.bundle(1)); } catch { unaccepted = true; }
      store.acceptLoad(loaded.receipt); const candidate = oracle.bundle(1); candidate.document.composition.tracks[0].notes[0].pitch = 97;
      try { await store.save(candidate); } catch { invalid = true; }
      return { unaccepted, invalid, before, after: await oracle.snapshot() };
    } finally { store.close(); }
  });
  expect(result.unaccepted).toBe(true); expect(result.invalid).toBe(true); expect(result.after).toEqual(result.before); expectAsset(result.after, 0);
});
