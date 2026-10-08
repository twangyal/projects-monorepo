/** Independent real IndexedDB oracle. No producer implementation supplies expected records. */
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Project, SavedLook } from '../../src/types.ts';
import type { SavedCopyReceipt } from '../../src/storage.ts';

const imageId = 'a'.repeat(32);
function original(photo: string): Project {
  const pieces: Project['pieces'] = [
    { id: '1'.repeat(32), name: 'Original top 🌿', category: 'top', photoId: imageId, tags: { palette: 'neutral', fit: 'regular', style: 'classic', formality: 'casual' } },
    { id: '2'.repeat(32), name: 'Original bottom', category: 'bottom', photoId: null, tags: { palette: 'neutral', fit: 'regular', style: 'classic', formality: 'casual' } },
    { id: '3'.repeat(32), name: 'Original shoes', category: 'shoes', photoId: null, tags: { palette: 'neutral', fit: 'regular', style: 'classic', formality: 'casual' } },
  ];
  return { schemaVersion: 1, title: 'Independent complete original', pieces,
    examples: [{ id: '4'.repeat(32), caption: 'Literal original opinion', label: 'like', origin: 'tagged', features: [1,0,0,0,0,1,0,0,1,0,0,1,0,0], photoId: imageId, sourceLookId: null }],
    looks: [{ id: '5'.repeat(32), name: 'Original saved look', notes: 'Literal note\nsecond line', pieces: structuredClone(pieces) as unknown as SavedLook['pieces'] }],
    photos: [{ id: imageId, mime: 'image/jpeg', width: 720, height: 720, dataUrl: photo }] };
}
async function fixture(page: Page): Promise<Project> {
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 720;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!;
    ctx.fillStyle = '#1f6b34'; ctx.fillRect(0,0,720,720); ctx.fillStyle = '#ebcc3c'; ctx.fillRect(80,100,160,300);
    return canvas.toDataURL('image/jpeg', .9);
  });
  return original(photo);
}
async function ready(page: Page) {
  const body = await readFile(new URL('../../dist/tests/storage-harness.html', import.meta.url), 'utf8');
  await page.route('**/tests/storage-harness.html', route => route.fulfill({ contentType: 'text/html', body }));
  await page.goto('/tests/storage-harness.html');
  await expect.poll(() => page.evaluate(() => !!window.storageHarness)).toBe(true);
}
test.beforeEach(async ({ page }) => { await ready(page); });

test('oracle full saved graph wins against a stale instance without receipt promotion from reload', async ({ page }) => {
  const p = await fixture(page), winner = structuredClone(p); winner.title = 'Winner'; winner.pieces[0].tags.style = 'sporty'; winner.examples[0].label = 'pass'; winner.looks[0].notes = 'Winner keeps every original photo byte';
  const result = await page.evaluate(async ({ p, winner }) => {
    const h = window.storageHarness, a = await h.openProjectStore(); a.acceptLoad((await a.load()).receipt); await a.save(p);
    const b = await h.openProjectStore(); b.acceptLoad((await b.load()).receipt);
    await a.save(winner);
    const discardedLoad = await b.load(); // A returned read alone cannot authorize overwrite.
    discardedLoad.project!.title = 'Caller mutation';
    const local = structuredClone(p); local.title = 'Stale local';
    const conflict = await b.save(local).then(() => false, error => error instanceof h.SavedCopyConflict);
    const later = await b.save(local).then(() => false, () => true);
    const raw = await h.rawDatabase(), saved = await h.rawRead(raw); raw.close(); await a.close(); await b.close();
    return { conflict, later, saved, local };
  }, { p, winner });
  expect(result.conflict).toBe(true); expect(result.later).toBe(true);
  expect(result.saved).toMatchObject({ schemaVersion: 2, project: winner });
  expect((result.saved as { project: Project }).project).toEqual(winner);
  expect(result.local).toEqual({ ...p, title: 'Stale local' });
});

test('oracle simultaneous native readwrite scopes admit only one complete winner', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, a = await h.openProjectStore(), b = await h.openProjectStore();
    a.acceptLoad((await a.load()).receipt); b.acceptLoad((await b.load()).receipt);
    const outcomes = await Promise.allSettled([a.save({ ...p, title: 'A' }), b.save({ ...p, title: 'B' })]);
    const raw = await h.rawDatabase(), value = await h.rawRead(raw); raw.close(); await a.close(); await b.close();
    return { outcomes: outcomes.map(x => x.status), value };
  }, p);
  expect(result.outcomes.filter(x => x === 'fulfilled')).toHaveLength(1);
  expect(result.outcomes.filter(x => x === 'rejected')).toHaveLength(1);
  const expected = result.outcomes[0] === 'fulfilled' ? 'A' : 'B';
  expect((result.value as { project: Project }).project).toEqual({ ...p, title: expected });
});

test('oracle queued own writes detach full graph at admission and advance after native complete', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt);
    const gate = h.holdNextWrite(); let settled = false;
    const first = store.save(p).then(() => { settled = true; }); await gate.started;
    const next = structuredClone(p); next.title = 'Queued'; next.looks[0].notes = 'Captured notes';
    const second = store.save(next); next.photos[0].dataUrl = 'mutated'; next.looks[0].notes = 'Mutated after call';
    const before = settled; gate.release(); await first; await second;
    const loaded = await store.load(); await store.close(); return { before, project: loaded.project };
  }, p);
  const expected = structuredClone(p); expected.title = 'Queued'; expected.looks[0].notes = 'Captured notes';
  expect(result).toEqual({ before: false, project: expected });
});

test('oracle put request success followed by native abort neither publishes nor advances authority', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt); await store.save(p);
    const originalPut = IDBObjectStore.prototype.put; let requestSucceeded = false;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      const request = originalPut.call(this, value, key);
      if (this.name === 'profiles') { IDBObjectStore.prototype.put = originalPut; request.addEventListener('success', () => { requestSucceeded = true; this.transaction.abort(); }, { once: true }); }
      return request;
    };
    let failed = false;
    try { await store.save({ ...p, title: 'Aborted' }); } catch { failed = true; } finally { IDBObjectStore.prototype.put = originalPut; }
    const raw = await h.rawDatabase(), afterAbort = await h.rawRead(raw);
    await store.save({ ...p, title: 'Retry' }); const afterRetry = await h.rawRead(raw);
    raw.close(); await store.close(); return { requestSucceeded, failed, afterAbort, afterRetry };
  }, p);
  expect(result.requestSucceeded).toBe(true); expect(result.failed).toBe(true);
  expect((result.afterAbort as { project: Project }).project).toEqual(p);
  expect((result.afterRetry as { project: Project }).project).toEqual({ ...p, title: 'Retry' });
});

test('oracle version1 upgrade preserves exact legacy value and fences old writers', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness;
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('style-studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('profiles'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await h.rawWrite(old, p); old.close();
    let puts = 0; const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) { puts++; return put.call(this, value, key); };
    const store = await h.openProjectStore(), loaded = await store.load();
    const raw = await h.rawDatabase(), before = await h.rawRead(raw), noMigrationPut = puts;
    const refused = await new Promise<string>(resolve => { const r = indexedDB.open('style-studio', 1); r.onerror = () => { r.onerror = null; resolve(r.error?.name || 'error'); }; r.onsuccess = () => { r.result.close(); resolve('opened'); }; });
    store.acceptLoad(loaded.receipt); await store.save({ ...p, title: 'First new edit' });
    const after = await h.rawRead(raw); IDBObjectStore.prototype.put = put; raw.close(); await store.close();
    return { before, noMigrationPut, refused, after };
  }, p);
  expect(result.before).toEqual(p); expect(result.noMigrationPut).toBe(0); expect(result.refused).toBe('VersionError');
  expect(result.after).toEqual({ schemaVersion: 2, revision: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), project: { ...p, title: 'First new edit' } });
});

test('oracle absent key differs from present undefined and reviewed repair never silently loads corrupt data', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(), absent = await store.load();
    const noAuthority = await store.save(p).then(() => false, () => true);
    const raw = await h.rawDatabase(); await h.rawWrite(raw, undefined);
    const rejectedLoad = await store.load().then(() => false, () => true);
    const review = await store.reviewReplacement(); const summary = review.summary;
    await store.replace(p, review.receipt);
    const repaired = await store.load(); const tokenReuse = await store.replace(p, review.receipt).then(() => false, () => true);
    raw.close(); await store.close(); return { absent: absent.project, noAuthority, rejectedLoad, summary, repaired: repaired.project, tokenReuse };
  }, p);
  expect(result).toEqual({ absent: null, noAuthority: true, rejectedLoad: true, summary: { present: true, readable: false, title: null, pieces: null, examples: null, looks: null, photos: null }, repaired: p, tokenReuse: true });
});

test('oracle receipt purpose instance one-use and forgery reject without native mutation', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, a = await h.openProjectStore(), b = await h.openProjectStore();
    const read = await a.load(), review = await a.reviewReplacement(); let rejects = 0;
    const syncReject = (fn: () => void) => { try { fn(); } catch { rejects++; } };
    syncReject(() => a.acceptLoad({} as SavedCopyReceipt)); syncReject(() => b.acceptLoad(read.receipt));
    syncReject(() => a.acceptLoad(structuredClone(read.receipt))); syncReject(() => a.acceptLoad(review.receipt));
    await a.replace(p, read.receipt).then(() => {}, () => { rejects++; });
    a.acceptLoad(read.receipt); syncReject(() => a.acceptLoad(read.receipt));
    await a.save(p); const raw = await h.rawDatabase(), saved = await h.rawRead(raw);
    raw.close(); await a.close(); await b.close(); return { rejects, saved };
  }, p);
  expect(result.rejects).toBe(6); expect((result.saved as { project: Project }).project).toEqual(p);
});

test('oracle third writer invalidates reviewed replacement while keeping entire winner intact', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, a = await h.openProjectStore(), b = await h.openProjectStore();
    a.acceptLoad((await a.load()).receipt); await a.save(p);
    const review = await b.reviewReplacement(); await a.save({ ...p, title: 'Third writer' });
    const refused = await b.replace({ ...p, title: 'Replacement' }, review.receipt).then(() => false, error => error instanceof h.SavedCopyConflict);
    const raw = await h.rawDatabase(), preserved = await h.rawRead(raw);
    const fresh = await b.reviewReplacement(); await b.replace({ ...p, title: 'Reviewed now' }, fresh.receipt); await b.save({ ...p, title: 'Own next' });
    const final = await h.rawRead(raw); raw.close(); await a.close(); await b.close(); return { refused, preserved, final };
  }, p);
  expect(result.refused).toBe(true); expect((result.preserved as { project: Project }).project).toEqual({ ...p, title: 'Third writer' });
  expect((result.final as { project: Project }).project).toEqual({ ...p, title: 'Own next' });
});

test('oracle raw negative zero differs from zero while reordered object fields are value-identical', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(), raw = await h.rawDatabase();
    p.examples[0].features = [...p.examples[0].features] as typeof p.examples[0]['features']; (p.examples[0].features as unknown as number[])[1] = -0;
    await h.rawWrite(raw, p); const load = await store.load(); store.acceptLoad(load.receipt);
    const reordered = Object.fromEntries(Object.entries(p).reverse()); await h.rawWrite(raw, reordered);
    await store.save({ ...p, title: 'Order independent' });
    const current = await h.rawRead(raw) as { schemaVersion: number; revision: string; project: Project };
    const accepted = await store.load(); store.acceptLoad(accepted.receipt);
    (current.project.examples[0].features as unknown as number[])[1] = Object.is(current.project.examples[0].features[1], -0) ? 0 : -0;
    await h.rawWrite(raw, current);
    const conflict = await store.save({ ...p, title: 'Must refuse sign change' }).then(() => false, error => error instanceof h.SavedCopyConflict);
    const after = await h.rawRead(raw); raw.close(); await store.close(); return { conflict, after, expected: current };
  }, p);
  expect(result.conflict).toBe(true); expect(result.after).toEqual(result.expected);
});

test('oracle malformed ordinary records permit review but native cyclic and unbounded values do not', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(), raw = await h.rawDatabase(), summaries = [];
    for (const value of [null, { schemaVersion: 99 }, { schemaVersion: 2, revision: 'bad', project: p }, { ...p, unknown: true }]) {
      await h.rawWrite(raw, value); const failed = await store.load().then(() => false, () => true);
      const review = await store.reviewReplacement(); summaries.push({ failed, summary: review.summary, unchanged: JSON.stringify(await h.rawRead(raw)) === JSON.stringify(value) });
    }
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    const deep: unknown[] = []; let cursor = deep; for (let i = 0; i < 34; i++) { const next: unknown[] = []; cursor.push(next); cursor = next; }
    const rejected = [];
    for (const value of [cyclic, new Date(0), NaN, new Array(2), deep, Array.from({ length: 100001 }, () => null)]) {
      await h.rawWrite(raw, value); rejected.push(await store.reviewReplacement().then(() => false, () => true));
    }
    raw.close(); await store.close(); return { summaries, rejected };
  }, p);
  expect(result.summaries).toHaveLength(4);
  for (const row of result.summaries) { expect(row.failed).toBe(true); expect(row.unchanged).toBe(true); expect(row.summary.readable).toBe(false); expect(row.summary.present).toBe(true); }
  expect(result.rejected).toEqual([true,true,true,true,true,true]);
});

test('oracle exact portable and wrapper comparison byte ceilings distinguish plus one', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.storageHarness, store = await h.openProjectStore(), raw = await h.rawDatabase();
    const portable = 8388608, wrapper = 8388688, results = [];
    if (h.MAX_STORED_BYTES !== wrapper) throw Error('Frozen wrapper constant mismatch');
    for (const [kind, cap] of [['ordinary', portable], ['wrapper', wrapper]] as const) {
      const base = kind === 'ordinary' ? { invalid: '' } : { schemaVersion: 2, invalid: '' };
      const overhead = new TextEncoder().encode(JSON.stringify(base)).length;
      for (const excess of [0,1]) {
        const value = { ...base, invalid: 'x'.repeat(cap - overhead + excess) };
        await h.rawWrite(raw, value);
        const accepted = await store.reviewReplacement().then(r => !r.summary.readable, () => false);
        results.push({ kind, bytes: new TextEncoder().encode(JSON.stringify(value)).length, accepted });
      }
    }
    raw.close(); await store.close(); return results;
  });
  expect(result).toEqual([{ kind:'ordinary',bytes:8388608,accepted:true },{ kind:'ordinary',bytes:8388609,accepted:false },{ kind:'wrapper',bytes:8388688,accepted:true },{ kind:'wrapper',bytes:8388689,accepted:false }]);
});

test('oracle close drains accepted writes but forbids receipt acceptance and new operations immediately', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(), load = await store.load(); store.acceptLoad(load.receipt);
    const extra = await store.load(), gate = h.holdNextWrite();
    const first = store.save(p); await gate.started; const second = store.save({ ...p, title: 'Accepted second' });
    let closed = false; const closing = store.close().then(() => { closed = true; });
    let acceptRefused = false; try { store.acceptLoad(extra.receipt); } catch { acceptRefused = true; }
    const refused = await store.load().then(() => false, () => true), before = closed;
    gate.release(); await first; await second; await closing;
    const reopened = await h.openProjectStore(), saved = await reopened.load(); await reopened.close(); return { acceptRefused, refused, before, project: saved.project };
  }, p);
  expect(result).toEqual({ acceptRefused:true,refused:true,before:false,project:{ ...p,title:'Accepted second' } });
});

test('oracle held actual read delivery never invents absence and retires old receipts on protected refusal', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(), old = await store.load();
    store.acceptLoad(old.receipt); await store.save(p); const unused = await store.load();
    const raw = await h.rawDatabase();
    let release = () => {}, nativeComplete!: () => void;
    const completed = new Promise<void>(resolve => { nativeComplete = resolve; });
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(key: IDBValidKey | IDBKeyRange) {
      const request = originalGet.call(this, key);
      if (this.name !== 'profiles' || key !== 'current') return request;
      IDBObjectStore.prototype.get = originalGet;
      const listeners: (EventListenerOrEventListenerObject | null)[] = [];
      const add = request.addEventListener.bind(request);
      add('success', event => {
        event.stopImmediatePropagation();
        release = () => {
          request.onsuccess?.call(request, event);
          for (const listener of listeners) {
            if (typeof listener === 'function') listener.call(request, event);
            else listener?.handleEvent(event);
          }
        };
      }, { once: true });
      request.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
        if (type === 'success') listeners.push(listener); else if (listener) add(type, listener, options);
      }) as typeof request.addEventListener;
      this.transaction.addEventListener('complete', nativeComplete, { once: true });
      return request;
    };
    let settled = false; const started = performance.now();
    const pending = store.load().then(() => { settled = true; return 'fulfilled'; }, () => { settled = true; return 'rejected'; });
    await completed; await Promise.resolve(); const beforeDelivery = settled;
    const outcome = await pending, elapsed = performance.now() - started;
    release(); await Promise.resolve();
    let oldReceiptRefused = false; try { store.acceptLoad(unused.receipt); } catch { oldReceiptRefused = true; }
    const savedRefused = await store.save({ ...p, title: 'After unknown read' }).then(() => false, () => true);
    const untouched = await h.rawRead(raw); raw.close(); await store.close();
    return { beforeDelivery, outcome, elapsed, oldReceiptRefused, savedRefused, untouched, deadline: h.STORAGE_OPERATION_MS };
  }, p);
  // Safe immediate protection or bounded deadline rejection both satisfy admission.
  expect(result.outcome).toBe('rejected'); expect(result.deadline).toBe(10000);
  expect(result.oldReceiptRefused).toBe(true); expect(result.savedRefused).toBe(true);
  expect((result.untouched as { project: Project }).project).toEqual(p);
});

test('oracle versionchange retires receipts and cannot leave an old usable writer', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(), load = await store.load(); store.acceptLoad(load.receipt); await store.save(p);
    const review = await store.reviewReplacement();
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('style-studio', 3); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const ordinary = await store.save({ ...p, title: 'Old connection' }).then(() => false, () => true);
    const replacement = await store.replace(p, review.receipt).then(() => false, () => true);
    const preserved = await h.rawRead(upgraded); upgraded.close(); await store.close(); return { ordinary, replacement, preserved };
  }, p);
  expect(result.ordinary).toBe(true); expect(result.replacement).toBe(true); expect((result.preserved as { project: Project }).project).toEqual(p);
});

test('oracle blocked legacy upgrade refuses and late open releases its database without rewriting bytes', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness;
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('style-studio', 1); request.onupgradeneeded = () => request.result.createObjectStore('profiles'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await h.rawWrite(legacy, p); // Deliberately retain the actual version-one connection.
    const refusal = await h.openProjectStore().then(async store => { await store.close(); return ''; }, error => String(error));
    const before = await h.rawRead(legacy); legacy.close();
    const recovered = await h.openProjectStore(), loaded = await recovered.load(); await recovered.close();
    const versionThree = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('style-studio', 3); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const after = await h.rawRead(versionThree); versionThree.close(); return { refusal, before, loaded: loaded.project, after };
  }, p);
  expect(result.refusal).toMatch(/block|other.*tab|close/i); expect(result.before).toEqual(p); expect(result.loaded).toEqual(p); expect(result.after).toEqual(p);
});

test('oracle genuine live native transaction reaches actual10second deadline without authorizing late writes', async ({ page }) => {
  const p = await fixture(page);
  const result = await page.evaluate(async p => {
    const h = window.storageHarness, store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt); await store.save(p);
    const old = await store.load(), gate = h.holdNextWrite(), started = performance.now();
    const pending = store.save({ ...p, title: 'Deadline candidate' }).then(() => 'fulfilled', () => 'rejected');
    await gate.started;
    let outcome: string;
    try { outcome = await pending; } finally { gate.release(); }
    const elapsed = performance.now() - started;
    let receiptRefused = false; try { store.acceptLoad(old.receipt); } catch { receiptRefused = true; }
    const late = await store.save({ ...p, title: 'Not authorized' }).then(() => false, () => true);
    const raw = await h.rawDatabase(), value = await h.rawRead(raw); raw.close(); await store.close();
    return { outcome, elapsed, receiptRefused, late, value, deadline: h.STORAGE_OPERATION_MS };
  }, p);
  expect(result.outcome).toBe('rejected'); expect(result.elapsed).toBeGreaterThanOrEqual(9500); expect(result.deadline).toBe(10000);
  expect(result.receiptRefused).toBe(true); expect(result.late).toBe(true);
  expect((result.value as { project: Project }).project).toEqual(p);
});
