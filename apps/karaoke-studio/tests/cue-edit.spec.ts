import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// The suite shares one bounded service library. Release only this case's own
// created clip so new coverage cannot consume slots used by unchanged cases.
test.afterEach(async ({ page, request }) => {
  const id = new URL(page.url()).searchParams.get('project');
  if (!id) return;
  const session = await (await request.get('/api/session')).json();
  const response = await request.delete(`/api/projects/${id}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} });
  expect(response.ok()).toBe(true);
});

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

async function timingEditor(page: Page) {
  return page.evaluate(() => ({ title: (document.querySelector('#title') as HTMLInputElement).value,
    paste: (document.querySelector('#lyric-draft') as HTMLTextAreaElement).value,
    fields: [...document.querySelectorAll('#cue-list input,#cue-list textarea')].map(n => (n as HTMLInputElement).value) }));
}

test('whole-clip shift preserves words gaps raw history and drafts before deliberate save and SRT export', async ({ page }) => {
  await open(page);
  const id = new URL(page.url()).searchParams.get('project')!;
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  for (const [label, value] of [['Start line 1', '1.000'], ['End line 1', '2.000'], ['Start line 2', '3.500'], ['End line 2', '4.750']]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('Clip title', { exact: true }).fill('Shifted study');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied words kept');
  const before = await timingEditor(page);
  await page.getByText('Shift lyric timing', { exact: true }).click();
  const shift = page.getByLabel('Timing shift (seconds)', { exact: true }); await expect(shift).toBeVisible();
  await shift.fill('+0.25');
  await page.getByRole('button', { name: 'Shift all lyric times', exact: true }).click();
  for (const [label, value] of [['Start line 1', '1.25'], ['End line 1', '2.25'], ['Start line 2', '3.75'], ['End line 2', '5']]) await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('First 🌓 phrase');
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('Next 🎵');
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); expect(await timingEditor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('1.25');
  await page.getByRole('button', { name: 'Discard pasted draft', exact: true }).click();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click();
  const srt = await readFile((await (await download).path())!, 'utf8');
  expect(srt).toContain('00:00:01,250 --> 00:00:02,250'); expect(srt).toContain('00:00:03,750 --> 00:00:05,000');
  await page.reload();
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('1.25');
  await expect(page.getByLabel('End line 2', { exact: true })).toHaveValue('5');
  await page.getByText('Shift lyric timing', { exact: true }).click(); await expect(shift).toHaveValue('');
});

test('refused shifts preserve native playback and pending import while a valid shift retires both', async ({ page }) => {
  await open(page);
  for (const [label, value] of [['Start line 1', '0'], ['End line 1', '2'], ['Start line 2', '3.5'], ['End line 2', '4.75']]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('Import timed lyrics (SRT)', { exact: true }).setInputFiles({ name: 'pending.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,500 --> 00:00:01,500\nPending imported words\n') });
  await expect(page.locator('#srt-review')).toBeVisible();
  await page.getByRole('button', { name: 'Repeat range', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await expect(page.getByRole('button', { name: 'Pause practice', exact: true })).toBeEnabled();
  const before = await timingEditor(page);
  await page.getByText('Shift lyric timing', { exact: true }).click();
  const shift = page.getByLabel('Timing shift (seconds)', { exact: true });
  for (const value of ['', '0', 'oops', 'Infinity', '1e-20', '-1.01', '1.26']) {
    await shift.fill(value); await page.getByRole('button', { name: 'Shift all lyric times', exact: true }).click();
    await expect(shift).toHaveValue(value);
    await expect(page.locator('#timing-shift-status')).not.toHaveText('');
    expect(await timingEditor(page)).toEqual(before); await expect(page.locator('#srt-review')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause practice', exact: true })).toBeEnabled();
    await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  }
  await shift.fill('.25'); await page.getByRole('button', { name: 'Shift all lyric times', exact: true }).click();
  await expect(page.locator('#srt-review')).toBeHidden();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.25');
});

test('phone keyboard shift keeps an invalid title and refuses incomplete timing without consuming Redo', async ({ page }) => {
  await open(page); await page.setViewportSize({ width: 390, height: 844 });
  for (const [label, value] of [['Start line 1', '1.000'], ['End line 1', '2.000'], ['Start line 2', '3.500'], ['End line 2', '4.750']]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('Clip title', { exact: true }).fill('');
  const before = await timingEditor(page);
  await page.getByText('Shift lyric timing', { exact: true }).click();
  const shift = page.getByLabel('Timing shift (seconds)', { exact: true }); await shift.fill('-.5');
  const apply = page.getByRole('button', { name: 'Shift all lyric times', exact: true }); await apply.focus(); await apply.press('Enter');
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.5');
  await expect(page.getByLabel('End line 2', { exact: true })).toHaveValue('4.25');
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); expect(await timingEditor(page)).toEqual(before);
  await shift.fill('0'); await apply.click();
  await expect(page.getByRole('button', { name: 'Redo lyric edit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await page.getByLabel('Start line 1', { exact: true }).fill('');
  const invalid = await timingEditor(page); await shift.fill('.25'); await apply.click();
  expect(await timingEditor(page)).toEqual(invalid);
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('');
});

async function passageFixture(page: Page) {
  await open(page, 'Keep 🌓\nVerse A\nVerse B\nFinal 🎵');
  for (const [label, value] of [['Start line 1', '0.000'], ['End line 1', '0.500'], ['Start line 2', '1.000'], ['End line 2', '1.500'], ['Start line 3', '2.000'], ['End line 3', '2.500'], ['Start line 4', '4.000'], ['End line 4', '5.000']]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByText('Shift lyric timing', { exact: true }).click();
  await page.getByLabel('Timing shift scope', { exact: true }).selectOption('passage');
  await selectPassage(page, '1', '2');
  await page.getByLabel('Timing shift (seconds)', { exact: true }).fill('+.25');
}
async function selectPassage(page: Page, first: string, last: string) {
  await page.getByLabel('First line in passage', { exact: true }).selectOption(first);
  await page.getByLabel('Last line in passage', { exact: true }).selectOption(last);
}
const passageApply = (page: Page) => page.getByRole('button', { name: 'Shift selected lyric times', exact: true });

test('selected passage preserves outside raw times drafts history saved reload and SRT', async ({ page }) => {
  await passageFixture(page);
  const id = new URL(page.url()).searchParams.get('project')!, saved = await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByLabel('Clip title', { exact: true }).fill('Passage study');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied words 🌓');
  const before = await timingEditor(page);
  await expect(page.locator('#timing-shift-range-summary')).toContainText('Lines 2–3'); await passageApply(page).click();
  for (const [label, value] of [['Start line 1', '0.000'], ['End line 1', '0.500'], ['Start line 2', '1.25'], ['End line 2', '1.75'], ['Start line 3', '2.25'], ['End line 3', '2.75'], ['Start line 4', '4.000'], ['End line 4', '5.000']]) await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  await expect(page.locator('#timing-shift-status')).toContainText('lines 2–3');
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); expect(await timingEditor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click(); await expect(page.getByLabel('Start line 4', { exact: true })).toHaveValue('4.000');
  await page.getByRole('button', { name: 'Discard pasted draft', exact: true }).click(); await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click();
  const srt = await readFile((await (await download).path())!, 'utf8');
  for (const interval of ['00:00:00,000 --> 00:00:00,500', '00:00:01,250 --> 00:00:01,750', '00:00:02,250 --> 00:00:02,750', '00:00:04,000 --> 00:00:05,000']) expect(srt).toContain(interval);
  await page.reload(); await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('1.25');
  await page.getByText('Shift lyric timing', { exact: true }).click(); await expect(page.getByLabel('Timing shift scope', { exact: true })).toHaveValue('all');
});

test('passage refusals keep playback import editor and Redo until a valid application', async ({ page }) => {
  await passageFixture(page); await passageApply(page).click(); await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); await selectPassage(page, '1', '2');
  await page.getByLabel('Import timed lyrics (SRT)', { exact: true }).setInputFiles({ name: 'pending.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,500 --> 00:00:01,500\nPending imported words\n') });
  await expect(page.locator('#srt-review')).toBeVisible(); await page.getByRole('button', { name: 'Repeat range', exact: true }).click();
  const before = await timingEditor(page);
  for (const delta of ['-.501', '1.501', '0', 'NaN']) {
    await page.getByLabel('Timing shift (seconds)', { exact: true }).fill(delta); await passageApply(page).click();
    expect(await timingEditor(page)).toEqual(before); await expect(page.locator('#srt-review')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Redo lyric edit', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Pause practice', exact: true })).toBeEnabled();
  }
  await page.getByLabel('Timing shift (seconds)', { exact: true }).fill('.25');
  for (const [first, last] of [['2', '1'], ['', '2']]) {
    await selectPassage(page, first, last); await passageApply(page).click(); expect(await timingEditor(page)).toEqual(before);
    await expect(page.locator('#srt-review')).toBeVisible();
  }
  await selectPassage(page, '1', '2'); await passageApply(page).click(); await expect(page.locator('#srt-review')).toBeHidden();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
});

test('changed cue structure requires passage reselection before shifting', async ({ page }) => {
  await passageFixture(page); await page.getByRole('button', { name: 'Merge with next line 1', exact: true }).click();
  for (const label of ['First line in passage', 'Last line in passage']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  const before = await timingEditor(page); await passageApply(page).click(); expect(await timingEditor(page)).toEqual(before);
  await expect(page.locator('#timing-shift-status')).toContainText('Choose');
  await selectPassage(page, '1', '1'); await passageApply(page).click(); await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('2.25');
});

test('phone keyboard shifts one passage line while preserving its neighbors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await passageFixture(page); await selectPassage(page, '1', '1');
  await page.getByLabel('Timing shift (seconds)', { exact: true }).fill('-.5'); await passageApply(page).focus(); await passageApply(page).press('Enter');
  await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('0.5'); await expect(page.getByLabel('Start line 3', { exact: true })).toHaveValue('2.000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/karaoke294-phone.png', fullPage: true });
});
