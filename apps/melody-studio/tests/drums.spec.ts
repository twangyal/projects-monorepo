import { test, expect, type Page } from '@playwright/test';
import { openRoll, readRoll, rollDownload } from './roll-edit-fixtures.ts';

const step = (page: Page, name: string, beat: number, sub: number) => page.getByRole('button', { name: `${name}, beat ${beat} step ${sub}`, exact: true });
async function drumTrack(page: Page) {
  await page.getByRole('button', { name: 'Add track', exact: true }).click();
  await page.getByLabel('Instrument', { exact: true }).selectOption('drums');
  await expect(page.locator('#drum-heading')).toHaveText('Drum pattern');
}
function channelTenNoteOns(midi: Buffer) {
  const keys: number[] = [];
  for (let i = 0; i + 2 < midi.length; i++) if (midi[i] === 0x99 && midi[i + 2]! > 0) keys.push(midi[i + 1]!);
  return keys;
}

test('a drum track is built on a step grid as undoable saved edits and plays, renders and exports as drums', async ({ page }) => {
  await openRoll(page);
  const original = await readRoll(page);
  await drumTrack(page);
  await expect(page.locator('.track-card[aria-pressed="true"] small')).toHaveText('0 notes · Drum kit');
  const empty = await readRoll(page);
  const index = empty.document.composition.tracks.length - 1;
  expect(empty.document.composition.tracks[index]).toMatchObject({ instrument: 'drums', notes: [] });

  await page.getByRole('button', { name: 'Start with a basic beat', exact: true }).click();
  await expect(step(page, 'Kick', 1, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 'Snare', 2, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 'Closed hat', 1, 3)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 'Clap', 2, 1)).toHaveAttribute('aria-pressed', 'false');
  const beat = (await readRoll(page)).document.composition.tracks[index]!;
  expect(beat.notes.map(note => [note.pitch, note.start])).toEqual([[36, 0], [42, 0], [42, 0.5], [38, 1], [42, 1], [42, 1.5], [36, 2], [42, 2], [36, 2.5], [42, 2.5], [38, 3], [42, 3], [42, 3.5]]);

  // A clap on beat 2 and a keyboard-toggled open hat on the last sixteenth; focus stays on the step.
  await step(page, 'Clap', 2, 1).click();
  await expect(step(page, 'Clap', 2, 1)).toHaveAttribute('aria-pressed', 'true');
  await step(page, 'Open hat', 4, 4).focus();
  await page.keyboard.press('Enter');
  await expect(step(page, 'Open hat', 4, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 'Open hat', 4, 4)).toBeFocused();
  const edited = (await readRoll(page)).document.composition.tracks[index]!;
  expect(edited.notes.filter(note => note.pitch === 39 || note.pitch === 46).map(note => [note.pitch, note.start, note.duration])).toEqual([[39, 1, 0.25], [46, 3.75, 0.25]]);

  // Copying the bar fills bar 2 and moves there.
  await page.getByRole('button', { name: 'Copy bar to next', exact: true }).click();
  await expect(page.locator('#drum-bar-label')).toHaveText('Bar 2 of 3');
  await expect(step(page, 'Clap', 6, 1)).toHaveAttribute('aria-pressed', 'true');
  const copied = (await readRoll(page)).document.composition;
  expect(copied.tracks[index]!.notes).toHaveLength(30);
  expect(copied.tracks.slice(0, index)).toEqual(original.document.composition.tracks);
  await page.getByRole('button', { name: 'Previous bar', exact: true }).click();
  await expect(page.locator('#drum-bar-label')).toHaveText('Bar 1 of 3');

  // The drums are heard in playback, the WAV and the MIDI (channel 10).
  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Playing your composition');
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  const wav = await rollDownload(page, 'Export WAV');
  const frames = wav.readUInt32LE(40) / 2;
  // Eight beats at 120 BPM plus the last open hat's ring.
  expect(frames).toBeGreaterThan(4 * 22050);
  let energy = 0;
  for (let i = 0; i < Math.min(frames, 22050); i++) energy += Math.abs(wav.readInt16LE(44 + i * 2));
  expect(energy).toBeGreaterThan(1e6);
  const keys = channelTenNoteOns(await rollDownload(page, 'Export MIDI'));
  expect(keys.filter(key => key === 36)).toHaveLength(6);
  expect(new Set(keys)).toEqual(new Set([36, 38, 39, 42, 46]));

  // Each step and bar action is one undoable edit, and the project reloads with its drums.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await readRoll(page)).toEqual(empty);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await readRoll(page)).document.composition).toEqual(copied);
  await expect(page.locator('#save-status')).toContainText(/Saved/);
  await page.reload();
  await page.locator(`[data-track="${copied.tracks[index]!.id}"]`).click();
  await expect(step(page, 'Clap', 2, 1)).toHaveAttribute('aria-pressed', 'true');
});

test('the step grid fits a phone screen without widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoll(page);
  await drumTrack(page);
  await page.getByRole('button', { name: 'Start with a basic beat', exact: true }).click();
  await step(page, 'Kick', 4, 4).click();
  await expect(step(page, 'Kick', 4, 4)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
