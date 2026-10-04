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
    const missing = await h.loadProject();
    const project = h.fixture();
    await h.saveProject(project);
    const loaded = (await h.loadProject())!;
    const equal = JSON.stringify(loaded) === JSON.stringify(project);
    loaded.title = 'Detached edit';
    const savedTitle = (await h.loadProject())!.title;
    await h.clearProject();
    return { missing, equal, savedTitle, cleared: await h.loadProject() };
  });
  expect(result).toEqual({ missing: null, equal: true, savedTitle: 'Captured study', cleared: null });
});

test('queued saves capture immediately and complete only after their ordered native transactions', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const original = IDBDatabase.prototype.transaction;
    let hold = true;
    let first = true;
    let started = 0;
    let firstCompleted = false;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite') {
        started++;
        if (first) {
          first = false;
          const keepAlive = () => {
            const request = tx.objectStore('projects').get('current');
            request.onsuccess = () => { if (hold) keepAlive(); };
          };
          keepAlive();
        }
      }
      return tx;
    };
    try {
      const project = window.lensStorage.fixture('First snapshot');
      const firstSave = window.lensStorage.saveProject(project).then(() => { firstCompleted = true; });
      project.title = 'Second snapshot';
      const secondSave = window.lensStorage.saveProject(project);
      project.title = 'Unsaved mutation';
      await new Promise(resolve => setTimeout(resolve, 50));
      const pending = !firstCompleted && started === 1;
      hold = false;
      await Promise.all([firstSave, secondSave]);
      const title = (await window.lensStorage.loadProject())!.title;
      const third = window.lensStorage.saveProject(project);
      const clear = window.lensStorage.clearProject();
      await Promise.all([third, clear]);
      return { pending, title, cleared: await window.lensStorage.loadProject() };
    } finally { hold = false; IDBDatabase.prototype.transaction = original; }
  });
  expect(result).toEqual({ pending: true, title: 'Second snapshot', cleared: null });
});

test('aborted native save rejects, leaves prior record intact and allows subsequent saves', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.lensStorage;
    const project = h.fixture('Last good');
    await h.saveProject(project);
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
    try { await h.saveProject({ ...project, title: 'Aborted edit' }); }
    catch (value) { error = (value as Error).message; }
    finally { IDBDatabase.prototype.transaction = original; }
    const retained = (await h.loadProject())!.title;
    await h.saveProject({ ...project, title: 'Retry worked' });
    return { error, retained, retry: (await h.loadProject())!.title };
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
      try { await h.loadProject(); } catch (value) { messages.push((value as Error).message); }
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
    const project = h.fixture('Recoverable record');
    await h.saveProject(project);
    const original = window.createImageBitmap;
    let calls = 0;
    window.createImageBitmap = (() => { calls++; return Promise.reject(new DOMException('Fixture decode failure', 'InvalidStateError')); }) as typeof createImageBitmap;
    let message = '';
    try { await h.loadProject(); } catch (error) { message = (error as Error).message; }
    finally { window.createImageBitmap = original; }
    return { calls, message, retained: JSON.stringify(await h.rawRecord()) === JSON.stringify(project), retry: (await h.loadProject())!.title };
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
    const project = h.fixture('Valid saved study');
    await h.saveProject(project);
    let rejected = false;
    try { await h.saveProject({ ...project, title: 'Broken replacement', photo: { ...project.photo, dataUrl } }); }
    catch { rejected = true; }
    return { rejected, title: (await h.loadProject())!.title };
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
      for (const operation of [() => h.saveProject(project), h.loadProject, h.clearProject]) {
        try { await operation(); } catch (error) { messages.push((error as Error).message); }
      }
    } finally { indexedDB.open = original; }
    await h.saveProject(project);
    return { messages, title: (await h.loadProject())!.title };
  });
  expect(result.messages).toHaveLength(3);
  for (const message of result.messages) {
    expect(message).toMatch(/storage.*unavailable.*download.*project.*retry/i);
    expect(message).not.toContain('Private fixture');
  }
  expect(result.title).toBe('Captured study');
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
    const original = indexedDB.open;
    indexedDB.open = (name: string) => original.call(indexedDB, name, 2);
    let message = '';
    try { await window.lensStorage.loadProject(); }
    catch (error) { message = (error as Error).message; }
    finally { indexedDB.open = original; blocker.close(); }
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('lens-studio.v1');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Late connection was leaked')), 3000)),
    ]);
    return { message, reset: await window.lensStorage.loadProject() };
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
    await h.saveProject(project);
    return {
      width: frame.width, height: frame.height, mode: project.settings.mode, maskErrors,
      planes: Array.from(new Set(mask)).sort(), samples: [sample(20, 20), sample(360, 220), sample(20, 440)],
      colorSamples: [rgba(20, 20), rgba(360, 220), rgba(20, 440)],
      normalized: project.photo.dataUrl.startsWith('data:image/png;base64,'),
      restored: JSON.stringify(await h.loadProject()) === JSON.stringify(project),
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
