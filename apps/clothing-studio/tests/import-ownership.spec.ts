import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Project } from '../src/model.ts';

// Freeze actual File reads/native bitmap deliveries, not application methods.
// Removing editor-intent retirement must allow an older complete graph to win.
interface Gate {
  releases: Map<string, () => void>;
  completed: string[];
  closed: number;
  holdDecode: boolean;
}
async function install(page: Page) {
  await page.addInitScript(() => {
    const gate: Gate = { releases: new Map(), completed: [], closed: 0, holdDecode: false };
    Object.assign(window, { importGate: gate });
    const read = File.prototype.text;
    File.prototype.text = function () {
      if (!this.name.startsWith('held-')) return read.call(this);
      const name = this.name, actualRead = read.bind(this);
      return new Promise<string>((resolve, reject) => {
        gate.releases.set(name, () => {
          gate.releases.delete(name);
          void actualRead().then(text => { resolve(text); gate.completed.push(name); }, reject);
        });
      });
    };
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (source: ImageBitmapSource) => {
      const bitmap = await decode(source);
      const close = bitmap.close.bind(bitmap);
      bitmap.close = () => { gate.closed++; close(); };
      if (!gate.holdDecode) return bitmap;
      gate.holdDecode = false;
      return new Promise<ImageBitmap>(resolve => gate.releases.set('bitmap', () => {
        gate.releases.delete('bitmap'); resolve(bitmap); gate.completed.push('bitmap');
      }));
    }) as typeof window.createImageBitmap;
  });
}
async function gateReady(page: Page, name: string) {
  await expect.poll(() => page.evaluate(name => (window as unknown as { importGate: Gate }).importGate.releases.has(name), name)).toBe(true);
}
async function release(page: Page, name: string) {
  await page.evaluate(name => (window as unknown as { importGate: Gate }).importGate.releases.get(name)!(), name);
  await expect.poll(() => page.evaluate(name => (window as unknown as { importGate: Gate }).importGate.completed.includes(name), name)).toBe(true);
  // Allow all continuations and any erroneous autosave to finish.
  await page.waitForTimeout(350);
}
async function backup(page: Page): Promise<Project> {
  const next = page.waitForEvent('download'); await page.locator('#backup').click();
  return JSON.parse(await readFile((await (await next).path())!, 'utf8')) as Project;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('clothing-studio', 1); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise(resolve => { const r = db.transaction('project').objectStore('project').get('current'); r.onsuccess = () => resolve(r.result); }); }
    finally { db.close(); }
  });
}
async function open(page: Page, project: Project, name: string) {
  await page.locator('#project-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
}
async function setup(page: Page) {
  await install(page); await page.goto('/');
  await expect(page.locator('#save-state')).not.toContainText('Checking');
  const photo = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 80;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#a02b61'; ctx.fillRect(0, 0, 64, 80);
    ctx.fillStyle = '#129fca'; ctx.fillRect(11, 13, 23, 29);
    return { dataUrl: c.toDataURL('image/jpeg', .85), width: 64, height: 80, name: 'original.jpg' };
  });
  const original: Project = {
    schemaVersion: 1, title: 'Original complete concept', note: 'Literal original note',
    garment: { bodyWidth: 210, bodyLength: 240, sleeveLength: 40, neckline: 'v', color: '#357b9f', pattern: 'stripe', patternColor: '#fead31' },
    placement: { x: .43, y: .37, width: .63, height: .58, rotation: 13, opacity: .8 },
    strokes: [{ id: 'original-mark', color: '#ff0123', width: 7, points: [{ x: .4, y: .4 }, { x: .6, y: .6 }] }], photo,
  };
  await open(page, original, 'original.json'); await expect(page.locator('#save-state')).toHaveText('Locally saved');
  expect(await backup(page)).toEqual(original);
  const older = structuredClone(original); older.title = 'Older pending backup'; older.note = 'Older note';
  older.garment.color = '#ffcc00'; older.strokes = []; older.photo!.name = 'older.jpg';
  return { original, older };
}

for (const field of ['title', 'note']) test(`held complete backup preserves a newer committed ${field} and history`, async ({ page }) => {
  const { original, older } = await setup(page); await open(page, older, 'held-edit.json'); await gateReady(page, 'held-edit.json');
  await page.locator(`#${field}`).fill('Newer literal edit'); await page.locator(`#${field}`).press('Tab');
  await release(page, 'held-edit.json');
  const expected = { ...original, [field]: 'Newer literal edit' };
  expect(await backup(page)).toEqual(expected); expect(await stored(page)).toEqual(expected);
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(original);
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(expected);
  await expect(page.locator('#save-state')).toHaveText('Locally saved'); await page.reload();
  await expect(page.locator('#save-state')).toHaveText('Locally saved'); expect(await backup(page)).toEqual(expected);
});

test('changed-back raw placement input retires import without normalizing or losing focus', async ({ page }) => {
  const { original, older } = await setup(page); await open(page, older, 'held-raw.json'); await gateReady(page, 'held-raw.json');
  const field = page.locator('#rotation'); await field.fill('17.250'); await field.fill('13.000');
  await release(page, 'held-raw.json'); await expect(field).toHaveValue('13.000'); await expect(field).toBeFocused();
  expect(await stored(page)).toEqual(original); expect(await backup(page)).toEqual(original);
});

for (const surface of ['sketch-surface', 'preview-surface']) test(`held backup preserves a newer active ${surface} gesture`, async ({ page }) => {
  const { original, older } = await setup(page); await open(page, older, 'held-gesture.json'); await gateReady(page, 'held-gesture.json');
  const target = page.locator(`#${surface}`); await target.scrollIntoViewIfNeeded(); const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width * .4, b.y + b.height * .4); await page.mouse.down();
  await page.mouse.move(b.x + b.width * .6, b.y + b.height * .6, { steps: 3 });
  await release(page, 'held-gesture.json');
  await expect(page.locator('#title')).toHaveValue(original.title); expect(await stored(page)).toEqual(original);
  if (surface === 'sketch-surface') await expect(page.locator('#stroke-count')).toHaveText('2 strokes');
  await page.mouse.up(); await expect(page.locator('#save-state')).toHaveText('Locally saved');
  const changed = await backup(page);
  expect(changed.photo).toEqual(original.photo); expect(changed.note).toBe(original.note);
  if (surface === 'sketch-surface') { expect(changed.strokes).toHaveLength(2); expect(changed.strokes[0]).toEqual(original.strokes[0]); }
  else { expect(changed.placement.x).toBeCloseTo(.63, 2); expect(changed.placement.y).toBeCloseTo(.57, 2); }
  expect(await stored(page)).toEqual(changed);
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(original);
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(changed);
});

test('held native backup decoding releases its bitmap but cannot replace newer edits', async ({ page }) => {
  const { original, older } = await setup(page);
  await page.evaluate(() => { (window as unknown as { importGate: Gate }).importGate.holdDecode = true; });
  await open(page, older, 'decode.json'); await gateReady(page, 'bitmap');
  await page.locator('#title').fill('Edit during actual JPEG decoding'); await page.locator('#title').press('Tab');
  const closes = await page.evaluate(() => (window as unknown as { importGate: Gate }).importGate.closed);
  await release(page, 'bitmap');
  expect(await page.evaluate(() => (window as unknown as { importGate: Gate }).importGate.closed)).toBe(closes + 1);
  expect(await backup(page)).toEqual({ ...original, title: 'Edit during actual JPEG decoding' });
});

test('held native photo decoding preserves newer raw draft and complete saved backup', async ({ page }) => {
  const { original } = await setup(page);
  await page.evaluate(() => { (window as unknown as { importGate: Gate }).importGate.holdDecode = true; });
  await page.locator('#photo-file').setInputFiles({ name: 'pending.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(original.photo!.dataUrl.split(',')[1], 'base64') });
  await gateReady(page, 'bitmap'); await page.locator('#rotation').fill(''); await release(page, 'bitmap');
  await expect(page.locator('#rotation')).toHaveValue(''); expect(await stored(page)).toEqual(original);
  expect(await backup(page)).toEqual(original);
});

test('late old failure and finalization cannot change a newer import status or result', async ({ page }) => {
  const { original, older } = await setup(page);
  await page.locator('#project-file').setInputFiles({ name: 'held-invalid.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await gateReady(page, 'held-invalid.json'); await open(page, older, 'held-newer.json'); await gateReady(page, 'held-newer.json');
  await release(page, 'held-invalid.json'); await expect(page.locator('#load-state')).toBeVisible();
  expect(await stored(page)).toEqual(original); await expect(page.locator('#message')).not.toContainText('Could not open');
  await release(page, 'held-newer.json'); await expect(page.locator('#load-state')).toBeHidden();
  expect(await backup(page)).toEqual(older); expect(await stored(page)).toEqual(older);
});

test('page lifetime retirement prevents a late native import after pagehide', async ({ page }) => {
  const { original, older } = await setup(page); await open(page, older, 'held-hidden.json'); await gateReady(page, 'held-hidden.json');
  // Controlled lifecycle event establishes handler behavior, not actual BFCache eligibility.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await release(page, 'held-hidden.json'); expect(await backup(page)).toEqual(original); expect(await stored(page)).toEqual(original);
});
