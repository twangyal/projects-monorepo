import { test, expect, chromium, type Page } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('maximum artwork and exact-cap held File preserve complete backup and PNG through browser restart', async ({ baseURL }) => {
  test.setTimeout(60000);
  const directory = await mkdtemp(join(tmpdir(), 'clothing-import-retention-'));
  const launch = () => chromium.launchPersistentContext(directory, {
    headless: true, acceptDownloads: true, baseURL,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  let context = await launch();
  try {
    const page = context.pages()[0]; const { original, older } = await setup(page);
    const photo = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 1200;
      const ctx = c.getContext('2d')!, pixels = ctx.createImageData(1200, 1200);
      for (let y = 0; y < 1200; y++) for (let x = 0; x < 1200; x++) {
        const i = (y * 1200 + x) * 4;
        pixels.data.set([(x * 7 + y) % 256, (y * 3 + x) % 256, (x + y * 11) % 256, 255], i);
      }
      ctx.putImageData(pixels, 0, 0);
      return { dataUrl: c.toDataURL('image/jpeg', .85), width: 1200, height: 1200, name: 'original-1200.jpg' };
    });
    const maximum: Project = { ...original, photo, strokes: Array.from({ length: 100 }, (_, s) => ({
      id: `original-${s}`, color: s % 2 ? '#ff0123' : '#129fca', width: 2,
      points: Array.from({ length: 120 }, (_, p) => ({ x: .3 + p / 400, y: .3 + s / 400 })),
    })) };
    await open(page, maximum, 'maximum.json'); await expect(page.locator('#save-state')).toHaveText('Locally saved');
    expect(await backup(page)).toEqual(maximum);
    async function png(p: Page) {
      const download = p.waitForEvent('download'); await p.locator('#garment-png').click();
      return readFile((await (await download).path())!);
    }
    const originalPng = await png(page);
    const content = JSON.stringify(older), cap = 6 * 1024 * 1024;
    await page.locator('#project-file').setInputFiles({ name: 'held-maximum.json', mimeType: 'application/json', buffer: Buffer.from(content + ' '.repeat(cap - Buffer.byteLength(content))) });
    await gateReady(page, 'held-maximum.json');
    await page.locator('#title').fill('Retained maximum artwork'); await page.locator('#title').press('Tab');
    await release(page, 'held-maximum.json');
    const expected = { ...maximum, title: 'Retained maximum artwork' };
    expect(await backup(page)).toEqual(expected); expect(await stored(page)).toEqual(expected);
    expect(await png(page)).toEqual(originalPng);
    await expect(page.locator('#save-state')).toHaveText('Locally saved');
    await context.close(); context = await launch();
    const reopened = context.pages()[0]; await reopened.goto(baseURL!);
    await expect(reopened.locator('#save-state')).toHaveText('Locally saved');
    expect(await backup(reopened)).toEqual(expected); expect(await stored(reopened)).toEqual(expected);
    expect(await png(reopened)).toEqual(originalPng);
  } finally { await context.close(); await rm(directory, { recursive: true, force: true }); }
});
