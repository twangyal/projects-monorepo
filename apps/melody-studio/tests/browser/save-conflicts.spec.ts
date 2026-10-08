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
  // Native file selection is unavailable until the complete saved-copy read settles.
  await expect(page.getByLabel('Open project file', { exact: true })).toBeEnabled();
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


// Hold actual native transactions open with real readonly requests. No saved
// descriptor, asset, request result, revision or production API is substituted.
interface ConflictGate { pending: boolean; hold: boolean }
async function transactionGate(page: Page, mode: IDBTransactionMode) {
  await page.evaluate(mode => {
    const native = IDBDatabase.prototype.transaction;
    const gate: ConflictGate = { pending: false, hold: true };
    (window as unknown as { conflictGate: ConflictGate }).conflictGate = gate;
    let armed = true;
    IDBDatabase.prototype.transaction = function (names, requestedMode, options) {
      const tx = native.call(this, names, requestedMode, options);
      if (armed && this.name === 'melody-studio.projects' && requestedMode === mode && tx.objectStoreNames.contains('projects')) {
        armed = false; gate.pending = true;
        const keepAlive = () => {
          if (!gate.hold) return;
          const request = tx.objectStore('projects').get('current');
          request.onsuccess = () => keepAlive();
        };
        keepAlive();
      }
      return tx;
    };
  }, mode);
}
async function heldTransaction(page: Page) { await expect.poll(() => page.evaluate(() => (window as unknown as { conflictGate: ConflictGate }).conflictGate.pending)).toBe(true); }
async function releaseTransaction(page: Page) { await page.evaluate(() => { (window as unknown as { conflictGate: ConflictGate }).conflictGate.hold = false; }); }
async function protectStale(page: Page, stale: Page) {
  page.on('dialog', d => d.accept()); await page.goto('/'); await open(page, 'Original local audio');
  await stale.goto('/'); await saved(stale); await open(page, 'Foreign winner audio', 2);
  await edit(stale, 'My protected alternative'); await expect(stale.locator('#save-status')).toContainText(/another tab|conflict/i);
}

test('newer local committed and raw edits during replacement remain unsaved until explicit Retry save', async ({ page, context }) => {
  const stale = await context.newPage(); await protectStale(page, stale);
  const captured = await downloaded(stale);
  await transactionGate(stale, 'readwrite'); stale.once('dialog', d => d.accept()); await stale.locator('#replace-saved-copy').click(); await heldTransaction(stale);
  await edit(stale, 'Newer local work after consent'); const tempo = stale.getByLabel('Tempo (BPM)'); await tempo.fill('');
  await tempo.evaluate(node => { node.dataset.conflictIdentity = 'retained'; });
  await releaseTransaction(stale);
  await expect(stale.locator('#save-status')).toContainText(/not saved|unsaved/i); await expect(stale.locator('#retry-save')).toBeVisible();
  const oldSaved = await stored(page); expect(oldSaved.row).toMatchObject({ document: captured.document });
  expect(oldSaved.assets[0].bytes).toEqual(Array.from(Buffer.from(captured.assets[0].pcmBase64, 'base64')));
  await expect(tempo).toHaveValue(''); await expect(tempo).toBeFocused(); await expect(tempo).toHaveAttribute('data-conflict-identity', 'retained');
  const latest = await downloaded(stale); expect(latest.document.composition.title).toBe('Newer local work after consent'); expect(latest.assets).toEqual(captured.assets);
  expect(await stored(page)).toEqual(oldSaved);
  await stale.locator('#retry-save').click(); await saved(stale); expect((await stored(page)).row).toMatchObject({ document: latest.document });
  await expect(tempo).toHaveValue(''); await stale.reload(); await saved(stale); expect(await downloaded(stale)).toEqual(latest);
});

test('cancelled and genuinely aborted replacement retain protection both audio copies and raw fields', async ({ page, context }) => {
  const stale = await context.newPage(); await protectStale(page, stale); const winner = await stored(page), memory = await downloaded(stale);
  await stale.locator('[data-note="note"]').click(); const duration = stale.getByLabel('Duration (beats)'); await duration.fill('1.0000');
  stale.once('dialog', d => d.dismiss()); await stale.locator('#replace-saved-copy').click(); await expect(stale.locator('#replace-saved-copy')).toBeVisible(); expect(await stored(page)).toEqual(winner); await expect(duration).toHaveValue('1.0000');
  await stale.evaluate(() => {
    const put = IDBObjectStore.prototype.put; let armed = true;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (armed && this.transaction.db.name === 'melody-studio.projects' && this.name === 'projects') { armed = false; request.addEventListener('success', () => this.transaction.abort(), { once: true }); }
      return request;
    };
  });
  stale.once('dialog', d => d.accept()); await stale.locator('#replace-saved-copy').click();
  await expect(stale.locator('#save-status')).toContainText(/failed|not saved|could not|abort/i); await expect(stale.locator('#replace-saved-copy')).toBeVisible();
  expect(await stored(page)).toEqual(winner); expect(await downloaded(stale)).toEqual(memory); await expect(duration).toHaveValue('1.0000');
  await edit(stale, 'Further protected memory'); expect(await stored(page)).toEqual(winner);
});

test('a second tab writing after actual replacement confirmation opens invalidates that reviewed receipt', async ({ page, context }) => {
  const stale = await context.newPage(); await protectStale(page, stale); const memory = await downloaded(stale);
  const confirmation = stale.waitForEvent('dialog'); const click = stale.locator('#replace-saved-copy').click(); const dialog = await confirmation;
  expect(dialog.message()).toContain('Foreign winner audio');
  await edit(page, 'Foreign winner changed after review'); await saved(page); const winner = await stored(page); await dialog.accept(); await click;
  await expect(stale.locator('#save-status')).toContainText(/another tab|conflict/i); expect(await stored(page)).toEqual(winner); expect(await downloaded(stale)).toEqual(memory);
  await expect(stale.locator('#replace-saved-copy')).toBeVisible();
});

test('direct piano-roll editing on a stale tab cannot bypass protected storage or damage its Undo reference', async ({ page, context }) => {
  page.on('dialog', d => d.accept()); await page.goto('/'); await open(page, 'Original roll audio'); const stale = await context.newPage(); await stale.goto('/'); await saved(stale); const original = await downloaded(stale);
  await open(page, 'Foreign roll winner', 2); const winner = await stored(page); await stale.locator('[data-note="note"]').focus(); await stale.keyboard.press('ArrowRight');
  await expect(stale.locator('#save-status')).toContainText(/another tab|conflict/i); const moved = await downloaded(stale); expect(moved.document.composition.tracks[0].notes[0].start).toBe(.25); expect(moved.assets).toEqual(original.assets); expect(await stored(page)).toEqual(winner);
  await stale.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await downloaded(stale)).toEqual(original); expect(await stored(page)).toEqual(winner);
  await stale.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await downloaded(stale)).toEqual(moved); expect(await stored(page)).toEqual(winner);
});

test('raw changed-back input during a real delayed replacement review retires consent and preserves its field', async ({ page, context }) => {
  const stale = await context.newPage(); await protectStale(page, stale); const winner = await stored(page), memory = await downloaded(stale); const confirmations: string[] = [];
  stale.on('dialog', d => { confirmations.push(d.message()); void d.accept(); });
  await transactionGate(stale, 'readonly'); await stale.locator('#replace-saved-copy').click(); await heldTransaction(stale);
  const title = stale.getByLabel('Project title'); await title.fill('New raw scratch'); await title.fill(memory.document.composition.title); await title.evaluate(node => { node.dataset.conflictIdentity = 'same'; (node as HTMLInputElement).setSelectionRange(4, 4); });
  await releaseTransaction(stale); await expect(stale.locator('#replace-saved-copy')).toBeEnabled();
  expect(confirmations).toEqual([]); await expect(title).toBeFocused(); await expect(title).toHaveAttribute('data-conflict-identity', 'same'); expect(await title.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(4);
  expect(await stored(page)).toEqual(winner); expect(await downloaded(stale)).toEqual(memory);
});
