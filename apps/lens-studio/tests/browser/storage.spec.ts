import { expect, test } from '@playwright/test';
import type {} from '../storage-harness.ts';
import { pngHeader } from '../photo-fixtures.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/storage-harness.html');
  await page.waitForFunction(() => Boolean(window.lensStorage));
});

test('native storage round-trip validates decoded images and returns detached records', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.lensStorage;
    const store = await h.openProjectStore(), initial = await store.load();
    store.acceptLoad(initial.receipt);
    const missing = initial.project;
    const project = h.fixture();
    await store.save(project);
    const loaded = (await store.load()).project!;
    const equal = JSON.stringify(loaded) === JSON.stringify(project);
    loaded.title = 'Detached edit';
    const savedTitle = (await store.load()).project!.title;
    await store.clear();
    const cleared = (await store.load()).project; await store.close();
    return { missing, equal, savedTitle, cleared };
  });
  expect(result).toEqual({ missing: null, equal: true, savedTitle: 'Captured study', cleared: null });
});

test('queued saves capture immediately and complete only after their ordered native transactions', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = await window.lensStorage.openProjectStore();
    store.acceptLoad((await store.load()).receipt);
    const original = IDBDatabase.prototype.transaction;
    let hold = true;
    let first = true;
    let started = 0;
    let firstCompleted = false;
    let markFirstRequest!: () => void;
    const firstRequest = new Promise<void>(resolve => { markFirstRequest = resolve; });
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite') {
        started++;
        if (first) {
          first = false;
          const keepAlive = () => {
            const request = tx.objectStore('projects').get('current');
            request.onsuccess = () => {
              if (hold) keepAlive();
              markFirstRequest();
            };
          };
          keepAlive();
        }
      }
      return tx;
    };
    try {
      const project = window.lensStorage.fixture('First snapshot');
      const firstSave = store.save(project).then(() => { firstCompleted = true; });
      project.title = 'Second snapshot';
      const secondSave = store.save(project);
      project.title = 'Unsaved mutation';
      // Image validation precedes the transaction; elapsed time does not prove it started.
      await firstRequest;
      const pending = !firstCompleted && started === 1;
      hold = false;
      await Promise.all([firstSave, secondSave]);
      const title = (await store.load()).project!.title;
      const third = store.save(project);
      const clear = store.clear();
      await Promise.all([third, clear]);
      return { pending, title, cleared: (await store.load()).project };
    } finally { hold = false; IDBDatabase.prototype.transaction = original; await store.close(); }
  });
  expect(result).toEqual({ pending: true, title: 'Second snapshot', cleared: null });
});

test('aborted native save rejects, leaves prior record intact and allows subsequent saves', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.lensStorage;
    const store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt);
    const project = h.fixture('Last good');
    await store.save(project);
    const original = IDBDatabase.prototype.transaction;
    let once = true;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite' && once) {
        once = false;
        tx.objectStore('projects').get('current').onsuccess = () => tx.abort();
      }
      return tx;
    };
    let error = '';
    try { await store.save({ ...project, title: 'Aborted edit' }); }
    catch (value) { error = (value as Error).message; }
    finally { IDBDatabase.prototype.transaction = original; }
    const retained = (await store.load()).project!.title;
    await store.save({ ...project, title: 'Retry worked' });
    const retry = (await store.load()).project!.title; await store.close();
    return { error, retained, retry };
  });
  expect(result.error).toMatch(/storage.*download.*project.*retry/i);
  expect(result.retained).toBe('Last good');
  expect(result.retry).toBe('Retry worked');
});

test('corrupt and explicitly undefined records are reported without replacement', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.lensStorage;
    const messages: string[] = [];
    for (const raw of [{ unexpected: 'Corrupt record' }, undefined]) {
      await h.rawRecord(raw, true);
      const store = await h.openProjectStore();
      try { await store.load(); } catch (value) { messages.push((value as Error).message); }
      finally { await store.close(); }
      const retained = await h.rawRecord();
      if (JSON.stringify(retained) !== JSON.stringify(raw)) throw new Error('Corrupt record was replaced');
    }
    return messages;
  });
  expect(result).toHaveLength(2);
  for (const message of result) expect(message).toMatch(/saved.*project.*invalid|corrupt/i);
});

test('a native image decode failure prevents restore and retains the stored record', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.lensStorage;
    const store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt);
    const project = h.fixture('Recoverable record');
    await store.save(project);
    const saved = await h.rawRecord();
    const original = window.createImageBitmap;
    let calls = 0;
    window.createImageBitmap = (() => { calls++; return Promise.reject(new DOMException('Fixture decode failure', 'InvalidStateError')); }) as typeof createImageBitmap;
    let message = '';
    try { await store.load(); } catch (error) { message = (error as Error).message; }
    finally { window.createImageBitmap = original; }
    await store.close();
    const reopened = await h.openProjectStore();
    const retry = (await reopened.load()).project!.title; await reopened.close();
    return { calls, message, retained: JSON.stringify(await h.rawRecord()) === JSON.stringify(saved), retry };
  });
  expect(result.calls).toBeGreaterThan(0);
  expect(result.message).toMatch(/saved.*project.*invalid|decode|image/i);
  expect(result.retained).toBe(true);
  expect(result.retry).toBe('Recoverable record');
});

test('header-valid undecodable image cannot overwrite a good saved project', async ({ page }) => {
  const badPhoto = 'data:image/png;base64,' + Buffer.from(pngHeader(4, 3)).toString('base64');
  const result = await page.evaluate(async (dataUrl) => {
    const h = window.lensStorage;
    const store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt);
    const project = h.fixture('Valid saved study');
    await store.save(project);
    let rejected = false;
    try { await store.save({ ...project, title: 'Broken replacement', photo: { ...project.photo, dataUrl } }); }
    catch { rejected = true; }
    const title = (await store.load()).project!.title; await store.close();
    return { rejected, title };
  }, badPhoto);
  expect(result).toEqual({ rejected: true, title: 'Valid saved study' });
});

test('private storage failure gives backup guidance, does not expose errors and recovers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.lensStorage;
    const project = h.fixture();
    const original = indexedDB.open;
    indexedDB.open = () => { throw new DOMException('Private fixture value must never be copied', 'SecurityError'); };
    const messages: string[] = [];
    try {
      for (const operation of ['save', 'load', 'clear'] as const) {
        try {
          const store = await h.openProjectStore();
          try { if (operation === 'save') await store.save(project); else await store[operation](); }
          finally { await store.close(); }
        } catch (error) { messages.push((error as Error).message); }
      }
    } finally { indexedDB.open = original; }
    const store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt);
    await store.save(project);
    const title = (await store.load()).project!.title; await store.close();
    return { messages, title };
  });
  expect(result.messages).toHaveLength(3);
  for (const message of result.messages) {
    expect(message).toMatch(/storage.*unavailable.*download.*project.*retry/i);
    expect(message).not.toContain('Private fixture');
  }
  expect(result.title).toBe('Captured study');
});

test('schema creation failure has no uncaught page error and native setup can retry', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const h = window.lensStorage, original = IDBDatabase.prototype.createObjectStore;
    IDBDatabase.prototype.createObjectStore = () => { throw new DOMException('Private setup detail', 'QuotaExceededError'); };
    let message = '';
    try { await h.openProjectStore(); } catch (error) { message = (error as Error).message; }
    finally { IDBDatabase.prototype.createObjectStore = original; }
    const store = await h.openProjectStore(), initial = await store.load();
    store.acceptLoad(initial.receipt);
    await store.save(h.fixture('After setup retry'));
    const title = (await store.load()).project!.title; await store.close();
    return { message, empty: initial.project, title };
  });
  expect(result.message).toMatch(/storage.*download.*project.*retry/i);
  expect(result.message).not.toContain('Private setup detail');
  expect(result.empty).toBeNull(); expect(result.title).toBe('After setup retry');
  expect(errors).toEqual([]);
});

test('blocked native opening rejects visibly and closes the connection that opens late', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lens-studio.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    blocker.onversionchange = () => { /* Keep the real native version upgrade blocked. */ };
    let message = '';
    try { await window.lensStorage.openProjectStore(); }
    catch (error) { message = (error as Error).message; }
    finally { blocker.close(); }
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('lens-studio.v1');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Late connection was leaked')), 3000)),
    ]);
    const store = await window.lensStorage.openProjectStore();
    const reset = (await store.load()).project; await store.close();
    return { message, reset };
  });
  expect(result.message).toMatch(/storage.*blocked.*download.*project.*retry/i);
  expect(result.reset).toBeNull();
});

test('authored demo has independently known three-plane geometry and normalizes real pixels', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.lensStorage;
    const project = await h.createDemoProject();
    const frame = await h.decodePhoto(project.photo);
    const mask = h.decodeMask(project.depth);
    const sample = (x: number, y: number) => mask[y * frame.width + x];
    const rgba = (x: number, y: number) => Array.from(frame.rgba.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4));
    let maskErrors = 0;
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const foreground = y >= 400 || (y >= 304 && (x < 104 || x >= 616));
      const subject = (x >= 288 && x < 432 && y >= 112 && y < 392) || (x >= 264 && x < 456 && y >= 360 && y < 400);
      const expected = foreground ? 0 : subject ? 1 : 2;
      if (sample(x, y) !== expected) maskErrors++;
    }
    const store = await h.openProjectStore(); store.acceptLoad((await store.load()).receipt);
    await store.save(project);
    const restored = JSON.stringify((await store.load()).project) === JSON.stringify(project);
    await store.close();
    return {
      width: frame.width, height: frame.height, mode: project.settings.mode, maskErrors,
      planes: Array.from(new Set(mask)).sort(), samples: [sample(20, 20), sample(360, 220), sample(20, 440)],
      colorSamples: [rgba(20, 20), rgba(360, 220), rgba(20, 440)],
      normalized: project.photo.dataUrl.startsWith('data:image/png;base64,'),
      restored,
    };
  });
  expect(result).toMatchObject({ width: 720, height: 480, mode: 'fixed', maskErrors: 0, planes: [0, 1, 2], samples: [2, 1, 0], normalized: true, restored: true });
  expect(result.colorSamples[0]).not.toEqual(result.colorSamples[1]);
  expect(result.colorSamples[1]).not.toEqual(result.colorSamples[2]);
  for (const pixel of result.colorSamples) expect(pixel[3]).toBe(255);
});

test('demo aborted during native normalization never publishes a partial project', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const original = window.createImageBitmap;
    const controller = new AbortController();
    let calls = 0;
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      calls++;
      const bitmap = await Reflect.apply(original, window, args) as ImageBitmap;
      controller.abort();
      return bitmap;
    }) as typeof createImageBitmap;
    try {
      await window.lensStorage.createDemoProject(controller.signal);
      return { name: 'unexpected success', calls };
    } catch (error) { return { name: (error as Error).name, calls }; }
    finally { window.createImageBitmap = original; }
  });
  expect(result.name).toBe('AbortError');
  expect(result.calls).toBeGreaterThan(0);
});
