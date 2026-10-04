import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { authoredScene, fixtureProject, independentPng, texture, undecodablePng } from '../oracle/fixtures';
import { errorBetween, scalarReference } from '../oracle/scalar';
import type { Project, Raster, Rendered } from '../../src/types';

async function download(page: Page, action: 'Export PNG' | 'Download project') {
  const button = page.getByRole('button', { name: action, exact: true });
  await expect(button).toBeEnabled();
  const pending = page.waitForEvent('download');
  await button.click();
  const file = await pending;
  return { bytes: await readFile((await file.path())!), name: file.suggestedFilename() };
}

async function backup(page: Page): Promise<Project> {
  return JSON.parse((await download(page, 'Download project')).bytes.toString('utf8')) as Project;
}

async function rendered(page: Page) {
  await expect(page.locator('#render-status')).toContainText(/^Projection ready\b/i);
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
}

async function settings(page: Page, patch: Record<string, string>) {
  for (const [name, value] of Object.entries(patch)) await page.locator(`#settings-form [name=${name}]`).fill(value);
  await page.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await rendered(page);
}

async function importPhoto(page: Page, source: Raster) {
  await page.goto('/');
  await page.getByLabel('Import photo', { exact: true }).setInputFiles({ name: 'original-authored-scene.png', mimeType: 'image/png', buffer: independentPng(source) });
  await expect(page.locator('#source-canvas')).toBeVisible();
  await rendered(page);
}

async function checkPng(page: Page, project: Project) {
  const sourcePng = PNG.sync.read(Buffer.from(project.photo.dataUrl.slice('data:image/png;base64,'.length), 'base64'));
  const source = { width: sourcePng.width, height: sourcePng.height, rgba: new Uint8ClampedArray(sourcePng.data) };
  const labels = new Uint8Array(Buffer.from(project.depth.labels, 'base64'));
  const expected = scalarReference(source, project.settings, labels);
  const downloaded = await download(page, 'Export PNG');
  expect(downloaded.name).toMatch(/\.png$/);
  const actualPng = PNG.sync.read(downloaded.bytes);
  expect([actualPng.width, actualPng.height]).toEqual([source.width, source.height]);
  const actual: Rendered = { width: actualPng.width, height: actualPng.height, rgba: new Uint8ClampedArray(actualPng.data), missingFraction: expected.missingFraction };
  expect(errorBetween(actual, expected).rgba).toBeLessThanOrEqual(1);
  // Compare presentations through Canvas for both paths. Straight low-alpha
  // kernel bytes have their separate independent PNG gate in the Node suite.
  const preview = await page.locator('#result-canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data]);
  const presented = await page.evaluate(({ width, height, rgba }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    return [...context.getImageData(0, 0, width, height).data];
  }, { width: actual.width, height: actual.height, rgba: [...actual.rgba] });
  expect(preview.length).toBe(presented.length);
  let presentationError = 0;
  for (let i = 0; i < preview.length; i++) presentationError = Math.max(presentationError, Math.abs(preview[i]! - presented[i]!));
  expect(presentationError).toBe(0);
  return { expected, decoded: actualPng };
}

test('real photo framing, paint, perspective, exact PNG and JSON reopen use the declared geometry', async ({ page, baseURL }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url()); });
  const { source } = authoredScene();
  await importPhoto(page, source);
  await expect(page.getByLabel('Fixed camera', { exact: true })).toBeChecked();
  let project = await backup(page);
  expect(project.settings).toMatchObject({ sourceFocal: 50, targetFocal: 50, mode: 'fixed', shiftX: 0, shiftY: 0 });
  expect(new Set(Buffer.from(project.depth.labels, 'base64'))).toEqual(new Set([1]));
  await checkPng(page, project);
  await settings(page, { targetFocal: '100' });
  project = await backup(page); await checkPng(page, project);
  await settings(page, { targetFocal: '25', shiftX: '.125', shiftY: '-.1' });
  project = await backup(page);
  const wide = await checkPng(page, project);
  expect(wide.expected.missingFraction).toBeGreaterThan(.6);
  expect(wide.decoded.data.some((value, index) => index % 4 === 3 && value === 0)).toBe(true);
  await page.getByRole('button', { name: 'Reset projection', exact: true }).click(); await rendered(page);
  expect((await backup(page)).settings).toMatchObject({ targetFocal: 50, shiftX: 0, shiftY: 0 });
  await page.getByLabel('Paint near', { exact: true }).check();
  await page.getByLabel('Brush size', { exact: true }).fill('2');
  await page.locator('#source-canvas').scrollIntoViewIfNeeded();
  const bounds = (await page.locator('#source-canvas').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height * .55, { steps: 5 });
  await page.mouse.up(); await rendered(page);
  const painted = await backup(page), labels = Buffer.from(painted.depth.labels, 'base64');
  expect(labels.some(label => label === 0)).toBe(true); expect(labels.some(label => label === 1)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(new Set(Buffer.from((await backup(page)).depth.labels, 'base64'))).toEqual(new Set([1]));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await backup(page)).depth).toEqual(painted.depth);
  await page.getByLabel('I understand this is manual geometry, not inferred depth', { exact: true }).check();
  await page.getByLabel('Manual perspective', { exact: true }).check();
  await settings(page, { targetFocal: '40', near: '.6', far: '2' });
  await checkPng(page, await backup(page));
  await settings(page, { targetFocal: '85' });
  await checkPng(page, await backup(page));
  await expect(page.getByText('Manual depth is your assignment, not inferred scene depth', { exact: false })).toBeVisible();
  await expect(page.getByText('No content was generated', { exact: false })).toBeVisible();
  const saved = await backup(page);
  await expect(page.locator('#save-status')).toContainText(/^Saved locally\b/i);
  await page.reload(); await rendered(page);
  expect(await backup(page)).toEqual(saved);
  expect(errors).toEqual([]); expect(external).toEqual([]);
  await page.screenshot({ path: '/tmp/lens-desktop.png', fullPage: true });
});

test('failed photo/JSON imports and invalid numeric drafts preserve the source, painted history and focused text', async ({ page }) => {
  await importPhoto(page, authoredScene().source);
  await page.getByLabel('Paint far', { exact: true }).check();
  await page.getByRole('button', { name: 'Fill plane', exact: true }).click();
  const before = await backup(page);
  const field = page.getByLabel('Target focal length', { exact: true });
  await field.fill('300');
  await page.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(page.locator('#settings-error')).toContainText(/ratio|range|invalid|focal/i);
  await expect(field).toHaveValue('300');
  expect(await backup(page)).toEqual(before);
  const corrupt = { ...before, photo: { ...before.photo, dataUrl: `data:image/png;base64,${undecodablePng(authoredScene().source).toString('base64')}` } };
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import project', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(corrupt)) });
  await expect(page.locator('#message')).toContainText(/invalid|image|PNG|photo|decode/i);
  expect(await backup(page)).toEqual(before);
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import photo', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') });
  await expect(page.locator('#message')).toContainText(/invalid|image|PNG|photo|format/i);
  expect(await backup(page)).toEqual(before);
  await field.fill('50'); await page.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(new Set(Buffer.from((await backup(page)).depth.labels, 'base64'))).toEqual(new Set([1]));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await backup(page)).depth).toEqual(before.depth);
});

test('authored imported planes retain transparency and independently computed perspective holes at both ratios', async ({ page }) => {
  const { source, labels } = authoredScene();
  const project = fixtureProject(source, labels, { mode: 'perspective', targetFocal: 40 });
  await page.goto('/');
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import project', { exact: true }).setInputFiles({ name: 'authored.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await rendered(page);
  for (const target of ['40', '85']) {
    await settings(page, { targetFocal: target });
    const checked = await checkPng(page, await backup(page));
    expect(checked.expected.missingFraction).toBeGreaterThan(0);
  }
  await page.getByLabel('Paint subject', { exact: true }).check();
  await page.getByRole('button', { name: 'Fill plane', exact: true }).click(); await rendered(page);
  const anchored = await checkPng(page, await backup(page));
  expect(anchored.expected.missingFraction).toBe(0);
  const alpha = texture(17, 11);
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import photo', { exact: true }).setInputFiles({ name: 'alpha.png', mimeType: 'image/png', buffer: independentPng(alpha) });
  await rendered(page); await checkPng(page, await backup(page));
});

test('mobile editing and keyboard history preserve numeric input shortcuts and layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.getByRole('button', { name: 'Try authored demo', exact: true }).click(); await rendered(page);
  const initial = await backup(page);
  await settings(page, { targetFocal: '75' });
  await page.locator('#result-canvas').click();
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Target focal length', { exact: true })).toHaveValue(String(initial.settings.targetFocal));
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByLabel('Target focal length', { exact: true })).toHaveValue('75');
  const title = page.locator('#project-title'); await title.fill('My unsent title'); await title.focus();
  await page.keyboard.press('Control+z');
  expect((await backup(page)).settings.targetFocal).toBe(75);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/lens-mobile.png', fullPage: true });
});

test('unavailable storage remains visible while the real editor and portable backup keep working', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); } }));
  page.once('dialog', dialog => dialog.accept());
  await importPhoto(page, authoredScene().source);
  await settings(page, { targetFocal: '75', shiftX: '.1' });
  await expect(page.locator('#save-status')).toContainText(/not saved|failed|unavailable/i);
  const current = await backup(page);
  expect(current.settings).toMatchObject({ targetFocal: 75, shiftX: .1 });
  await checkPng(page, current);
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText(/not saved|failed|unavailable/i);
  expect(await backup(page)).toEqual(current);
});

async function delayNativeMessages(page: Page) {
  await page.addInitScript(() => {
    const control = { hold: false, pending: [] as (() => void)[], received: 0 };
    Object.defineProperty(window, 'lensNativeMessages', { value: control });
    const terminated = new WeakSet<Worker>();
    const deliver = (worker: Worker, action: () => void) => {
      if (!control.hold) { action(); return; }
      control.received++;
      control.pending.push(() => { if (!terminated.has(worker)) action(); });
    };
    const originalTerminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () { terminated.add(this); originalTerminate.call(this); };
    const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')!;
    const assigned = new WeakMap<Worker, ((event: MessageEvent) => void) | null>();
    Object.defineProperty(Worker.prototype, 'onmessage', {
      configurable: true,
      get() { return assigned.get(this as Worker) ?? null; },
      set(handler: ((event: MessageEvent) => void) | null) {
        const worker = this as Worker; assigned.set(worker, handler);
        descriptor.set!.call(worker, handler ? (event: MessageEvent) => deliver(worker, () => handler.call(worker, event)) : null);
      },
    });
    const add = Worker.prototype.addEventListener, remove = Worker.prototype.removeEventListener;
    const wrappers = new WeakMap<object, EventListener>();
    Worker.prototype.addEventListener = function (this: Worker, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (!listener) return;
      if (type !== 'message') { add.call(this, type, listener, options); return; }
      const wrapped: EventListener = event => deliver(this, () => {
        if (typeof listener === 'function') listener.call(this, event); else listener.handleEvent(event);
      });
      wrappers.set(listener, wrapped); add.call(this, type, wrapped, options);
    } as typeof Worker.prototype.addEventListener;
    Worker.prototype.removeEventListener = function (this: Worker, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      if (listener) remove.call(this, type, wrappers.get(listener) || listener, options);
    } as typeof Worker.prototype.removeEventListener;
  });
}

for (const cancel of [false, true]) {
  test(`a delayed real preview is refreshed after ${cancel ? 'canceling' : 'completing'} an intervening export`, async ({ page }) => {
    await delayNativeMessages(page);
    await importPhoto(page, authoredScene().source);
    await page.evaluate(() => { (window as unknown as { lensNativeMessages: { hold: boolean } }).lensNativeMessages.hold = true; });
    await page.getByLabel('Target focal length', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Apply settings', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { lensNativeMessages: { received: number } }).lensNativeMessages.received)).toBe(1);
    const downloaded = cancel ? null : page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    await expect(page.getByLabel('Target focal length', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Import photo', { exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as unknown as { lensNativeMessages: { received: number } }).lensNativeMessages.received)).toBe(2);
    if (cancel) await page.getByRole('button', { name: 'Cancel operation', exact: true }).click();
    await page.evaluate(() => {
      const control = (window as unknown as { lensNativeMessages: { hold: boolean; pending: (() => void)[] } }).lensNativeMessages;
      control.hold = false; for (const task of control.pending.splice(0)) task();
    });
    if (downloaded) await downloaded;
    await rendered(page);
    await expect(page.getByLabel('Target focal length', { exact: true })).toBeEnabled();
    const project = await backup(page);
    expect(project.settings.targetFocal).toBe(100);
    await checkPng(page, project);
  });
}

test('a canceled unfinished source stroke cannot roll back a competing settings edit', async ({ page }) => {
  await importPhoto(page, authoredScene().source);
  await settings(page, { targetFocal: '75' });
  const before = await backup(page);
  await page.getByLabel('Paint near', { exact: true }).check();
  await page.getByLabel('Brush size', { exact: true }).fill('2');
  await page.locator('#source-canvas').scrollIntoViewIfNeeded();
  const bounds = (await page.locator('#source-canvas').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .3, bounds.y + bounds.height * .5);
  await expect.poll(() => page.locator('#source-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.hasPointerCapture(1))).toBe(true);
  // History is guarded while the source gesture is unfinished. A competing
  // settings commit must cancel it before the eventual pointer release.
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Target focal length', { exact: true })).toHaveValue('75');
  await page.getByLabel('Target focal length', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply settings', exact: true }).press('Enter');
  await page.mouse.up(); await rendered(page);
  const after = await backup(page);
  expect(after.settings.targetFocal).toBe(100);
  expect(after.depth).toEqual(before.depth);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).settings.targetFocal).toBe(75);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await backup(page)).settings.targetFocal).toBe(100);
});

for (const name of ['targetFocal', 'title']) {
  test(`typing an uncommitted ${name} draft prevents a delayed native replacement from publishing`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = createImageBitmap.bind(window);
      const control = { hold: false, waiting: [] as (() => void)[] };
      Object.defineProperty(window, 'lensNativeDecode', { value: control });
      window.createImageBitmap = ((...args: unknown[]) => {
        const decoded = (original as (...values: unknown[]) => Promise<ImageBitmap>)(...args);
        return decoded.then(bitmap => control.hold ? new Promise<ImageBitmap>(resolve => control.waiting.push(() => resolve(bitmap))) : bitmap);
      }) as typeof createImageBitmap;
    });
    await importPhoto(page, authoredScene().source);
    const before = await backup(page);
    await page.evaluate(() => { (window as unknown as { lensNativeDecode: { hold: boolean } }).lensNativeDecode.hold = true; });
    page.once('dialog', dialog => dialog.accept());
    await page.getByLabel('Import photo', { exact: true }).setInputFiles({ name: 'late-replacement.png', mimeType: 'image/png', buffer: independentPng(authoredScene(17, 13).source) });
    await expect.poll(() => page.evaluate(() => (window as unknown as { lensNativeDecode: { waiting: unknown[] } }).lensNativeDecode.waiting.length)).toBe(1);
    const field = name === 'title' ? page.locator('#project-title') : page.getByLabel('Target focal length', { exact: true });
    const value = name === 'title' ? 'An unsaved new title' : '300';
    await field.fill(value);
    await page.evaluate(() => {
      const control = (window as unknown as { lensNativeDecode: { hold: boolean; waiting: (() => void)[] } }).lensNativeDecode;
      control.hold = false; for (const task of control.waiting.splice(0)) task();
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(field).toHaveValue(value); await expect(field).toBeFocused();
    expect(await backup(page)).toEqual(before);
  });
}
