import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface StorageTestWindow extends Window {
  __motionStorage: { holdNext: boolean; tracking: boolean; opens: number; release: (() => void) | null };
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Motion Studio', exact: true })).toBeVisible();
  await expect(page.locator('#project-title')).toBeVisible();
  await expect(page.locator('#save-status')).not.toContainText(/checking|loading|restoring|opening/i);
}

async function setTitle(page: Page, title: string): Promise<void> {
  await page.locator('#project-title').fill(title);
  await page.locator('#project-title').press('Tab');
}

async function readStored(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motion-studio', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction('project', 'readonly');
        const request = transaction.objectStore('project').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

async function backup(page: Page): Promise<Record<string, unknown>> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#backup').click(),
  ]);
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as Record<string, unknown>;
}

test('local storage keeps one validated project and restores its complete saved state', async ({ page }) => {
  await ready(page);
  await setTitle(page, 'Saved motion idea');
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const saved = await backup(page);
  expect(await readStored(page)).toEqual(saved);
  await page.reload();
  await expect(page.locator('#project-title')).toHaveValue('Saved motion idea');
  expect(await backup(page)).toEqual(saved);
  expect(await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motion-studio', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = database.transaction('project').objectStore('project').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  })).toBe(1);
});

test('a delayed older save cannot overwrite a newer edit', async ({ page }) => {
  await page.addInitScript(() => {
    const observed = window as unknown as StorageTestWindow;
    observed.__motionStorage = { holdNext: false, tracking: false, opens: 0, release: null };
    const originalOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      const request = originalOpen(name, version);
      const state = observed.__motionStorage;
      if (name !== 'motion-studio') return request;
      if (state.tracking) state.opens += 1;
      if (!state.holdNext) return request;
      state.holdNext = false;
      let callback: IDBOpenDBRequest['onsuccess'] = null;
      Object.defineProperty(request, 'onsuccess', {
        get: () => callback,
        set: (listener: IDBOpenDBRequest['onsuccess']) => {
          callback = listener;
          request.addEventListener('success', event => {
            state.release = () => { state.release = null; callback?.call(request, event); };
          }, { once: true });
        },
      });
      return request;
    };
  });
  await ready(page);
  // Finish an actual database read before arming the gate for the first write.
  await readStored(page);
  await page.clock.install();
  await page.evaluate(() => {
    const state = (window as unknown as StorageTestWindow).__motionStorage;
    state.holdNext = true; state.tracking = true; state.opens = 0;
  });
  await setTitle(page, 'Older pending save');
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => (window as unknown as StorageTestWindow).__motionStorage.release !== null)).toBe(true);
  try {
    await setTitle(page, 'Newer motion survives');
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => (window as unknown as StorageTestWindow).__motionStorage.opens)).toBe(1);
  } finally {
    await page.evaluate(() => (window as unknown as StorageTestWindow).__motionStorage.release?.());
  }
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const stored = await readStored(page) as { title: string };
  expect(stored.title).toBe('Newer motion survives');
  await page.reload();
  await expect(page.locator('#project-title')).toHaveValue('Newer motion survives');
});

test('an invalid stored record is reported and preserved instead of silently replaced', async ({ page }) => {
  await ready(page);
  await setTitle(page, 'Valid before corruption');
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const corrupt = { schemaVersion: 99, title: 'Unrecognized stored project' };
  await page.evaluate(async value => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motion-studio', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('project', 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction.objectStore('project').put(value, 'current');
      });
    } finally { database.close(); }
  }, corrupt);
  await page.reload();
  await expect(page.locator('#message')).toContainText(/restore|saved project|backup/i);
  expect(await readStored(page)).toEqual(corrupt);
  await expect(page.locator('#project-title')).not.toHaveValue('Unrecognized stored project');
  await expect(page.locator('#project-title')).toBeEnabled();
  await page.clock.install();await setTitle(page,'New work stays in memory');await page.clock.runFor(1000);
  expect(await readStored(page)).toEqual(corrupt);
});

test('blocked IndexedDB keeps the animation editable and JSON backup available', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => { throw new DOMException('Storage blocked', 'SecurityError'); } });
  });
  await ready(page);
  await setTitle(page, 'Backup despite storage failure');
  await expect(page.locator('#save-status')).toContainText(/not saved|unavailable|failed/i);
  await expect(page.locator('#project-title')).toBeEnabled();
  const saved = await backup(page);
  expect(saved.title).toBe('Backup despite storage failure');
  expect(saved.schemaVersion).toBe(1);
  expect(Array.isArray(saved.layers)).toBe(true);
  expect(errors).toEqual([]);
});

test('schema creation failure is reported without an uncaught browser error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    IDBDatabase.prototype.createObjectStore = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); };
  });
  await ready(page);
  await expect(page.locator('#save-status')).toContainText('Local save unavailable');
  await expect(page.locator('#message')).toContainText('Storage quota exceeded');
  await setTitle(page, 'Editable after storage setup failed');
  await expect(page.locator('#save-status')).toContainText('Local save unavailable');
  expect((await backup(page)).title).toBe('Editable after storage setup failed');
  expect(errors).toEqual([]);
});
