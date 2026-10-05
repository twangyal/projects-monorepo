import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

// Original complete composition and signed PCM. No product encoder or reducer
// participates in the fixture or the expected byte stream.
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function originalCopy(index = 1) {
  const id = `12600000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 52, 18, 204, 237, index, 0, 255, 255, 0, 0]);
  return { format: 'melody-studio-project', version: 1,
    document: { schemaVersion: 1, composition: { version: 1, title: `Original library ${index} Ω`, tempo: 108,
      tracks: [{ id: 'library-voice', name: 'Original retained voice', instrument: 'triangle', volume: .7, muted: false,
        notes: Array.from({ length: 8 }, (_, i) => ({ id: `library-note-${i}`, pitch: [60, 62, 64, 62][i % 4], start: i * .25, duration: .25, velocity: [.2, .4, .6, .8][i % 4] })) }] },
    references: [{ trackId: 'library-voice', assetId: id }] },
    assets: [{ id, kind: 'audio-file', captureTempo: 108, decodedSampleRate: 22050, decodedChannels: 1,
      decodedFrames: 8, analyzedFrames: 8, frameCount: 8, sha256: digest(pcm), pcmBase64: pcm.toString('base64') }] };
}
export type OriginalCopy = ReturnType<typeof originalCopy>;
export const originalBytes = (copy: OriginalCopy) => Buffer.from(JSON.stringify(copy));
export async function loadOriginal(page: Page, copy = originalCopy()) {
  await page.goto('/');
  await expect(page.getByLabel('Open project file', { exact: true })).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Open project file', { exact: true }).setInputFiles({ name: 'oracle-original.melody.json', mimeType: 'application/json', buffer: originalBytes(copy) });
  await expect(page.getByLabel('Project title')).toHaveValue(copy.document.composition.title);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  await expect(page.locator('#reference-summary')).toContainText('108');
}
export async function downloadBytes(page: Page, selector: string) {
  const pending = page.waitForEvent('download', { timeout: 10000 });
  await page.locator(selector).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Expected a real browser download');
  return readFile(path);
}
export async function workspaceBytes(page: Page) {
  const pending = page.waitForEvent('download', { timeout: 10000 });
  await page.getByRole('button', { name: 'Save project file', exact: true }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Expected a real complete project download');
  return readFile(path);
}

export interface RawCopy {
  schemaVersion: number; id: string; revision: string; label: string; title: string;
  tracks: number; references: number; bytes: number; sha256: string; backup: string; type: string;
}
export function literalRow(index: number, label = `Authored copy ${index}`): RawCopy {
  const copy = originalCopy(index), bytes = originalBytes(copy);
  return { schemaVersion: 1, id: `12610000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    revision: `12620000-0000-4000-8000-${String(index).padStart(12, '0')}`, label,
    title: copy.document.composition.title, tracks: 1, references: 1,
    bytes: bytes.length, sha256: digest(bytes), backup: bytes.toString(), type: 'application/json' };
}
export async function rows(page: Page): Promise<RawCopy[]> {
  return page.evaluate(() => new Promise<RawCopy[]>((resolve, reject) => {
    const request = indexedDB.open('melody-studio.library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('copies', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('copies', 'readonly'), get = tx.objectStore('copies').getAll();
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.oncomplete = () => { db.close(); void Promise.all((get.result as (Omit<RawCopy, 'backup' | 'type'> & {backup: Blob})[]).map(async row => {
        const { backup, ...metadata } = row;
        return { ...metadata, backup: await backup.text(), type: backup.type };
      })).then(resolve, reject); };
    };
  }));
}
export async function seedRows(page: Page, values: RawCopy[]) {
  await page.evaluate(values => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('melody-studio.library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('copies', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('copies', 'readwrite');
      for (const value of values) { const { backup, type, ...metadata } = value; tx.objectStore('copies').put({ ...metadata, backup: new Blob([backup], { type }) }); }
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), values);
}
export async function selectCopy(page: Page, id: string) {
  await page.locator('#library-refresh').click();
  await expect(page.locator(`#library-select option[value="${id}"]`)).toHaveCount(1);
  await page.locator('#library-select').selectOption(id);
}
export async function createCopy(page: Page, label: string) {
  const count = (await rows(page)).length;
  await page.locator('#library-label').fill(label); await page.locator('#library-create').click();
  await expect.poll(async () => (await rows(page)).length).toBe(count + 1);
  return (await rows(page)).find(row => row.label === label.trim())!;
}
export async function currentRow(page: Page) {
  return page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('melody-studio.projects', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('projects', 'readonly'), get = tx.objectStore('projects').get('current');
      tx.oncomplete = () => { db.close(); resolve(get.result); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
export async function rawInput(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((element, value) => { (element as HTMLInputElement).value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
interface LibraryProbe {
  holdRead: boolean; reads: number; pendingReads: number; releaseRead: (() => void) | null;
  abortPut: boolean; aborted: number; holdWrite: boolean; writing: boolean; releaseWrite: (() => void) | null;
  holdLoad: boolean; loading: boolean; releaseLoad: (() => void) | null;
  putSuccesses: number; commits: number;
}
export type OracleWindow = Window & { libraryOracle: LibraryProbe };
// Controlled faults/delivery gates wrap real native Blob reads and IDB work.
// The app's store/reducer/encoder are never replaced and no timer is shortened.
export async function installProbe(page: Page, holdLoad = false) {
  await page.addInitScript(holdLoad => {
    const probe: LibraryProbe = { holdRead: false, reads: 0, pendingReads: 0, releaseRead: null,
      abortPut: false, aborted: 0, holdWrite: false, writing: false, releaseWrite: null,
      holdLoad, loading: false, releaseLoad: null, putSuccesses: 0, commits: 0 };
    (window as unknown as OracleWindow).libraryOracle = probe;
    const buffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      if (this.type !== 'application/json') return buffer.call(this);
      probe.reads++;
      const native = buffer.call(this);
      if (!probe.holdRead) return native;
      return native.then(value => new Promise<ArrayBuffer>(resolve => {
        probe.pendingReads++;
        probe.releaseRead = () => { probe.holdRead = false; probe.pendingReads--; probe.releaseRead = null; resolve(value); };
      }));
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (this.transaction.db.name === 'melody-studio.library') request.addEventListener('success', () => {
        probe.putSuccesses++;
        if (probe.abortPut) { probe.abortPut = false; probe.aborted++; this.transaction.abort(); }
      }, { once: true });
      return request;
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const tx = transaction.call(this, names, mode, options);
      const library = this.name === 'melody-studio.library' && mode === 'readwrite';
      const startup = this.name === 'melody-studio.projects' && mode === 'readonly' && probe.holdLoad;
      if (library) tx.addEventListener('complete', () => probe.commits++, { once: true });
      if (library && probe.holdWrite || startup) {
        const key = startup ? 'holdLoad' : 'holdWrite';
        if (startup) { probe.loading = true; probe.releaseLoad = () => { probe.holdLoad = false; probe.loading = false; }; }
        else { probe.writing = true; probe.releaseWrite = () => { probe.holdWrite = false; probe.writing = false; }; }
        const pump = () => { if (probe[key]) { const request = tx.objectStore(startup ? 'projects' : 'copies').get(startup ? 'current' : 'oracle-keepalive'); request.addEventListener('success', pump, { once: true }); } };
        pump();
        tx.addEventListener('abort', () => { if (startup) probe.loading = false; else probe.writing = false; }, { once: true });
      }
      return tx;
    };
  }, holdLoad);
}
export async function probe(page: Page) {
  return page.evaluate(() => { const p = (window as unknown as OracleWindow).libraryOracle; return { reads: p.reads, pendingReads: p.pendingReads, writing: p.writing, loading: p.loading, aborted: p.aborted, putSuccesses: p.putSuccesses, commits: p.commits }; });
}
export async function control(page: Page, action: 'holdRead' | 'holdWrite' | 'abortPut' | 'releaseRead' | 'releaseWrite' | 'releaseLoad') {
  await page.evaluate(action => { const p = (window as unknown as OracleWindow).libraryOracle; if (action === 'holdRead' || action === 'holdWrite' || action === 'abortPut') p[action] = true; else p[action]?.(); }, action);
}
