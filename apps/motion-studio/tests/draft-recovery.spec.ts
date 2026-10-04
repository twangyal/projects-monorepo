import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createProject } from '../src/model.ts';
import { nativeCurrent, nativeLegacyRaw } from './native-saved-project.ts';

const corrupt = { schemaVersion: 99, title: 'Protected original', extra: { unicode: '日本語 ✦', nested: [null, false, 7] } };

async function record(page: Page, value?: unknown, put = false): Promise<unknown> { return nativeCurrent(page, put ? { value } : undefined); }

async function seed(page: Page, value: unknown = corrupt) {
  await page.goto('/');
  await expect(page.locator('#save-status')).not.toContainText(/opening|checking|loading|restoring/i);
  await record(page, value, true);
  await page.reload();
  await expect(page.locator('#message')).toContainText(/saved|restore|decode/i);
}
async function title(page: Page, value: string) { await page.locator('#project-title').fill(value); await page.locator('#project-title').press('Tab'); }
async function downloaded(page: Page, id: string) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(id).click()]);
  return readFile((await download.path())!, 'utf8');
}
async function protectedRecord(page: Page, value: unknown = corrupt) {
  // Wait past the real debounce; the assertion reads the native persisted value.
  await page.waitForTimeout(400);
  expect(await record(page)).toEqual(value);
}

// This reproduces #48 without depending on any proposed recovery UI.
test('editing after invalid restore never overwrites the native saved record', async ({ page }) => {
  await seed(page);
  await title(page, 'Unsaved memory edit');
  await protectedRecord(page);
});

test('raw saved record download preserves exact unknown properties without exporting the recovery demo', async ({ page }) => {
  await seed(page); await title(page, 'Different current project');
  expect(await downloaded(page, '#recovery-download')).toBe(JSON.stringify(corrupt));
  await protectedRecord(page);
});

test('recovery retains raw data through history, imports, resets and current exports', async ({ page }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4210') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) external.push(request.url()); });
  await seed(page);
  await expect(page.getByRole('region', { name: 'Saved draft recovery' })).toBeVisible();
  await title(page, 'Memory edit'); await page.locator('#undo').click(); await page.locator('#redo').click();
  const imported = createProject(); imported.title = 'Imported in memory'; imported.frameCount = 12;
  await page.locator('#project-file-action').selectOption('replace');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#project-file').setInputFiles({ name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator('#project-title')).toHaveValue(imported.title);
  await expect(page.locator('#save-status')).toContainText(/in memory|memory only/i);
  expect(JSON.parse(await downloaded(page, '#backup')).title).toBe(imported.title);
  for (const selector of ['#png', '#gif']) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
    expect((await readFile((await download.path())!)).length).toBeGreaterThan(0);
  }
  expect(await downloaded(page, '#recovery-download')).toBe(JSON.stringify(corrupt));
  await expect(page.locator('#save-status')).toContainText(/in memory|memory only/i);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#new-project').click();
  await protectedRecord(page);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('cancel, failed import and failed deliberate replacement keep recovery active', async ({ page }) => {
  await seed(page); await title(page, 'Keep memory');
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#replace-saved-project').click();
  await protectedRecord(page);
  await page.locator('#project-file-action').selectOption('replace');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#project-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.locator('#message')).toContainText('unchanged');
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException('Simulated write denied', 'QuotaExceededError'); }; });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#replace-saved-project').click();
  await expect(page.locator('#recovery-detail')).toContainText(/Simulated write denied|could not/i);
  await expect(page.locator('#recovery-panel')).toBeVisible();
  await protectedRecord(page);
  expect(JSON.parse(await downloaded(page, '#backup')).title).toBe('Keep memory');
});

test('successful confirmed replacement resumes autosave and reopens the actual record', async ({ page }) => {
  await seed(page); await title(page, 'Deliberately saved');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#replace-saved-project').click();
  await expect(page.locator('#recovery-panel')).toBeHidden();
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  expect((await record(page) as { title: string }).title).toBe('Deliberately saved');
  expect(await nativeLegacyRaw(page)).toEqual(corrupt);
  await title(page, 'Normal autosave resumes');
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  await page.reload(); await expect(page.locator('#project-title')).toHaveValue('Normal autosave resumes');
});

async function gateRead(page: Page, mode: 'deny' | 'hold') {
  await page.addInitScript(mode => {
    const actual = IDBObjectStore.prototype.get;
    let first = true;
    Object.assign(window, { releaseMotionRead: null, allowMotionRead: false });
    IDBObjectStore.prototype.get = function (...args) {
      const state = window as unknown as { allowMotionRead: boolean; releaseMotionRead: (() => void) | null };
      if (this.name !== 'project' || args[0] !== 'current' || !first) return actual.apply(this, args);
      if (mode === 'deny' && !state.allowMotionRead) throw new DOMException('Simulated read denied', 'SecurityError');
      first = false;
      const request = actual.apply(this, args);
      if (mode === 'hold') {
        let callback: IDBRequest['onsuccess'] = null;
        Object.defineProperty(request, 'onsuccess', { get: () => callback, set: listener => {
          callback = listener;
          request.addEventListener('success', event => { state.releaseMotionRead = () => callback?.call(request, event); }, { once: true });
        } });
      }
      return request;
    };
  }, mode);
}

test('denied reads protect unknown storage and retry preserves edits until confirmed restore', async ({ page }) => {
  const saved = createProject(); saved.title = 'Recovered actual draft';
  await seed(page, saved);
  await gateRead(page, 'deny'); await page.reload();
  await expect(page.locator('#recovery-panel')).toBeVisible(); await title(page, 'New memory work');
  await page.locator('#recovery-download').click();
  await expect(page.locator('#recovery-detail')).toContainText(/unavailable|not read|unknown/i);
  await page.evaluate(() => { (window as unknown as { allowMotionRead: boolean }).allowMotionRead = true; });
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#recovery-retry').click();
  await expect(page.locator('#project-title')).toHaveValue('New memory work'); await protectedRecord(page, saved);
  expect(JSON.parse(await downloaded(page, '#recovery-download'))).toEqual(saved);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#recovery-retry').click();
  await expect(page.locator('#project-title')).toHaveValue(saved.title);
  await expect(page.locator('#recovery-panel')).toBeHidden();
});

test('startup read keeps editor mutations locked until restore completes', async ({ page }) => {
  const saved = createProject(); saved.title = 'Slow saved draft'; await seed(page, saved);
  await gateRead(page, 'hold'); await page.reload();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseMotionRead: unknown }).releaseMotionRead)).toBe('function');
  await expect(page.locator('#project-title')).toBeDisabled();
  await expect(page.locator('#project-file')).toBeDisabled();
  await expect(page.locator('#new-project')).toBeDisabled();
  await protectedRecord(page, saved);
  await page.evaluate(() => (window as unknown as { releaseMotionRead: () => void }).releaseMotionRead());
  await expect(page.locator('#project-title')).toHaveValue(saved.title);
  await expect(page.locator('#project-title')).toBeEnabled(); await protectedRecord(page, saved);
});

test('a delayed retry cannot publish over a newer memory edit', async ({ page }) => {
  await seed(page); await title(page, 'Before retry');
  const saved = createProject(); saved.title = 'Valid saved draft'; await record(page, saved, true);
  await page.evaluate(() => {
    const actual = IDBObjectStore.prototype.get;
    let first = true;
    IDBObjectStore.prototype.get = function (...args) {
      const request = actual.apply(this, args);
      if (this.name !== 'project' || args[0] !== 'current' || !first) return request;
      first = false;
      let callback: IDBRequest['onsuccess'] = null;
      Object.defineProperty(request, 'onsuccess', { get: () => callback, set: listener => {
        callback = listener; request.addEventListener('success', event => {
          Object.assign(window, { releaseMotionRetry: () => callback?.call(request, event) });
        }, { once: true });
      } });
      return request;
    };
  });
  await page.locator('#recovery-retry').click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseMotionRetry: unknown }).releaseMotionRetry)).toBe('function');
  await title(page, 'Newer edit during retry');
  await page.evaluate(() => (window as unknown as { releaseMotionRetry: () => void }).releaseMotionRetry());
  await expect(page.locator('#recovery-detail')).toContainText(/changed|newer|kept/i);
  await expect(page.locator('#project-title')).toHaveValue('Newer edit during retry');
  await protectedRecord(page, saved);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#recovery-retry').click();
  await expect(page.locator('#project-title')).toHaveValue(saved.title);
});

test('late native image decode during retry releases bitmaps and preserves newer edits and history', async ({ page }) => {
  await seed(page); await title(page, 'Before image retry');
  const saved = await page.evaluate(project => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    canvas.getContext('2d')!.fillRect(0, 0, 10, 10);
    return { ...project, title: 'Saved image draft', layers: [{ id: 'image', kind: 'image', name: 'Image', keys: project.layers[0].keys,
      image: { width: 10, height: 10, dataUrl: canvas.toDataURL('image/png') } }] };
  }, createProject());
  await record(page, saved, true);
  await page.evaluate(() => {
    const original = createImageBitmap; let first = true;
    Object.assign(window, { recoveryBitmapClosed: 0, releaseRecoveryBitmap: null });
    const close = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function () {
      (window as unknown as { recoveryBitmapClosed: number }).recoveryBitmapClosed++;
      close.call(this);
    };
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      const decoded = Reflect.apply(original, window, args) as Promise<ImageBitmap>;
      if (!first) return decoded; first = false;
      return decoded.then(bitmap => new Promise<ImageBitmap>(resolve => {
        Object.assign(window, { releaseRecoveryBitmap: () => resolve(bitmap) });
      }));
    }) as typeof createImageBitmap;
  });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#recovery-retry').click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseRecoveryBitmap: unknown }).releaseRecoveryBitmap)).toBe('function');
  await title(page, 'Edited during decode');
  await page.evaluate(() => (window as unknown as { releaseRecoveryBitmap: () => void }).releaseRecoveryBitmap());
  await expect(page.locator('#recovery-detail')).toContainText('Newer work was kept');
  await expect.poll(() => page.evaluate(() => (window as unknown as { recoveryBitmapClosed: number }).recoveryBitmapClosed)).toBe(2);
  await expect(page.locator('#project-title')).toHaveValue('Edited during decode');
  await protectedRecord(page, saved);
  await page.locator('#undo').click(); await expect(page.locator('#project-title')).toHaveValue('Before image retry');
  await page.locator('#redo').click(); await expect(page.locator('#project-title')).toHaveValue('Edited during decode');
  expect(JSON.parse(await downloaded(page, '#recovery-download'))).toEqual(saved);
});

test('genuine PNG decoding failure preserves the complete raw saved project', async ({ page }) => {
  await page.goto('/');
  const broken = await page.evaluate(project => {
    const c = document.createElement('canvas'); c.width = c.height = 10;
    const bytes = Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
    let cursor = 8;
    while (cursor + 12 <= bytes.length) {
      const count = new DataView(bytes.buffer).getUint32(cursor), name = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
      if (name === 'IDAT') { bytes.fill(0, cursor + 8, cursor + 8 + count); break; } cursor += count + 12;
    }
    return { ...project, layers: [{ id: 'broken', kind: 'image', name: 'Broken', keys: project.layers[0].keys,
      image: { width: 10, height: 10, dataUrl: 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes)) } }], extra: 'retain me' };
  }, createProject());
  await seed(page, broken); await title(page, 'Editable despite decode failure'); await protectedRecord(page, broken);
  expect(JSON.parse(await downloaded(page, '#recovery-download'))).toEqual(broken);
});

for (const kind of ['cycle', 'nonfinite', 'undefined', 'date', 'overbound'] as const) test(`unsafe raw ${kind} never produces a lossy backup`, async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async kind => {
    let value: unknown;
    if (kind === 'cycle') { const cycle: Record<string, unknown> = { title: 'cycle' }; cycle.self = cycle; value = cycle; }
    if (kind === 'nonfinite') value = { number: Infinity };
    if (kind === 'undefined') value = undefined;
    if (kind === 'date') value = { date: new Date(0) };
    if (kind === 'overbound') value = { data: 'x'.repeat(6 * 1024 * 1024 + 168) };
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('motion-studio', 2); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('project', 'readwrite'); tx.objectStore('project').put(value, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, kind);
  await page.reload(); await expect(page.locator('#recovery-panel')).toBeVisible();
  const downloads: string[] = []; page.on('download', d => downloads.push(d.suggestedFilename()));
  await page.locator('#recovery-download').click();
  await expect(page.locator('#recovery-detail')).toContainText(/cannot|could not|unsafe|6 MiB|JSON/i);
  await title(page, 'Still editable'); await page.waitForTimeout(400);
  expect(downloads).toEqual([]);
  expect(await page.evaluate(async kind => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('motion-studio', 2); r.onsuccess = () => resolve(r.result); });
    const result = await new Promise<boolean>(resolve => { const store = db.transaction('project').objectStore('project'); const r = store.get('current'); r.onsuccess = () => {
      const v = r.result; resolve(kind === 'cycle' ? v.self === v : kind === 'nonfinite' ? v.number === Infinity : kind === 'undefined' ? v === undefined : kind === 'date' ? v.date instanceof Date : v.data.length === 6 * 1024 * 1024 + 168);
    }; }); db.close(); return result;
  }, kind)).toBe(true);
});

test('recovery actions remain visible, labelled and keyboard usable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page);
  const panel = page.getByRole('region', { name: 'Saved draft recovery' }); await expect(panel).toBeVisible();
  for (const id of ['recovery-download', 'recovery-retry', 'replace-saved-project']) {
    const button = page.locator(`#${id}`); await expect(button).toBeEnabled(); expect(await button.innerText()).not.toBe('');
    await button.focus(); await expect(button).toBeFocused();
    const box = (await button.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.locator('#recovery-download').focus();
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(corrupt);
});
