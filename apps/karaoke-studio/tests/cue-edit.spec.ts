import { downloaded, checkTimingVideo } from './sequential-timing-fixtures.ts';
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
  await page.getByRole('combobox', { name: 'Timing shift scope', exact: true }).selectOption('passage');
  await selectPassage(page, '1', '2');
  await page.getByLabel('Timing shift (seconds)', { exact: true }).fill('+.25');
}
async function selectPassage(page: Page, first: string, last: string) {
  await page.getByRole('combobox', { name: 'First line in passage', exact: true }).selectOption(first);
  await page.getByRole('combobox', { name: 'Last line in passage', exact: true }).selectOption(last);
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
  for (const name of ['First line in passage', 'Last line in passage']) await expect(page.getByRole('combobox', { name, exact: true })).toHaveValue('');
  await selectPassage(page, '0', '1');
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  for (const name of ['First line in passage', 'Last line in passage']) await expect(page.getByRole('combobox', { name, exact: true })).toHaveValue('');
  await expect(page.getByLabel('Start line 4', { exact: true })).toHaveValue('4.000');
  await page.getByRole('button', { name: 'Discard pasted draft', exact: true }).click(); await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click();
  const srt = await readFile((await (await download).path())!, 'utf8');
  for (const interval of ['00:00:00,000 --> 00:00:00,500', '00:00:01,250 --> 00:00:01,750', '00:00:02,250 --> 00:00:02,750', '00:00:04,000 --> 00:00:05,000']) expect(srt).toContain(interval);
  await page.reload(); await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('1.25');
  await page.getByText('Shift lyric timing', { exact: true }).click(); await expect(page.getByRole('combobox', { name: 'Timing shift scope', exact: true })).toHaveValue('all');
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
  for (const label of ['First line in passage', 'Last line in passage']) await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveValue('');
  const before = await timingEditor(page); await passageApply(page).click(); expect(await timingEditor(page)).toEqual(before);
  await expect(page.locator('#timing-shift-status')).toContainText('Choose');
  await selectPassage(page, '1', '1'); await passageApply(page).click(); await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('2.25');
});

test('phone keyboard shifts one passage line while preserving its neighbors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await passageFixture(page); await selectPassage(page, '1', '1');
  await page.getByLabel('Timing shift (seconds)', { exact: true }).fill('-.5'); await passageApply(page).focus(); await passageApply(page).press('Enter');
  await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('0.5'); await expect(page.getByLabel('Start line 3', { exact: true })).toHaveValue('2.000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.timing-shift').screenshot({ path: '/tmp/karaoke294-phone.png' });
});


test('same-length cue replacement cannot reuse a previous passage selection', async ({ page }) => {
  await passageFixture(page);
  const srt = '1\n00:00:00,000 --> 00:00:00,500\nReplacement one\n\n2\n00:00:01,000 --> 00:00:01,500\nReplacement two\n\n3\n00:00:02,000 --> 00:00:02,500\nReplacement three\n\n4\n00:00:04,000 --> 00:00:05,000\nReplacement four\n';
  await page.getByLabel('Import timed lyrics (SRT)', { exact: true }).setInputFiles({ name: 'replacement.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await expect(page.locator('#srt-review')).toBeVisible(); await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.locator('[data-cue]')).toHaveCount(4);
  for (const name of ['First line in passage', 'Last line in passage']) await expect(page.getByRole('combobox', { name, exact: true })).toHaveValue('');
  const before = await timingEditor(page); await passageApply(page).click(); expect(await timingEditor(page)).toEqual(before);
  await selectPassage(page, '1', '1'); await passageApply(page).click();
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('Replacement two');
  await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('1.25');
});

test('copy passage preserves raw outside timing and supports atomic refusals history save reopen and SRT', async ({ page }) => {
  await passageFixture(page); await selectPassage(page, '1', '1');
  const destination = page.getByLabel('Copy passage to (seconds)', { exact: true }), copy = page.getByRole('button', { name: 'Copy selected passage', exact: true });
  const before = await timingEditor(page);
  for (const value of ['', '1.25', '5.75', '-1']) {
    await destination.fill(value); await copy.click();
    expect(await timingEditor(page)).toEqual(before);
    await expect(page.locator('#passage-copy-status')).toContainText('kept');
  }
  await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied 🌓');
  const beforeCopy = await timingEditor(page);
  await destination.fill('3'); await copy.click();
  await expect(page.getByLabel('Lyric line 4', { exact: true })).toHaveValue('Verse A');
  await expect(page.getByLabel('Start line 4', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('End line 4', { exact: true })).toHaveValue('3.5');
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.000');
  await expect(page.getByLabel('Start line 5', { exact: true })).toHaveValue('4.000');
  await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('Unapplied 🌓');
  for (const name of ['First line in passage', 'Last line in passage']) await expect(page.getByRole('combobox', { name, exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  expect(await timingEditor(page)).toEqual(beforeCopy);
  await selectPassage(page, '1', '1'); await destination.fill('1'); await copy.click();
  await expect(page.getByRole('button', { name: 'Redo lyric edit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Lyric line 4', { exact: true })).toHaveValue('Verse A');
  await page.getByRole('button', { name: 'Discard pasted draft', exact: true }).click();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click();
  const srt = await readFile((await (await download).path())!, 'utf8');
  expect(srt).toContain('00:00:03,000 --> 00:00:03,500\nVerse A');
  expect(srt.match(/Verse A/g)).toHaveLength(2);
  await page.reload(); await expect(page.getByLabel('Start line 4', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Lyric line 5', { exact: true })).toHaveValue('Final 🎵');
});

test('phone keyboard copies a multi-line chorus with internal gaps and only valid copy retires playback and import', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await passageFixture(page);
  await page.getByLabel('End line 4', { exact: true }).fill('6.000');
  await page.getByLabel('Start line 4', { exact: true }).fill('5.000');
  await page.getByLabel('Import timed lyrics (SRT)', { exact: true }).setInputFiles({ name: 'pending.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,500 --> 00:00:01,500\nPending words\n') });
  await expect(page.locator('#srt-review')).toBeVisible();
  await page.getByRole('button', { name: 'Repeat range', exact: true }).click();
  const destination = page.getByLabel('Copy passage to (seconds)', { exact: true }), copy = page.getByRole('button', { name: 'Copy selected passage', exact: true }), before = await timingEditor(page);
  await destination.fill('4'); await copy.click(); expect(await timingEditor(page)).toEqual(before);
  await expect(page.locator('#srt-review')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause practice', exact: true })).toBeEnabled();
  await destination.fill('3'); await copy.focus(); await copy.press('Enter');
  await expect(page.locator('#srt-review')).toBeHidden();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  for (const [label, value] of [['Start line 4', '3'], ['End line 4', '3.5'], ['Start line 5', '4'], ['End line 5', '4.5'], ['Start line 6', '5.000'], ['End line 6', '6.000']]) await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  await expect(page.getByLabel('Lyric line 4', { exact: true })).toHaveValue('Verse A');
  await expect(page.getByLabel('Lyric line 5', { exact: true })).toHaveValue('Verse B');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('find navigation preserves raw drafts nodes review and history while focusing repeated Unicode lyrics', async ({ page }) => {
  await open(page, 'Café 🌓\n[chorus]\ncAFÉ 🌓 again');
  await page.getByLabel('Clip title', { exact: true }).fill('');
  await page.getByLabel('Start line 1', { exact: true }).fill('');
  await page.getByLabel('End line 3', { exact: true }).fill('6.000');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied words');
  await page.getByLabel('Import timed lyrics (SRT)', { exact: true }).setInputFiles({ name: 'pending.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,500 --> 00:00:01,500\nPending words\n') });
  await expect(page.locator('#srt-review')).toBeVisible();
  const before = await timingEditor(page), node = await page.getByLabel('Lyric line 1', { exact: true }).elementHandle();
  const undo = await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).isEnabled();
  await page.getByText('Find lyric line', { exact: true }).click();
  const query = page.getByLabel('Find words in lyrics', { exact: true }); await query.fill('café 🌓');
  await expect(page.locator('#lyric-find-status')).toContainText('2 matching');
  await query.press('Enter'); await expect(page.getByLabel('Lyric line 1', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Next lyric match', exact: true }).click(); await expect(page.getByLabel('Lyric line 3', { exact: true })).toBeFocused();
  await query.focus(); await query.press('Shift+Enter'); await expect(page.getByLabel('Lyric line 1', { exact: true })).toBeFocused();
  expect(await timingEditor(page)).toEqual(before); expect(await node!.evaluate(e => e.isConnected)).toBe(true);
  expect(await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).isEnabled()).toBe(undo);
  await expect(page.locator('#srt-review')).toBeVisible(); await expect(page.getByRole('button', { name: 'Play lyric match', exact: true })).toBeDisabled();
  await query.fill('.*'); await expect(page.locator('#lyric-find-status')).toContainText('No matching');
  await expect(page.getByRole('button', { name: 'Next lyric match', exact: true })).toBeDisabled();
  await query.fill('[chorus]'); await query.press('Enter'); await expect(page.getByLabel('Lyric line 2', { exact: true })).toBeFocused();
});

test('phone lyric find only starts native practice through explicit Play and tracks live corrections', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await open(page, 'First\nMiddle\nFinal chorus');
  await page.getByText('Find lyric line', { exact: true }).click();
  const query = page.getByLabel('Find words in lyrics', { exact: true }); await query.fill('FINAL'); await query.press('Enter');
  await expect(page.getByLabel('Lyric line 3', { exact: true })).toBeFocused();
  expect(await page.locator('audio').evaluate(e => ({ paused: (e as HTMLAudioElement).paused, time: (e as HTMLAudioElement).currentTime }))).toEqual({ paused: true, time: 0 });
  await page.getByRole('button', { name: 'Play lyric match', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(e => (e as HTMLAudioElement).paused)).toBe(false);
  expect(await page.locator('audio').evaluate(e => (e as HTMLAudioElement).currentTime)).toBeGreaterThanOrEqual(4);
  await query.fill('not present'); await expect(page.locator('#lyric-find-status')).toContainText('No matching');
  await expect(page.getByRole('button', { name: 'Pause practice', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop practice', exact: true }).click();
  await query.fill('FINAL'); await query.press('Enter'); await page.getByLabel('Lyric line 3', { exact: true }).fill('Changed words');
  await expect(page.locator('#lyric-find-status')).toContainText('No matching');
  await expect(page.getByRole('button', { name: 'Play lyric match', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('find selection retires across Undo Redo and another clip while the same-clip query stays useful', async ({ page }) => {
  await open(page, 'Chorus first\nOther\nChorus final');
  const firstId = new URL(page.url()).searchParams.get('project')!;
  await page.getByText('Find lyric line', { exact: true }).click();
  const query = page.getByLabel('Find words in lyrics', { exact: true }), play = page.getByRole('button', { name: 'Play lyric match', exact: true });
  await query.fill('chorus'); await query.press('Enter');
  await page.getByLabel('Lyric line 1', { exact: true }).fill('Changed');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(query).toHaveValue('chorus'); await expect(page.locator('#lyric-find-status')).toContainText('2 matching'); await expect(play).toBeDisabled();
  await query.press('Enter'); await expect(page.getByLabel('Lyric line 1', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click(); await expect(play).toBeDisabled();
  await page.getByRole('button', { name: 'Next lyric match', exact: true }).click(); await expect(page.getByLabel('Lyric line 3', { exact: true })).toBeFocused();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Upload song clip').setInputFiles({ name: 'another-find-clip.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect.poll(() => new URL(page.url()).searchParams.get('project')).not.toBe(firstId);
  await expect(query).toHaveValue(''); await expect(play).toBeDisabled();
  const session = await (await page.request.get('/api/session')).json();
  expect((await page.request.delete(`/api/projects/${firstId}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} })).ok()).toBe(true);
});

const fitStart = (page: Page) => page.getByLabel('Fit passage start (seconds)', { exact: true });
const fitEnd = (page: Page) => page.getByLabel('Fit passage end (seconds)', { exact: true });
const fitApply = (page: Page) => page.getByRole('button', { name: 'Fit selected passage timing', exact: true });
test('fit a passage proportionally preserves raw neighbors one-edit history saved SRT video and reload', async ({ page }, info) => {
  test.setTimeout(60000); await passageFixture(page); await expect(fitStart(page)).toBeVisible();
  const id = new URL(page.url()).searchParams.get('project')!, saved = await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByLabel('Clip title', { exact: true }).fill('Fitted passage'); await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied literal words 🌓'); const before = await timingEditor(page);
  await fitStart(page).fill('.5'); await fitEnd(page).fill('3.5'); await fitApply(page).click();
  for (const [label, value] of [['Start line 1','0.000'],['End line 1','0.500'],['Start line 2','0.5'],['End line 2','1.500'],['Start line 3','2.5'],['End line 3','3.5'],['Start line 4','4.000'],['End line 4','5.000']]) await expect(page.getByLabel(label,{exact:true})).toHaveValue(value);
  await expect(page.locator('#passage-fit-status')).toContainText('one unsaved edit'); expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved); const after = await timingEditor(page);
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click(); expect(await timingEditor(page)).toEqual(before); await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click(); expect(await timingEditor(page)).toEqual(after);
  await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
  const current=await(await page.request.get(`/api/projects/${id}`)).json();expect(current.cues.map((c:{start:number;end:number})=>[c.start,c.end])).toEqual([[0,.5],[.5,1.5],[2.5,3.5],[4,5]]);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export timed lyrics',exact:true}).click();const srt=await readFile((await(await pending).path())!,'utf8');for(const interval of ['00:00:00,500 --> 00:00:01,500','00:00:02,500 --> 00:00:03,500'])expect(srt).toContain(interval);
  const path=info.outputPath('fitted-passage.mp4');await downloaded(page,'Export karaoke MP4',path);await checkTimingVideo(path,current.cues);
  await page.reload();await expect(page.getByLabel('Start line 2',{exact:true})).toHaveValue('0.5');await page.getByText('Shift lyric timing',{exact:true}).click();await page.getByRole('combobox',{name:'Timing shift scope',exact:true}).selectOption('passage');await expect(fitStart(page)).toHaveValue('');await expect(fitEnd(page)).toHaveValue('');
});

test('fit refusals preserve exact editor raw fields listening review and Redo until valid apply', async ({ page }) => {
  await passageFixture(page);await passageApply(page).click();await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();await selectPassage(page,'1','2');
  await page.getByLabel('Import timed lyrics (SRT)',{exact:true}).setInputFiles({name:'pending-fit.srt',mimeType:'application/x-subrip',buffer:Buffer.from('1\n00:00:00,500 --> 00:00:01,500\nPending words\n')});await expect(page.locator('#srt-review')).toBeVisible();await page.getByRole('button',{name:'Repeat range',exact:true}).click();const before=await timingEditor(page);
  for(const [start,end]of[['','3.5'],['NaN','3.5'],['0','3.5'],['1','4.1'],['1','2.5']]){await fitStart(page).fill(start);await fitEnd(page).fill(end);await fitApply(page).click();await expect(page.locator('#passage-fit-status')).toContainText('kept');await expect(fitStart(page)).toHaveValue(start);expect(await timingEditor(page)).toEqual(before);await expect(page.locator('#srt-review')).toBeVisible();await expect(page.getByRole('button',{name:'Redo lyric edit',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Pause practice',exact:true})).toBeEnabled();}
  await fitStart(page).fill('.5');await fitEnd(page).fill('3.5');await selectPassage(page,'2','1');await fitApply(page).click();expect(await timingEditor(page)).toEqual(before);await expect(page.locator('#srt-review')).toBeVisible();await selectPassage(page,'1','2');await fitApply(page).click();await expect(page.locator('#srt-review')).toBeHidden();await expect(page.getByRole('button',{name:'Pause practice',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Redo lyric edit',exact:true})).toBeDisabled();
});
test('phone keyboard fits one line and stale selection or invalid source cannot mutate neighbors', async ({ page }) => {
  await page.setViewportSize({width:390,height:740});await passageFixture(page);await selectPassage(page,'1','1');await fitStart(page).fill('.75');await fitEnd(page).fill('1.75');await fitApply(page).focus();await fitApply(page).press('Enter');await expect(page.getByLabel('Start line 2',{exact:true})).toHaveValue('0.75');await expect(page.getByLabel('End line 2',{exact:true})).toHaveValue('1.75');await expect(page.getByLabel('Start line 3',{exact:true})).toHaveValue('2.000');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Merge with next line 1',exact:true}).click();for(const name of['First line in passage','Last line in passage'])await expect(page.getByRole('combobox',{name,exact:true})).toHaveValue('');const before=await timingEditor(page);await fitApply(page).click();await expect(page.locator('#passage-fit-status')).toContainText('Choose');expect(await timingEditor(page)).toEqual(before);await selectPassage(page,'1','1');await page.getByLabel('Start line 1',{exact:true}).fill('');const invalid=await timingEditor(page);await fitApply(page).click();expect(await timingEditor(page)).toEqual(invalid);await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('');
});

test('a precision-collapsed positive gap refuses before editor or pending review changes', async ({ page }) => {
  await passageFixture(page);for(const [name,value]of[['End line 2','2.000'],['Start line 3','2.0000000000000004'],['End line 3','3.000']])await page.getByLabel(name,{exact:true}).fill(value);
  await page.getByLabel('Import timed lyrics (SRT)',{exact:true}).setInputFiles({name:'precision-review.srt',mimeType:'application/x-subrip',buffer:Buffer.from('1\n00:00:00,500 --> 00:00:01,500\nKeep this review\n')});await expect(page.locator('#srt-review')).toBeVisible();await fitStart(page).fill('2');await fitEnd(page).fill('3');const before=await timingEditor(page);await fitApply(page).click();await expect(page.locator('#passage-fit-status')).toContainText('positive lyric gap');expect(await timingEditor(page)).toEqual(before);await expect(page.locator('#srt-review')).toBeVisible();await expect(fitStart(page)).toHaveValue('2');await expect(fitEnd(page)).toHaveValue('3');
});

test('remove passage preserves raw survivors history saved state and exported SRT',async({page})=>{
 await passageFixture(page);const remove=page.getByRole('button',{name:'Remove selected lyric lines',exact:true});
 await page.getByLabel('Clip title').fill('Removed passage');await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied 🌓');
 const before=await timingEditor(page),id=new URL(page.url()).searchParams.get('project')!,saved=await(await page.request.get(`/api/projects/${id}`)).json();
 await remove.click();await expect(page.locator('#passage-remove-status')).toContainText('Removed 2 lyric lines as one unsaved edit');await expect(page.locator('[data-cue]')).toHaveCount(2);await expect(page.getByLabel('Start line 2',{exact:true})).toHaveValue('4.000');await expect(page.getByLabel('End line 2',{exact:true})).toHaveValue('5.000');
 expect(await(await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);const after=await timingEditor(page);
 await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await timingEditor(page)).toEqual(before);await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();expect(await timingEditor(page)).toEqual(after);
 await expect(page.getByRole('combobox',{name:'First line in passage',exact:true})).toHaveValue('');await remove.click();expect(await timingEditor(page)).toEqual(after);
 await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
 const current=await(await page.request.get(`/api/projects/${id}`)).json();expect(current.cues).toEqual([{start:0,end:.5,text:'Keep 🌓'},{start:4,end:5,text:'Final 🎵'}]);
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export timed lyrics',exact:true}).click()]);expect(await readFile((await download.path())!,'utf8')).toContain('00:00:04,000 --> 00:00:05,000');await page.reload();await expect(page.locator('[data-cue]')).toHaveCount(2);
});
test('remove passage refuses reversed ranges keeps invalid survivor drafts and all-lines Undo on phone',async({page})=>{
 await page.setViewportSize({width:390,height:740});await passageFixture(page);const remove=page.getByRole('button',{name:'Remove selected lyric lines',exact:true});
 await page.getByLabel('Start line 1',{exact:true}).fill('');await page.getByLabel('End line 2',{exact:true}).fill('');const before=await timingEditor(page);
 await selectPassage(page,'2','1');await remove.click();expect(await timingEditor(page)).toEqual(before);
 await selectPassage(page,'1','2');await remove.click();await expect(page.locator('[data-cue]')).toHaveCount(2);await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await timingEditor(page)).toEqual(before);await selectPassage(page,'0','3');await remove.click();await expect(page.locator('[data-cue]')).toHaveCount(0);await expect(remove).toBeDisabled();
 await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await timingEditor(page)).toEqual(before);await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();await expect(page.locator('[data-cue]')).toHaveCount(0);
});
