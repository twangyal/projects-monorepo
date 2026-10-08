import { test, expect } from '@playwright/test';
import type { Project } from '../../src/model.ts';
import type { ProjectLibrary } from '../../src/library-storage.ts';

type NativeDump = { headPresent: boolean; head: unknown; legacyPresent: boolean; legacy: unknown;
  keys: IDBValidKey[]; rows: unknown[] };
type Seed = { head?: unknown; headPresent?: boolean; legacy?: unknown; legacyPresent?: boolean;
  rows?: Array<{ key: string; value: unknown }> };
type Oracle = { project(title?: string): Project; legacy(): unknown; seed(value: Seed): Promise<void>;
  dump(): Promise<NativeDump>; adopt(store: ProjectLibrary, id?: string): Promise<string> };
declare global { interface Window { libraryOracle: Oracle } }

// Original native fixtures. No production validator/factory computes expected data.
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/library-storage-harness.html');
  await page.waitForFunction(() => Boolean(window.motionLibrary));
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('motion-studio');
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Independent fixture database unexpectedly blocked.'));
    });
    const project = (title = 'Original copper motion'): Project => ({ schemaVersion: 2, title,
      background: '#102030', frameCount: 24, layers: [{ id: 'original-copper', name: 'Copper', kind: 'drawing',
        cels: [{ frame: 0, strokes: [{ color: '#b87333', width: 3,
          points: [{ x: -7, y: 11 }, { x: 23, y: 41 }] }] }, { frame: 13, strokes: [] }],
        keys: [{ x: 91, y: 47, scale: 1.25, rotation: -17, opacity: .625, frame: 0, easing: 'linear' }] }] });
    const legacy = () => ({ schemaVersion: 1, title: 'Original legacy copper', background: '#102030',
      frameCount: 24, layers: [{ id: 'original-copper', name: 'Copper', kind: 'drawing',
        strokes: [{ color: '#b87333', width: 3, points: [{ x: -7, y: 11 }, { x: 23, y: 41 }] }],
        keys: [{ x: 91, y: 47, scale: 1.25, rotation: -17, opacity: .625, frame: 0, easing: 'linear' }] }] });
    const open = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motion-studio', 2);
      request.onupgradeneeded = () => { for (const name of ['project', 'library', 'projects']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      } };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const seed = async (value: Seed) => {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['project', 'library', 'projects'], 'readwrite');
        for (const name of ['project', 'library', 'projects']) tx.objectStore(name).clear();
        if (value.headPresent) tx.objectStore('library').put(value.head, 'current');
        if (value.legacyPresent) tx.objectStore('project').put(value.legacy, 'current');
        for (const row of value.rows ?? []) tx.objectStore('projects').put(row.value, row.key);
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Fixture aborted.'));
      }); db.close();
    };
    const dump = async (): Promise<NativeDump> => {
      const db = await open();
      const result: NativeDump = { headPresent: false, head: undefined, legacyPresent: false,
        legacy: undefined, keys: [], rows: [] };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['project', 'library', 'projects'], 'readonly');
        const headKey = tx.objectStore('library').getKey('current');
        headKey.onsuccess = () => { result.headPresent = headKey.result !== undefined; };
        const head = tx.objectStore('library').get('current'); head.onsuccess = () => { result.head = head.result; };
        const oldKey = tx.objectStore('project').getKey('current');
        oldKey.onsuccess = () => { result.legacyPresent = oldKey.result !== undefined; };
        const old = tx.objectStore('project').get('current'); old.onsuccess = () => { result.legacy = old.result; };
        const keys = tx.objectStore('projects').getAllKeys(); keys.onsuccess = () => { result.keys = keys.result; };
        const rows = tx.objectStore('projects').getAll(); rows.onsuccess = () => { result.rows = rows.result; };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      }); db.close(); return result;
    };
    const adopt = async (store: ProjectLibrary, id?: string) => {
      const view = await store.read(); store.acceptRead(view.receipt);
      const target = id ?? view.head?.activeId;
      if (!target) throw new Error('Independent adoption requires a selected saved row.');
      const loaded = await store.readProject(target);
      if (view.head?.activeId === target) store.acceptProject(loaded.receipt);
      else await store.activate(loaded.receipt);
      return target;
    };
    window.libraryOracle = { project, legacy, seed, dump, adopt };
  });
});

test('real v1 and v2 legacy reads migrate only in memory; edit promotion leaves original native value exact', async ({ page }) => {
  for (const version of [1, 2]) {
    const result = await page.evaluate(async version => {
      const o = window.libraryOracle;
      const raw = version === 1 ? o.legacy() : o.project('Original schema2 legacy');
      // A genuine old database, not a v2 store merely populated with legacy-shaped data.
      const old = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('motion-studio', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('project');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = old.transaction('project', 'readwrite'); tx.objectStore('project').put(raw, 'current');
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      }); old.close();
      const store = new window.motionLibrary.ProjectLibrary();
      const view = await store.read(); const before = await o.dump();
      store.acceptRead(view.receipt); store.acceptProject(view.legacy!.receipt);
      const canonical = view.legacy!.project;
      const committed = await store.promoteLegacy({ ...canonical, title: 'Edited copper after admission' });
      const after = await o.dump(); store.close();
      return { raw, canonical, mode: view.mode, before, after, committed };
    }, version);
    expect(result.mode).toBe('legacy'); expect(result.canonical.schemaVersion).toBe(2);
    expect(result.before.headPresent).toBe(false); expect(result.before.keys).toEqual([]);
    expect(result.before.legacy).toEqual(result.raw); expect(result.after.legacy).toEqual(result.raw);
    expect(result.after.keys).toHaveLength(1);
    expect(result.committed.head.entries[0].title).toBe('Edited copper after admission');
    // Start the second schema fixture with a separate original v1 database.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('motion-studio');
        request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    });
  }
});

test('creating alongside admitted legacy atomically preserves old canvas and new entry in creation order', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.libraryOracle; const raw = o.legacy(); await o.seed({ legacyPresent: true, legacy: raw });
    const store = new window.motionLibrary.ProjectLibrary(); const view = await store.read();
    store.acceptRead(view.receipt); store.acceptProject(view.legacy!.receipt);
    const commit = await store.create(o.project('New separate copper'));
    const dump = await o.dump(); store.close(); return { commit, dump, raw };
  });
  expect(result.commit.head.entries.map(e => e.title)).toEqual(['Original legacy copper', 'New separate copper']);
  expect(result.commit.head.activeId).toBe(result.commit.head.entries[1].id);
  expect(result.dump.keys).toHaveLength(2); expect(result.dump.legacy).toEqual(result.raw);
});

test('undefined head/legacy and orphan rows are protected, not absent or silently reconstructed', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const o = window.libraryOracle; const results = [];
    for (const fixture of [{ headPresent: true, head: undefined },
      { legacyPresent: true, legacy: undefined },
      { rows: [{ key: '10400000-0000-4000-8000-000000000001', value: o.project() }] },
      { headPresent: true, head: { schemaVersion: 99 } }]) {
      await o.seed(fixture); const before = await o.dump(); const store = new window.motionLibrary.ProjectLibrary();
      let readRejected = false; let createRejected = false;
      try { await store.read(); } catch { readRejected = true; }
      try { await store.create(o.project('Cannot bypass protection')); } catch { createRejected = true; }
      const after = await o.dump(); store.close(); results.push({ before, after, readRejected, createRejected });
    } return results;
  });
  for (const result of results) { expect(result.readRejected).toBe(true); expect(result.createRejected).toBe(true);
    expect(result.after).toEqual(result.before); }
});

test('two accepted instances racing same project have one actual winner and preserve its whole geometry', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const seed = new ProjectLibrary(); const initial = await seed.read(); seed.acceptRead(initial.receipt);
    const created = await seed.create(o.project()); const id = created.entry!.id; seed.close();
    const a = new ProjectLibrary(), b = new ProjectLibrary(); await o.adopt(a); await o.adopt(b);
    const outcomes = await Promise.allSettled([a.save(id, o.project('Winner A')), b.save(id, o.project('Winner B'))]);
    const statuses = outcomes.map(outcome => outcome.status);
    const conflict = outcomes.filter(outcome => outcome.status === 'rejected')
      .every(outcome => outcome.reason instanceof window.motionLibrary.SavedProjectConflict);
    const dump = await o.dump(); a.close(); b.close(); return { statuses, conflict, dump };
  });
  expect(result.statuses.sort()).toEqual(['fulfilled', 'rejected']); expect(result.conflict).toBe(true);
  expect(result.dump.keys).toHaveLength(1);
  const row = result.dump.rows[0] as { project: Project };
  expect(['Winner A', 'Winner B']).toContain(row.project.title);
  expect(row.project.layers[0].keys[0]).toEqual({ x: 91, y: 47, scale: 1.25, rotation: -17,
    opacity: .625, frame: 0, easing: 'linear' });
});

test('different-row saves merge and old active-row save cannot overwrite another instance selection', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const seed = new ProjectLibrary(); const view = await seed.read(); seed.acceptRead(view.receipt);
    const aID = (await seed.create(o.project('A before'))).entry!.id;
    const bID = (await seed.create(o.project('B before'))).entry!.id; seed.close();
    const a = new ProjectLibrary(); await o.adopt(a, aID);
    const b = new ProjectLibrary(); await o.adopt(b, bID);
    await Promise.all([a.save(aID, o.project('A changed')), b.save(bID, o.project('B changed'))]);
    const dump = await o.dump();
    // A metadata refresh adopts B's durable selection without discarding accepted A identity.
    const refreshed = await a.read(); a.acceptRead(refreshed.receipt);
    const duplicate = await a.duplicate(aID); const afterDuplicate = await o.dump();
    a.close(); b.close(); return { dump, aID, bID, duplicate, afterDuplicate };
  });
  const head = result.dump.head as { activeId: string; entries: Array<{ title: string }> };
  expect(head.activeId).toBe(result.bID); expect(head.entries.map(e => e.title)).toEqual(['A changed', 'B changed']);
  expect((result.dump.rows as Array<{ project: Project }>).map(r => r.project.title).sort()).toEqual(['A changed', 'B changed']);
  expect(result.duplicate.entry!.id).not.toBe(result.aID); expect(result.duplicate.entry!.id).not.toBe(result.bID);
  expect(result.duplicate.head.activeId).toBe(result.duplicate.entry!.id);
  const rows = result.afterDuplicate.rows as Array<{ id: string; project: Project }>;
  expect(rows.find(row => row.id === result.aID)!.project.title).toBe('A changed');
  expect(rows.find(row => row.id === result.bID)!.project.title).toBe('B changed');
  expect(rows.find(row => row.id === result.duplicate.entry!.id)!.project)
    .toEqual(rows.find(row => row.id === result.aID)!.project);
});

test('unaccepted, cloned, foreign and consumed receipts cannot manufacture write authority', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const seed = new ProjectLibrary(); const view = await seed.read(); seed.acceptRead(view.receipt);
    const id = (await seed.create(o.project())).entry!.id; seed.close();
    const a = new ProjectLibrary(), b = new ProjectLibrary(); const current = await a.read();
    const rejected: boolean[] = [];
    for (const receipt of [{ ...current.receipt }, current.receipt]) {
      try { (receipt === current.receipt ? b : a).acceptRead(receipt); rejected.push(false); } catch { rejected.push(true); }
    }
    a.acceptRead(current.receipt);
    try { a.acceptRead(current.receipt); rejected.push(false); } catch { rejected.push(true); }
    const load = await a.readProject(id);
    try { await a.save(id, o.project('Unaccepted')); rejected.push(false); } catch { rejected.push(true); }
    try { a.acceptProject({ ...load.receipt }); rejected.push(false); } catch { rejected.push(true); }
    try { b.acceptProject(load.receipt); rejected.push(false); } catch { rejected.push(true); }
    a.acceptProject(load.receipt);
    try { a.acceptProject(load.receipt); rejected.push(false); } catch { rejected.push(true); }
    const before = await o.dump(); await a.save(id, o.project('Accepted proper receipt'));
    const after = await o.dump(); a.close(); b.close(); return { rejected, before, after };
  });
  expect(result.rejected).toEqual(Array(7).fill(true));
  expect((result.before.rows[0] as { project: Project }).project.title).toBe('Original copper motion');
  expect((result.after.rows[0] as { project: Project }).project.title).toBe('Accepted proper receipt');
});

test('active deletion consumes prepared next receipt, old autosave cannot resurrect, last delete never falls back', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle; const raw = o.legacy();
    await o.seed({ legacyPresent: true, legacy: raw }); const seed = new ProjectLibrary(); const view = await seed.read();
    seed.acceptRead(view.receipt); seed.acceptProject(view.legacy!.receipt);
    const created = await seed.create(o.project('B retained')); const aID = created.head.entries[0].id, bID = created.entry!.id;
    seed.close(); const old = new ProjectLibrary(); await o.adopt(old, aID);
    const owner = new ProjectLibrary(); await o.adopt(owner);
    const deletion = await owner.reviewDelete(aID); const next = await owner.readProject(bID);
    const first = await owner.delete(deletion.receipt, next.receipt);
    let rejected = false; try { await old.save(aID, o.project('Resurrected')); } catch { rejected = true; }
    const lastReview = await owner.reviewDelete(bID); const last = await owner.delete(lastReview.receipt, null);
    owner.close(); old.close(); const restarted = new ProjectLibrary(); const reloaded = await restarted.read();
    const dump = await o.dump(); restarted.close(); return { first, last, reloaded, rejected, dump, raw };
  });
  expect(result.first.head.activeId).toBe(result.first.head.entries[0].id);
  expect(result.first.head.entries[0].title).toBe('B retained'); expect(result.rejected).toBe(true);
  expect(result.last.head.entries).toEqual([]); expect(result.last.head.activeId).toBeNull();
  expect(result.reloaded.mode).toBe('library'); expect(result.reloaded.legacy).toBeNull();
  expect(result.dump.headPresent).toBe(true); expect(result.dump.keys).toEqual([]); expect(result.dump.legacy).toEqual(result.raw);
});

test('nonactive deletion preserves actual selected entry and stale catalog delete refuses atomically', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const a = new ProjectLibrary(); const view = await a.read(); a.acceptRead(view.receipt);
    const first = (await a.create(o.project('A'))).entry!.id;
    const second = (await a.create(o.project('B'))).entry!.id;
    const b = new ProjectLibrary(); await o.adopt(b);
    const stale = await a.reviewDelete(first);
    const target = await b.readProject(first); await b.activate(target.receipt);
    const before = await o.dump(); let refused = false;
    try { await a.delete(stale.receipt, null); } catch { refused = true; }
    const after = await o.dump(); const freshView = await a.read(); a.acceptRead(freshView.receipt);
    const fresh = await a.reviewDelete(second); const commit = await a.delete(fresh.receipt, null);
    a.close(); b.close(); return { refused, before, after, commit, first };
  });
  expect(result.refused).toBe(true); expect(result.after).toEqual(result.before);
  expect(result.commit.head.activeId).toBe(result.first); expect(result.commit.head.entries).toHaveLength(1);
});

test('genuine post-put-success abort rolls back row/head and does not advance expected authority', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const store = new ProjectLibrary(); const view = await store.read(); store.acceptRead(view.receipt);
    const id = (await store.create(o.project())).entry!.id; const before = await o.dump();
    const original = IDBObjectStore.prototype.put; let actualSuccess = false;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const request = original.apply(this, args);
      if (this.name === 'projects') request.addEventListener('success', () => {
        actualSuccess = true; this.transaction.abort();
      }, { once: true });
      return request;
    };
    let rejected = false;
    try { await store.save(id, o.project('Aborted request success')); } catch { rejected = true; }
    finally { IDBObjectStore.prototype.put = original; }
    const aborted = await o.dump(); await store.save(id, o.project('Successful retry'));
    const after = await o.dump(); store.close(); return { actualSuccess, rejected, before, aborted, after };
  });
  expect(result.actualSuccess).toBe(true); expect(result.rejected).toBe(true); expect(result.aborted).toEqual(result.before);
  expect((result.after.rows[0] as { project: Project }).project.title).toBe('Successful retry');
});

test('replacement reviews are one-use, instance-bound, and cannot overwrite a newer complete row', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const a = new ProjectLibrary(); const view = await a.read(); a.acceptRead(view.receipt);
    const id = (await a.create(o.project())).entry!.id;
    const b = new ProjectLibrary(); await o.adopt(b);
    const review = await a.reviewReplacement(id); const failures = [];
    try { await a.replace(o.project('Clone'), { ...review.receipt }); failures.push(false); } catch { failures.push(true); }
    try { await b.replace(o.project('Foreign'), review.receipt); failures.push(false); } catch { failures.push(true); }
    await b.save(id, o.project('Foreign newer complete row')); const before = await o.dump();
    try { await a.replace(o.project('Stale review'), review.receipt); failures.push(false); } catch { failures.push(true); }
    try { await a.replace(o.project('Consumed review'), review.receipt); failures.push(false); } catch { failures.push(true); }
    const after = await o.dump(); a.close(); b.close(); return { failures, before, after };
  });
  expect(result.failures).toEqual([true, true, true, true]); expect(result.after).toEqual(result.before);
});

test('bounded invalid candidates refuse atomically; duplicate captures saved committed geometry detached', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const store = new ProjectLibrary(); const view = await store.read(); store.acceptRead(view.receipt);
    const id = (await store.create(o.project())).entry!.id; const before = await o.dump(); const refused = [];
    for (const candidate of [{ ...o.project(), frameCount: 97 }, { ...o.project(), schemaVersion: 99 },
      { ...o.project(), title: '' }, { ...o.project(), layers: new Array(1) }]) {
      try { await store.save(id, candidate as Project); refused.push(false); } catch { refused.push(true); }
    }
    const after = await o.dump(); const duplicate = await store.duplicate(id);
    const loaded = await store.readProject(duplicate.entry!.id); loaded.project.layers[0].keys[0].x = -300;
    const dump = await o.dump(); store.close(); return { refused, before, after, duplicate, dump, id };
  });
  expect(result.refused).toEqual([true, true, true, true]); expect(result.after).toEqual(result.before);
  expect(result.duplicate.entry!.id).not.toBe(result.id); expect(result.dump.keys).toHaveLength(2);
  const rows = result.dump.rows as Array<{ project: Project }>;
  expect(rows[0].project).toEqual(rows[1].project); expect(rows[0].project.layers[0].keys[0].x).toBe(91);
});

test('unsafe raw protected row cannot be reviewed into ordinary replacement or autosave', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const store = new ProjectLibrary(); const view = await store.read(); store.acceptRead(view.receipt);
    const made = await store.create(o.project()); const id = made.entry!.id; store.close();
    const existing = await o.dump(); await o.seed({ headPresent: true, head: existing.head,
      rows: [{ key: id, value: { unsafe: new Blob(['not lossless JSON']) } }] });
    const reader = new ProjectLibrary(); const list = await reader.read(); reader.acceptRead(list.receipt);
    let loadRefused = false, reviewRefused = false, saveRefused = false;
    try { await reader.readProject(id); } catch { loadRefused = true; }
    try { await reader.reviewReplacement(id); } catch { reviewRefused = true; }
    try { await reader.save(id, o.project('Unsafe overwrite')); } catch { saveRefused = true; }
    const retained = await o.dump(); reader.close(); return { loadRefused, reviewRefused, saveRefused,
      keys: retained.keys, blob: (retained.rows[0] as { unsafe: Blob }).unsafe.size };
  });
  expect(result.loadRefused).toBe(true); expect(result.reviewRefused).toBe(true); expect(result.saveRefused).toBe(true);
  expect(result.keys).toHaveLength(1); expect(result.blob).toBe(17);
});

test('one present-undefined project protects that row without blocking another valid project', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const seed = new ProjectLibrary(); const view = await seed.read(); seed.acceptRead(view.receipt);
    const aID = (await seed.create(o.project('A protected'))).entry!.id;
    const bID = (await seed.create(o.project('B usable'))).entry!.id; seed.close();
    const before = await o.dump(); const validB = (before.rows as Array<{ id: string }>).find(row => row.id === bID);
    await o.seed({ headPresent: true, head: before.head,
      rows: [{ key: aID, value: undefined }, { key: bID, value: validB }] });
    const store = new ProjectLibrary(); const read = await store.read(); store.acceptRead(read.receipt);
    let protectedRow = false; try { await store.readProject(aID); } catch { protectedRow = true; }
    const valid = await store.readProject(bID); store.acceptProject(valid.receipt);
    await store.save(bID, o.project('B remains independently editable'));
    const after = await o.dump(); store.close();
    return { protectedRow, headCount: read.head!.entries.length, validTitle: valid.project.title,
      keys: after.keys, rows: after.rows, aID };
  });
  expect(result.protectedRow).toBe(true); expect(result.headCount).toBe(2); expect(result.validTitle).toBe('B usable');
  expect(result.keys).toContain(result.aID); expect(result.rows).toContain(undefined);
  expect((result.rows.filter(row => row !== undefined)[0] as { project: Project }).project.title)
    .toBe('B remains independently editable');
});

test('genuine blocked version upgrade has bounded refusal and eventual success cannot leak authority', async ({ page }) => {
  test.setTimeout(25_000);
  const result = await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('motion-studio');
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const blocking = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motion-studio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('project');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    blocking.onversionchange = () => { /* Deliberately retain actual old-tab native connection. */ };
    const store = new window.motionLibrary.ProjectLibrary(); const began = performance.now();
    let refused = false; try { await store.read(); } catch { refused = true; }
    const elapsed = performance.now() - began; blocking.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    const retry = await store.read(); store.acceptRead(retry.receipt);
    const committed = await store.create(window.libraryOracle.project('After blocked release'));
    store.close(); return { refused, elapsed, mode: retry.mode, committed };
  });
  expect(result.refused).toBe(true); expect(result.elapsed).toBeLessThan(12_000);
  expect(result.mode).toBe('empty'); expect(result.committed.head.entries).toHaveLength(1);
});

test('real held write deadline releases native transaction and queue, retaining exact previously committed bytes', async ({ page }) => {
  test.setTimeout(25_000);
  const result = await page.evaluate(async () => {
    const o = window.libraryOracle; const store = new window.motionLibrary.ProjectLibrary();
    const view = await store.read(); store.acceptRead(view.receipt);
    const id = (await store.create(o.project())).entry!.id; const before = await o.dump();
    const unusedRead = await store.read(); const unusedProject = await store.readProject(id);
    const original = IDBObjectStore.prototype.put; let held = false, nativeAbort = false, keepAlive = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const request = original.apply(this, args);
      if (this.name === 'projects' && !held) {
        held = true; const tx = this.transaction; tx.addEventListener('abort', () => { nativeAbort = true; });
        const again = () => { if (!keepAlive) return;
          try { tx.objectStore('library').get('current').addEventListener('success', again, { once: true }); }
          catch { /* Native transaction has retired. */ }
        };
        request.addEventListener('success', again, { once: true });
      } return request;
    };
    const began = performance.now(); let refused = false;
    const saving = store.save(id, o.project('Held native write'));
    void saving.catch(() => undefined);
    for (let i = 0; i < 100 && !held; i++) await new Promise(resolve => setTimeout(resolve, 5));
    // This actual readonly operation starts before uncertainty and waits behind the held native write.
    const lateRead = store.read(); void lateRead.catch(() => undefined);
    try { await saving; } catch { refused = true; }
    finally { keepAlive = false; IDBObjectStore.prototype.put = original; }
    const elapsed = performance.now() - began; const after = await o.dump();
    let oldReadRefused = false, oldProjectRefused = false, lateReadRefused = false;
    try { store.acceptRead(unusedRead.receipt); } catch { oldReadRefused = true; }
    try { store.acceptProject(unusedProject.receipt); } catch { oldProjectRefused = true; }
    try { const late = await lateRead; store.acceptRead(late.receipt); } catch { lateReadRefused = true; }
    const refreshed = await store.read(); store.acceptRead(refreshed.receipt);
    const loaded = await store.readProject(id); store.acceptProject(loaded.receipt);
    await store.save(id, o.project('Fresh accepted retry'));
    const retry = await o.dump(); store.close(); return { held, nativeAbort, refused, elapsed, before, after, retry,
      oldReadRefused, oldProjectRefused, lateReadRefused };
  });
  expect(result.held).toBe(true); expect(result.nativeAbort).toBe(true); expect(result.refused).toBe(true);
  expect(result.elapsed).toBeLessThan(12_000); expect(result.after).toEqual(result.before);
  expect(result.oldReadRefused).toBe(true); expect(result.oldProjectRefused).toBe(true);
  expect(result.lateReadRefused).toBe(true);
  expect((result.retry.rows[0] as { project: Project }).project.title).toBe('Fresh accepted retry');
});

test('accepting a compatible refreshed catalog retains the currently accepted project save authority', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.libraryOracle; const store = new window.motionLibrary.ProjectLibrary();
    const initial = await store.read(); store.acceptRead(initial.receipt);
    const id = (await store.create(o.project())).entry!.id;
    // Explicit adoption precedes the later metadata-only refresh.
    const loaded = await store.readProject(id); store.acceptProject(loaded.receipt);
    const before = await o.dump(); const refreshed = await store.read(); store.acceptRead(refreshed.receipt);
    const afterRefresh = await o.dump(); await store.save(id, o.project('Edit after catalog refresh'));
    const afterSave = await o.dump(); store.close(); return { before, afterRefresh, afterSave };
  });
  expect(result.afterRefresh).toEqual(result.before);
  expect((result.afterSave.rows[0] as { project: Project }).project.title).toBe('Edit after catalog refresh');
});

test('accepting a refreshed legacy view retains admitted legacy canvas when creating a separate project', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.libraryOracle; const raw = o.legacy(); await o.seed({ legacyPresent: true, legacy: raw });
    const store = new window.motionLibrary.ProjectLibrary(); const first = await store.read();
    store.acceptRead(first.receipt); store.acceptProject(first.legacy!.receipt);
    const refreshed = await store.read(); store.acceptRead(refreshed.receipt);
    const beforeCreate = await o.dump(); const commit = await store.create(o.project('New after legacy refresh'));
    const after = await o.dump(); store.close(); return { raw, beforeCreate, after, commit };
  });
  expect(result.beforeCreate.headPresent).toBe(false); expect(result.beforeCreate.legacy).toEqual(result.raw);
  expect(result.commit.head.entries.map(entry => entry.title))
    .toEqual(['Original legacy copper', 'New after legacy refresh']);
  expect(result.after.keys).toHaveLength(2); expect(result.after.legacy).toEqual(result.raw);
});

test('delaying a genuine readonly success callback beyond native completion cannot fabricate absent data', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.libraryOracle; const seed = new window.motionLibrary.ProjectLibrary();
    const initial = await seed.read(); seed.acceptRead(initial.receipt);
    const created = await seed.create(o.project('Real saved catalog behind delayed callback')); seed.close();
    const original = IDBObjectStore.prototype.get;
    let release: (() => void) | undefined; let completed = false, observed = false;
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
      const request = original.apply(this, args);
      if (this.name === 'library' && args[0] === 'current' && this.transaction.mode === 'readonly') {
        let callback: IDBRequest['onsuccess'] = null;
        Object.defineProperty(request, 'onsuccess', { configurable: true,
          get: () => callback, set: (handler: IDBRequest['onsuccess']) => { callback = handler; } });
        request.addEventListener('success', event => {
          observed = true; release = () => callback?.call(request, event);
        }, { once: true });
        this.transaction.addEventListener('complete', () => { completed = true; }, { once: true });
      } return request;
    };
    const reader = new window.motionLibrary.ProjectLibrary();
    let outcome: 'pending' | 'fulfilled' | 'rejected' = 'pending';
    const pending = reader.read().then(value => { outcome = 'fulfilled'; return value; }, error => {
      outcome = 'rejected'; throw error;
    });
    // Keep the rejection observed even if the implementation prematurely retires this read.
    void pending.catch(() => undefined);
    for (let i = 0; i < 100 && !completed; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const beforeRelease = outcome;
    IDBObjectStore.prototype.get = original; release?.();
    const read = await pending; reader.close();
    return { observed, completed, beforeRelease, read, expected: created.head };
  });
  expect(result.observed).toBe(true); expect(result.completed).toBe(true);
  expect(result.read.mode).toBe('library'); expect(result.read.head).toEqual(result.expected);
  expect(result.read.legacy).toBeNull();
});

test('malformed raw record at exact wrapper byte cap plus one cannot obtain replacement authority', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.libraryOracle; const store = new window.motionLibrary.ProjectLibrary();
    const first = await store.read(); store.acceptRead(first.receipt);
    const created = await store.create(o.project()); store.close();
    const id = created.entry!.id;
    // ASCII gives exact independent JSON bytes: two quotes + content, no escape expansion.
    const oversized = 'x'.repeat(6_291_881 - 2);
    const actualBytes = new TextEncoder().encode(JSON.stringify(oversized)).length;
    await o.seed({ headPresent: true, head: created.head, rows: [{ key: id, value: oversized }] });
    const reader = new window.motionLibrary.ProjectLibrary(); const view = await reader.read(); reader.acceptRead(view.receipt);
    let refused = false; try { await reader.reviewReplacement(id); } catch { refused = true; }
    const after = await o.dump(); reader.close();
    return { actualBytes, refused, retained: after.rows[0] === oversized, head: after.head, expected: created.head };
  });
  expect(result.actualBytes).toBe(6_291_881); expect(result.refused).toBe(true);
  expect(result.retained).toBe(true); expect(result.head).toEqual(result.expected);
});

test('late absent-head callback after native completion refuses safely without fabricated absence or page errors', async ({ page }) => {
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    const o = window.libraryOracle; const raw = o.legacy(); await o.seed({ legacyPresent: true, legacy: raw });
    const get = IDBObjectStore.prototype.get, getKey = IDBObjectStore.prototype.getKey;
    const releases: Array<() => void> = []; let nativeComplete = false, observed = 0;
    const defer = (store: IDBObjectStore, request: IDBRequest, key: IDBValidKey | IDBKeyRange) => {
      if (store.name !== 'library' || key !== 'current' || store.transaction.mode !== 'readonly') return request;
      let callback: IDBRequest['onsuccess'] = null;
      Object.defineProperty(request, 'onsuccess', { configurable: true, get: () => callback,
        set: (handler: IDBRequest['onsuccess']) => { callback = handler; } });
      request.addEventListener('success', event => { observed++;
        releases.push(() => callback?.call(request, event));
      }, { once: true });
      store.transaction.addEventListener('complete', () => { nativeComplete = true; }, { once: true });
      return request;
    };
    IDBObjectStore.prototype.get = function (key) { return defer(this, get.call(this, key), key); };
    IDBObjectStore.prototype.getKey = function (key) { return defer(this, getKey.call(this, key), key); };
    const reader = new window.motionLibrary.ProjectLibrary();
    const pending = reader.read().then(value => ({ status: 'fulfilled' as const, mode: value.mode }),
      () => ({ status: 'rejected' as const, mode: null }));
    for (let i = 0; i < 100 && !nativeComplete; i++) await new Promise(resolve => setTimeout(resolve, 5));
    IDBObjectStore.prototype.get = get; IDBObjectStore.prototype.getKey = getKey;
    let callbackThrew = false;
    for (const release of releases) { try { release(); } catch { callbackThrew = true; } }
    const outcome = await pending; const retained = await o.dump(); reader.close();
    return { outcome, callbackThrew, nativeComplete, observed, retained, raw };
  });
  expect(result.observed).toBeGreaterThan(0); expect(result.nativeComplete).toBe(true);
  expect(result.callbackThrew).toBe(false); expect(pageErrors).toEqual([]);
  expect(result.outcome.status).toBe('rejected'); expect(result.retained.headPresent).toBe(false);
  expect(result.retained.legacy).toEqual(result.raw); expect(result.retained.keys).toEqual([]);
});

test('actual write completion beyond monotonic deadline protects receipts before the timer task fires', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const o = window.libraryOracle; const store = new window.motionLibrary.ProjectLibrary();
    const initial = await store.read(); store.acceptRead(initial.receipt);
    const id = (await store.create(o.project())).entry!.id;
    const unusedRead = await store.read(); const unusedProject = await store.readProject(id);
    const descriptor = Object.getOwnPropertyDescriptor(Performance.prototype, 'now');
    const realNow = performance.now.bind(performance); let offset = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => realNow() + offset });
    const original = IDBDatabase.prototype.transaction;
    let nativeComplete = false, timeoutTaskRan = false;
    // This real timer remains queued while the monotonic clock is advanced synchronously.
    const timer = setTimeout(() => { timeoutTaskRan = true; }, 10_000);
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const tx = original.apply(this, args);
      if (tx.mode === 'readwrite' && tx.objectStoreNames.contains('projects')) {
        let callback: IDBTransaction['oncomplete'] = null;
        Object.defineProperty(tx, 'oncomplete', { configurable: true, get: () => callback,
          set: (handler: IDBTransaction['oncomplete']) => { callback = handler; } });
        tx.addEventListener('complete', event => {
          nativeComplete = true; offset = 10_001;
          callback?.call(tx, event);
        }, { once: true });
      } return tx;
    };
    let rejected = false;
    try { await store.save(id, o.project('Native completed but deadline unconfirmed')); } catch { rejected = true; }
    finally { IDBDatabase.prototype.transaction = original; }
    let oldReadRefused = false, oldProjectRefused = false;
    try { store.acceptRead(unusedRead.receipt); } catch { oldReadRefused = true; }
    try { store.acceptProject(unusedProject.receipt); } catch { oldProjectRefused = true; }
    const observedBeforeTimer = !timeoutTaskRan;
    const after = await o.dump(); const fresh = await store.read(); store.acceptRead(fresh.receipt);
    const selected = await store.readProject(id); store.acceptProject(selected.receipt);
    await store.save(id, o.project('Fresh admission after actual settlement'));
    const retry = await o.dump(); store.close(); clearTimeout(timer);
    delete (performance as unknown as { now?: () => number }).now;
    // Native prototype method was never replaced; restore any original own property if one existed.
    if (!descriptor) throw new Error('Native Performance.now prototype descriptor missing.');
    return { nativeComplete, rejected, observedBeforeTimer, oldReadRefused, oldProjectRefused, after, retry };
  });
  expect(result.nativeComplete).toBe(true); expect(result.rejected).toBe(true); expect(result.observedBeforeTimer).toBe(true);
  expect(result.oldReadRefused).toBe(true); expect(result.oldProjectRefused).toBe(true);
  // The native commit really happened: logical deadline failure must not falsely claim rollback.
  expect((result.after.rows[0] as { project: Project }).project.title).toBe('Native completed but deadline unconfirmed');
  expect((result.retry.rows[0] as { project: Project }).project.title).toBe('Fresh admission after actual settlement');
});

test('reviewDelete refuses an unaccepted foreign selection but fresh catalog permits explicit nonactive deletion', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ProjectLibrary } = window.motionLibrary; const o = window.libraryOracle;
    const a = new ProjectLibrary(); const initial = await a.read(); a.acceptRead(initial.receipt);
    const aID = (await a.create(o.project('A initially selected'))).entry!.id;
    const bID = (await a.create(o.project('B selected elsewhere'))).entry!.id;
    await o.adopt(a, aID);
    const b = new ProjectLibrary(); await o.adopt(b, bID);
    const before = await o.dump(); let reviewRefused = false;
    try { await a.reviewDelete(aID); } catch { reviewRefused = true; }
    const afterRefusal = await o.dump(); const refreshed = await a.read(); a.acceptRead(refreshed.receipt);
    const review = await a.reviewDelete(aID); const commit = await a.delete(review.receipt, null);
    a.close(); b.close(); return { reviewRefused, before, afterRefusal, commit, bID };
  });
  expect(result.reviewRefused).toBe(true); expect(result.afterRefusal).toEqual(result.before);
  expect(result.commit.head.activeId).toBe(result.bID);
  expect(result.commit.head.entries.map(entry => entry.title)).toEqual(['B selected elsewhere']);
});
