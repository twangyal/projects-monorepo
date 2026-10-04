import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function stored(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('clothing-studio', 1);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try { return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('project', 'readonly'), r = tx.objectStore('project').get('current');
      r.onsuccess = () => resolve(r.result); tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  });
}

async function title(page: Page, value: string) {
  await page.getByLabel('Concept name').fill(value);
  await page.getByLabel('Concept name').press('Tab');
}

async function seed(page: Page) {
  await page.goto('/'); await expect(page.locator('#save-state')).not.toContainText('Checking');
  await title(page, 'Durable original'); await expect(page.locator('#save-state')).toHaveText('Locally saved');
  return stored(page);
}

// Keep actual native work active, without replacing put/get or inventing an
// abort. Production must retire this transaction and await its native event.
async function holdNextWrite(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction; let first = true;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const tx = original.apply(this, args);
      if (this.name === 'clothing-studio' && args[1] === 'readwrite' && first) {
        first = false;
        Object.assign(window, { deadlineWriteStarted: true, deadlineAborted: false });
        tx.addEventListener('abort', () => Object.assign(window, { deadlineAborted: true }));
        const keepAlive = () => { const r = tx.objectStore('project').get('current'); r.onsuccess = keepAlive; };
        keepAlive();
      }
      return tx;
    };
  });
}

test('held native autosave rolls back exactly and a later edit retries', async ({ page }) => {
  const prior = await seed(page); await page.clock.install(); await holdNextWrite(page);
  await title(page, 'Uncommitted held write'); await page.clock.runFor(250);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'deadlineWriteStarted'))).toBe(true);
  await page.clock.runFor(10_000);
  await expect(page.locator('#save-state')).toHaveText('Not saved locally');
  expect(await page.evaluate(() => Reflect.get(window, 'deadlineAborted'))).toBe(true);
  expect(await stored(page)).toEqual(prior);
  const download = page.waitForEvent('download'); await page.locator('#backup').click();
  expect(JSON.parse(await readFile((await (await download).path())!, 'utf8')).title).toBe('Uncommitted held write');
  await title(page, 'Deliberate retry'); await page.clock.runFor(250);
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  expect((await stored(page) as { title: string }).title).toBe('Deliberate retry');
});

test('queued committed edits proceed only after held autosave aborts', async ({ page }) => {
  await seed(page); await page.clock.install(); await holdNextWrite(page);
  await title(page, 'Held first edit'); await page.clock.runFor(250);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'deadlineWriteStarted'))).toBe(true);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (value?.title === 'Queued latest edit') Object.assign(window, { queuedSawAbort: Reflect.get(window, 'deadlineAborted') });
      return original.call(this, value, key);
    };
  });
  await title(page, 'Queued latest edit'); await page.clock.runFor(250);
  await page.clock.runFor(10_000);
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  expect(await page.evaluate(() => Reflect.get(window, 'queuedSawAbort'))).toBe(true);
  expect((await stored(page) as { title: string }).title).toBe('Queued latest edit');
});

test('a blocked native startup read expires without erasing the saved concept', async ({ page, context }) => {
  const prior = await seed(page), blocker = await context.newPage();
  await blocker.goto('/'); await expect(blocker.locator('#save-state')).toHaveText('Locally saved');
  await blocker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('clothing-studio', 1); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction('project', 'readwrite'); let active = true;
    Object.assign(window, { releaseBlocker: () => { active = false; } });
    await new Promise<void>(resolve => {
      const keepAlive = () => { const r = tx.objectStore('project').get('current'); r.onsuccess = () => { resolve(); if (active) keepAlive(); }; };
      keepAlive();
    });
    tx.oncomplete = () => db.close(); tx.onabort = () => db.close();
  });
  await page.clock.install(); await page.reload();
  await expect(page.locator('#save-state')).toContainText('Checking');
  await page.clock.runFor(10_000);
  await expect(page.locator('#save-state')).toContainText('previous concept protected');
  await title(page, 'Memory work after read timeout');
  await blocker.evaluate(() => Reflect.get(window, 'releaseBlocker')());
  expect(await stored(page)).toEqual(prior);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#replace-saved').click();
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  expect((await stored(page) as { title: string }).title).toBe('Memory work after read timeout');
  await blocker.close();
});

test('a delayed native completion callback still reports the actual committed write', async ({ page }) => {
  await seed(page); await page.clock.install();
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction; let first = true;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const tx = original.apply(this, args);
      if (this.name === 'clothing-studio' && args[1] === 'readwrite' && first) {
        first = false; let callback: IDBTransaction['oncomplete'] = null;
        Object.defineProperty(tx, 'oncomplete', { get: () => callback, set: (listener: IDBTransaction['oncomplete']) => {
          callback = listener; tx.addEventListener('complete', event => {
            Object.assign(window, { releaseCommittedWrite: () => callback?.call(tx, event) });
          }, { once: true });
        } });
      }
      return tx;
    };
  });
  await title(page, 'Actually committed'); await page.clock.runFor(250);
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseCommittedWrite'))).toBe('function');
  expect((await stored(page) as { title: string }).title).toBe('Actually committed');
  await page.clock.runFor(10_000); await expect(page.locator('#save-state')).toHaveText('Saving…');
  await page.evaluate(() => Reflect.get(window, 'releaseCommittedWrite')());
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  expect((await stored(page) as { title: string }).title).toBe('Actually committed');
});
