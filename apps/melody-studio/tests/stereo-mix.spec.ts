import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { openRoll, readRoll, rollDownload } from './roll-edit-fixtures.ts';

function wav(bytes: Buffer): { channels: number; frames: number; sample: (frame: number, channel: number) => number } {
  const channels = bytes.readUInt16LE(22), size = bytes.readUInt32LE(40);
  expect(bytes.readUInt32LE(24)).toBe(22050);
  expect(bytes.readUInt16LE(32)).toBe(channels * 2);
  return { channels, frames: size / 2 / channels, sample: (frame, channel) => bytes.readInt16LE(44 + (frame * channels + channel) * 2) };
}
async function slide(page: Page, label: string, value: string): Promise<void> {
  await (label === 'Pan' ? page.getByRole('slider', {name: /^Pan /}) : page.getByLabel(label)).evaluate((input, v) => {
    const range = input as HTMLInputElement; range.value = v;
    range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('pan and reverb send turn the song into a stereo mix with a reverb tail, as undoable saved edits', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: number[] = []; Object.assign(window, { playedChannels: seen });
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>) { if (this.buffer) seen.push(this.buffer.numberOfChannels); return original.apply(this, args); };
  });
  await openRoll(page);
  const before = await readRoll(page), dryBytes = await rollDownload(page, 'Export WAV'), dry = wav(dryBytes);
  expect(dry.channels).toBe(1);
  await expect(page.locator('#mix-format')).toContainText('stay mono');

  // Hard left: the right channel is silent and the left channel is the original mono mix.
  await slide(page, 'Pan', '-1');
  await expect(page.locator('label[for=pan] span')).toHaveText('100% left');
  const panned = await readRoll(page);
  expect(panned.document.composition.tracks[0]!.pan).toBe(-1);
  const unpanned = structuredClone(panned);
  for (const track of unpanned.document.composition.tracks) delete track.pan;
  expect(unpanned).toEqual(before);
  const left = wav(await rollDownload(page, 'Export WAV'));
  expect([left.channels, left.frames]).toEqual([2, dry.frames]);
  for (let frame = 0; frame < dry.frames; frame += 7) { expect(left.sample(frame, 0)).toBe(dry.sample(frame, 0)); expect(left.sample(frame, 1)).toBe(0); }
  await expect(page.locator('#mix-format')).toContainText('stereo');

  // A reverb send adds a tail in both channels.
  await slide(page, 'Reverb send', '0.5');
  await slide(page, 'Reverb size', '0.8');
  const wet = await readRoll(page);
  expect(wet.document.composition.tracks[0]!.reverbSend).toBe(0.5);
  expect(wet.document.composition.reverb).toEqual({ size: 0.8, level: 0.5 });
  const reverb = wav(await rollDownload(page, 'Export WAV'));
  // The tail is added before rounding to frames, so allow the one-frame rounding difference.
  expect(Math.abs(reverb.frames - (dry.frames + (0.75 + 3.25 * 0.8) * 22050))).toBeLessThanOrEqual(1);
  let tail = 0;
  for (let frame = dry.frames; frame < reverb.frames; frame++) tail += Math.abs(reverb.sample(frame, 1));
  expect(tail).toBeGreaterThan(1000);

  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Playing your composition');
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { playedChannels: number[] }).playedChannels)).toEqual([2]);

  // Each slider change is one edit: three Undos restore the original mono project and WAV bytes.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await readRoll(page)).toEqual(before);
  expect(await rollDownload(page, 'Export WAV')).toEqual(dryBytes);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await readRoll(page)).toEqual(wet);
  // The saved study keeps the mix across a reload.
  await expect(page.locator('#save-status')).toContainText(/Saved/);
  await page.reload();
  await expect(page.getByLabel('Reverb send')).toHaveValue('0.5');
  await expect(page.getByRole('slider', {name: /^Pan /})).toHaveValue('-1');
});

test('mix controls fit a phone screen and centring removes the field again', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoll(page);
  const before = await readRoll(page);
  await slide(page, 'Pan', '0.25');
  await expect(page.locator('label[for=pan] span')).toHaveText('25% right');
  await slide(page, 'Pan', '0');
  await expect(page.locator('label[for=pan] span')).toHaveText('Centre');
  expect((await readRoll(page)).document.composition).toEqual(before.document.composition);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
