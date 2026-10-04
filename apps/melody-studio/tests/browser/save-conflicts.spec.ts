import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const DB = 'melody-studio.projects';
// Independent literal backup with actual PCM; never call the product encoder.
function fixture(title = 'Shared original', variant = 1) {
  const pcm = Buffer.alloc(44100);
  for (let i = 0; i < 22050; i++) pcm.writeInt16LE(Math.round(4000 * Math.sin(i * 2 * Math.PI * (variant === 1 ? 440 : 660) / 22050)), i * 2);
  const id = `0000000${variant}-0000-4000-8000-000000000001`;
  return { format: 'melody-studio-project', version: 1, document: { schemaVersion: 1,
    composition: { version: 1, title, tempo: 120, tracks: [{ id: 'track', name: 'Voice', instrument: 'sine', volume: .5, muted: false,
      notes: [{ id: 'note', pitch: variant === 1 ? 69 : 76, start: 0, duration: 1, velocity: .5 }] }] }, references: [{ trackId: 'track', assetId: id }] },
    assets: [{ id, kind: 'audio-file', captureTempo: 120, decodedSampleRate: 22050, decodedChannels: 1, decodedFrames: 22050,
      analyzedFrames: 22050, frameCount: 22050, sha256: createHash('sha256').update(pcm).digest('hex'), pcmBase64: pcm.toString('base64') }] };
}
async function saved(page: Page) { await expect(page.locator('#save-status')).toContainText(/Saved|Restored/); }
async function open(page: Page, title: string, variant = 1) {
  await page.getByLabel('Open project file', { exact: true }).setInputFiles({ name: 'complete.melody.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture(title, variant))) });
  await expect(page.getByLabel('Project title')).toHaveValue(title); await saved(page);
}
async function edit(page: Page, title: string) {
  await page.getByLabel('Project title').fill(title); await page.getByLabel('Project title').press('Tab');
}
async function stored(page: Page) {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const tx = db.transaction(['projects', 'assets'], 'readonly');
      const result = await Promise.all([new Promise<unknown>(resolve => { const r = tx.objectStore('projects').get('current'); r.onsuccess = () => resolve(r.result); }),
        new Promise<Array<{ id: string; pcm: Blob; sha256: string }>>(resolve => { const r = tx.objectStore('assets').getAll(); r.onsuccess = () => resolve(r.result); })]);
      return { row: result[0], assets: await Promise.all(result[1].map(async a => ({ id: a.id, sha256: a.sha256, bytes: Array.from(new Uint8Array(await a.pcm.arrayBuffer())) }))) };
    } finally { db.close(); }
  }, DB);
}
async function downloaded(page: Page) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project file', exact: true }).click();
  const path = await (await event).path(); if (!path) throw Error('Missing actual backup');
  return JSON.parse((await readFile(path)).toString('utf8'));
}

test('a stale tab preserves newer complete audio while retaining its own notes, backup and raw fields', async ({ page, context }) => {
  page.on('dialog', d => d.accept()); await page.goto('/'); await open(page, 'Shared original');
  const stale = await context.newPage(); stale.on('dialog', d => d.accept()); await stale.goto('/'); await saved(stale);
  await open(page, 'Newer complete audio', 2); const winner = await stored(page);
  await edit(stale, 'Stale local edit');
  await expect(stale.locator('#save-status')).toContainText(/another tab|conflict/i);
  await expect(stale.locator('#replace-saved-copy')).toBeVisible(); await expect(stale.locator('#retry-load')).toBeVisible();
  await stale.getByLabel('Tempo (BPM)').fill('');
  expect(await stored(page)).toEqual(winner);
  const backup = await downloaded(stale);
  expect(backup.document.composition.title).toBe('Stale local edit');
  expect(backup.assets).toEqual(fixture().assets);
  await expect(stale.getByLabel('Tempo (BPM)')).toHaveValue('');
  await stale.locator('#retry-load').click(); await saved(stale);
  expect((await downloaded(stale)).assets).toEqual(fixture('Newer complete audio', 2).assets);
  await expect(stale.getByLabel('Project title')).toHaveValue('Newer complete audio');
});

test('replacement is deliberate and ordinary queued saves advance the current tab identity', async ({ page, context }) => {
  page.on('dialog', d => d.accept()); await page.goto('/'); await open(page, 'Original');
  const stale = await context.newPage(); await stale.goto('/'); await saved(stale);
  await open(page, 'Winner', 2); await edit(stale, 'My alternative');
  await expect(stale.locator('#save-status')).toContainText(/another tab|conflict/i);
  stale.once('dialog', d => d.dismiss()); await stale.locator('#replace-saved-copy').click();
  expect((await stored(page)).row).toMatchObject({ document: { composition: { title: 'Winner' } } });
  stale.once('dialog', d => d.accept()); await stale.locator('#replace-saved-copy').click(); await saved(stale);
  const replacement = await stored(stale);
  expect(replacement.assets[0].bytes).toEqual(Array.from(Buffer.from(fixture().assets[0].pcmBase64, 'base64')));
  await edit(stale, 'Next edit'); await saved(stale); await edit(stale, 'Final edit'); await saved(stale);
  expect((await stored(stale)).row).toMatchObject({ document: { composition: { title: 'Final edit' } } });
  await edit(page, 'Old winner now stale'); await expect(page.locator('#save-status')).toContainText(/another tab|conflict/i);
  expect((await stored(stale)).row).toMatchObject({ document: { composition: { title: 'Final edit' } } });
});

test('genuine old stored descriptors are read without writes and conflict on first migration', async ({ page, context }) => {
  page.on('dialog', d => d.accept()); await page.goto('/'); await open(page, 'Legacy original');
  await page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'); const store = tx.objectStore('projects');
      const r = store.get('current'); r.onsuccess = () => store.put({ schemaVersion: 1, document: r.result.document }, 'current');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  }, DB);
  const legacy = await stored(page); await page.reload(); await saved(page); expect(await stored(page)).toEqual(legacy);
  const stale = await context.newPage(); await stale.goto('/'); await saved(stale); expect(await stored(page)).toEqual(legacy);
  await edit(page, 'Migrated winner'); await saved(page); const migrated = await stored(page);
  expect(migrated.row).toMatchObject({ schemaVersion: 2 });
  await edit(stale, 'Legacy stale'); await expect(stale.locator('#save-status')).toContainText(/another tab|conflict/i);
  expect(await stored(page)).toEqual(migrated);
});
