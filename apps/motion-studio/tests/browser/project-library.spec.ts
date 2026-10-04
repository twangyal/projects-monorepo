import { chromium, expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';

// Original literal fixtures frozen before reading the new library producers.
// Embedded pixels are independently encoded RGBA PNGs, not screenshots or app exports.
interface LibraryFixturePose { frame: number; x: number; y: number; scale: number; rotation: number; opacity: number; easing: 'linear' }
interface LibraryFixtureStroke { color: string; width: number; points: { x: number; y: number }[] }
interface LibraryFixtureLayer {
  id: string; name: string; kind: 'drawing' | 'image'; keys: LibraryFixturePose[];
  cels?: { frame: number; strokes: LibraryFixtureStroke[] }[];
  image?: { dataUrl: string; width: number; height: number };
}
interface LibraryFixtureProject { schemaVersion: 2; title: string; background: string; frameCount: number; layers: LibraryFixtureLayer[] }
function fixtureCrc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function fixtureChunk(name: string, bytes: Uint8Array): Buffer {
  const type = Buffer.from(name), data = Buffer.from(bytes), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); type.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(fixtureCrc(Buffer.concat([type, data])), data.length + 8); return result;
}
function fixturePng(rgba: readonly number[]): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(8); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(8 * 33);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.set(rgba, y * 33 + 1 + x * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), fixtureChunk('IHDR', header), fixtureChunk('IDAT', deflateSync(pixels)), fixtureChunk('IEND', Buffer.alloc(0))]);
}
function fixturePose(frame: number, x: number, y: number, scale = 1): LibraryFixturePose {
  return { frame, x, y, scale, rotation: 0, opacity: 1, easing: 'linear' };
}
function libraryFixture(which: 'A' | 'B'): LibraryFixtureProject {
  const isA = which === 'A';
  const line = (color: string): LibraryFixtureStroke => ({ color, width: 20, points: [{ x: -60, y: 0 }, { x: 60, y: 0 }] });
  return { schemaVersion: 2, title: isA ? 'Amber <A> Ω' : 'Blue B 🌿', background: '#FFFFFF', frameCount: 12, layers: [
    { id: `drawing-${which}`, name: `Drawing ${which}`, kind: 'drawing',
      keys: [fixturePose(0, (isA ? 320 : 400) + 1 / 3, 180), fixturePose(11, (isA ? 352 : 368) + 1 / 3, 180)],
      cels: [{ frame: 0, strokes: [line(isA ? '#FF0000' : '#00FF00')] }, { frame: 6, strokes: [line(isA ? '#0000FF' : '#FF00FF')] }] },
    { id: `image-${which}`, name: `Embedded ${which}`, kind: 'image', keys: [fixturePose(0, 60, 60, 4)],
      image: { width: 8, height: 8, dataUrl: 'data:image/png;base64,' + fixturePng(isA ? [255, 255, 0, 255] : [0, 255, 255, 255]).toString('base64') } },
  ] };
}

test('literal artwork imports into the named project library', async ({ page }) => {
  const project = libraryFixture('A');
  await page.goto('/');
  await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
  await page.locator('#project-file').setInputFiles({ name: 'original-A.motion.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#project-title')).toHaveValue(project.title);
  await expect(page.getByRole('region', { name: 'Projects', exact: true })).toBeVisible();
});

// Native database inspection is independent of application storage helpers.
interface NativeHead { schemaVersion: 1; revision: string; activeId: string | null; entries: { id: string; revision: string; title: string; frameCount: number; layerCount: number; projectBytes: number }[] }
interface NativeRow { schemaVersion: 1; id: string; revision: string; project: LibraryFixtureProject }
interface NativeLibrary { head: NativeHead | null; headPresent: boolean; rows: NativeRow[]; legacy: unknown; legacyPresent: boolean }
async function inspectLibrary(page: import('@playwright/test').Page): Promise<NativeLibrary> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('motion-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['library', 'projects', 'project'], 'readonly');
      const head = tx.objectStore('library').get('current'), present = tx.objectStore('library').getKey('current');
      const rows = tx.objectStore('projects').getAll(), legacy = tx.objectStore('project').get('current'), legacyKey = tx.objectStore('project').getKey('current');
      tx.oncomplete = () => { db.close(); resolve({ head: head.result ?? null, headPresent: present.result !== undefined, rows: rows.result, legacy: legacy.result, legacyPresent: legacyKey.result !== undefined }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function saved(page: import('@playwright/test').Page) { await expect(page.locator('#save-status')).toHaveText('Saved in this browser'); }
async function ready(page: import('@playwright/test').Page) {
  await page.goto('/'); await expect(page.locator('#project-library')).toBeVisible();
  await expect(page.locator('#project-file')).toBeEnabled();
}
async function importFixture(page: import('@playwright/test').Page, project: LibraryFixtureProject) {
  await expect(page.locator('#project-file')).toBeEnabled();
  await page.locator('#project-file-action').selectOption('new');
  await page.locator('#project-file').setInputFiles({ name: 'library-original.motion.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#project-title')).toHaveValue(project.title); await saved(page);
  const library = await inspectLibrary(page); const id = library.head!.activeId!;
  expect(library.rows.find(row => row.id === id)!.project).toEqual(project);
  return id;
}
async function nativeDownload(page: import('@playwright/test').Page, selector = '#backup') {
  const waiting = page.waitForEvent('download'); await page.locator(selector).click();
  const download = await waiting, path = await download.path(); if (!path) throw Error('Native download unavailable');
  return (await import('node:fs/promises')).readFile(path);
}
async function currentBackup(page: import('@playwright/test').Page): Promise<LibraryFixtureProject> { return JSON.parse((await nativeDownload(page)).toString('utf8')) as LibraryFixtureProject; }
function libraryRow(page: import('@playwright/test').Page, id: string) { return page.locator(`#project-library-list [data-project-id="${id}"]`); }
async function openEntry(page: import('@playwright/test').Page, id: string, title: string) {
  await libraryRow(page, id).locator('[data-library-action="open"]').click();
  await expect(page.locator('#project-title')).toHaveValue(title); await saved(page);
  await expect.poll(async () => (await inspectLibrary(page)).head!.activeId).toBe(id);
}
async function rename(page: import('@playwright/test').Page, title: string) { await page.locator('#project-title').fill(title); await page.locator('#project-title').press('Tab'); await saved(page); }
async function stagePixel(page: import('@playwright/test').Page, x: number, y: number) { return page.locator('#stage').evaluate((node, p) => Array.from((node as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data), { x, y }); }
async function scrubTo(page: import('@playwright/test').Page, frame: number) {
  await page.locator('#frame').evaluate((node, value) => { (node as HTMLInputElement).value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, frame);
  await expect(page.locator('#stage')).toHaveAttribute('data-frame', String(frame));
}
async function seedLegacy(page: import('@playwright/test').Page, raw: unknown) {
  await page.route('**/__motion_library_seed__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Original native fixture setup</title>' }));
  await page.goto('/__motion_library_seed__');
  await page.evaluate(value => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('motion-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('project');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction('project', 'readwrite'); tx.objectStore('project').put(value, 'current'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  }), raw);
}
function legacyFixture() {
  const canonical = libraryFixture('A'); const drawing = canonical.layers[0];
  return { ...canonical, schemaVersion: 1, layers: [{ id: drawing.id, name: drawing.name, kind: 'drawing', keys: drawing.keys, strokes: drawing.cels![0].strokes }, canonical.layers[1]], harmlessLegacyExtension: { literal: 'Preserve this original native field Ω' } };
}
function expectedLegacy() { const result = libraryFixture('A'); result.layers[0].cels = result.layers[0].cels!.slice(0, 1); return result; }
async function replaceNative(page: import('@playwright/test').Page, store: 'library' | 'projects', key: string, value: unknown) {
  await page.evaluate(({ store, key, value }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('motion-studio', 2); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  }), { store, key, value });
}

test.beforeEach(async ({ page }) => { page.on('dialog', dialog => dialog.accept()); });

test('imports create independent entries; open, title edit, duplicate and explicit deletion preserve original art', async ({ page }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B');
  const idA = await importFixture(page, a), idB = await importFixture(page, b);
  expect(idB).not.toBe(idA); expect((await inspectLibrary(page)).head!.entries.map(entry => entry.id)).toEqual([idA, idB]);
  await openEntry(page, idA, a.title); expect(await currentBackup(page)).toEqual(a); expect(await stagePixel(page, 60, 60)).toEqual([255, 255, 0, 255]);
  await rename(page, 'Renamed A'); const renamed = { ...a, title: 'Renamed A' };
  await page.locator('#duplicate-project').click(); await expect(page.locator('#project-library-list [data-project-id]')).toHaveCount(3); await saved(page);
  const idCopy = (await inspectLibrary(page)).head!.activeId!; expect([idA, idB]).not.toContain(idCopy); expect(await currentBackup(page)).toEqual(renamed);
  await rename(page, 'Independent duplicate'); const copy = { ...structuredClone(a), title: 'Independent duplicate' };
  await page.locator('#layers button').filter({ hasText: 'Drawing A' }).click(); await scrubTo(page, 6); await page.locator('#delete-cel').click(); await saved(page); copy.layers[0].cels = copy.layers[0].cels!.slice(0, 1);
  expect(await currentBackup(page)).toEqual(copy);
  await openEntry(page, idA, renamed.title); expect(await currentBackup(page)).toEqual(renamed);
  await openEntry(page, idB, b.title); expect(await currentBackup(page)).toEqual(b); expect(await stagePixel(page, 60, 60)).toEqual([0, 255, 255, 255]);
  page.removeAllListeners('dialog'); let prompt = ''; page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  await libraryRow(page, idA).locator('[data-library-action="delete"]').click(); await expect.poll(() => prompt).toContain('Renamed A');
  expect((await inspectLibrary(page)).head!.entries).toHaveLength(3);
  page.once('dialog', dialog => dialog.accept()); await libraryRow(page, idA).locator('[data-library-action="delete"]').click();
  await expect(libraryRow(page, idA)).toHaveCount(0); expect(await currentBackup(page)).toEqual(b);
  const final = await inspectLibrary(page); expect(final.head!.activeId).toBe(idB); expect(final.rows.map(row => row.id).sort()).toEqual([idB, idCopy].sort());
});

test('legacy upgrade reads without writes, creation retains legacy atomically and last deletion never resurrects it', async ({ page }) => {
  const original = legacyFixture(); await seedLegacy(page, original); await ready(page);
  await expect(page.locator('#project-title')).toHaveValue(original.title); expect(await currentBackup(page)).toEqual(expectedLegacy());
  const before = await inspectLibrary(page); expect(before.headPresent).toBe(false); expect(before.rows).toEqual([]); expect(before.legacy).toEqual(original);
  await page.locator('#new-project').click(); await expect(page.locator('#project-title')).toHaveValue('Untitled motion'); await saved(page);
  const promoted = await inspectLibrary(page); expect(promoted.head!.entries).toHaveLength(2); expect(promoted.rows.find(row => row.project.title === original.title)!.project).toEqual(expectedLegacy()); expect(promoted.legacy).toEqual(original);
  for (const id of promoted.head!.entries.map(entry => entry.id)) { await libraryRow(page, id).locator('[data-library-action="delete"]').click(); await expect(libraryRow(page, id)).toHaveCount(0); }
  const empty = await inspectLibrary(page); expect(empty.headPresent).toBe(true); expect(empty.head!.entries).toEqual([]); expect(empty.head!.activeId).toBeNull(); expect(empty.rows).toEqual([]); expect(empty.legacy).toEqual(original);
  await page.reload(); await expect(page.locator('#project-library')).toBeVisible(); await expect(page.locator('#project-title')).not.toHaveValue(original.title);
  expect((await inspectLibrary(page)).head).toEqual(empty.head); expect((await inspectLibrary(page)).legacy).toEqual(original);
});

test('same-project competing tab cannot overwrite winner or lose raw pose draft; explicit save-as-new preserves both', async ({ page, context }) => {
  await ready(page); const a = libraryFixture('A'), id = await importFixture(page, a);
  const other = await context.newPage(); other.on('dialog', dialog => dialog.accept()); await ready(other); await expect(other.locator('#project-title')).toHaveValue(a.title);
  await rename(page, 'First tab winner'); const winner = await inspectLibrary(page);
  await other.locator('#project-title').fill('Second tab local'); await other.locator('#project-title').press('Tab');
  await expect(other.locator('#save-status')).toContainText(/unavailable|protected/i);
  expect(await currentBackup(other)).toEqual({ ...a, title: 'Second tab local' }); expect((await inspectLibrary(page)).head).toEqual(winner.head);
  const input = other.locator('#pose-x'); await input.fill('-'); await input.focus(); await input.evaluate(node => { node.setAttribute('data-library-original', 'yes'); (node as HTMLInputElement).setSelectionRange(1, 1); });
  await other.locator('#refresh-project-library').evaluate(node => (node as HTMLButtonElement).click());
  await expect(input).toHaveValue('-'); await expect(input).toBeFocused(); await expect(input).toHaveAttribute('data-library-original', 'yes'); expect(await input.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(1);
  expect((await inspectLibrary(page)).rows.find(row => row.id === id)!.project.title).toBe('First tab winner');
  await other.locator('#discard-pose-edits').click(); await other.locator('#save-project-as-new').click(); await saved(other);
  const both = await inspectLibrary(page); expect(both.head!.entries).toHaveLength(2); expect(both.rows.find(row => row.id === id)!.project.title).toBe('First tab winner'); expect(both.rows.find(row => row.id !== id)!.project.title).toBe('Second tab local');
  await other.close();
});

test('different-project saves merge without changing another tab active selection', async ({ page, context }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B');
  const idA = await importFixture(page, a), idB = await importFixture(page, b);
  const other = await context.newPage(); other.on('dialog', dialog => dialog.accept()); await ready(other); await expect(other.locator('#project-title')).toHaveValue(b.title);
  await openEntry(page, idA, a.title); await rename(page, 'A changed independently');
  await rename(other, 'B changed independently');
  const actual = await inspectLibrary(page); expect(actual.head!.activeId).toBe(idA);
  expect(actual.rows.find(row => row.id === idA)!.project).toEqual({ ...a, title: 'A changed independently' });
  expect(actual.rows.find(row => row.id === idB)!.project).toEqual({ ...b, title: 'B changed independently' });
  expect(await currentBackup(page)).toEqual({ ...a, title: 'A changed independently' }); await other.close();
});

test('metadata refresh preserves native raw input identity and caret without replacing editor history', async ({ page, context }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B'); const idA = await importFixture(page, a); await importFixture(page, b);
  const other = await context.newPage(); other.on('dialog', dialog => dialog.accept()); await ready(other); await openEntry(page, idA, a.title); await rename(page, 'A prior local edit');
  const x = page.locator('#pose-x'); await x.fill('00-.'); await x.focus(); await x.evaluate(node => { node.setAttribute('data-original-library-field', 'true'); (node as HTMLInputElement).setSelectionRange(2, 3); });
  await rename(other, 'B metadata changed');
  await page.locator('#refresh-project-library').evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.locator('[data-project-title]').filter({ hasText: 'B metadata changed' })).toBeVisible();
  await expect(x).toHaveValue('00-.'); await expect(x).toBeFocused(); await expect(x).toHaveAttribute('data-original-library-field', 'true');
  expect(await x.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([2, 3]);
  // Keyboard-triggered download keeps the still-focused raw editor untouched.
  const waiting = page.waitForEvent('download'); await page.locator('#backup').evaluate(node => (node as HTMLButtonElement).click()); const path = await (await waiting).path();
  expect(JSON.parse(await (await import('node:fs/promises')).readFile(path!, 'utf8'))).toEqual({ ...a, title: 'A prior local edit' }); await expect(x).toHaveValue('00-.');
  await page.locator('#discard-pose-edits').click(); await expect(page.locator('#undo')).toBeEnabled(); await page.locator('#undo').click(); await expect(page.locator('#project-title')).toHaveValue(a.title); expect(await currentBackup(page)).toEqual(a); await other.close();
});

test('present corrupt head blocks new/import without legacy fallback and preserves every original row', async ({ page }) => {
  await ready(page); await importFixture(page, libraryFixture('A')); const before = await inspectLibrary(page), corrupt = { schemaVersion: 99, privateMarker: 'Retain original head Ω' };
  await replaceNative(page, 'library', 'current', corrupt); await page.reload();
  await expect(page.locator('#save-status')).toContainText(/protected|memory/i);
  const originalRows = (await inspectLibrary(page)).rows; expect(originalRows).toEqual(before.rows);
  if (await page.locator('#new-project').isEnabled()) await page.locator('#new-project').click();
  // Native File selection on disabled input must also be refused by admission.
  await page.locator('#project-file').setInputFiles({ name: 'must-not-replace.motion.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(libraryFixture('B'))) });
  expect((await inspectLibrary(page)).head).toEqual(corrupt); expect((await inspectLibrary(page)).rows).toEqual(originalRows);
  expect(await currentBackup(page)).toHaveProperty('schemaVersion', 2);
});

test('one corrupt entry is preserved while another admitted entry remains usable', async ({ page }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B'); const idA = await importFixture(page, a), idB = await importFixture(page, b);
  const before = await inspectLibrary(page), broken = { ...before.rows.find(row => row.id === idA)!, project: { ...a, frameCount: 1000 } };
  await replaceNative(page, 'projects', idA, broken); await libraryRow(page, idA).locator('[data-library-action="open"]').click();
  await expect(page.locator('#message')).toContainText(/frame count.*12.*96/i); expect(await currentBackup(page)).toEqual(b); expect(await stagePixel(page, 60, 60)).toEqual([0, 255, 255, 255]);
  await page.reload(); await expect(page.locator('#project-title')).toHaveValue(b.title); expect(await currentBackup(page)).toEqual(b);
  expect((await inspectLibrary(page)).rows.find(row => row.id === idA)).toEqual(broken); expect((await inspectLibrary(page)).head!.activeId).toBe(idB);
});

test('corrupt legacy value stays protected and original raw copy survives explicit replacement', async ({ page }) => {
  const corrupt = { unknownSchema: 999, literal: 'Do not discard old legacy Ω', nested: [null, true] };
  await seedLegacy(page, corrupt); await page.goto('/'); await expect(page.locator('#save-status')).toContainText(/protected|memory/i);
  expect((await inspectLibrary(page)).legacy).toEqual(corrupt); expect((await inspectLibrary(page)).headPresent).toBe(false);
  await page.locator('#replace-saved-project').click(); await saved(page);
  const after = await inspectLibrary(page); expect(after.legacy).toEqual(corrupt); expect(after.head!.entries).toHaveLength(1);
  expect(after.rows[0].project).toEqual(await currentBackup(page));
});

type GateWindow = Window & { motion104Gate?: { reached: boolean; released: boolean; release(): void } };
async function holdNextWrite(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction; let first = true, hold = true;
    const gate = { reached: false, released: false, release() { hold = false; gate.released = true; IDBDatabase.prototype.transaction = original; } };
    (window as GateWindow).motion104Gate = gate;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (first && args[1] === 'readwrite' && tx.objectStoreNames.contains('projects')) {
        first = false;
        const keep = () => { const request = tx.objectStore('projects').get('unmatched-oracle-keepalive'); request.onsuccess = () => { if (hold) keep(); gate.reached = true; }; };
        keep();
      }
      return tx;
    };
  });
}
async function holdNextDecode(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const original = window.createImageBitmap; let first = true; let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const gate = { reached: false, released: false, release() { release(); gate.released = true; window.createImageBitmap = original; } };
    (window as GateWindow).motion104Gate = gate;
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const bitmap = await Reflect.apply(original, window, args) as ImageBitmap;
      if (first) { first = false; gate.reached = true; await waiting; }
      return bitmap;
    }) as typeof createImageBitmap;
  });
}
async function holdNextFile(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const original = Blob.prototype.text; let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const gate = { reached: false, released: false, release() { release(); gate.released = true; Blob.prototype.text = original; } };
    (window as GateWindow).motion104Gate = gate;
    Blob.prototype.text = async function () {
      const text = await original.call(this);
      if (this instanceof File && this.name === 'held-motion104.json') { gate.reached = true; await waiting; }
      return text;
    };
  });
}
async function waitGate(page: import('@playwright/test').Page) { await page.waitForFunction(() => (window as GateWindow).motion104Gate?.reached); }
async function releaseGate(page: import('@playwright/test').Page) { await page.evaluate(() => (window as GateWindow).motion104Gate!.release()); }

test('held autosave completes for its captured entry before ordinary project switching', async ({ page }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B'); const idA = await importFixture(page, a), idB = await importFixture(page, b); await openEntry(page, idA, a.title);
  await holdNextWrite(page); await page.locator('#project-title').fill('A captured pending'); await page.locator('#project-title').press('Tab'); await waitGate(page);
  await expect(page.locator('#save-status')).not.toHaveText('Saved in this browser');
  const switchOperation = libraryRow(page, idB).locator('[data-library-action="open"]').click();
  await expect(page.locator('#project-title')).toHaveValue('A captured pending');
  await releaseGate(page); await switchOperation; await expect(page.locator('#project-title')).toHaveValue(b.title); await saved(page);
  const actual = await inspectLibrary(page); expect(actual.head!.activeId).toBe(idB); expect(actual.rows.find(row => row.id === idA)!.project).toEqual({ ...a, title: 'A captured pending' }); expect(actual.rows.find(row => row.id === idB)!.project).toEqual(b); expect(await currentBackup(page)).toEqual(b);
});

test('changed-back raw input during genuine project File read refuses old import and preserves focused draft', async ({ page }) => {
  await ready(page); const a = libraryFixture('A'); await importFixture(page, a); const before = await inspectLibrary(page); await holdNextFile(page);
  await page.locator('#project-file').setInputFiles({ name: 'held-motion104.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(libraryFixture('B'))) }); await waitGate(page);
  const x = page.locator('#pose-x'); await x.focus(); await x.evaluate(node => { const input = node as HTMLInputElement, original = input.value; input.setAttribute('data-owner-field', 'retained'); input.value = '-'; input.dispatchEvent(new Event('input', { bubbles: true })); input.value = original; input.dispatchEvent(new Event('input', { bubbles: true })); input.setSelectionRange(0, 2); });
  const raw = await x.inputValue(); await releaseGate(page);
  await expect(page.locator('#project-file')).toBeEnabled(); await expect(page.locator('#project-title')).toHaveValue(a.title); await expect(x).toBeFocused(); await expect(x).toHaveValue(raw); await expect(x).toHaveAttribute('data-owner-field', 'retained');
  expect(await x.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([0, 2]); expect(await inspectLibrary(page)).toEqual(before);
});

test('held selected-image decode never moves durable active pointer and pagehide retires its editor authority', async ({ page }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B'); const idA = await importFixture(page, a), idB = await importFixture(page, b); const before = await inspectLibrary(page);
  await holdNextDecode(page); await libraryRow(page, idA).locator('[data-library-action="open"]').click(); await waitGate(page);
  expect((await inspectLibrary(page)).head!.activeId).toBe(idB); await expect(page.locator('#project-title')).toHaveValue(b.title);
  await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await releaseGate(page); await expect(page.locator('#project-title')).toHaveValue(b.title); expect(await currentBackup(page)).toEqual(b); expect(await stagePixel(page, 60, 60)).toEqual([0, 255, 255, 255]);
  expect((await inspectLibrary(page)).head).toEqual(before.head);
  // Actual navigation starts a fresh owner and adopts only the durable entry.
  await page.reload(); await expect(page.locator('#project-title')).toHaveValue(b.title); expect(await currentBackup(page)).toEqual(b);
});

test('actual selected-image decode failure refuses opening and later native retry opens the exact entry', async ({ page }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B'); const idA = await importFixture(page, a), idB = await importFixture(page, b); const before = await inspectLibrary(page);
  await page.evaluate(() => { const original = window.createImageBitmap; window.createImageBitmap = (() => { window.createImageBitmap = original; return Promise.reject(new DOMException('Controlled selected-image decode failure', 'InvalidStateError')); }) as typeof createImageBitmap; });
  await libraryRow(page, idA).locator('[data-library-action="open"]').click(); await expect(page.locator('#message')).toContainText(/decode|image|unchanged|open/i);
  await expect(page.locator('#project-title')).toHaveValue(b.title); expect((await inspectLibrary(page)).head).toEqual(before.head); expect((await inspectLibrary(page)).head!.activeId).toBe(idB); expect(await currentBackup(page)).toEqual(b);
  await openEntry(page, idA, a.title); expect(await currentBackup(page)).toEqual(a); expect(await stagePixel(page, 60, 60)).toEqual([255, 255, 0, 255]);
});

test('raw pose draft blocks project navigation until explicit discard without moving the saved pointer', async ({ page }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B'); const idA = await importFixture(page, a); await importFixture(page, b); const before = await inspectLibrary(page);
  const x = page.locator('#pose-x'); await x.fill('-'); await x.focus();
  page.removeAllListeners('dialog'); page.once('dialog', dialog => dialog.dismiss());
  await libraryRow(page, idA).locator('[data-library-action="open"]').click(); await expect(x).toHaveValue('-'); await expect(page.locator('#project-title')).toHaveValue(b.title); expect((await inspectLibrary(page)).head).toEqual(before.head);
  page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept()); await page.locator('#discard-pose-edits').click(); await openEntry(page, idA, a.title); expect(await currentBackup(page)).toEqual(a);
});

test('eight ordinary literal projects refuse a ninth atomically with no silent eviction', async ({ page }) => {
  await ready(page);
  for (let i = 0; i < 8; i++) await importFixture(page, { ...libraryFixture(i % 2 ? 'B' : 'A'), title: `Original library ${i + 1}` });
  const full = await inspectLibrary(page); expect(full.head!.entries).toHaveLength(8);
  if (await page.locator('#new-project').isEnabled()) { await page.locator('#new-project').click(); await expect(page.locator('#message')).toContainText(/8|eight|full|limit/i); }
  await page.locator('#project-file').setInputFiles({ name: 'ninth.motion.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...libraryFixture('A'), title: 'Must not evict' })) });
  await expect(page.locator('#project-title')).toHaveValue('Original library 8'); expect(await inspectLibrary(page)).toEqual(full);
});

test('keyboard library controls fit390px and selected entry exports literal held pixels', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page); const a = libraryFixture('A'), b = libraryFixture('B'); const idA = await importFixture(page, a); await importFixture(page, b);
  const open = libraryRow(page, idA).locator('[data-library-action="open"]'); await open.focus(); await open.press('Enter'); await expect(page.locator('#project-title')).toHaveValue(a.title); await saved(page);
  await scrubTo(page, 6); expect(await stagePixel(page, 333, 180)).toEqual([0, 0, 255, 255]); expect(await stagePixel(page, 60, 60)).toEqual([255, 255, 0, 255]);
  const png = await nativeDownload(page, '#png');
  const decoded = await page.evaluate(async bytes => { const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' })); const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); const result = { width: bitmap.width, height: bitmap.height, ink: Array.from(ctx.getImageData(333, 180, 1, 1).data), original: Array.from(ctx.getImageData(60, 60, 1, 1).data) }; bitmap.close(); return result; }, Array.from(png));
  expect(decoded).toEqual({ width: 640, height: 360, ink: [0, 0, 255, 255], original: [255, 255, 0, 255] }); expect(await currentBackup(page)).toEqual(a);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); await page.screenshot({ path: testInfo.outputPath('library-390.png'), fullPage: true });
});

test('complete browser-process restart restores exact active project and independently editable earlier entry', async ({ baseURL }, testInfo) => {
  test.setTimeout(45000);
  const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'motion104-persistent-'));
  const owner: { context?: import('@playwright/test').BrowserContext } = {};
  const start = async () => { const context = await chromium.launchPersistentContext(profile, { ...testInfo.project.use.launchOptions, baseURL }); owner.context = context; const page = context.pages()[0]; page.on('dialog', dialog => dialog.accept()); return page; };
  try {
    let page = await start(); await ready(page); const a = libraryFixture('A'), b = libraryFixture('B'); const idA = await importFixture(page, a), idB = await importFixture(page, b); const before = await nativeDownload(page); const raw = await inspectLibrary(page);
    await owner.context!.close(); delete owner.context;
    page = await start(); await ready(page); await expect(page.locator('#project-title')).toHaveValue(b.title); expect((await nativeDownload(page)).equals(before)).toBe(true); expect(await inspectLibrary(page)).toEqual(raw); expect((await inspectLibrary(page)).head!.activeId).toBe(idB);
    await openEntry(page, idA, a.title); expect(await currentBackup(page)).toEqual(a); await rename(page, 'A after process restart'); expect((await inspectLibrary(page)).rows.find(row => row.id === idB)!.project).toEqual(b);
    await fs.writeFile(testInfo.outputPath('restart-active.motion.json'), before); await fs.writeFile(testInfo.outputPath('restart-proof.json'), JSON.stringify({ wholePersistentContextClosed: true, activeId: idB, savedEntries: 2, byteIdenticalBackup: true }, null, 2));
  } finally { await owner.context?.close(); await fs.rm(profile, { recursive: true, force: true }); }
});

test('reviewed replacement stays bound to conflicted A when another tab makes B globally active', async ({ page, context }) => {
  await ready(page); const a = libraryFixture('A'), b = libraryFixture('B');
  const idA = await importFixture(page, a), idB = await importFixture(page, b); await openEntry(page, idA, a.title);
  const other = await context.newPage(); other.on('dialog', dialog => dialog.accept()); await ready(other); await expect(other.locator('#project-title')).toHaveValue(a.title);
  await rename(other, 'Other tab saved A'); await openEntry(other, idB, b.title);
  const winner = await inspectLibrary(page), originalB = winner.rows.find(row => row.id === idB)!; expect(winner.head!.activeId).toBe(idB);
  await page.locator('#project-title').fill('First tab local A'); await page.locator('#project-title').press('Tab');
  await expect(page.locator('#save-status')).toContainText(/protected/i); expect(await currentBackup(page)).toEqual({ ...a, title: 'First tab local A' });
  let prompt = ''; page.removeAllListeners('dialog'); page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.accept(); });
  await page.locator('#replace-saved-project').click(); await saved(page);
  expect(prompt).toContain('Other tab saved A'); expect(prompt).not.toContain(b.title);
  const after = await inspectLibrary(page); expect(after.rows.find(row => row.id === idA)!.project).toEqual({ ...a, title: 'First tab local A' }); expect(after.rows.find(row => row.id === idB)).toEqual(originalB); expect(after.head!.activeId).toBe(idB);
  expect(await currentBackup(page)).toEqual({ ...a, title: 'First tab local A' }); await other.close();
});

test('a second genuine project File supersedes held first File and creates exactly one new entry', async ({ page }) => {
  await ready(page); const base = libraryFixture('A'); await importFixture(page, base); const original = await inspectLibrary(page);
  await holdNextFile(page);
  await page.locator('#project-file').setInputFiles({ name: 'held-motion104.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...base, title: 'Obsolete pending file' })) }); await waitGate(page);
  const b = libraryFixture('B'); await expect(page.locator('#project-file')).toBeEnabled();
  // No select/change/cancel action intervenes: the second real File must own supersession.
  await page.locator('#project-file').setInputFiles({ name: 'newer-motion104.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(b)) });
  await expect(page.locator('#project-title')).toHaveValue(b.title); await saved(page);
  const accepted = await inspectLibrary(page); expect(accepted.head!.entries).toHaveLength(2); expect(accepted.rows.find(row => row.id === original.head!.activeId)!.project).toEqual(base); expect(accepted.rows.find(row => row.id === accepted.head!.activeId)!.project).toEqual(b);
  await releaseGate(page); expect(await inspectLibrary(page)).toEqual(accepted); expect(await currentBackup(page)).toEqual(b);
  await expect(page.locator('#undo')).toBeDisabled(); await expect(page.locator('#redo')).toBeDisabled();
  await expect(page.locator('#project-library-list [data-project-id]')).toHaveCount(2);
});
