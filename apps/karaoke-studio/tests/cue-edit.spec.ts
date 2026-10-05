import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function audioFixture(): Buffer {
  const frames = 6 * 44100, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(176400, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    const sample = Math.round(Math.sin(2 * Math.PI * 330 * frame / 44100) * 3000);
    bytes.writeInt16LE(sample, 44 + frame * 4); bytes.writeInt16LE(sample, 46 + frame * 4);
  }
  return bytes;
}
async function open(page: Page, text = 'First 🌓 phrase\nNext 🎵') {
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles({ name: 'original-cue-edit.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('#message')).toContainText('Your stems are ready', { timeout: 15000 });
  await expect.poll(() => page.locator('audio').evaluate(node => (node as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.getByLabel('Paste lyrics, one line per cue').fill(text);
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
}
async function seek(page: Page, time: number) {
  await page.locator('audio').evaluate((node, time) => { (node as HTMLAudioElement).currentTime = time; }, time);
  await expect.poll(() => page.locator('audio').evaluate(node => (node as HTMLAudioElement).currentTime)).toBeCloseTo(time, 3);
}
async function caret(page: Page, position: number, end = position) {
  await page.getByLabel('Lyric line 1', { exact: true }).evaluate((node, range) => {
    const text = node as HTMLTextAreaElement; text.focus(); text.setSelectionRange(range[0], range[1]);
  }, [position, end]);
}

test('literal split and gap merge are one-edit history changes with exact saved/reopened SRT', async ({ page }) => {
  await open(page);
  await page.getByLabel('Clip title').fill('Original split study');
  for (const [field, value] of [['Start line 1', '0.250'], ['End line 1', '4.000'], ['Start line 2', '5.000'], ['End line 2', '6.000']]) {
    await page.getByLabel(field, { exact: true }).fill(value);
  }
  await seek(page, 2.125); await caret(page, 8);
  await expect(page.getByRole('button', { name: 'Split at caret and playhead line 1', exact: true })).toBeVisible({ timeout: 1000 });
  await page.getByRole('button', { name: 'Split at caret and playhead line 1', exact: true }).click();
  await expect(page.locator('[data-cue]')).toHaveCount(3);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('First 🌓');
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue(' phrase');
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.250');
  await expect(page.getByLabel('End line 2', { exact: true })).toHaveValue('4.000');
  await expect(page.getByLabel('Start line 3', { exact: true })).toHaveValue('5.000');
  await page.getByRole('button', { name: 'Merge with next line 2', exact: true }).click();
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue(' phrase\nNext 🎵');
  await expect(page.getByLabel('End line 2', { exact: true })).toHaveValue('6.000');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.locator('[data-cue]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.locator('[data-cue]')).toHaveCount(2);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('First 🌓 phrase');
  await expect(page.getByLabel('End line 1', { exact: true })).toHaveValue('4.000');
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('First 🌓 phrase\nNext 🎵');
  await expect(page.getByLabel('Clip title')).toHaveValue('Original split study');
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  const id = new URL(page.url()).searchParams.get('project')!;
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(saved.cues).toEqual([{ start: .25, end: 2.125, text: 'First 🌓' }, { start: 2.125, end: 6, text: ' phrase\nNext 🎵' }]);
  await page.reload();
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue(' phrase\nNext 🎵');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click()]);
  expect(await readFile((await download.path())!, 'utf8')).toBe('1\n00:00:00,250 --> 00:00:02,125\nFirst 🌓\n\n2\n00:00:02,125 --> 00:00:06,000\n phrase\nNext 🎵\n');
});

test('invalid caret, raw timings and oversized merge leave drafts and history intact', async ({ page }) => {
  await open(page);
  await seek(page, 1); await caret(page, 7);
  await page.getByRole('button', { name: 'Split at caret and playhead line 1', exact: true }).click();
  await expect(page.locator('#message')).toContainText('code point');
  await expect(page.locator('[data-cue]')).toHaveCount(2);
  await caret(page, 1, 4);
  await page.getByRole('button', { name: 'Split at caret and playhead line 1', exact: true }).click();
  await expect(page.locator('#message')).toContainText('caret');
  await page.getByLabel('Start line 2', { exact: true }).fill('');
  await page.getByLabel('Paste lyrics, one line per cue').fill('New uncommitted pasted words');
  await caret(page, 8);
  await page.getByRole('button', { name: 'Split at caret and playhead line 1', exact: true }).click();
  await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('New uncommitted pasted words');
  // Failed action adds no history state: undo returns to before the pasted draft.
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('First 🌓 phrase\nNext 🎵');
  await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('');
  await page.getByLabel('Start line 2', { exact: true }).fill('3');
  await page.getByLabel('Lyric line 1', { exact: true }).fill('🌓'.repeat(120));
  await page.getByLabel('Lyric line 2', { exact: true }).fill('x'.repeat(120));
  await page.getByRole('button', { name: 'Merge with next line 1', exact: true }).click();
  await expect(page.locator('#message')).toContainText('240');
  await expect(page.locator('[data-cue]')).toHaveCount(2);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('🌓'.repeat(120));
});

test('complete 200-cue project refuses split, admits a deliberate merge and restores all cues on undo', async ({ page }) => {
  await open(page, Array.from({ length: 200 }, () => 'a b').join('\n'));
  await seek(page, .015); await caret(page, 1);
  await page.getByRole('button', { name: 'Split at caret and playhead line 1', exact: true }).click();
  await expect(page.locator('#message')).toContainText('200');
  await expect(page.locator('[data-cue]')).toHaveCount(200);
  await page.getByRole('button', { name: 'Merge with next line 1', exact: true }).click();
  await expect(page.locator('[data-cue]')).toHaveCount(199);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('a b\na b');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.locator('[data-cue]')).toHaveCount(200);
});

test('reopened literal CRLF cue translates native textarea caret without altering words', async ({ page }) => {
  await open(page);
  const id = new URL(page.url()).searchParams.get('project')!;
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  const session = await (await page.request.get('/api/session')).json();
  const response = await page.request.put(`/api/projects/${id}`, {
    headers: { 'X-Karaoke-Token': session.token },
    data: { title: 'Literal CRLF cue', revision: saved.revision, cues: [{ start: .25, end: 4, text: 'a\r\n🌓b' }] },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('a\n🌓b');
  await expect.poll(() => page.locator('audio').evaluate(node => (node as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  await seek(page, 2); await caret(page, 4);
  await page.getByRole('button', { name: 'Split at caret and playhead line 1', exact: true }).click();
  await expect(page.locator('[data-cue]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).cues).toEqual([
    { start: .25, end: 2, text: 'a\r\n🌓' }, { start: 2, end: 4, text: 'b' },
  ]);
});
