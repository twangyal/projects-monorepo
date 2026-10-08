import { expect, test } from '@playwright/test';
import { loadOriginal, originalBytes, originalCopy, workspaceBytes } from './library-fixtures.ts';

test('library baseline: complete original audio project exposes explicit saved-copy controls', async ({ page }) => {
  const original = originalCopy();
  await loadOriginal(page, original);
  expect(await workspaceBytes(page)).toEqual(originalBytes(original));
  await expect(page.locator('#library-select')).toBeVisible();
  await expect(page.locator('#library-create')).toHaveText('Save new copy');
});

import { chromium, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { control, createCopy, currentRow, digest, downloadBytes, installProbe, literalRow, probe, rawInput, rows, seedRows, selectCopy } from './library-fixtures.ts';
import { phraseMidi } from './browser/midi-import-fixtures.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function settle(page: Page) { await expect(page.locator('#library-refresh')).toBeEnabled(); }
async function consent(page: Page, selector: string, accept = true) {
  let message = '';
  page.once('dialog', async dialog => { message = dialog.message(); if (accept) await dialog.accept(); else await dialog.dismiss(); });
  await page.locator(selector).click(); return message;
}

test('library exact capture: create update refresh and download preserve complete bytes and current autosave', async ({ page }) => {
  await installProbe(page); const original = originalCopy(); await loadOriginal(page, original);
  const current = await currentRow(page), copy = await createCopy(page, '  Named separately Ω  ');
  expect(copy.id).toMatch(uuid); expect(copy.revision).toMatch(uuid);
  expect(copy).toEqual({ schemaVersion: 1, id: copy.id, revision: copy.revision, label: 'Named separately Ω',
    title: original.document.composition.title, tracks: 1, references: 1, bytes: originalBytes(original).length,
    sha256: digest(originalBytes(original)), backup: originalBytes(original).toString(), type: 'application/json' });
  expect(await currentRow(page)).toEqual(current);
  await selectCopy(page, copy.id); const reads = (await probe(page)).reads;
  await page.locator('#library-refresh').click(); await settle(page);
  expect((await probe(page)).reads).toBe(reads);
  expect(await downloadBytes(page, '#library-download')).toEqual(originalBytes(original));
  await page.locator('#library-label').fill('Renamed copy');
  expect(await consent(page, '#library-update')).toContain('Named separately Ω');
  await expect.poll(async () => (await rows(page))[0].label).toBe('Renamed copy');
  const updated = (await rows(page))[0]; expect(updated.revision).not.toBe(copy.revision);
  expect(updated.backup).toBe(copy.backup); expect(updated.title).toBe(copy.title);
  expect(await workspaceBytes(page)).toEqual(originalBytes(original)); expect(await currentRow(page)).toEqual(current);
});

test('library native capacity: two tabs race for eighth slot without losing existing rows', async ({ page, context }) => {
  await loadOriginal(page); const originalRows = Array.from({ length: 7 }, (_, i) => literalRow(i + 2));
  await seedRows(page, originalRows); await page.locator('#library-refresh').click(); await settle(page);
  const other = await context.newPage(); await other.goto('/'); await expect(other.locator('#library-create')).toBeEnabled();
  await page.locator('#library-label').fill('Race alpha'); await other.locator('#library-label').fill('Race beta');
  await Promise.all([page.locator('#library-create').click(), other.locator('#library-create').click()]);
  await expect.poll(async () => (await rows(page)).length).toBe(8); await settle(page); await settle(other);
  const result = await rows(page); expect(result.filter(row => row.label.startsWith('Race '))).toHaveLength(1);
  for (const row of originalRows) expect(result.find(value => value.id === row.id)).toEqual(row);
  await page.locator('#library-label').fill('Ninth copy');
  if (await page.locator('#library-create').isEnabled()) { await page.locator('#library-create').click(); await settle(page); }
  expect(await rows(page)).toEqual(result); await other.close();
});

test('library native CAS: different entry updates survive and stale same entry mutation refuses', async ({ page, context }) => {
  await loadOriginal(page); await seedRows(page, [literalRow(2), literalRow(3)]);
  const other = await context.newPage(); await other.goto('/'); await expect(other.locator('#library-refresh')).toBeEnabled();
  await selectCopy(page, literalRow(2).id); await selectCopy(other, literalRow(3).id);
  await page.locator('#library-label').fill('Alpha independent'); await other.locator('#library-label').fill('Beta independent');
  await Promise.all([consent(page, '#library-update'), consent(other, '#library-update')]);
  await expect.poll(async () => (await rows(page)).map(row => row.label).sort()).toEqual(['Alpha independent', 'Beta independent']);
  await selectCopy(page, literalRow(2).id); await selectCopy(other, literalRow(2).id);
  await page.locator('#library-label').fill('Newest exact winner'); await consent(page, '#library-update');
  await expect.poll(async () => (await rows(page)).find(row => row.id === literalRow(2).id)?.label).toBe('Newest exact winner');
  const winner = await rows(page); await other.locator('#library-label').fill('Stale loser'); await consent(other, '#library-update'); await settle(other);
  expect(await rows(page)).toEqual(winner); await expect(other.locator('#library-status')).toContainText(/changed|stale|refresh|conflict/i); await other.close();
});

test('library native deletion: declined delete preserves bytes and deleted receipts cannot recreate rows', async ({ page, context }) => {
  await loadOriginal(page); await seedRows(page, [literalRow(2)]); await selectCopy(page, literalRow(2).id);
  const other = await context.newPage(); await other.goto('/'); await selectCopy(other, literalRow(2).id);
  expect(await consent(page, '#library-delete', false)).toContain(literalRow(2).label); expect(await rows(page)).toEqual([literalRow(2)]);
  expect(await consent(page, '#library-delete')).toContain(literalRow(2).label); await expect.poll(async () => (await rows(page)).length).toBe(0);
  await other.locator('#library-label').fill('Stale resurrection'); await consent(other, '#library-update'); await settle(other); expect(await rows(page)).toEqual([]);
  const recreated = await createCopy(page, literalRow(2).label); expect(recreated.id).not.toBe(literalRow(2).id);
  expect(recreated.backup).toBe(originalBytes(originalCopy()).toString()); await other.close();
});

test('library integrity: plausible same-size corrupt copy downloads exact damaged bytes and never opens', async ({ page }) => {
  await loadOriginal(page); const before = await workspaceBytes(page), current = await currentRow(page), damaged = literalRow(2);
  damaged.backup = damaged.backup.replace('Original library 2', 'Original library 9');
  expect(Buffer.byteLength(damaged.backup)).toBe(damaged.bytes); expect(digest(Buffer.from(damaged.backup))).not.toBe(damaged.sha256);
  await seedRows(page, [damaged]); await selectCopy(page, damaged.id);
  expect(await downloadBytes(page, '#library-download')).toEqual(Buffer.from(damaged.backup));
  if (await page.locator('#library-open').isEnabled()) { await consent(page, '#library-open'); await settle(page); }
  await expect(page.locator('#library-status')).toContainText(/corrupt|integrity|invalid|hash|damaged|incomplete/i);
  expect(await workspaceBytes(page)).toEqual(before); expect(await currentRow(page)).toEqual(current); expect(await rows(page)).toEqual([damaged]);
});

test('library pointer capture preserves title caret numeric spellings MIDI review and continuation scratch', async ({ page }) => {
  await loadOriginal(page); await page.locator('#continuation-count').fill('8'); await page.getByRole('button', { name: 'Suggest continuation', exact: true }).click();
  const proposal = await page.locator('#proposal-notes').textContent(); expect(proposal).toBeTruthy();
  await page.getByLabel('Import MIDI file', { exact: true }).setInputFiles({ name: 'library-original.mid', mimeType: 'audio/midi', buffer: phraseMidi() });
  await page.locator('[data-midi-lane="channel-2"] [name=included]').check();
  await page.locator('#midi-start').fill('3'); await page.locator('#midi-end').fill('7'); await page.locator('#midi-review').click();
  const midi = await page.locator('#midi-summary').textContent(), current = await currentRow(page);
  await page.locator('#library-label').fill('Committed only'); await rawInput(page, '#tempo', '108.000');
  await rawInput(page, '#project-title', '   uncommitted title   '); await page.locator('#project-title').focus();
  const node = await page.locator('#project-title').elementHandle();
  await page.locator('#project-title').evaluate(element => (element as HTMLInputElement).setSelectionRange(3, 14, 'backward'));
  await page.locator('#library-create').click(); await expect.poll(async () => (await rows(page)).length).toBe(1);
  await expect(page.locator('#project-title')).toBeFocused(); await expect(page.locator('#project-title')).toHaveValue('   uncommitted title   ');
  expect(await node!.evaluate(element => element === document.querySelector('#project-title'))).toBe(true);
  expect(await page.locator('#project-title').evaluate(element => { const input = element as HTMLInputElement; return [input.selectionStart, input.selectionEnd, input.selectionDirection]; })).toEqual([3, 14, 'backward']);
  await expect(page.locator('#tempo')).toHaveValue('108.000'); expect(await page.locator('#midi-summary').textContent()).toBe(midi);
  expect(await page.locator('#proposal-notes').textContent()).toBe(proposal); expect(await currentRow(page)).toEqual(current);
  expect((await rows(page))[0].backup).toBe(originalBytes(originalCopy()).toString());
});

test('library Open is one reversible complete audio edit and declined Open retains pending review', async ({ page }) => {
  await loadOriginal(page); await seedRows(page, [literalRow(2)]); await selectCopy(page, literalRow(2).id);
  await page.locator('#continuation-count').fill('8'); await page.getByRole('button', { name: 'Suggest continuation', exact: true }).click();
  const proposal = await page.locator('#proposal-notes').textContent(); await consent(page, '#library-open', false);
  expect(await page.locator('#proposal-notes').textContent()).toBe(proposal); expect(await workspaceBytes(page)).toEqual(originalBytes(originalCopy()));
  page.on('dialog', dialog => dialog.accept()); await page.locator('#library-open').click();
  await expect(page.getByLabel('Project title')).toHaveValue(originalCopy(2).document.composition.title);
  expect(await workspaceBytes(page)).toEqual(originalBytes(originalCopy(2))); await expect(page.locator('#proposal-notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await workspaceBytes(page)).toEqual(originalBytes(originalCopy()));
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await workspaceBytes(page)).toEqual(originalBytes(originalCopy(2)));
});

for (const change of ['changed-back editor intent', 'label', 'selection', 'cancel', 'persisted page return']) {
  test(`library held native Blob read retires on ${change}`, async ({ page }) => {
    await installProbe(page); await loadOriginal(page); await seedRows(page, [literalRow(2), literalRow(3)]); await selectCopy(page, literalRow(2).id);
    const current = await currentRow(page); await control(page, 'holdRead'); page.on('dialog', dialog => dialog.accept());
    await page.locator('#library-open').click(); await expect.poll(async () => (await probe(page)).pendingReads).toBe(1);
    if (change === 'changed-back editor intent') { await rawInput(page, '#project-title', 'Intervening intent'); await rawInput(page, '#project-title', originalCopy().document.composition.title); }
    else if (change === 'label') await page.locator('#library-label').fill('Newer label intent');
    else if (change === 'selection') await page.locator('#library-select').selectOption(literalRow(3).id);
    else if (change === 'cancel') await page.locator('#library-cancel').click();
    else await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await control(page, 'releaseRead'); await expect.poll(async () => (await probe(page)).pendingReads).toBe(0); await settle(page);
    expect(await workspaceBytes(page)).toEqual(originalBytes(originalCopy())); expect(await currentRow(page)).toEqual(current);
    await page.locator('#library-refresh').click(); await settle(page); expect(await rows(page)).toHaveLength(2);
    if (change === 'persisted page return') await createCopy(page, 'Explicit after return');
  });
}

test('library controlled native rollback: put success followed by transaction abort never reports a durable copy', async ({ page }) => {
  await installProbe(page); await loadOriginal(page); const current = await currentRow(page); await control(page, 'abortPut');
  await page.locator('#library-label').fill('Must roll back'); await page.locator('#library-create').click();
  await expect.poll(async () => (await probe(page)).aborted).toBe(1); await settle(page);
  expect((await probe(page)).putSuccesses).toBe(1); expect(await rows(page)).toEqual([]); expect(await currentRow(page)).toEqual(current);
  await expect(page.locator('#library-status')).toContainText(/abort|fail|could not|unable|not saved/i);
  await page.locator('#library-refresh').click(); await settle(page); await createCopy(page, 'Explicit retry');
});

test('library real ten second deadline aborts a held native write and never replays it', async ({ page }) => {
  test.setTimeout(30000); await installProbe(page); await loadOriginal(page); const current = await currentRow(page);
  await control(page, 'holdWrite'); await page.locator('#library-label').fill('Deadline candidate'); const started = Date.now();
  await page.locator('#library-create').click(); await expect.poll(async () => (await probe(page)).writing).toBe(true);
  await expect(page.locator('#library-status')).toContainText(/timed out|timeout|10 seconds|deadline/i, { timeout: 12000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(9500); await control(page, 'releaseWrite');
  await expect.poll(async () => (await probe(page)).writing).toBe(false); await settle(page);
  expect(await rows(page)).toEqual([]); expect(await currentRow(page)).toEqual(current);
  await page.locator('#library-refresh').click(); await settle(page); expect(await rows(page)).toEqual([]); await createCopy(page, 'After native drain');
});

test('library startup and protected current autosave do not grant current-row replacement authority', async ({ page }) => {
  await loadOriginal(page); await seedRows(page, [literalRow(2)]);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('melody-studio.projects', 1); opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => { const db = opening.result, tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(undefined, 'current'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  }));
  await installProbe(page, true); await page.reload(); await expect.poll(async () => (await probe(page)).loading).toBe(true);
  await expect(page.locator('#library-open')).toBeDisabled(); await expect(page.locator('#library-create')).toBeDisabled();
  await control(page, 'releaseLoad'); await expect(page.locator('#retry-load')).toBeVisible();
  await selectCopy(page, literalRow(2).id); page.on('dialog', dialog => dialog.accept()); await page.locator('#library-open').click();
  await expect(page.getByLabel('Project title')).toHaveValue(originalCopy(2).document.composition.title);
  expect(await workspaceBytes(page)).toEqual(originalBytes(originalCopy(2))); expect(await currentRow(page)).toBeUndefined();
  await page.getByLabel('Project title').fill('Protected memory edit'); await page.getByLabel('Project title').press('Tab');
  expect(await currentRow(page)).toBeUndefined(); await expect(page.locator('#retry-load')).toBeVisible(); await createCopy(page, 'Independent recovery');
  expect(await currentRow(page)).toBeUndefined();
});

test('library full Chromium process restart retains exact audio bytes and keyboard mobile actions', async ({ baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), 'melody-library-oracle-')); const options = { baseURL, viewport: { width: 390, height: 844 }, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    let page = await context.newPage(); await loadOriginal(page); const copy = await createCopy(page, 'Restart retained Ω');
    await context.close(); context = await chromium.launchPersistentContext(profile, options); page = await context.newPage(); await page.goto('/');
    await selectCopy(page, copy.id); expect(await rows(page)).toEqual([copy]); expect(await downloadBytes(page, '#library-download')).toEqual(originalBytes(originalCopy()));
    await page.locator('#library-label').fill('Keyboard duplicate'); await page.locator('#library-create').focus(); await page.keyboard.press('Enter');
    await expect.poll(async () => (await rows(page)).length).toBe(2); await expect(page.locator('#library-status')).toHaveAttribute('role', 'status');
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); expect(overflows).toBe(false);
    await page.screenshot({ path: info.outputPath('library-mobile.png'), fullPage: true });
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

import type { CompositionLibrary } from '../src/composition-library.ts';
import type { ReferenceBundle } from '../src/reference-types.ts';
type HarnessWindow = Window & { libraryHarness: { CompositionLibrary: typeof CompositionLibrary } };

test('library native opaque receipts immutable snapshots and consumed authority never mutate a different capture', async ({ page }) => {
  await page.goto('/tests/library-harness.html');
  const result = await page.evaluate(async original => {
    const Store = (window as unknown as HarnessWindow).libraryHarness.CompositionLibrary;
    const bundle = () => ({ document: structuredClone(original.document), assets: original.assets.map(({ sha256, pcmBase64, ...asset }) => {
      void sha256; return { ...asset, pcm: Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0)) };
    }) }) as ReferenceBundle;
    const a = new Store(indexedDB), b = new Store(indexedDB); let refused = 0;
    try {
      const candidate = bundle(), pending = a.create('Detached original', candidate);
      candidate.document.composition.title = 'After admission mutation'; candidate.assets[0].pcm.fill(42);
      const entry = await pending, listed = await a.list(), review = await a.review(entry.receipt);
      const immutable = [entry, entry.receipt, listed, listed[0], listed[0].receipt, review].every(Object.isFrozen);
      const exact = await review.backup.text(); if (review.bundle) review.bundle.assets[0].pcm.fill(21);
      const again = await a.review(entry.receipt);
      for (const action of [() => a.remove({} as typeof entry.receipt), () => a.remove(structuredClone(entry.receipt)), () => b.remove(entry.receipt)]) {
        try { await action(); } catch { refused++; }
      }
      const fresh = (await a.list())[0], updated = await a.update(fresh.receipt, 'Updated once', bundle());
      try { await a.remove(fresh.receipt); } catch { refused++; }
      await a.remove(updated.receipt);
      try { await a.update(updated.receipt, 'Cannot resurrect', bundle()); } catch { refused++; }
      return { refused, immutable, exact, secondPcm: Array.from(again.bundle?.assets[0].pcm ?? []), entries: (await a.list()).length };
    } finally { await a.close(); await b.close(); }
  }, originalCopy());
  expect(result.refused).toBe(5); expect(result.immutable).toBe(true); expect(result.exact).toBe(originalBytes(originalCopy()).toString());
  expect(result.secondPcm).toEqual([...Buffer.from(originalCopy().assets[0].pcmBase64, 'base64')]); expect(result.entries).toBe(0);
});

test('library actual blocked native open retains its drain after logical cancellation and terminal close', async ({ page }) => {
  await page.goto('/tests/library-harness.html'); await seedRows(page, [literalRow(2)]);
  const result = await page.evaluate(async () => {
    const Store = (window as unknown as HarnessWindow).libraryHarness.CompositionLibrary;
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('melody-studio.library', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    blocker.onversionchange = () => { /* Explicit controlled blocker on a real database. */ };
    let removed!: () => void, deletionFailed!: (reason: unknown) => void;
    const removedPromise = new Promise<void>((resolve, reject) => { removed = resolve; deletionFailed = reject; });
    await new Promise<void>((resolve, reject) => {
      const removal = indexedDB.deleteDatabase('melody-studio.library'); removal.onblocked = () => resolve();
      removal.onsuccess = () => removed(); removal.onerror = () => { deletionFailed(removal.error); reject(removal.error); };
    });
    const native = IDBFactory.prototype.open; let observed!: () => void;
    const opening = new Promise<void>(resolve => { observed = resolve; });
    IDBFactory.prototype.open = function (name: string, version?: number) { const request = version === undefined ? native.call(this, name) : native.call(this, name, version); if (name === 'melody-studio.library') observed(); return request; };
    const store = new Store(indexedDB), controller = new AbortController(); let closeFinished = false;
    try {
      const pending = store.list({ signal: controller.signal }).then(() => 'fulfilled', () => 'rejected');
      await opening; controller.abort(); const terminal = await pending, draining = store.nativePending;
      const closed = store.close().then(() => { closeFinished = true; }); await Promise.resolve();
      const earlyClose = closeFinished; let refusedAfterClose = false; try { await store.list(); } catch { refusedAfterClose = true; }
      blocker.close(); await removedPromise; await closed;
      return { terminal, draining, earlyClose, refusedAfterClose, finalPending: store.nativePending, closeFinished };
    } finally { IDBFactory.prototype.open = native; blocker.close(); await store.close(); }
  });
  expect(result).toEqual({ terminal: 'rejected', draining: true, earlyClose: false, refusedAfterClose: true, finalPending: false, closeFinished: true });
});

test('library valid audio ID collision refuses atomically without clearing continuation or Undo', async ({ page }) => {
  await loadOriginal(page); const collision = originalCopy(2), row = literalRow(2);
  collision.assets[0].id = originalCopy().assets[0].id; collision.document.references[0].assetId = collision.assets[0].id;
  row.backup = originalBytes(collision).toString(); row.bytes = Buffer.byteLength(row.backup); row.sha256 = digest(Buffer.from(row.backup));
  await seedRows(page, [row]); await selectCopy(page, row.id); await page.locator('#continuation-count').fill('8');
  await page.getByRole('button', { name: 'Suggest continuation', exact: true }).click();
  const proposal = await page.locator('#proposal-notes').textContent(), current = await currentRow(page);
  const undo = await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled();
  page.on('dialog', dialog => dialog.accept()); await page.locator('#library-open').click();
  await expect(page.locator('#library-status')).toContainText(/collision|conflict|different|audio|retained/i);
  expect(await workspaceBytes(page)).toEqual(originalBytes(originalCopy())); expect(await currentRow(page)).toEqual(current);
  expect(await page.locator('#proposal-notes').textContent()).toBe(proposal); expect(await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled()).toBe(undo);
});

test('library native committed-before-cancel uncertainty is distinct from rollback and never automatically replays', async ({ page }) => {
  await page.goto('/tests/library-harness.html');
  const result = await page.evaluate(async original => {
    const Store = (window as unknown as HarnessWindow).libraryHarness.CompositionLibrary;
    const bundle = { document: original.document, assets: original.assets.map(({ sha256, pcmBase64, ...asset }) => { void sha256; return { ...asset, pcm: Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0)) }; }) } as ReferenceBundle;
    const transaction = IDBDatabase.prototype.transaction, store = new Store(indexedDB), controller = new AbortController(); let completions = 0;
    IDBDatabase.prototype.transaction = function (names: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const tx = transaction.call(this, names, mode, options);
      if (this.name === 'melody-studio.library' && mode === 'readwrite') tx.addEventListener('complete', () => { completions++; controller.abort(); }, { once: true });
      return tx;
    };
    try {
      const outcome = await store.create('Captured before cancellation', bundle, { signal: controller.signal }).then(() => 'fulfilled', () => 'rejected');
      const refreshed = await store.list(); return { outcome, completions, count: refreshed.length, backup: await (await store.review(refreshed[0].receipt)).backup.text() };
    } finally { IDBDatabase.prototype.transaction = transaction; await store.close(); }
  }, originalCopy());
  expect(result.outcome).toBe('rejected'); expect(result.completions).toBe(1); expect(result.count).toBe(1);
  expect(result.backup).toBe(originalBytes(originalCopy()).toString()); expect(await rows(page)).toHaveLength(1);
});

test('library controlled pending microphone permission blocks Save and Open through native cleanup', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { requested: false, release: null as (() => void) | null };
    Object.defineProperty(window, 'libraryPermission', { value: state });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: () => new Promise<MediaStream>((_resolve, reject) => {
      state.requested = true; state.release = () => reject(new DOMException('Controlled permission rejection', 'NotAllowedError'));
    }) });
  });
  await loadOriginal(page); await seedRows(page, [literalRow(2)]); await selectCopy(page, literalRow(2).id);
  const current = await currentRow(page); page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Record melody', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {libraryPermission: {requested: boolean}}).libraryPermission.requested)).toBe(true);
  await expect(page.locator('#library-create')).toBeDisabled(); await expect(page.locator('#library-open')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#library-create')).toBeDisabled(); await expect(page.locator('#library-open')).toBeDisabled();
  await page.evaluate(() => (window as unknown as {libraryPermission: {release: () => void}}).libraryPermission.release());
  await expect(page.locator('#library-create')).toBeEnabled(); expect(await currentRow(page)).toEqual(current);
  expect(await workspaceBytes(page)).toEqual(originalBytes(originalCopy())); expect(await rows(page)).toEqual([literalRow(2)]);
});
