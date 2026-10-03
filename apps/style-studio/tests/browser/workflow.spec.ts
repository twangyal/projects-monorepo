import { randomBytes } from 'node:crypto';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import type { Category, Label, Project, Tags } from '../../src/types.ts';

const liked: Tags = { palette: 'cool', fit: 'fitted', style: 'minimal', formality: 'smart' };
const passed: Tags = { palette: 'bright', fit: 'relaxed', style: 'playful', formality: 'casual' };
const errors = new WeakMap<Page, string[]>();
const external = new WeakMap<Page, string[]>();

declare global {
  interface Window {
    styleDecodeStarted: boolean;
    styleDecodeCompleted: boolean;
    styleReleaseDecode: () => void;
    styleArmDecode: () => void;
    styleNativePut: IDBObjectStore['put'];
  }
}

async function holdNextDecode(page: Page, atStartup = false) {
  function install() {
    const native = globalThis.createImageBitmap;
    let hold = true;
    let release: () => void = () => {};
    window.styleDecodeStarted = false;
    window.styleDecodeCompleted = false;
    window.styleReleaseDecode = () => release();
    window.styleArmDecode = () => {
      hold = true; window.styleDecodeStarted = false; window.styleDecodeCompleted = false;
    };
    globalThis.createImageBitmap = (async (...args: unknown[]) => {
      const actual = await Reflect.apply(native, globalThis, args) as ImageBitmap;
      if (hold) {
        hold = false; window.styleDecodeStarted = true;
        await new Promise<void>(resolve => { release = resolve; });
        window.styleDecodeCompleted = true;
      }
      return actual;
    }) as typeof createImageBitmap;
  }
  if (atStartup) await page.addInitScript(install);
  else await page.evaluate(install);
}

async function releaseDecode(page: Page) {
  await page.evaluate(() => window.styleReleaseDecode());
  await page.waitForFunction(() => window.styleDecodeCompleted);
  // Flush the app's rejection/publication microtasks after the real bitmap.
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
}

test.beforeEach(async ({ page, baseURL }) => {
  errors.set(page, []); external.set(page, []);
  page.on('pageerror', error => errors.get(page)!.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(baseURL!).origin) {
      external.get(page)!.push(url.href);
    }
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.locator('#piece-form')).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), 'No unhandled errors in the actual product').toEqual([]);
  expect(external.get(page), 'No photo, preference, or export request leaves the app').toEqual([]);
});

async function bytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  expect(stream, 'Download contains a real artifact').not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportProfile(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export profile', exact: true }).click();
  const artifact = await pending;
  expect(artifact.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse((await bytes(artifact)).toString('utf8')) as Project;
}

async function fillTags(form: Locator, tags: Tags) {
  for (const [name, value] of Object.entries(tags)) await form.locator(`[name="${name}"]`).selectOption(value);
}

async function photoFixture(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e000e0'; context.fillRect(0, 0, 80, 80);
    context.fillStyle = '#1010ef'; context.fillRect(80, 0, 80, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(data, 'base64');
}

async function addPiece(page: Page, name: string, category: Category, tags = liked, photo?: Buffer) {
  const form = page.locator('#piece-form');
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="category"]').selectOption(category);
  await fillTags(form, tags);
  if (photo) await form.locator('input[type="file"]').setInputFiles({ name: 'my-original.png', mimeType: 'image/png', buffer: photo });
  await form.getByRole('button', { name: 'Add wardrobe piece', exact: true }).click();
  await expect(page.locator('#wardrobe-list')).toContainText(name);
}

async function teach(page: Page, caption: string, label: Label, tags: Tags) {
  const form = page.locator('#example-form');
  await form.locator('[name="caption"]').fill(caption);
  await form.locator('[name="label"]').selectOption(label);
  await fillTags(form, tags);
  await form.getByRole('button', { name: 'Teach my taste', exact: true }).click();
  await expect(page.locator('#example-list')).toContainText(caption);
}

async function assess(page: Page, tags = liked): Promise<number> {
  const form = page.locator('#assessment-form');
  await fillTags(form, tags);
  await form.getByRole('button', { name: 'Assess this outfit', exact: true }).click();
  const result = page.locator('#assessment-result');
  await expect(result).toContainText(/\d+\s*\/\s*100/);
  return Number((await result.innerText()).match(/(\d+)\s*\/\s*100/)![1]);
}

async function suggest(page: Page, mode = 'match', occasion = 'any') {
  const form = page.locator('#suggestion-form');
  await form.locator('[name="mode"]').selectOption(mode);
  await form.locator('[name="occasion"]').selectOption(occasion);
  await form.getByRole('button', { name: 'Suggest looks', exact: true }).click();
}

async function loadSample(page: Page) {
  await page.getByRole('button', { name: 'Load sample profile', exact: true }).click();
  await expect(page.locator('#wardrobe-list [data-piece-id]')).toHaveCount(6);
  await expect(page.locator('#example-list [data-example-id]')).toHaveCount(12);
}

async function title(page: Page, value: string) {
  const form = page.locator('#profile-form');
  await form.locator('[name="title"]').fill(value);
  await form.getByRole('button').first().click();
}

async function importProfile(page: Page, text: string) {
  await page.locator('#profile-import').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}

test('a person teaches an empty profile, assesses, saves and corrects a look, then exports real pixels and reopens', async ({ page }) => {
  await expect(page.locator('#wardrobe-list [data-piece-id]')).toHaveCount(0);
  await expect(page.locator('#example-list [data-example-id]')).toHaveCount(0);
  await page.locator('#assessment-form').getByRole('button', { name: 'Assess this outfit', exact: true }).click();
  await expect(page.locator('#assessment-result')).toContainText(/8|eight/i);
  await expect(page.locator('#assessment-result')).not.toContainText(/\d+\s*\/\s*100/);
  await title(page, 'My actual wardrobe');
  await addPiece(page, 'Photographed top', 'top', liked, await photoFixture(page));
  await addPiece(page, 'Owned trousers', 'bottom');
  await addPiece(page, 'Owned shoes', 'shoes');
  for (let index = 0; index < 4; index++) {
    await teach(page, `My liked example ${index + 1}`, 'like', liked);
    await teach(page, `My passed example ${index + 1}`, 'pass', passed);
  }
  const preference = await assess(page);
  expect(preference).toBeGreaterThan(60);
  expect(await assess(page, passed)).toBeLessThan(40);
  await expect(page.locator('body')).toContainText(/uncalibrated|not.*probabilit/i);
  await suggest(page, 'match', 'formal');
  await expect(page.locator('#suggestion-list [data-candidate-key]')).toHaveCount(0);
  await expect(page.locator('#suggestion-list')).toContainText(/no outfits/i);
  await suggest(page, 'match', 'smart');
  await expect(page.locator('#suggestion-list [data-candidate-key]')).toHaveCount(1);
  await page.locator('#suggestion-list').getByRole('button', { name: 'Save look', exact: true }).first().click();
  await expect(page.locator('#look-list [data-look-id]')).toHaveCount(1);
  const look = page.locator('#look-list [data-look-id]').first();
  await look.locator('[name="name"]').fill('First personal look');
  await look.locator('[name="notes"]').fill('Keep these references.\nThese tags are mine, not image recognition.');
  await look.getByRole('button', { name: 'Save changes', exact: true }).click();
  await look.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.locator('#example-list [data-example-id]')).toHaveCount(9);
  const likedProfile = await exportProfile(page);
  const likedScore = await assess(page);
  await look.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(page.locator('#example-list [data-example-id]')).toHaveCount(9);
  const corrected = await exportProfile(page);
  expect(corrected.examples.filter(example => example.sourceLookId === corrected.looks[0].id)).toHaveLength(1);
  expect(corrected.examples.find(example => example.sourceLookId)?.label).toBe('pass');
  expect(corrected.examples.find(example => example.sourceLookId)?.id).toBe(likedProfile.examples.find(example => example.sourceLookId)?.id);
  expect(await assess(page)).toBeLessThan(likedScore);
  expect(corrected.examples.filter(example => example.origin === 'tagged')).toHaveLength(8);
  expect(corrected.photos).toHaveLength(1);
  const normalized = await page.evaluate(async dataUrl => {
    const raw = atob(dataUrl.split(',')[1]);
    const image = await createImageBitmap(new Blob([Uint8Array.from(raw, character => character.charCodeAt(0))], { type: 'image/jpeg' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); image.close();
    return { width: canvas.width, height: canvas.height, top: [...context.getImageData(360, 10, 1, 1).data],
      left: [...context.getImageData(180, 360, 1, 1).data], right: [...context.getImageData(540, 360, 1, 1).data] };
  }, corrected.photos[0].dataUrl);
  expect(normalized.width).toBe(720); expect(normalized.height).toBe(720);
  expect(normalized.top.slice(0, 3).every(channel => channel > 245)).toBe(true);
  expect(normalized.left[0]).toBeGreaterThan(180); expect(normalized.left[2]).toBeGreaterThan(180);
  expect(normalized.right[2]).toBeGreaterThan(180); expect(normalized.right[0]).toBeLessThan(50);
  expect(Buffer.from(corrected.photos[0].dataUrl.split(',')[1], 'base64').length).toBeLessThanOrEqual(204800);
  const pending = page.waitForEvent('download');
  await look.getByRole('button', { name: 'Download outfit board', exact: true }).click();
  const board = await bytes(await pending);
  expect([...board.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const pixels = await page.evaluate(async values => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(values)], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); image.close();
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonwhite = 0, magenta = 0, blue = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) nonwhite++;
      if (data[index] > 160 && data[index + 1] < 80 && data[index + 2] > 160) magenta++;
      if (data[index] < 80 && data[index + 1] < 80 && data[index + 2] > 160) blue++;
    }
    return { width: canvas.width, height: canvas.height, nonwhite, magenta, blue };
  }, [...board]);
  expect(pixels.width).toBe(1200); expect(pixels.height).toBe(1000);
  expect(pixels.nonwhite).toBeGreaterThan(30000);
  expect(pixels.magenta).toBeGreaterThan(3000); expect(pixels.blue).toBeGreaterThan(3000);
  await page.reload();
  await expect(page.locator('#wardrobe-list [data-piece-id]')).toHaveCount(3);
  await expect(page.locator('#example-list [data-example-id]')).toHaveCount(9);
  expect(await exportProfile(page)).toEqual(corrected);
});

test('sample labels affect the learned prediction and occasion and exploration rules stay explicit', async ({ page }) => {
  await loadSample(page);
  const before = await assess(page);
  const profile = await exportProfile(page);
  const firstLike = profile.examples.find(example => example.label === 'like')!;
  await page.locator(`[data-example-id="${firstLike.id}"]`).getByRole('button', { name: 'Pass', exact: true }).click();
  const after = await assess(page);
  expect(after).not.toBe(before);
  await suggest(page, 'match', 'any');
  await expect(page.locator('#suggestion-list [data-candidate-key]')).toHaveCount(3);
  const match = await page.locator('#suggestion-list [data-candidate-key]').evaluateAll(cards => cards.map(card => card.getAttribute('data-candidate-key')));
  await suggest(page, 'explore', 'any');
  await expect(page.locator('#suggestion-list [data-candidate-key]')).toHaveCount(3);
  const explore = await page.locator('#suggestion-list [data-candidate-key]').evaluateAll(cards => cards.map(card => card.getAttribute('data-candidate-key')));
  expect(explore).not.toEqual(match);
  await expect(page.locator('body')).toContainText(/novelty|distance/i);
  await suggest(page, 'match', 'formal');
  const eligible = ['top', 'bottom', 'shoes'].map(category => profile.pieces.filter(piece => piece.category === category && piece.tags.formality === 'formal').length)
    .reduce((total, count) => total * count, 1);
  await expect(page.locator('#suggestion-list [data-candidate-key]')).toHaveCount(Math.min(3, eligible));
  await expect(page.locator('#suggestion-status')).toContainText(`${eligible} occasion-valid`);
});

test('malformed and undecodable imports preserve the current profile and the undo boundary', async ({ page }) => {
  await loadSample(page);
  const initial = await exportProfile(page);
  await title(page, 'My newer profile name');
  const current = await exportProfile(page);
  const corrupt = structuredClone(initial);
  const photoId = randomBytes(16).toString('hex');
  corrupt.pieces[0].photoId = photoId;
  corrupt.photos.push({ id: photoId, mime: 'image/jpeg', width: 720, height: 720,
    dataUrl: 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 192, 0, 11, 8, 2, 208, 2, 208, 1, 1, 17, 0, 255, 217]).toString('base64') });
  const draft = page.locator(`[data-look-id="${initial.looks[0].id}"] [name="notes"]`);
  await draft.fill('An invalid import must preserve this unsaved draft.');
  for (const input of ['{', '{"schemaVersion":1,"schemaVersion":2}', JSON.stringify({ ...initial, unknown: true }), JSON.stringify(corrupt)]) {
    await importProfile(page, input);
    await expect(page.locator('#message')).toContainText(/invalid|corrupt|decode|JPEG|JSON|unknown|unsupported|duplicate/i);
    await expect(draft).toHaveValue('An invalid import must preserve this unsaved draft.');
    expect(await exportProfile(page)).toEqual(current);
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await exportProfile(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await exportProfile(page)).toEqual(current);
  const imported = structuredClone(initial);
  imported.looks[0].name = 'Explicitly imported look';
  imported.looks[0].notes = 'Imported notes replace the old draft.';
  const look = page.locator(`[data-look-id="${initial.looks[0].id}"]`);
  await look.locator('[name="name"]').fill('Unsaved old look name');
  await look.locator('[name="notes"]').fill('Unsaved old notes must not override the import.');
  await importProfile(page, JSON.stringify(imported));
  await expect(page.locator('#profile-form [name="title"]')).toHaveValue(initial.title);
  await expect(look.locator('[name="name"]')).toHaveValue(imported.looks[0].name);
  await expect(look.locator('[name="notes"]')).toHaveValue(imported.looks[0].notes);
  expect(await exportProfile(page)).toEqual(imported);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await exportProfile(page)).toEqual(current);
});

test('focused and unsaved drafts survive independent rating edits; selected wardrobe edits leave saved snapshots intact', async ({ page }) => {
  await loadSample(page);
  const initial = await exportProfile(page);
  const look = page.locator(`[data-look-id="${initial.looks[0].id}"]`);
  await look.locator('[name="notes"]').fill('Unsaved notes stay here.');
  const caption = page.locator('#example-form [name="caption"]');
  await caption.fill('Still typing my own example');
  await caption.focus();
  await page.locator(`[data-example-id="${initial.examples[0].id}"]`).getByRole('button', { name: 'Pass', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(caption).toBeFocused();
  await expect(caption).toHaveValue('Still typing my own example');
  await expect(look.locator('[name="notes"]')).toHaveValue('Unsaved notes stay here.');
  const piece = page.locator(`[data-piece-id="${initial.pieces[0].id}"]`);
  await piece.getByRole('button', { name: 'Edit piece', exact: true }).click();
  await page.locator('#piece-form [name="name"]').fill('Renamed owned piece');
  await page.locator('#piece-form').getByRole('button', { name: 'Save wardrobe piece', exact: true }).click();
  const edited = await exportProfile(page);
  expect(edited.looks).toEqual(initial.looks);
  expect(edited.pieces.find(value => value.id === initial.pieces[0].id)?.name).toBe('Renamed owned piece');
  await page.locator(`[data-piece-id="${initial.pieces[0].id}"]`).getByRole('button', { name: 'Delete piece', exact: true }).click();
  const deleted = await exportProfile(page);
  expect(deleted.pieces).toHaveLength(5);
  expect(deleted.looks).toEqual(initial.looks);
  expect(deleted.pieces.some(value => value.id === initial.pieces[1].id)).toBe(true);
});

test('storage unavailable stays visible while real in-memory edits and backup export work', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new DOMException('Storage disabled for this test', 'SecurityError'); };
  });
  await page.reload();
  await expect(page.locator('#save-status')).toContainText(/in memory|storage.*unavailable|could not.*loaded/i);
  await addPiece(page, 'Not lost when storage fails', 'top');
  const profile = await exportProfile(page);
  expect(profile.pieces).toHaveLength(1);
  expect(profile.pieces[0].name).toBe('Not lost when storage fails');
  await expect(page.locator('body')).toContainText(/export|backup/i);
});

test('mobile workspace has no horizontal overflow, preserves invalid-form drafts and makes no external requests', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await addPiece(page, 'My mobile top', 'top');
  await loadSample(page);
  await suggest(page, 'explore', 'any');
  await expect(page.locator('#suggestion-list [data-candidate-key]')).toHaveCount(3);
  const form = page.locator('#piece-form');
  await form.locator('[name="name"]').fill('   ');
  await form.getByRole('button', { name: 'Add wardrobe piece', exact: true }).click();
  await expect(form.locator('[name="name"]')).toHaveValue('   ');
  await expect(page.locator('#wardrobe-list [data-piece-id]')).toHaveCount(6);
  const layout = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(layout.page).toBeLessThanOrEqual(layout.viewport + 1);
});

test('cold-start outfit ideas are unranked and limited wardrobes disclose shared-piece fallback', async ({ page }) => {
  await addPiece(page, 'One owned top', 'top');
  await addPiece(page, 'Another owned top', 'top', passed);
  await addPiece(page, 'Only owned bottom', 'bottom');
  await addPiece(page, 'Only owned shoes', 'shoes');
  await suggest(page, 'explore', 'any');
  await expect(page.locator('#suggestion-list [data-candidate-key]')).toHaveCount(2);
  await expect(page.locator('#suggestion-list')).toContainText(/unranked/i);
  await expect(page.locator('#suggestion-list')).not.toContainText(/\d+\s*\/\s*100/);
  await expect(page.locator('#suggestion-status')).toContainText(/shared pieces/i);
  expect((await exportProfile(page)).examples).toHaveLength(0);
});

test('a late startup photo decode cannot replace a newer edit, and resetting a pending photo cannot attach it later', async ({ page }) => {
  await addPiece(page, 'Saved photo before reload', 'top', liked, await photoFixture(page));
  await expect(page.locator('#save-status')).toContainText(/saved on this device/i);
  await holdNextDecode(page, true);
  await page.reload();
  await page.waitForFunction(() => window.styleDecodeStarted);
  await title(page, 'My newer edit wins over the late load');
  await releaseDecode(page);
  await expect(page.locator('#save-status')).toContainText(/saved on this device/i);
  const afterLoad = await exportProfile(page);
  expect(afterLoad.title).toBe('My newer edit wins over the late load');
  expect(afterLoad.pieces).toHaveLength(0);
  await page.evaluate(() => window.styleArmDecode());
  await page.locator('#piece-form [name="name"]').fill('Pending stale photo');
  await page.locator('#piece-photo').setInputFiles({ name: 'real-photo.png', mimeType: 'image/png', buffer: await photoFixture(page) });
  await page.waitForFunction(() => window.styleDecodeStarted);
  await page.getByRole('button', { name: 'New profile', exact: true }).click();
  await releaseDecode(page);
  await expect(page.locator('#piece-photo-preview img')).toHaveCount(0);
  await addPiece(page, 'A fresh piece without the stale photo', 'top');
  const afterReset = await exportProfile(page);
  expect(afterReset.pieces).toHaveLength(1);
  expect(afterReset.pieces[0].photoId).toBeNull();
  expect(afterReset.photos).toHaveLength(0);
});

test('intervening edits cancel a photo-bearing import and a real board export without stale publication or download', async ({ page }) => {
  await addPiece(page, 'My photo top', 'top', liked, await photoFixture(page));
  await addPiece(page, 'My bottom', 'bottom');
  await addPiece(page, 'My shoes', 'shoes');
  await suggest(page);
  await page.locator('#suggestion-list').getByRole('button', { name: 'Save look', exact: true }).first().click();
  const original = await exportProfile(page);
  const incoming = structuredClone(original); incoming.title = 'A late import must not win';
  await holdNextDecode(page);
  await importProfile(page, JSON.stringify(incoming));
  await page.waitForFunction(() => window.styleDecodeStarted);
  await title(page, 'My intervening title');
  await releaseDecode(page);
  const current = await exportProfile(page);
  expect(current).toEqual({ ...original, title: 'My intervening title' });
  await page.evaluate(() => window.styleArmDecode());
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.locator('#look-list').getByRole('button', { name: 'Download outfit board', exact: true }).click();
  await page.waitForFunction(() => window.styleDecodeStarted);
  await title(page, 'My edit cancels the pending board');
  await releaseDecode(page);
  await expect(page.locator('#cancel-operation')).toBeHidden();
  expect(downloads.filter(name => name.endsWith('.png'))).toEqual([]);
  expect(await exportProfile(page)).toEqual({ ...original, title: 'My edit cancels the pending board' });
});

test('leaving the page with an unsaved opinion draft requires a native navigation confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'Assess this outfit', exact: true }).click();
  await page.locator('#example-form [name="caption"]').fill('This opinion has not been submitted');
  const dialogs: string[] = [];
  page.on('dialog', dialog => dialogs.push(dialog.type()));
  await page.goto('/?navigation=confirmed');
  expect(dialogs).toContain('beforeunload');
  await expect(page.locator('#piece-form')).toBeVisible();
});

test('a quota error leaves edits and backup usable, then an explicit retry saves the same real profile', async ({ page }) => {
  await expect(page.locator('#save-status')).toContainText(/local storage ready/i);
  await page.evaluate(() => {
    window.styleNativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('Simulated exhausted browser quota', 'QuotaExceededError');
    };
  });
  await addPiece(page, 'My piece remains available', 'top');
  await expect(page.locator('#save-status')).toContainText(/local save failed/i);
  const available = await exportProfile(page);
  expect(available.pieces).toHaveLength(1);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.styleNativePut; });
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText(/saved on this device/i);
  await page.reload();
  await expect(page.locator('#wardrobe-list')).toContainText('My piece remains available');
  expect(await exportProfile(page)).toEqual(available);
});

test('corrupt stored data is preserved until confirmed New profile durably replaces it with a valid empty profile', async ({ page }) => {
  await expect(page.locator('#save-status')).toContainText(/local storage ready/i);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('style-studio', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('profiles', 'readwrite');
      transaction.objectStore('profiles').put({ broken: true }, 'current');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  await page.reload();
  await expect(page.locator('#save-status')).toContainText(/could not be loaded/i);
  const preserved = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('style-studio', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('profiles', 'readonly');
      const record = transaction.objectStore('profiles').get('current');
      record.onsuccess = () => resolve(record.result);
      record.onerror = () => reject(record.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  expect(preserved).toEqual({ broken: true });
  await page.getByRole('button', { name: 'New profile', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText(/saved on this device/i);
  await page.reload();
  await expect(page.locator('#save-status')).toContainText(/local storage ready/i);
  const recovered = await exportProfile(page);
  expect(recovered.title).toBe('My style');
  expect(recovered.pieces).toEqual([]);
  expect(recovered.examples).toEqual([]);
  expect(recovered.looks).toEqual([]);
  expect(recovered.photos).toEqual([]);
});
