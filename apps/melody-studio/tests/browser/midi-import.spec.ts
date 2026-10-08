import { test, expect, type Page } from '@playwright/test';
import { phraseMidi, globalUnsupportedMidi, unsupportedLanesMidi, channelEvents } from './midi-import-fixtures.ts';
import { loadFixture, phraseFixture, savedProject, downloadedBytes, decodeWav, rmsAt, installAudioProbe, audioProbe } from './continuation-fixtures.ts';

const action = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const lane = (page: Page, channel = 2) => page.locator(`[data-midi-lane="channel-${channel}"]`);
async function pick(page: Page, bytes = phraseMidi(), filename = 'authored.mid') {
  await page.getByLabel('Import MIDI file', { exact: true }).setInputFiles({ name: filename, mimeType: 'audio/midi', buffer: bytes });
}
async function review(page: Page, start = '3', end = '7', channel = 2) {
  await lane(page, channel).locator('[name=included]').check();
  await lane(page, channel).locator('[name=instrument]').selectOption('sine');
  await page.locator('#midi-start').fill(start); await page.locator('#midi-end').fill(end);
  await page.locator('#midi-review').click(); await expect(page.locator('#midi-summary')).toBeVisible();
}
async function replace(page: Page, accept = true): Promise<string> {
  let text = ''; page.once('dialog', async dialog => { text = dialog.message(); if (accept) await dialog.accept(); else await dialog.dismiss(); });
  await page.locator('#midi-apply').click(); return text;
}
async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download'); await action(page, label).click(); return downloadedBytes(await pending);
}
interface Reads { pending: { name: string; release(): void }[]; completed: string[] }
type ReadWindow = Window & typeof globalThis & { midiReads: Reads };
async function delayedReads(page: Page) {
  await page.addInitScript(() => {
    const native = File.prototype.arrayBuffer;
    const state: Reads = { pending: [], completed: [] }; (window as ReadWindow).midiReads = state;
    File.prototype.arrayBuffer = async function () {
      const bytes = await native.call(this);
      if (this.name.startsWith('hold-')) await new Promise<void>(resolve => state.pending.push({ name: this.name, release: resolve }));
      state.completed.push(this.name); return bytes;
    };
  });
}
async function pending(page: Page, count = 1) { await expect.poll(() => page.evaluate(() => (window as ReadWindow).midiReads.pending.length)).toBe(count); }
async function release(page: Page, index = 0) {
  await page.evaluate(index => (window as ReadWindow).midiReads.pending.splice(index, 1)[0].release(), index);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function rawInput(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((node, value) => { const input = node as HTMLInputElement; input.value = value; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); }, value);
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('native MIDI file opens a transient explicit part review', async ({ page }) => {
  const original = phraseFixture(); await loadFixture(page, original);
  await expect(page.getByLabel('Import MIDI file', { exact: true })).toBeEnabled({ timeout: 2000 });
  await pick(page); await expect(lane(page)).toBeVisible(); await expect(lane(page, 5)).toBeVisible();
  await expect(lane(page).locator('[name=included]')).not.toBeChecked();
  await expect(lane(page).locator('[name=instrument]')).toHaveValue('');
  await expect(page.locator('#midi-apply')).toBeDisabled();
  expect(await savedProject(page)).toEqual(original); await expect(action(page, 'Undo')).toBeDisabled();
});

test('selected off-grid phrase replaces once, edits and plays, and real JSON MIDI WAV and reload agree', async ({ page }) => {
  await installAudioProbe(page); const original = phraseFixture(); await loadFixture(page, original);
  await pick(page); await review(page);
  await expect(page.locator('#midi-summary')).toContainText(/trailing/i);
  expect(await savedProject(page)).toEqual(original);
  const consent = await replace(page); expect(consent).toMatch(/2/); expect(consent).toMatch(/3/); expect(consent).toMatch(/Undo/i);
  const imported = await savedProject(page);
  expect(imported.title).toBe('Literal <phrase> 🎵'); expect(imported.tempo).toBe(120); expect(imported.tracks).toHaveLength(1);
  expect(imported.tracks[0]).toMatchObject({ name: 'Selected part', instrument: 'sine', volume: 64 / 127, muted: false });
  expect(imported.tracks[0].notes.map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity }))).toEqual([
    { pitch: 69, start: .13, duration: 1, velocity: 96 / 127 }, { pitch: 72, start: 2.13, duration: 1, velocity: 32 / 127 },
  ]);
  await action(page, 'Undo').click(); expect(await savedProject(page)).toEqual(original); await expect(action(page, 'Undo')).toBeDisabled();
  await action(page, 'Redo').click(); expect(await savedProject(page)).toEqual(imported); await expect(action(page, 'Redo')).toBeDisabled();
  await action(page, 'Play composition').click(); await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(1);
  expect((await audioProbe(page)).starts[0].peak).toBeGreaterThan(.01); await action(page, 'Stop playback').click();
  const json = JSON.parse((await download(page, 'Save project file')).toString());
  expect(json).toEqual({ format: 'melody-studio-project', version: 1,
    document: { schemaVersion: 1, composition: imported, references: [] }, assets: [] });
  const events = channelEvents(await download(page, 'Export MIDI'));
  expect(events.filter(event => event.kind === 192)).toEqual([{ tick: 0, kind: 192, channel: 0, data: [73] }]);
  expect(events.filter(event => event.kind === 176)).toEqual([{ tick: 0, kind: 176, channel: 0, data: [7, 64] }]);
  expect(events.filter(event => event.kind === 144 || event.kind === 128)).toEqual([
    { tick: 62, kind: 144, channel: 0, data: [69, 96] }, { tick: 542, kind: 128, channel: 0, data: [69, 0] },
    { tick: 1022, kind: 144, channel: 0, data: [72, 32] }, { tick: 1502, kind: 128, channel: 0, data: [72, 0] },
  ]);
  const wav = decodeWav(await download(page, 'Export WAV')); expect(wav.sampleRate).toBe(22050); expect(wav.samples.length).toBe(36273);
  expect(rmsAt(wav, .02)).toBe(0); expect(rmsAt(wav, .8)).toBe(0); expect(rmsAt(wav, .2)).toBeGreaterThan(.09); expect(rmsAt(wav, 1.2)).toBeGreaterThan(.03);
  await page.reload(); expect(await savedProject(page)).toEqual(imported); await expect(action(page, 'Undo')).toBeDisabled();
  await page.locator(`[data-note="${imported.tracks[0].notes[0].id}"]`).click(); await page.getByLabel('Pitch (MIDI)').fill('70'); await action(page, 'Apply note').click();
  expect((await savedProject(page)).tracks[0].notes[0].pitch).toBe(70);
});

test('unsupported channels stay visible while global MIDI effects reject the whole source', async ({ page }) => {
  await loadFixture(page); const original = await savedProject(page); await pick(page, unsupportedLanesMidi());
  for (const channel of [0, 3, 9]) { await expect(lane(page, channel)).toBeVisible(); await expect(lane(page, channel).locator('[name=included]')).toBeDisabled(); }
  await expect(lane(page, 0)).toContainText(/multiple raw tracks/i); await expect(lane(page, 9)).toContainText(/percussion/i);
  await review(page, '1', '5'); await expect(page.locator('#midi-summary')).toContainText(/3.*excluded|excluded.*3/is);
  await page.locator('#midi-cancel').click(); await pick(page, globalUnsupportedMidi());
  await expect(page.locator('#midi-status')).toContainText(/port|unsupported/i); await expect(page.locator('#midi-apply')).toBeDisabled();
  expect(await savedProject(page)).toEqual(original); await expect(action(page, 'Undo')).toBeDisabled();
});

test('literal unusable source names require visible fallback and explicit editable destination choices', async ({ page }) => {
  await loadFixture(page); await pick(page, phraseMidi(' <img src=x onerror=alert(1)> '), '<script>.mid');
  await expect(page.locator('#midi-import')).toContainText(' <img src=x onerror=alert(1)> ');
  await expect(page.locator('#midi-title')).toHaveValue('Imported MIDI'); expect(await page.locator('#midi-import img').count()).toBe(0);
  await page.locator('#midi-title').fill('Chosen exact title'); await review(page);
  await replace(page); expect((await savedProject(page)).title).toBe('Chosen exact title');
});

test('raw global track and nonselected note drafts plus proposal survive review, declined consent and cancellation', async ({ page }) => {
  await loadFixture(page); const original = await savedProject(page);
  await page.locator('#continuation-count').fill('8'); await action(page, 'Suggest continuation').click();
  const proposal = await page.locator('#proposal-notes').textContent();
  await page.locator('[data-note="phrase-0"]').click(); await page.getByLabel('Start beat', { exact: true }).fill('');
  await page.locator('[data-note="phrase-1"]').click();
  await rawInput(page, '#project-title', '   '); await rawInput(page, '#tempo', '108.000'); await rawInput(page, '#track-name', '');
  await page.locator('#tempo').focus(); const focused = await page.locator('#tempo').elementHandle();
  await pick(page); await expect(lane(page)).toBeVisible(); await expect(page.locator('#tempo')).toBeFocused(); expect(await focused!.evaluate(node => node.isConnected)).toBe(true);
  await review(page); await expect(page.locator('#midi-discard-ack')).toBeVisible(); await expect(page.locator('#midi-apply')).toBeDisabled();
  await page.locator('#midi-discard-ack').check(); await replace(page, false);
  await expect(page.locator('#project-title')).toHaveValue('   '); await expect(page.locator('#tempo')).toHaveValue('108.000'); await expect(page.locator('#track-name')).toHaveValue('');
  expect(await page.locator('#proposal-notes').textContent()).toBe(proposal); expect(await savedProject(page)).toEqual(original);
  await page.locator('#midi-cancel').click(); await page.locator('[data-note="phrase-0"]').click(); await expect(page.getByLabel('Start beat', { exact: true })).toHaveValue('');
  expect(await savedProject(page)).toEqual(original);
  await pick(page); await review(page); await page.locator('#midi-discard-ack').check(); await replace(page);
  await expect(page.locator('#proposal-notes')).toHaveCount(0);
  await action(page, 'Undo').click(); expect(await savedProject(page)).toEqual(original); await expect(action(page, 'Undo')).toBeDisabled();
  await page.locator('[data-note="phrase-0"]').click(); await expect(page.getByLabel('Start beat', { exact: true })).toHaveValue('3');
  await expect(page.locator('#project-title')).toHaveValue(original.title); await expect(page.locator('#proposal-notes')).toHaveCount(0);
});

test('any changed-back input irreversibly invalidates review and resets discard consent', async ({ page }) => {
  await loadFixture(page); await pick(page); await review(page);
  const title = await page.locator('#project-title').inputValue(); await rawInput(page, '#project-title', `${title}!`); await rawInput(page, '#project-title', title);
  await expect(page.locator('#midi-status')).toContainText(/editor changed.*review.*again/is); await expect(page.locator('#midi-apply')).toBeDisabled();
  await page.locator('#midi-review').click(); await expect(page.locator('#midi-apply')).toBeEnabled();
  await rawInput(page, '#tempo', ''); await page.locator('#midi-review').click(); await page.locator('#midi-discard-ack').check();
  await page.locator('#midi-end').fill('8'); await expect(page.locator('#midi-apply')).toBeDisabled(); await page.locator('#midi-review').click(); await expect(page.locator('#midi-discard-ack')).not.toBeChecked();
});

for (const intent of ['input', 'changed-back', 'selection', 'commit', 'undo'] as const) {
  test(`delayed native File read cannot publish after ${intent} intent`, async ({ page }) => {
    await delayedReads(page); await loadFixture(page);
    if (intent === 'undo') { await page.locator('#project-title').fill('Committed before read'); await page.locator('#project-title').press('Tab'); }
    await pick(page, phraseMidi(), 'hold-first.mid'); await pending(page);
    if (intent === 'input') { await page.locator('#tempo').focus(); await page.locator('#tempo').fill(''); }
    if (intent === 'changed-back') { const title = await page.locator('#project-title').inputValue(); await rawInput(page, '#project-title', `${title}!`); await rawInput(page, '#project-title', title); }
    if (intent === 'selection') await page.locator('[data-track="other-track"]').click();
    if (intent === 'commit') { await page.locator('#project-title').fill('Newly committed during read'); await page.locator('#project-title').press('Tab'); }
    if (intent === 'undo') await action(page, 'Undo').click();
    const saved = await savedProject(page); await release(page);
    await expect(page.locator('#midi-status')).toContainText(/changed|stale|again/i); await expect(lane(page)).toHaveCount(0); expect(await savedProject(page)).toEqual(saved);
    if (intent === 'input') { await expect(page.locator('#tempo')).toHaveValue(''); await expect(page.locator('#tempo')).toBeFocused(); }
  });
}

test('newer native file owns its status and stale finally after cancel cannot revive the old source', async ({ page }) => {
  await delayedReads(page); await loadFixture(page); await pick(page, phraseMidi('First old source'), 'hold-first.mid'); await pending(page);
  await pick(page, phraseMidi('Second source'), 'hold-second.mid'); await pending(page, 2);
  await release(page); await expect(lane(page)).toHaveCount(0); await expect(page.locator('#midi-status')).toContainText(/read|load/i);
  await release(page); await expect(page.locator('#midi-title')).toHaveValue('Second source');
  await pick(page, phraseMidi('Cancelled source'), 'hold-cancel.mid'); await pending(page); await page.locator('#midi-cancel').click(); await release(page);
  await expect(lane(page)).toHaveCount(0); await expect(action(page, 'Undo')).toBeDisabled();
});

test('mobile keyboard review has explicit choices and storage failure keeps a usable in-memory JSON backup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await loadFixture(page); const original = await savedProject(page);
  await pick(page); await lane(page).locator('[name=included]').focus(); await page.keyboard.press('Space');
  await lane(page).locator('[name=instrument]').selectOption('sine'); await page.locator('#midi-start').fill('3'); await page.locator('#midi-end').fill('7');
  await page.locator('#midi-review').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#midi-apply')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.evaluate(() => {
    const nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.transaction.mode === 'readwrite') throw new DOMException('Fixture quota exhausted', 'QuotaExceededError');
      return nativePut.apply(this, args);
    };
  });
  await replace(page); await expect(page.locator('#save-status')).toContainText(/not saved|failed|backup/i);
  expect(await savedProject(page)).toEqual(original);
  const backup = JSON.parse((await download(page, 'Save project file')).toString()); expect(backup.format).toBe('melody-studio-project'); expect(backup.assets).toEqual([]);
  expect(backup.document.composition.title).toBe('Literal <phrase> 🎵'); expect(backup.document.composition.tracks).toHaveLength(1);
  await expect(action(page, 'Undo')).toBeEnabled();
});


test('MIDI staging and cancellation preserve live native playback and redo without an audio side effect', async ({ page }) => {
  await installAudioProbe(page); await loadFixture(page, phraseFixture(8, 40));
  await page.locator('#project-title').fill('Temporary history'); await page.locator('#project-title').press('Tab');
  await action(page, 'Undo').click(); const original = await savedProject(page);
  await action(page, 'Play composition').click(); await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(1);
  await pick(page); await review(page); await page.locator('#midi-cancel').click();
  expect((await audioProbe(page)).starts).toHaveLength(1); expect((await audioProbe(page)).stopped).toBe(0);
  await expect(action(page, 'Stop playback')).toBeEnabled(); await expect(action(page, 'Redo')).toBeEnabled();
  expect(await savedProject(page)).toEqual(original); await action(page, 'Stop playback').click();
});


test('a crossing source note blocks review until the whole-beat window includes its complete interval', async ({ page }) => {
  await loadFixture(page); const original = await savedProject(page); await pick(page);
  await lane(page).locator('[name=included]').check(); await lane(page).locator('[name=instrument]').selectOption('sine');
  await page.locator('#midi-start').fill('4'); await page.locator('#midi-end').fill('7'); await page.locator('#midi-review').click();
  await expect(page.locator('#midi-status')).toContainText(/cross|boundary|window/i); await expect(page.locator('#midi-apply')).toBeDisabled();
  expect(await savedProject(page)).toEqual(original); await page.locator('#midi-start').fill('3'); await page.locator('#midi-review').click();
  await expect(page.locator('#midi-apply')).toBeEnabled(); await expect(page.locator('#midi-summary')).toContainText('2 included notes');
  expect(await savedProject(page)).toEqual(original);
});
