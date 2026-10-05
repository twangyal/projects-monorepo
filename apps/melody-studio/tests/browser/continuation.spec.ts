import { expect, test, type Page } from '@playwright/test';
import type { Composition, Note } from '../../src/types.ts';
import {
  audioProbe, controlProbe, decodeMidi, decodeWav, downloadedBytes, expectedMidiNotes,
  installAudioProbe, loadFixture, phraseFixture, rmsAt, savedProject,
} from './continuation-fixtures.ts';

const action = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const suggest = (page: Page) => action(page, 'Suggest continuation');
const audition = (page: Page) => action(page, 'Audition ending + suggestion');
const proposalRows = (page: Page) => page.locator('#proposal-notes [data-proposal-index]');

async function proposedNotes(page: Page): Promise<Omit<Note, 'id'>[]> {
  return proposalRows(page).evaluateAll(rows => rows.map(row => {
    const data = (row as HTMLElement).dataset;
    const result = { pitch: Number(data.pitch), start: Number(data.start), duration: Number(data.duration), velocity: Number(data.velocity) };
    if (!Object.values(result).every(Number.isFinite)) throw new Error('Proposal rows must expose complete numeric note values.');
    return result;
  }));
}

async function download(page: Page, button: string): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await action(page, button).click();
  return downloadedBytes(await pending);
}

async function generate(page: Page, length = 4): Promise<Omit<Note, 'id'>[]> {
  await page.locator('#continuation-count').fill('8');
  await page.locator('#continuation-length').selectOption(String(length));
  await suggest(page).click();
  await expect(proposalRows(page)).toHaveCount(length);
  return proposedNotes(page);
}

function withoutIds(project: Composition): Omit<Note, 'id'>[] {
  return project.tracks[0].notes.map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity }));
}

test('proposal is transient; real solo audition, apply once, history and decoded exports agree', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installAudioProbe(page);
  const original = phraseFixture();
  await loadFixture(page, original);
  await expect(action(page, 'Undo')).toBeDisabled();
  const proposed = await generate(page);
  await expect(page.locator('.note-event.is-seed')).toHaveCount(8);
  await expect(page.locator('.proposal-note')).toHaveCount(4);
  await expect(page.locator('#continuation-proposal')).toContainText('not saved');
  expect(await savedProject(page)).toEqual(original);
  expect(JSON.parse((await download(page, 'Save project file')).toString('utf8'))).toEqual({
    format: 'melody-studio-project', version: 1,
    document: { schemaVersion: 1, composition: original, references: [] }, assets: [],
  });
  const midiBefore = decodeMidi(await download(page, 'Export MIDI'));
  expect(midiBefore.tracks[1].notes).toEqual(expectedMidiNotes(original.tracks[0].notes));
  const wavBefore = decodeWav(await download(page, 'Export WAV'));
  expect(rmsAt(wavBefore, 2.42)).toBe(0);
  expect(await savedProject(page)).toEqual(original);

  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(1);
  const probe = await audioProbe(page);
  const scratch = probe.requests.filter(request => !request.wav).at(-1)!.project;
  expect(scratch.tracks).toHaveLength(1);
  expect(scratch.tempo).toBe(original.tempo);
  expect(scratch.tracks[0].instrument).toBe('triangle');
  expect(scratch.tracks[0].volume).toBe(0.6);
  const expectedScratch = [...withoutIds(original), ...proposed].map(note => ({ ...note, start: note.start - 2 }));
  expect(withoutIds(scratch)).toEqual(expectedScratch);
  const endingBeat = Math.max(...expectedScratch.map(note => note.start + note.duration));
  expect(probe.starts[0].sampleRate).toBe(22050);
  expect(probe.starts[0].frames).toBe(Math.ceil((endingBeat * 60 / original.tempo + 0.08) * 22050));
  expect(probe.starts[0].peak).toBeGreaterThan(0.01);
  expect(await savedProject(page)).toEqual(original);
  await action(page, 'Stop playback').click();
  await action(page, 'Discard suggestion').click();
  await expect(proposalRows(page)).toHaveCount(0);
  await expect(action(page, 'Undo')).toBeDisabled();
  expect(await savedProject(page)).toEqual(original);

  await suggest(page).click();
  await action(page, 'Another suggestion').click();
  const acceptedNotes = await proposedNotes(page);
  expect(acceptedNotes).toHaveLength(4);
  expect(acceptedNotes.every(note => note.velocity === 0.5)).toBe(true);
  await action(page, 'Apply continuation').evaluate(element => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  const accepted = await savedProject(page);
  expect(accepted.tracks[0].notes).toHaveLength(12);
  expect(accepted.tracks[0].notes.slice(0, 8)).toEqual(original.tracks[0].notes);
  expect(withoutIds(accepted).slice(8)).toEqual(acceptedNotes);
  expect(accepted.tracks[1]).toEqual(original.tracks[1]);
  expect(new Set(accepted.tracks.flatMap(track => [track.id, ...track.notes.map(note => note.id)])).size).toBe(15);
  await expect(proposalRows(page)).toHaveCount(0);
  await action(page, 'Undo').click();
  expect(await savedProject(page)).toEqual(original);
  await expect(action(page, 'Undo')).toBeDisabled();
  await action(page, 'Redo').click();
  expect(await savedProject(page)).toEqual(accepted);
  const midiAfter = decodeMidi(await download(page, 'Export MIDI'));
  expect(midiAfter.ticksPerBeat).toBe(480);
  expect(midiAfter.microsecondsPerBeat).toBe(500000);
  expect(midiAfter.tracks[1].program).toBe(80);
  expect(midiAfter.tracks[1].notes).toEqual(expectedMidiNotes(accepted.tracks[0].notes));
  expect(midiAfter.tracks[2].notes).toEqual(expectedMidiNotes(original.tracks[1].notes));
  const wavAfter = decodeWav(await download(page, 'Export WAV'));
  expect(wavAfter.sampleRate).toBe(22050);
  expect(wavAfter.samples.length).toBe(Math.ceil((10 * 60 / original.tempo + 0.08) * 22050));
  expect(rmsAt(wavAfter, 2.42)).toBeGreaterThan(0.005);
  expect(rmsAt(wavAfter, 3)).toBe(0);
  await page.reload();
  expect(await savedProject(page)).toEqual(accepted);
  await expect(proposalRows(page)).toHaveCount(0);
  await expect(action(page, 'Undo')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('note drafts and invalid seed count survive guards and asynchronous playback redraws', async ({ page }) => {
  await installAudioProbe(page);
  const original = phraseFixture();
  await loadFixture(page, original);
  await generate(page);
  await page.locator('[data-note="phrase-0"]').click();
  await page.getByLabel('Pitch (MIDI)').fill('200');
  await page.getByLabel('Duration (beats)').fill('0');
  for (const button of ['Another suggestion', 'Audition ending + suggestion', 'Apply continuation']) {
    await action(page, button).click();
    await expect(page.locator('#notice')).toContainText('Apply or discard your note edits first');
    await expect(page.getByLabel('Pitch (MIDI)')).toHaveValue('200');
    await expect(page.getByLabel('Duration (beats)')).toHaveValue('0');
    await expect(proposalRows(page)).toHaveCount(4);
    expect(await savedProject(page)).toEqual(original);
  }
  await action(page, 'Discard suggestion').click();
  await page.locator('#continuation-count').fill('7');
  await expect(suggest(page)).toBeDisabled();
  await action(page, 'Play composition').click();
  await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(1);
  await action(page, 'Stop playback').click();
  await expect(page.locator('#continuation-count')).toHaveValue('7');
  await expect(page.getByLabel('Pitch (MIDI)')).toHaveValue('200');
  await expect(page.getByLabel('Duration (beats)')).toHaveValue('0');
  await action(page, 'Discard note edits').click();
  await generate(page);
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(2);
  await page.getByLabel('Velocity').fill('2');
  await expect(action(page, 'Stop playback')).toBeDisabled({ timeout: 8000 });
  await expect(page.getByLabel('Velocity')).toHaveValue('2');
  await expect(proposalRows(page)).toHaveCount(4);
  expect(await savedProject(page)).toEqual(original);
});

test('cancelled native worker replies cannot start sound or cancel a newer render', async ({ page }) => {
  await installAudioProbe(page);
  await loadFixture(page);
  await generate(page);
  await controlProbe(page, 'holdReplies');
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).pendingReplies).toBe(1);
  await action(page, 'Cancel').click();
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).pendingReplies).toBe(2);
  await controlProbe(page, 'releaseNext');
  expect((await audioProbe(page)).starts).toHaveLength(0);
  await action(page, 'Cancel').click();
  await action(page, 'Discard suggestion').click();
  await controlProbe(page, 'releaseAll');
  await expect(action(page, 'Play composition')).toBeEnabled();
  expect((await audioProbe(page)).starts).toHaveLength(0);
  expect(await savedProject(page)).toEqual(phraseFixture());
});

test('discard and stop pending native audition protect subsequent track and project edits', async ({ page }) => {
  await installAudioProbe(page);
  const original = phraseFixture();
  await loadFixture(page, original);
  await generate(page);
  await controlProbe(page, 'holdReplies');
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).pendingReplies).toBe(1);
  await action(page, 'Discard suggestion').click();
  await expect(proposalRows(page)).toHaveCount(0);
  await action(page, 'Select track: Unrelated high accent').click();
  await controlProbe(page, 'releaseNext');
  expect((await audioProbe(page)).starts).toHaveLength(0);
  expect(await savedProject(page)).toEqual(original);
  await action(page, 'Select track: Small steps').click();
  await generate(page);
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).pendingReplies).toBe(1);
  await action(page, 'Stop playback').click();
  await page.getByLabel('Project title').fill('Edited after stop');
  await page.getByLabel('Project title').press('Tab');
  await controlProbe(page, 'releaseNext');
  expect((await audioProbe(page)).starts).toHaveLength(0);
  expect(await savedProject(page)).toEqual({ ...original, title: 'Edited after stop' });
  await generate(page);
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).pendingReplies).toBe(1);
  await action(page, 'Stop playback').click();
  page.once('dialog', dialog => dialog.accept());
  await action(page, 'New project').click();
  await controlProbe(page, 'releaseAll');
  expect((await audioProbe(page)).starts).toHaveLength(0);
  expect((await savedProject(page)).tracks.every(track => track.notes.length === 0)).toBe(true);
  await expect(proposalRows(page)).toHaveCount(0);
});

test('pending native resume and an old source ending cannot replace newer playback', async ({ page }) => {
  await installAudioProbe(page);
  await loadFixture(page);
  await generate(page);
  await controlProbe(page, 'holdResume');
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).pendingResumes).toBe(1);
  await action(page, 'Cancel').click();
  await controlProbe(page, 'releaseResume');
  expect((await audioProbe(page)).requests).toHaveLength(0);
  expect((await audioProbe(page)).starts).toHaveLength(0);
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(1);
  await action(page, 'Stop playback').click();
  await action(page, 'Play composition').click();
  await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(2);
  await controlProbe(page, 'oldEnded');
  await expect(action(page, 'Stop playback')).toBeEnabled();
  await action(page, 'Stop playback').click();
  expect((await audioProbe(page)).stopped).toBeGreaterThanOrEqual(2);
});

test('mobile keyboard proposals respect mute and zero volume without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAudioProbe(page);
  await loadFixture(page);
  await page.getByLabel('Mute track', { exact: true }).check();
  await page.locator('#continuation-length').selectOption('8');
  await suggest(page).focus();
  await page.keyboard.press('Enter');
  await expect(proposalRows(page)).toHaveCount(8);
  await expect(audition(page)).toBeDisabled();
  await expect(page.locator('#continuation-panel')).toContainText('Unmute or raise volume');
  expect((await audioProbe(page)).requests).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Mute track', { exact: true }).uncheck();
  await expect(proposalRows(page)).toHaveCount(0);
  await page.locator('#volume').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#volume')).toHaveValue('0');
  await suggest(page).press('Enter');
  await expect(proposalRows(page)).toHaveCount(8);
  await expect(audition(page)).toBeDisabled();
  await action(page, 'Apply continuation').press('Enter');
  expect((await savedProject(page)).tracks[0].notes).toHaveLength(16);
  expect((await savedProject(page)).tracks[0].volume).toBe(0);
  expect((await audioProbe(page)).starts).toHaveLength(0);
});

test('64-note ending at40 BPM uses the real worker within bounded solo audio', async ({ page }, testInfo) => {
  await installAudioProbe(page);
  const original = phraseFixture(64, 40);
  await loadFixture(page, original);
  await page.locator('#continuation-count').fill('64');
  await page.locator('#continuation-length').selectOption('8');
  const begin = Date.now();
  await suggest(page).click();
  await expect(proposalRows(page)).toHaveCount(8);
  const proposed = await proposedNotes(page);
  const fittedMilliseconds = Date.now() - begin;
  const auditionBegin = Date.now();
  await audition(page).click();
  await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(1);
  const probe = await audioProbe(page);
  const expectedEnd = Math.max(...proposed.map(note => note.start + note.duration));
  expect(probe.starts[0].frames).toBe(Math.ceil((expectedEnd * 1.5 + 0.08) * 22050));
  expect(probe.starts[0].frames).toBeLessThanOrEqual(Math.ceil(48.08 * 22050));
  expect(probe.starts[0].peak).toBeGreaterThan(0.01);
  expect(probe.requests[0].project.tracks).toHaveLength(1);
  await action(page, 'Stop playback').click();
  await testInfo.attach('real-continuation-timing', { contentType: 'application/json', body: JSON.stringify({
    sourceNotes: 64, proposedNotes: 8, tempo: 40, fittedMilliseconds, auditionMilliseconds: Date.now() - auditionBegin,
    frames: probe.starts[0].frames, sampleRate: probe.starts[0].sampleRate,
  }) });
  expect(await savedProject(page)).toEqual(original);
});
