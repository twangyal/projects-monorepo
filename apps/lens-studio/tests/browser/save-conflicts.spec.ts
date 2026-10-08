/** Independent Lens saved-copy oracle. Native IDB and bitmap decoding remain real. */
import { expect, test } from '@playwright/test';
import type {} from '../storage-harness.ts';
import type { Project } from '../../src/types.ts';
import type { SavedCopyReceipt } from '../../src/storage.ts';

// Browser-only original fixture and native scheduling gates, never producer validators.
function createOracle() {
  const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 3;
  const context = canvas.getContext('2d', { colorSpace: 'srgb' })!;
  context.fillStyle = '#115395'; context.fillRect(0, 0, 4, 3);
  context.fillStyle = '#e7392a'; context.fillRect(0, 0, 2, 1);
  const project: Project = {
    schemaVersion: 1, id: 'aa117000-1111-4111-8111-111111111111', title: 'Independent mask 🌿',
    photo: { id: 'bb117000-2222-4222-8222-222222222222', dataUrl: canvas.toDataURL('image/png'), width: 4, height: 3 },
    settings: { mode: 'perspective', sourceFocal: 50, targetFocal: 100, shiftX: 0.125, shiftY: -0.125, near: 0.7, far: 3 },
    depth: { width: 4, height: 3, labels: btoa(String.fromCharCode(0, 0, 1, 2, 0, 1, 2, 2, 1, 1, 2, 0)) },
  };
  const database = (version = 2, store = true) => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lens-studio.v1', version);
    request.onupgradeneeded = () => { if (store && !request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const read = (db: IDBDatabase) => new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('projects'), request = tx.objectStore('projects').get('current');
    tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error);
  });
  const write = (db: IDBDatabase, value: unknown) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(value, 'current');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  const holdWrite = () => {
    const original = IDBDatabase.prototype.transaction; let hold = true, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (this.name === 'lens-studio.v1' && args[1] === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        const keep = () => {
          const request = tx.objectStore('projects').get('current');
          request.onsuccess = () => { started(); if (hold) keep(); };
        };
        keep();
      }
      return tx;
    };
    return { ready, release: () => { hold = false; IDBDatabase.prototype.transaction = original; } };
  };
  const holdBitmap = () => {
    const original = window.createImageBitmap, originalClose = ImageBitmap.prototype.close;
    let release!: () => void, arrived!: () => void, calls = 0, closes = 0;
    const ready = new Promise<void>(resolve => { arrived = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    ImageBitmap.prototype.close = function () { closes++; return originalClose.call(this); };
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      calls++;
      const bitmap = await Reflect.apply(original, window, args) as ImageBitmap;
      arrived(); await gate; return bitmap;
    }) as typeof createImageBitmap;
    return { ready, release, calls: () => calls, closes: () => closes, restore: () => {
      release(); window.createImageBitmap = original; ImageBitmap.prototype.close = originalClose;
    } };
  };
  return { project, database, read, write, holdWrite, holdBitmap };
}
declare global { interface Window { lensOracle: ReturnType<typeof createOracle> } }

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/storage-harness.html');
  await page.waitForFunction(() => Boolean(window.lensStorage));
  await page.evaluate(`window.lensOracle = (${createOracle.toString()})()`);
});

test('oracle load decodes once, detaches complete source and requires explicit acceptance', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, raw = await o.database(); await o.write(raw, o.project);
    const store = await h.openProjectStore(), bitmap = window.createImageBitmap; let calls = 0;
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => { calls++; return Reflect.apply(bitmap, window, args); }) as typeof createImageBitmap;
    const loaded = await store.load(); window.createImageBitmap = bitmap;
    const pixels = Array.from(loaded.raster!.rgba), expected = structuredClone(o.project);
    loaded.project!.photo.dataUrl = 'caller mutation'; loaded.project!.depth.labels = 'caller mutation'; loaded.raster!.rgba.fill(0);
    const noAuthority = await store.save(o.project).then(() => false, () => true);
    // Missing-authority rejection may invalidate the first receipt; obtain a deliberate new one.
    store.acceptLoad((await store.load()).receipt); await store.save(o.project);
    const saved = await o.read(raw); raw.close(); await store.close(); return { calls, pixels, noAuthority, saved, expected };
  });
  expect(result.calls).toBe(1); expect(result.noAuthority).toBe(true);
  expect(result.pixels).toEqual([231,57,42,255,231,57,42,255,...Array.from({ length: 10 }, () => [17,83,149,255]).flat()]);
  expect(result.saved).toMatchObject({ schemaVersion: 2, project: result.expected });
});

test('oracle stale whole graph loses CAS while an unaccepted fresh load never promotes authority', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, a = await h.openProjectStore(); a.acceptLoad((await a.load()).receipt); await a.save(o.project);
    const b = await h.openProjectStore(); b.acceptLoad((await b.load()).receipt);
    const winner = structuredClone(o.project); winner.title = 'Whole winner'; winner.settings.targetFocal = 125; winner.depth.labels = btoa(String.fromCharCode(2,2,2,1,1,1,0,0,0,2,1,0));
    await a.save(winner); await b.load();
    const conflict = await b.save({ ...o.project, title: 'Losing title' }).then(() => false, e => e instanceof h.SavedCopyConflict);
    const protectedLater = await b.save(o.project).then(() => false, () => true);
    const raw = await o.database(), saved = await o.read(raw); raw.close(); await a.close(); await b.close(); return { conflict, protectedLater, saved, winner };
  });
  expect(result.conflict).toBe(true); expect(result.protectedLater).toBe(true);
  expect(result.saved).toMatchObject({ schemaVersion: 2, project: result.winner });
});

test('oracle simultaneous real CAS admits one complete winner and queued own saves capture all fields', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, a = await h.openProjectStore(), b = await h.openProjectStore();
    a.acceptLoad((await a.load()).receipt); b.acceptLoad((await b.load()).receipt);
    const outcomes = await Promise.allSettled([a.save({ ...o.project, title: 'A' }), b.save({ ...o.project, title: 'B' })]);
    const owner = outcomes[0].status === 'fulfilled' ? a : b;
    const gate = o.holdWrite(); let settled = false; const first = owner.save(o.project).then(() => { settled = true; }); await gate.ready;
    const candidate = structuredClone(o.project); candidate.title = 'Queued'; candidate.settings.near = 0.8;
    const expected = structuredClone(candidate), second = owner.save(candidate);
    candidate.photo.dataUrl = 'mutated'; candidate.depth.labels = 'mutated'; candidate.settings.near = 0.1;
    const before = settled; gate.release(); await first; await second;
    const raw = await o.database(), saved = await o.read(raw); raw.close(); await a.close(); await b.close();
    return { statuses: outcomes.map(x => x.status), before, saved, expected };
  });
  expect(result.statuses.sort()).toEqual(['fulfilled','rejected']); expect(result.before).toBe(false);
  expect(result.saved).toMatchObject({ project: result.expected });
});

test('oracle put success followed by actual abort retains prior graph and permits explicit retry', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt); await store.save(o.project);
    const put = IDBObjectStore.prototype.put; let success = false;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = put.call(this, value, key);
      if (this.name === 'projects') { IDBObjectStore.prototype.put = put; request.addEventListener('success', () => { success = true; this.transaction.abort(); }, { once: true }); }
      return request;
    };
    const rollback = await store.save({ ...o.project, title: 'Aborted' }).then(() => 'fulfilled', e => e instanceof h.SavedCopyProtected ? 'protected' : 'rollback');
    IDBObjectStore.prototype.put = put;
    const raw = await o.database(), before = await o.read(raw); await store.save({ ...o.project, title: 'Explicit retry' }); const after = await o.read(raw);
    raw.close(); await store.close(); return { success, rollback, before, after, original: o.project };
  });
  expect(result.success).toBe(true); expect(result.rollback).toBe('rollback');
  expect(result.before).toMatchObject({ project: result.original }); expect(result.after).toMatchObject({ project: { ...result.original, title: 'Explicit retry' } });
});

test('oracle legacy upgrade never rewrites bare bytes and rejects old version-one opens', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, old = await o.database(1); await o.write(old, o.project); old.close();
    const put = IDBObjectStore.prototype.put; let puts = 0;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) { puts++; return put.call(this, value, key); };
    const store = await h.openProjectStore(), loaded = await store.load(), raw = await o.database(), before = await o.read(raw), migrationPuts = puts;
    const oldRefused = await o.database(1).then(db => { db.close(); return ''; }, e => (e as Error).name);
    store.acceptLoad(loaded.receipt); await store.save(o.project); const after = await o.read(raw);
    IDBObjectStore.prototype.put = put; raw.close(); await store.close(); return { migrationPuts, oldRefused, before, after, original: o.project };
  });
  expect(result.migrationPuts).toBe(0); expect(result.oldRefused).toBe('VersionError'); expect(result.before).toEqual(result.original);
  expect(result.after).toEqual({ schemaVersion: 2, revision: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), project: result.original });
});

test('oracle missing legacy object store is protected without fabricated migration', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, old = await o.database(1, false); old.close();
    const refused = await window.lensStorage.openProjectStore().then(async s => { await s.close(); return false; }, () => true);
    const retained = await o.database(1, false), version = retained.version, stores = [...retained.objectStoreNames]; retained.close(); return { refused, version, stores };
  });
  expect(result).toEqual({ refused: true, version: 1, stores: [] });
});

test('oracle present undefined and bounded corrupt values need reviewed repair, never invented absence', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, store = await h.openProjectStore(), absent = await store.load(), raw = await o.database();
    const summaries = [];
    for (const value of [undefined, null, { schemaVersion: 99 }, { schemaVersion: 2, revision: 'bad', project: o.project }]) {
      await o.write(raw, value); const refused = await store.load().then(() => false, () => true), review = await store.reviewReplacement();
      summaries.push({ refused, summary: review.summary, unchanged: JSON.stringify(await o.read(raw)) === JSON.stringify(value) });
    }
    const review = await store.reviewReplacement(); await store.replace(o.project, review.receipt);
    const reused = await store.replace(o.project, review.receipt).then(() => false, () => true), saved = await o.read(raw);
    raw.close(); await store.close(); return { absent: { project: absent.project, raster: absent.raster }, summaries, reused, saved, original: o.project };
  });
  expect(result.absent).toEqual({ project: null, raster: null }); expect(result.reused).toBe(true);
  for (const entry of result.summaries) expect(entry).toEqual({ refused: true, unchanged: true, summary: { present: true, readable: false, title: null, width: null, height: null, mode: null } });
  expect(result.saved).toMatchObject({ project: result.original });
});

test('oracle purpose foreign cloned used cancelled and forged receipt objects cannot authorize writes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, a = await h.openProjectStore(), b = await h.openProjectStore();
    const controller = new AbortController(), read = await a.load({ signal: controller.signal }), review = await a.reviewReplacement(); let refusals = 0;
    const refuse = (fn: () => void) => { try { fn(); } catch { refusals++; } };
    refuse(() => a.acceptLoad({} as SavedCopyReceipt)); refuse(() => b.acceptLoad(read.receipt)); refuse(() => a.acceptLoad(structuredClone(read.receipt))); refuse(() => a.acceptLoad(review.receipt));
    await a.replace(o.project, read.receipt).then(() => {}, () => { refusals++; });
    controller.abort(); refuse(() => a.acceptLoad(read.receipt));
    await a.close(); await b.close();
    const c = await h.openProjectStore(), accepted = await c.load(); c.acceptLoad(accepted.receipt); refuse(() => c.acceptLoad(accepted.receipt)); await c.save(o.project); await c.close(); return refusals;
  });
  expect(result).toBe(7);
});

test('oracle a third writer during genuine held replacement decode preserves every winning byte', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, a = await h.openProjectStore(), b = await h.openProjectStore(); a.acceptLoad((await a.load()).receipt); await a.save(o.project);
    const review = await b.reviewReplacement(), raw = await o.database(), gate = o.holdBitmap();
    const replacement = b.replace({ ...o.project, title: 'Replacement' }, review.receipt).then(() => false, e => e instanceof h.SavedCopyConflict); await gate.ready;
    const winner = { schemaVersion: 2, revision: 'cc117000-3333-4333-8333-333333333333', project: { ...o.project, title: 'Third writer during actual decode' } };
    await o.write(raw, winner); gate.release(); const conflict = await replacement; gate.restore();
    const after = await o.read(raw); raw.close(); await a.close(); await b.close(); return { conflict, after, winner };
  });
  expect(result.conflict).toBe(true); expect(result.after).toEqual(result.winner);
});

test('oracle raw rounded settings and negative zero retain identity while key order does not', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, raw = await o.database(), store = await h.openProjectStore();
    const initial = structuredClone(o.project); initial.settings.shiftX = -0; initial.settings.targetFocal = 100.0000000001;
    await o.write(raw, initial); store.acceptLoad((await store.load()).receipt);
    await o.write(raw, Object.fromEntries(Object.entries(initial).reverse())); await store.save(o.project);
    const current = await o.read(raw) as { schemaVersion: 2; revision: string; project: Project };
    store.acceptLoad((await store.load()).receipt); current.project.settings.targetFocal += 0.0000000001; await o.write(raw, current);
    const rawDifference = await store.save(o.project).then(() => false, e => e instanceof h.SavedCopyConflict);
    const second = await h.openProjectStore(); current.project.settings.shiftX = -0; await o.write(raw, current); second.acceptLoad((await second.load()).receipt);
    current.project.settings.shiftX = 0; await o.write(raw, current);
    const signDifference = await second.save(o.project).then(() => false, e => e instanceof h.SavedCopyConflict);
    const after = await o.read(raw); raw.close(); await store.close(); await second.close(); return { rawDifference, signDifference, after, expected: current };
  });
  expect(result.rawDifference).toBe(true); expect(result.signDifference).toBe(true); expect(result.after).toEqual(result.expected);
});

test('oracle comparator refuses cyclic native sparse deep and excessive-node values without mutation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, store = await window.lensStorage.openProjectStore(), raw = await o.database();
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    const deep: unknown[] = []; let cursor = deep; for (let i = 0; i < 26; i++) { const next: unknown[] = []; cursor.push(next); cursor = next; }
    const results = [];
    for (const value of [cycle, new Date(0), NaN, new Array(2), deep, Array.from({ length: 100001 }, () => null)]) {
      await o.write(raw, value); results.push(await store.reviewReplacement().then(() => false, () => true));
    }
    raw.close(); await store.close(); return results;
  });
  expect(result).toEqual([true,true,true,true,true,true]);
});

test('oracle exact 12MiB legacy and plus80 wrapper comparison caps admit bounded malformed review only', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, store = await h.openProjectStore(), raw = await o.database(), results = [];
    for (const [kind, cap] of [['legacy', 12582912], ['wrapper', 12582992]] as const) {
      const base = kind === 'legacy' ? { invalid: '' } : { schemaVersion: 2, invalid: '' }, overhead = new TextEncoder().encode(JSON.stringify(base)).length;
      for (const extra of [0, 1]) {
        const value = { ...base, invalid: 'x'.repeat(cap - overhead + extra) }; await o.write(raw, value);
        results.push({ kind, bytes: new TextEncoder().encode(JSON.stringify(value)).length, accepted: await store.reviewReplacement().then(r => !r.summary.readable, () => false) });
      }
    }
    raw.close(); await store.close(); return { cap: h.MAX_STORED_BYTES, results };
  });
  expect(result).toEqual({ cap: 12582992, results: [{ kind:'legacy',bytes:12582912,accepted:true },{ kind:'legacy',bytes:12582913,accepted:false },{ kind:'wrapper',bytes:12582992,accepted:true },{ kind:'wrapper',bytes:12582993,accepted:false }] });
});

test('oracle real compressed PNG failure cannot load or overwrite while structural review stays truthful', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt); await store.save(o.project);
    const bytes = Uint8Array.from(atob(o.project.photo.dataUrl.split(',')[1]), c => c.charCodeAt(0)), view = new DataView(bytes.buffer);
    for (let offset = 8; offset < bytes.length;) {
      const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (type === 'IDAT') {
        bytes.fill(0, offset + 8, offset + 8 + length); let crc = 0xffffffff;
        for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
        view.setUint32(offset + 8 + length, (crc ^ 0xffffffff) >>> 0);
      }
      offset += length + 12;
    }
    const bad = structuredClone(o.project); bad.photo.dataUrl = 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
    const saveRefused = await store.save(bad).then(() => false, () => true), raw = await o.database(), winner = await o.read(raw);
    await o.write(raw, bad); const loadRefused = await store.load().then(() => false, () => true), review = await store.reviewReplacement();
    const unchanged = await o.read(raw); raw.close(); await store.close(); return { saveRefused, winner, loadRefused, readable: review.summary.readable, unchanged, bad, original: o.project };
  });
  expect(result.saveRefused).toBe(true); expect(result.winner).toMatchObject({ project: result.original });
  expect(result.loadRefused).toBe(true); expect(result.readable).toBe(true); expect(result.unchanged).toEqual(result.bad);
});

test('oracle cancelled actual bitmap load rejects promptly but close retains the native decode drain', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, raw = await o.database(); await o.write(raw, o.project);
    const store = await h.openProjectStore(), controller = new AbortController(), gate = o.holdBitmap();
    const pending = store.load({ signal: controller.signal }).then(() => 'fulfilled', e => (e as Error).name); await gate.ready;
    controller.abort();
    const immediate = await Promise.race([pending, new Promise<string>(resolve => setTimeout(() => resolve('did not reject promptly'), 1000))]);
    let closed = false; const closing = store.close().then(() => { closed = true; });
    const refused = await store.load().then(() => false, () => true), extraSave = await store.save(o.project).then(() => false, () => true);
    const before = { closed, calls: gate.calls(), closes: gate.closes() };
    gate.release(); await pending; await closing; const after = { closed, calls: gate.calls(), closes: gate.closes() }; gate.restore();
    const retained = await o.read(raw); raw.close(); return { immediate, refused, extraSave, before, after, retained, original: o.project };
  });
  expect(result.immediate).toBe('AbortError'); expect(result.refused).toBe(true); expect(result.extraSave).toBe(true);
  expect(result.before).toEqual({ closed:false,calls:1,closes:0 }); expect(result.after).toEqual({ closed:true,calls:1,closes:1 }); expect(result.retained).toEqual(result.original);
});

test('oracle actual30second image watchdog rejects before bitmap delivery and cannot start late CAS', async ({ page }) => {
  test.setTimeout(60000);
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt); await store.save(o.project);
    const unused = await store.load(), gate = o.holdBitmap(), start = performance.now();
    const pending = store.save({ ...o.project, title: 'Expired preflight' }).then(() => 'fulfilled', e => e instanceof h.SavedCopyProtected ? 'protected' : (e as Error).name);
    await gate.ready; const outcome = await pending, elapsed = performance.now() - start;
    let tokenRefused = false; try { store.acceptLoad(unused.receipt); } catch { tokenRefused = true; }
    let closed = false; const closing = store.close().then(() => { closed = true; });
    const next = await store.save(o.project).then(() => false, () => true), before = { closed, calls: gate.calls(), closes: gate.closes() };
    gate.release(); await closing; const closes = gate.closes(); gate.restore();
    const raw = await o.database(), retained = await o.read(raw); raw.close(); return { outcome, elapsed, tokenRefused, next, before, closes, retained, original: o.project, deadline: h.STORAGE_IMAGE_MS };
  });
  expect(result.deadline).toBe(30000); expect(result.elapsed).toBeGreaterThanOrEqual(29500); expect(result.elapsed).toBeLessThan(45000);
  expect(result.outcome).toBe('protected'); expect(result.tokenRefused).toBe(true); expect(result.next).toBe(true);
  expect(result.before).toEqual({ closed:false,calls:1,closes:0 }); expect(result.closes).toBe(1); expect(result.retained).toMatchObject({ project: result.original });
});

test('oracle versionchange during native bitmap load revokes publication and drains owned cleanup', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, raw = await o.database(); await o.write(raw, o.project); raw.close();
    const store = await h.openProjectStore(), gate = o.holdBitmap(), pending = store.load().then(() => false, () => true); await gate.ready;
    const upgraded = await o.database(3); let closed = false; const closing = store.close().then(() => { closed = true; });
    const before = closed; gate.release(); const rejected = await pending; await closing; const closes = gate.closes(); gate.restore();
    const refused = await store.save(o.project).then(() => false, () => true), retained = await o.read(upgraded); upgraded.close(); return { before, rejected, closes, refused, retained, original: o.project };
  });
  expect(result.before).toBe(false); expect(result.rejected).toBe(true); expect(result.closes).toBe(1); expect(result.refused).toBe(true); expect(result.retained).toEqual(result.original);
});

test('oracle normal close drains admitted queued work and immediately refuses new operations and proofs', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt);
    const unused = await store.load(), gate = o.holdWrite(), first = store.save(o.project); await gate.ready;
    const second = store.save({ ...o.project, title: 'Accepted before close' }); let closed = false; const closing = store.close().then(() => { closed = true; });
    let tokenRefused = false; try { store.acceptLoad(unused.receipt); } catch { tokenRefused = true; }
    const refused = await store.load().then(() => false, () => true), before = closed;
    gate.release(); await first; await second; await closing;
    const reopened = await h.openProjectStore(), load = await reopened.load(); await reopened.close(); return { tokenRefused, refused, before, project: load.project, original: o.project };
  });
  expect(result.tokenRefused).toBe(true); expect(result.refused).toBe(true); expect(result.before).toBe(false);
  expect(result.project).toEqual({ ...result.original, title:'Accepted before close' });
});

test('oracle held genuine read callback cannot be mistaken for absence after native complete', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, raw = await o.database(); await o.write(raw, o.project);
    const store = await h.openProjectStore(), unused = await store.load(), get = IDBObjectStore.prototype.get;
    let release = () => {}, terminal!: () => void;
    const completed = new Promise<void>(resolve => { terminal = resolve; });
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      const request = get.call(this, key);
      if (this.name !== 'projects' || key !== 'current') return request;
      IDBObjectStore.prototype.get = get;
      const add = request.addEventListener.bind(request), listeners: (EventListenerOrEventListenerObject | null)[] = [];
      add('success', event => {
        event.stopImmediatePropagation();
        release = () => { request.onsuccess?.call(request, event); for (const listener of listeners) { if (typeof listener === 'function') listener.call(request, event); else listener?.handleEvent(event); } };
      }, { once: true });
      request.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
        if (type === 'success') listeners.push(listener); else if (listener) add(type, listener, options);
      }) as typeof request.addEventListener;
      this.transaction.addEventListener('complete', terminal, { once: true }); return request;
    };
    const pending = store.load().then(() => 'fulfilled', () => 'rejected'); await completed;
    const outcome = await pending; release(); await Promise.resolve();
    let tokenRefused = false; try { store.acceptLoad(unused.receipt); } catch { tokenRefused = true; }
    const writeRefused = await store.save(o.project).then(() => false, () => true), retained = await o.read(raw);
    raw.close(); await store.close(); return { outcome, tokenRefused, writeRefused, retained, original: o.project };
  });
  expect(result.outcome).toBe('rejected'); expect(result.tokenRefused).toBe(true); expect(result.writeRefused).toBe(true); expect(result.retained).toEqual(result.original);
});

test('oracle real still-active readwrite transaction hits10second deadline without late authority', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt); await store.save(o.project);
    const unused = await store.load(), gate = o.holdWrite(), start = performance.now();
    const pending = store.save({ ...o.project, title:'Timed out' }).then(() => 'fulfilled', e => e instanceof h.SavedCopyProtected ? 'protected' : 'other');
    await gate.ready; const outcome = await pending, elapsed = performance.now() - start; gate.release();
    let tokenRefused = false; try { store.acceptLoad(unused.receipt); } catch { tokenRefused = true; }
    const refused = await store.save(o.project).then(() => false, () => true); await store.close();
    const raw = await o.database(), retained = await o.read(raw); raw.close(); return { outcome, elapsed, tokenRefused, refused, retained, original: o.project, deadline: h.STORAGE_OPERATION_MS };
  });
  expect(result.deadline).toBe(10000); expect(result.elapsed).toBeGreaterThanOrEqual(9500); expect(result.elapsed).toBeLessThan(20000);
  expect(result.outcome).toBe('protected'); expect(result.tokenRefused).toBe(true); expect(result.refused).toBe(true); expect(result.retained).toMatchObject({ project: result.original });
});

test('oracle blocked legacy upgrade closes late handles and preserves original bare value', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.lensOracle, h = window.lensStorage, legacy = await o.database(1); await o.write(legacy, o.project);
    const refusal = await h.openProjectStore().then(async store => { await store.close(); return false; }, () => true);
    const before = await o.read(legacy); legacy.close();
    const recovered = await h.openProjectStore(), loaded = await recovered.load(); await recovered.close();
    const next = await o.database(3), after = await o.read(next); next.close(); return { refusal, before, loaded: loaded.project, after, original: o.project };
  });
  expect(result.refusal).toBe(true); expect(result.before).toEqual(result.original); expect(result.loaded).toEqual(result.original); expect(result.after).toEqual(result.original);
});
