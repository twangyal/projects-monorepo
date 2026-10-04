import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

interface OriginalCue { start: number; end: number; text: string }
interface OriginalProject { schemaVersion: 1; id: string; revision: number; title: string; duration: number; cues: OriginalCue[] }
interface NativeJob { id: string; projectId: string; status: string; error?: string }
const BEFORE: OriginalCue[] = [{ start: 1 / 3, end: 1.125, text: 'Previous exact fraction Ω' }, { start: 2.25, end: 3.5, text: 'Previous final line' }];
const AFTER: OriginalCue[] = [{ start: .333, end: 1.125, text: 'First café 🌓 <b>literal</b>' }, { start: 1.25, end: 2.5, text: 'Second & final?' }, { start: 3.001, end: 4, text: 'Line three 🎵' }];
const PRIMARY = Buffer.from('\uFEFF1\r\n00:00:00,333 --> 00:00:01,125\r\nFirst café 🌓 &lt;b&gt;literal&lt;/b&gt;\r\n\r\n2\r\n00:00:01,250 --> 00:00:02,500\r\nSecond &amp; final?\r\n\r\n3\r\n00:00:03,001 --> 00:00:04,000\r\nLine three 🎵\r\n');
const NEWER = Buffer.from('1\n00:00:00,125 --> 00:00:00,875\nNewer original selection 105\n');
const EXPORTED = '1\n00:00:00,333 --> 00:00:01,125\nFirst café 🌓 &lt;b&gt;literal&lt;/b&gt;\n\n2\n00:00:01,250 --> 00:00:02,500\nSecond &amp; final?\n\n3\n00:00:03,001 --> 00:00:04,000\nLine three 🎵\n';
function originalAudio(): Buffer {
  const frames = 4 * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { const sample = Math.round(3500 * Math.sin(2 * Math.PI * 277 * i / 44100)); wav.writeInt16LE(sample, 44 + i * 4); wav.writeInt16LE(-sample, 46 + i * 4); }
  return wav;
}
const test = base.extend<{ clips: { create(title?: string): Promise<OriginalProject> } }>({
  clips: async ({ request }, use) => {
    const session = await (await request.get('/api/session')).json() as { token: string }; const owned: string[] = [], jobs: string[] = [];
    try {
      await use({ create: async (title = 'Original saved title105') => {
        const response = await request.post('/api/projects', { headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Name': 'original-srt105.wav', 'X-Karaoke-Token': session.token }, data: originalAudio() }); expect(response.status()).toBe(202);
        const job = (await response.json() as { job: NativeJob }).job; owned.push(job.projectId); jobs.push(job.id);
        await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json() as { job: NativeJob }).job.status, { timeout: 10000 }).toBe('complete');
        const current = await projectFromServer(request, job.projectId);
        const saved = await request.put(`/api/projects/${job.projectId}`, { headers: { 'X-Karaoke-Token': session.token }, data: { revision: current.revision, title, cues: BEFORE } }); expect(saved.status()).toBe(200); return await saved.json() as OriginalProject;
      } });
    } finally {
      const current = await (await request.get('/api/session')).json() as { activeJob: NativeJob | null };
      if (current.activeJob && owned.includes(current.activeJob.projectId)) { jobs.push(current.activeJob.id); await request.post(`/api/jobs/${current.activeJob.id}/cancel`, { headers: { 'X-Karaoke-Token': session.token }, data: {} }); }
      for (const id of jobs) await expect.poll(async () => { const response = await request.get(`/api/jobs/${id}`); return response.status() === 404 || (await response.json() as { job: NativeJob }).job.status !== 'running'; }, { timeout: 10000 }).toBe(true);
      for (const id of owned) { const response = await request.delete(`/api/projects/${id}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} }); expect([200, 404]).toContain(response.status()); }
    }
  },
});
async function projectFromServer(request: APIRequestContext, id: string): Promise<OriginalProject> { const response = await request.get(`/api/projects/${id}`); expect(response.status()).toBe(200); return await response.json() as OriginalProject; }
async function openClip(page: Page, project: OriginalProject) { await page.goto(`/?project=${project.id}`); await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(project.title); await expect(page.getByRole('button', { name: 'Undo lyric edit', exact: true })).toBeDisabled(); }
async function chooseSrt(page: Page, bytes = PRIMARY, name = 'original-105.srt') { await expect(page.locator('#srt-file')).toBeEnabled(); await page.locator('#srt-file').setInputFiles({ name, mimeType: 'application/x-subrip', buffer: bytes }); }
async function reviewReady(page: Page, count = 3) { await expect(page.locator('#srt-review')).toBeVisible(); await expect(page.locator('#srt-review-list [data-srt-cue]')).toHaveCount(count); await expect(page.locator('#srt-apply')).toBeEnabled(); }
async function editorCues(page: Page): Promise<OriginalCue[]> {
  return page.locator('#cue-list [data-cue]').evaluateAll(rows => rows.map(row => ({ text: row.querySelector<HTMLTextAreaElement>('.cue-text textarea')?.value ?? row.querySelector<HTMLInputElement>('.cue-text input')!.value, start: Number(row.querySelector<HTMLInputElement>('[data-boundary="start"]')!.value), end: Number(row.querySelector<HTMLInputElement>('[data-boundary="end"]')!.value) })));
}

test('selected original clip offers reviewed timed lyrics import', async ({ page, clips }) => {
  const project = await clips.create(); await openClip(page, project);
  await expect(page.getByLabel('Import timed lyrics (SRT)', { exact: true })).toBeEnabled();
});

test('complete literal review changes no saved data and Apply is one reversible unsaved edit', async ({ page, request, clips }) => {
  const project = await clips.create(); await openClip(page, project);
  await chooseSrt(page); await reviewReady(page);
  for (const [i, cue] of AFTER.entries()) await expect(page.locator('[data-srt-cue]').nth(i)).toContainText(cue.text);
  await expect(page.locator('#srt-review b')).toHaveCount(0); expect(await editorCues(page)).toEqual(BEFORE);
  expect(await projectFromServer(request, project.id)).toEqual(project);
  await page.locator('#srt-apply').click(); expect(await editorCues(page)).toEqual(AFTER);
  await expect(page.locator('#title')).toHaveValue(project.title); await expect(page.locator('#save-state')).toContainText('Unsaved lyric edits');
  expect(await projectFromServer(request, project.id)).toEqual(project);
  await page.locator('#undo-lyrics').click(); expect(await editorCues(page)).toEqual(BEFORE); await expect(page.locator('#undo-lyrics')).toBeDisabled();
  await page.locator('#redo-lyrics').click(); expect(await editorCues(page)).toEqual(AFTER);
});

test('manual Save produces exact SRT and reload keeps imported millisecond values', async ({ page, request, clips }, info) => {
  const project = await clips.create(); await openClip(page, project);
  const originalAudioBytes = await Promise.all(['original', 'vocals', 'backing'].map(async track => (await request.get(`/api/projects/${project.id}/audio/${track}`)).body()));
  await chooseSrt(page); await reviewReady(page); await page.locator('#srt-apply').click();
  await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  const saved = await projectFromServer(request, project.id); expect(saved.cues).toEqual(AFTER); expect(saved.title).toBe(project.title); expect(saved.revision).toBe(project.revision + 1);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click(); const file = await download;
  await file.saveAs(info.outputPath('actual-imported.srt')); const stream = await file.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); expect(Buffer.concat(chunks).toString()).toBe(EXPORTED);
  await page.reload(); await expect(page.locator('#title')).toHaveValue(project.title); expect(await editorCues(page)).toEqual(AFTER); await expect(page.locator('#undo-lyrics')).toBeDisabled();
  await page.locator('#archive-backup').click(); await expect(page.locator('#archive-download')).toBeVisible({ timeout: 15000 });
  const archived = page.waitForEvent('download'); await page.locator('#archive-download').click(); const archive = await archived; await archive.saveAs(info.outputPath('actual-imported.karaoke.zip'));
  const bytes = await readFile((await archive.path())!), entries = new Map<string, Buffer>(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) { const length = bytes.readUInt32LE(offset + 18), names = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28); expect(bytes.readUInt16LE(offset + 8)).toBe(0); const start = offset + 30 + names + extra; entries.set(bytes.subarray(offset + 30, offset + 30 + names).toString(), bytes.subarray(start, start + length)); offset = start + length; }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50); const portable = JSON.parse(entries.get('project.json')!.toString()) as OriginalProject; expect(portable).toEqual(saved);
  for (const [i, name] of ['source.wav', 'vocals.wav', 'backing.wav'].entries()) expect(createHash('sha256').update(entries.get(name)!).digest('hex')).toBe(createHash('sha256').update(originalAudioBytes[i]).digest('hex'));

});

test('review cancellation and rejection preserve focused raw fields and existing redo', async ({ page, request, clips }) => {
  const project = await clips.create(); await openClip(page, project);
  await page.getByLabel('Lyric line 1', { exact: true }).fill('temporary edit'); await page.locator('#undo-lyrics').click(); await expect(page.locator('#redo-lyrics')).toBeEnabled();
  await page.getByLabel('Start line 1', { exact: true }).fill(''); await page.getByLabel('End line 1', { exact: true }).fill('1.1250');
  const lyric = page.getByLabel('Lyric line 1', { exact: true }); await lyric.focus(); await lyric.evaluate(node => { (node as HTMLTextAreaElement).setSelectionRange(3, 8); node.setAttribute('data-original-node', 'yes'); });
  await chooseSrt(page); await reviewReady(page); await expect(lyric).toBeFocused(); await expect(lyric).toHaveAttribute('data-original-node', 'yes');
  expect(await lyric.evaluate(node => [(node as HTMLTextAreaElement).selectionStart, (node as HTMLTextAreaElement).selectionEnd])).toEqual([3, 8]);
  await page.locator('#srt-cancel').click(); await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue(''); await expect(page.getByLabel('End line 1', { exact: true })).toHaveValue('1.1250');
  await chooseSrt(page, Buffer.from([0xff]), 'invalid-utf8.srt'); await expect(page.locator('#srt-status')).toContainText(/UTF|encoding/i); await expect(page.locator('#srt-apply')).toBeDisabled(); expect(await projectFromServer(request, project.id)).toEqual(project);
});

test('Apply keeps title and unapplied pasted words and Undo restores invalid raw timing spelling', async ({ page, clips }) => {
  const project = await clips.create(); await openClip(page, project);
  await page.locator('#title').fill('Unsent title Ω'); await page.locator('#lyric-draft').fill('Unapplied words\n second line');
  await page.getByLabel('Start line 1', { exact: true }).fill(''); await page.getByLabel('End line 1', { exact: true }).fill('1.1250');
  await chooseSrt(page); await reviewReady(page); await page.locator('#srt-apply').click(); expect(await editorCues(page)).toEqual(AFTER);
  await expect(page.locator('#title')).toHaveValue('Unsent title Ω'); await expect(page.locator('#lyric-draft')).toHaveValue('Unapplied words\n second line'); await expect(page.locator('#save')).toBeDisabled();
  await page.locator('#undo-lyrics').click(); await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue(''); await expect(page.getByLabel('End line 1', { exact: true })).toHaveValue('1.1250');
  await page.locator('#redo-lyrics').click(); expect(await editorCues(page)).toEqual(AFTER);
});

test('multiline plaintext and single-pass entities remain literal editable text', async ({ page, clips }) => {
  const project = await clips.create(); await openClip(page, project);
  const text = 'First &amp;lt; &copy;\n  second\tline &lt;b&gt;\nmeaningful\u00a0space';
  await chooseSrt(page, Buffer.from(`1\n00:00:00,000 --> 00:00:02,000\n${text}\n`)); await reviewReady(page, 1); await page.locator('#srt-apply').click();
  const expected = 'First &lt; &copy;\n  second\tline <b>\nmeaningful\u00a0space'; expect(await editorCues(page)).toEqual([{ start: 0, end: 2, text: expected }]);
  await expect(page.locator('#cue-list textarea')).toHaveCount(1); await page.getByLabel('Lyric line 1', { exact: true }).fill(`${expected}\nFinal`); await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue(`${expected}\nFinal`);
});

test('malformed complete files never publish a partial review or mutate current lyrics', async ({ page, request, clips }) => {
  const project = await clips.create(); await openClip(page, project);
  const invalid = ['01\n00:00:00,000 --> 00:00:01,000\ntext', '1\n00:00:00.000 --> 00:00:01,000\ntext', '1\n00:00:00,000 --> 00:00:01,000 align:start\ntext', '1\n00:00:00,000 --> 00:00:01,000\n<b>text</b>', '1\n00:00:00,000 --> 00:00:04,001\ntext', '1\n00:00:00,000 --> 00:00:01,000\n\u00a0', '1\n00:00:00,000 --> 00:00:02,000\ntext\n\n2\n00:00:01,999 --> 00:00:03,000\nsecond'];
  for (const [i, value] of invalid.entries()) { await chooseSrt(page, Buffer.from(value), `invalid-${i}.srt`); await expect(page.locator('#srt-status')).toContainText(/kept/i); await expect(page.locator('#srt-apply')).toBeDisabled(); expect(await editorCues(page)).toEqual(BEFORE); }
  expect(await projectFromServer(request, project.id)).toEqual(project); await expect(page.locator('#undo-lyrics')).toBeDisabled();
});

async function holdRead(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as { releaseSrt?: () => void; srtReadEntered?: boolean }; const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () { const result = await original.call(this); if (this.name === 'held-original.srt') { state.srtReadEntered = true; await new Promise<void>(resolve => { state.releaseSrt = resolve; }); } return result; };
  });
}
async function readEntered(page: Page) { await expect.poll(() => page.evaluate(() => (window as unknown as { srtReadEntered?: boolean }).srtReadEntered)).toBe(true); }
async function releaseRead(page: Page) { await page.evaluate(() => (window as unknown as { releaseSrt?: () => void }).releaseSrt?.()); }

test('changed-back raw input defeats a held genuine File read without losing focus', async ({ page, clips }) => {
  const project = await clips.create(); await openClip(page, project); await holdRead(page); await chooseSrt(page, PRIMARY, 'held-original.srt'); await readEntered(page);
  const title = page.locator('#title'); await title.fill('new intent'); await title.fill(project.title); await title.focus(); await releaseRead(page);
  await expect(page.locator('#srt-apply')).toBeDisabled(); await expect(title).toBeFocused(); expect(await editorCues(page)).toEqual(BEFORE);
  await chooseSrt(page); await reviewReady(page);
});

test('newer native File wins and releasing the earlier read cannot overwrite its review', async ({ page, clips }) => {
  const project = await clips.create(); await openClip(page, project); await holdRead(page); await chooseSrt(page, PRIMARY, 'held-original.srt'); await readEntered(page);
  await chooseSrt(page, NEWER, 'newer.srt'); await reviewReady(page, 1); await releaseRead(page); await expect(page.locator('#srt-review-list')).toContainText('Newer original selection 105');
  await page.locator('#srt-apply').click(); expect(await editorCues(page)).toEqual([{ start: .125, end: .875, text: 'Newer original selection 105' }]);
});

for (const retirement of ['cancel', 'pagehide', 'project'] as const) test(`pending native read cannot publish after ${retirement}`, async ({ page, request, clips }) => {
  const project = await clips.create(), second = retirement === 'project' ? await clips.create('Second original clip105') : null;
  await openClip(page, project); await holdRead(page); await chooseSrt(page, PRIMARY, 'held-original.srt'); await readEntered(page);
  if (retirement === 'cancel') await page.locator('#srt-cancel').click();
  else if (retirement === 'pagehide') await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  else { await page.locator('#projects').selectOption(second!.id); await expect(page.locator('#title')).toHaveValue(second!.title); }
  await releaseRead(page); await expect(page.locator('#srt-apply')).toBeDisabled(); expect(await editorCues(page)).toEqual(BEFORE); expect(await projectFromServer(request, project.id)).toEqual(project);
});

test('a competing server save rejects manual Save while retaining imported cues and Undo', async ({ page, request, clips }) => {
  const project = await clips.create(); await openClip(page, project); await chooseSrt(page); await reviewReady(page); await page.locator('#srt-apply').click();
  const token = (await (await request.get('/api/session')).json() as { token: string }).token;
  const response = await request.put(`/api/projects/${project.id}`, { headers: { 'X-Karaoke-Token': token }, data: { revision: project.revision, title: 'Other saved title105', cues: BEFORE } }); expect(response.status()).toBe(200);
  await page.locator('#save').click(); await expect(page.locator('#message')).toContainText(/changed|revision|newer|reload/i); expect(await editorCues(page)).toEqual(AFTER); await expect(page.locator('#undo-lyrics')).toBeEnabled();
  expect((await projectFromServer(request, project.id)).title).toBe('Other saved title105'); await page.locator('#undo-lyrics').click(); expect(await editorCues(page)).toEqual(BEFORE);
});

test('waveform adjustment preserves imported milliseconds and Undo returns original fractional timing', async ({ page, clips }) => {
  const project = await clips.create(); await openClip(page, project); await expect(page.locator('#waveform-status')).toContainText(/ready/i);
  await chooseSrt(page); await reviewReady(page); await page.locator('#srt-apply').click(); await page.getByRole('button', { name: 'Select timing line 1', exact: true }).click();
  await page.locator('#cue-start-handle').focus(); await page.keyboard.press('ArrowRight'); await expect(page.locator('#cue-start-handle')).toHaveAttribute('aria-valuenow', String(.333 + .01));
  await page.locator('#undo-lyrics').click(); expect((await editorCues(page))[0].start).toBe(.333); await page.locator('#undo-lyrics').click(); expect((await editorCues(page))[0].start).toBe(1 / 3);
});

test('390px keyboard review exposes all literal cues without horizontal overflow', async ({ page, clips }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); const project = await clips.create(); await openClip(page, project); await chooseSrt(page); await reviewReady(page);
  await page.locator('#srt-apply').focus(); await page.keyboard.press('Enter'); expect(await editorCues(page)).toEqual(AFTER);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('srt-mobile-390.png'), fullPage: true });
});


test('successful Save establishes one exact baseline before a later SRT Apply', async ({ page, clips }) => {
  const project = await clips.create(); await openClip(page, project);
  await page.getByLabel('Start line 1', { exact: true }).fill('1.000'); await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  const spelling = await page.getByLabel('Start line 1', { exact: true }).inputValue(); await expect(page.locator('#undo-lyrics')).toBeDisabled();
  await chooseSrt(page); await reviewReady(page); await page.locator('#srt-apply').click(); await page.locator('#undo-lyrics').click();
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue(spelling); expect((await editorCues(page))[0].start).toBe(1); await expect(page.locator('#undo-lyrics')).toBeDisabled();
});

test('ten-second aggregate deadline retires a held native read and late release stays inert', async ({ page, request, clips }) => {
  const project = await clips.create(); await openClip(page, project); await page.clock.install(); await holdRead(page);
  await chooseSrt(page, PRIMARY, 'held-original.srt'); await readEntered(page); await page.clock.runFor(10001);
  await expect(page.locator('#srt-status')).toContainText(/10 seconds/i); await expect(page.locator('#srt-apply')).toBeDisabled();
  await releaseRead(page); expect(await editorCues(page)).toEqual(BEFORE); expect(await projectFromServer(request, project.id)).toEqual(project);
  await chooseSrt(page, NEWER); await reviewReady(page, 1);
});
