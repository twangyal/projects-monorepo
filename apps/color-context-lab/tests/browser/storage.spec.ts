import { test, expect, type Page } from '@playwright/test';
import type {} from '../storage-harness.ts';

async function ready(page: Page) {
  await page.goto('/tests/storage-harness.html');
  await page.waitForFunction(() => Boolean(window.colorStorage));
}

test('real IDB saves detached snapshots in global order, clear cannot resurrect queued writes, reload preserves exact RGBA', async ({ page }) => {
  await ready(page);
  const expected = await page.evaluate(async () => {
    const { ProjectStore, createProject, createImageAsset, serializeProject } = window.colorStorage;
    const a = new ProjectStore(), b = new ProjectStore();
    const p = createProject(createImageAsset({ width: 1, height: 1, rgba: new Uint8ClampedArray([123, 1, 254, 0]) }, { fileName: 'literal <source>.png', format: 'png', width: 1, height: 1 }));
    p.title = 'First';
    const first = a.save(p); p.title = 'Second';
    const second = b.save(p); p.title = 'Uncommitted mutation';
    await Promise.all([first, second]);
    if ((await a.load())?.title !== 'Second') throw Error('save aliased caller');
    await Promise.all([a.save(p), b.clear()]);
    if (await b.load() !== null) throw Error('clear lost ordering');
    p.title = 'Durable <title> 🟩'; await a.save(p);
    const raw = serializeProject(p); a.close(); b.close(); return raw;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.colorStorage));
  expect(await page.evaluate(async () => {
    const s = new window.colorStorage.ProjectStore();
    try { return [await s.exportRaw(), window.colorStorage.serializeProject((await s.load())!)]; } finally { s.close(); }
  })).toEqual([expected, expected]);
});

test('present undefined/null and malformed records are protected; raw backup does not parse or rewrite', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const opened = indexedDB.open('color-context-lab.v1', 1);
    opened.onupgradeneeded = () => opened.result.createObjectStore('projects');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const s = new window.colorStorage.ProjectStore();
    const results: { load: string; raw: string | null }[] = [];
    for (const value of [undefined, null, '{ "unknown": true }\r\n', '\ud800', ' '.repeat(4 * 1024 ** 2 + 1)]) {
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(value, 'current'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      const load = await s.load().then(() => 'unexpected success', () => 'protected');
      const raw = await s.exportRaw().catch(() => 'rejected'); results.push({ load, raw });
    }
    db.close(); await s.clear(); const absent = await s.load(); s.close(); return { results, absent };
  });
  expect(result.absent).toBeNull();
  expect(result.results).toEqual([
    { load: 'protected', raw: 'rejected' }, { load: 'protected', raw: 'rejected' },
    { load: 'protected', raw: '{ "unknown": true }\r\n' },
    { load: 'protected', raw: 'rejected' }, { load: 'protected', raw: 'rejected' },
  ]);
});

test('request success is not transaction success, and genuine post-request abort preserves previous saved value', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const api = window.colorStorage, s = new api.ProjectStore();
    const p = api.createProject(api.createImageAsset({ width: 1, height: 1, rgba: new Uint8ClampedArray(4) }, { fileName: 'x.png', format: 'png', width: 1, height: 1 }));
    p.title = 'Complete'; await s.save(p);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
    let error = '';
    try { p.title = 'Must roll back'; await s.save(p); } catch (cause) { error = String(cause); }
    finally { IDBObjectStore.prototype.put = original; }
    const title = (await s.load())!.title; s.close(); return { title, error };
  });
  expect(result.title).toBe('Complete'); expect(result.error).toMatch(/storage/i);
});

test('transaction remains pending after put success; close rejects active and queued owner work without affecting another store', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const api = window.colorStorage, a = new api.ProjectStore(), b = new api.ProjectStore();
    const p = api.createProject(api.createImageAsset({ width: 1, height: 1, rgba: new Uint8ClampedArray(4) }, { fileName: 'x.png', format: 'png', width: 1, height: 1 }));
    p.title = 'Complete'; await a.save(p);
    const original = IDBObjectStore.prototype.put;
    let signal!: () => void;
    const success = new Promise<void>(resolve => { signal = resolve; });
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      IDBObjectStore.prototype.put = original;
      const request = original.apply(this, args);
      request.addEventListener('success', () => {
        const keepAlive = () => { const next = this.get('keepalive'); next.onsuccess = keepAlive; };
        keepAlive(); signal();
      });
      return request;
    };
    let settled = false;
    p.title = 'Uncommitted';
    const first = a.save(p).then(() => 'bad success', error => String(error)).finally(() => { settled = true; });
    const queued = a.clear().then(() => 'bad success', error => String(error));
    const other = b.load();
    await success; const prematurelySettled = settled; a.close();
    const outcomes = await Promise.all([first, queued]);
    const surviving = (await other)!.title; b.close();
    return { prematurelySettled, outcomes, surviving };
  });
  expect(result.prematurelySettled).toBe(false); expect(result.surviving).toBe('Complete');
  expect(result.outcomes.every(item => /closed/i.test(item))).toBe(true);
});

test('real transaction timeout aborts the write and global queue admits at most 32 operations', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const api = window.colorStorage, a = new api.ProjectStore(), b = new api.ProjectStore();
    const p = api.createProject(api.createImageAsset({ width: 1, height: 1, rgba: new Uint8ClampedArray(4) }, { fileName: 'x.png', format: 'png', width: 1, height: 1 }));
    p.title = 'Complete'; await a.save(p);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      IDBObjectStore.prototype.put = original;
      const request = original.apply(this, args);
      request.addEventListener('success', () => {
        const keepAlive = () => { const next = this.get('keepalive'); next.onsuccess = keepAlive; }; keepAlive();
      });
      return request;
    };
    p.title = 'Never complete';
    const first = a.save(p).then(() => 'bad success', error => String(error));
    const queued = Array.from({ length: 31 }, () => b.load());
    const overflow = await a.load().then(() => 'bad success', error => String(error));
    const timedOut = await first;
    const titles = await Promise.all(queued.map(async item => (await item)!.title));
    a.close(); b.close(); return { timedOut, overflow, titles };
  });
  expect(result.timedOut).toMatch(/timed out/i); expect(result.overflow).toMatch(/too many/i);
  expect(result.titles).toEqual(Array(31).fill('Complete'));
});

test('blocked open times out without treating it as absence and closes late native opens', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const open = indexedDB.open('color-context-lab.v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('projects');
    const blocker = await new Promise<IDBDatabase>(resolve => { open.onsuccess = () => resolve(open.result); });
    const deletion = indexedDB.deleteDatabase('color-context-lab.v1');
    await new Promise<void>(resolve => { deletion.onblocked = () => resolve(); });
    const store = new window.colorStorage.ProjectStore();
    const result = await store.load().then(() => 'bad absence', error => String(error));
    store.close(); blocker.close();
    await new Promise<void>((resolve, reject) => { deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(deletion.error); });
    // A leaked late-open connection would block this version upgrade.
    const upgrade = indexedDB.open('color-context-lab.v1', 2);
    await new Promise<void>((resolve, reject) => { upgrade.onsuccess = () => { upgrade.result.close(); resolve(); }; upgrade.onerror = () => reject(upgrade.error); });
    return result;
  });
  expect(result).toMatch(/timed out/i);
});
