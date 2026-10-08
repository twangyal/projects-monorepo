import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Project } from '../src/lyrics.ts';

interface Job { id: string; projectId: string; kind: string; status: string; resultUrl?: string; error?: string }
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pcm(frequency: number): Buffer {
  const frames = 3 * 44100, data = Buffer.alloc(44 + frames * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(44100, 24); data.writeUInt32LE(176400, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { const sample = Math.round(Math.sin(2 * Math.PI * frequency * i / 44100) * 4000); data.writeInt16LE(sample, 44 + i * 4); data.writeInt16LE(-sample, 46 + i * 4); }
  return data;
}
// Independent ZIP_STORED fixture: no archive producer or parser is imported.
function storedZip(entries: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name), crc = crc32(data), local = Buffer.alloc(30), record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE((0o100600 * 65536) >>> 0, 38); record.writeUInt32LE(offset, 42);
    locals.push(local, filename, data); central.push(record, filename); offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function fixture(title = 'Saved chorus 🎵 <literal>') {
  const project: Project = { schemaVersion: 1, id: 'f'.repeat(32), title, duration: 3, revision: 7,
    cues: [{ start: .25, end: 1.25, text: 'Saved <verse> 🌓' }, { start: 1.75, end: 2.875, text: 'Final & chorus' }] };
  const entries: [string, Buffer][] = [['project.json', Buffer.from(JSON.stringify(project))], ['source.wav', pcm(220)], ['vocals.wav', pcm(330)], ['backing.wav', pcm(440)],
    ['processing.json', Buffer.from('{"model":"spleeter:2stems","frameCount":132300,"sampleRate":44100,"duration":3}')]];
  const manifest = { schemaVersion: 1, kind: 'karaoke-studio-project', origin: 'local-library', audio: { sampleRate: 44100, channels: 2, sampleWidth: 2, frames: 132300 },
    files: entries.map(([name, data]) => ({ name, bytes: data.length, sha256: hash(data) })) };
  return { project, entries: new Map(entries), bytes: storedZip([...entries, ['manifest.json', Buffer.from(JSON.stringify(manifest))]]) };
}
function archiveContents(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    expect(bytes.readUInt16LE(offset + 8)).toBe(0); expect(extra).toBe(0);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('ascii');
    const start = offset + 30 + nameLength, data = bytes.subarray(start, start + length);
    expect(crc32(data)).toBe(bytes.readUInt32LE(offset + 14)); expect(files.has(name)).toBe(false); files.set(name, data); offset = start + length;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  for (const entry of manifest.files) { expect(files.get(entry.name)!.length).toBe(entry.bytes); expect(hash(files.get(entry.name)!)).toBe(entry.sha256); }
  return files;
}
async function token(request: APIRequestContext): Promise<string> { return (await (await request.get('/api/session')).json()).token; }
async function projects(request: APIRequestContext): Promise<Project[]> { return (await (await request.get('/api/projects')).json()).projects; }
async function waitJob(request: APIRequestContext, id: string): Promise<Job> {
  let job!: Job;
  await expect.poll(async () => { job = (await (await request.get(`/api/jobs/${id}`)).json()).job; return job.status; }, { timeout: 12000 }).not.toBe('running');
  expect(job.status, job.error).toBe('complete'); return job;
}
async function seed(request: APIRequestContext, title = 'Current saved clip'): Promise<Project> {
  const archive = fixture(title), response = await request.post('/api/archives', { headers: { 'X-Karaoke-Token': await token(request), 'Content-Type': 'application/zip' }, data: archive.bytes });
  expect(response.status()).toBe(202); const job = await waitJob(request, (await response.json()).job.id);
  return await (await request.get(`/api/projects/${job.projectId}`)).json();
}
async function open(page: Page, project: Project) {
  await page.goto(`/?project=${project.id}`); await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(project.title);
  await expect(page.locator('#archive-backup')).toBeEnabled();
  await expect.poll(() => page.locator('audio').evaluate(el => (el as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
}
async function uploadArchive(page: Page, title = 'Restored portable clip') {
  const archive = fixture(title);
  await page.getByLabel('Import project archive', { exact: true }).setInputFiles({ name: 'original.karaoke.zip', mimeType: 'application/zip', buffer: archive.bytes });
  await expect(page.locator('#open-imported')).toBeVisible({ timeout: 15000 }); await expect(page.locator('#job-panel')).toBeHidden();
  return archive;
}
async function downloadArchive(page: Page): Promise<{ bytes: Buffer; name: string }> {
  const pending = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download saved archive', exact: true }).click();
  const download = await pending; return { bytes: await readFile((await download.path())!), name: download.suggestedFilename() };
}
async function rawDraft(page: Page) {
  await page.getByLabel('Clip title', { exact: true }).fill('Unsent title ☃ <img>');
  await page.getByLabel('Lyric line 1', { exact: true }).fill('Unsent cue <b>🎵</b>');
  await page.getByLabel('Paste lyrics, one line per cue', { exact: true }).fill('Unsent paste 🌓\n second line');
  await page.getByLabel('Start line 1', { exact: true }).fill('');
  await page.getByLabel('Start line 1', { exact: true }).blur();
  await page.getByLabel('End line 1', { exact: true }).fill('1.125');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo lyric edit', exact: true })).toBeEnabled();
}
async function expectDraft(page: Page) {
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue('Unsent title ☃ <img>');
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Unsent cue <b>🎵</b>');
  await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toHaveValue('Unsent paste 🌓\n second line');
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Redo lyric edit', exact: true })).toBeEnabled();
}
const baseline = new WeakMap<Page, Set<string>>();
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  baseline.set(page, new Set((await projects(request)).map(project => project.id)));
});
test.afterEach(async ({ page, request }) => {
  const session = await (await request.get('/api/session')).json();
  if (session.activeJob) { await request.post(`/api/jobs/${session.activeJob.id}/cancel`, { headers: { 'X-Karaoke-Token': session.token }, data: {} });
    await expect.poll(async () => (await (await request.get('/api/session')).json()).activeJob, { timeout: 12000 }).toBeNull(); }
  for (const project of await projects(request)) if (!baseline.get(page)!.has(project.id)) {
    expect((await request.delete(`/api/projects/${project.id}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} })).status()).toBe(200);
  }
  expect(pageErrors.get(page)).toEqual([]);
});

test('native archive import is available independently of model readiness', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('Import project archive', { exact: true })).toBeEnabled({ timeout: 2000 });
  await expect(page.getByRole('button', { name: 'Back up saved clip', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  if (process.env.KARAOKE_ARCHIVE_NO_MODEL === '1') {
    const session = await (await page.request.get('/api/session')).json();
    expect(session.modelReady).toBe(false);
    await expect(page.getByLabel('Upload song clip')).toBeDisabled();
  }
});


test('native archive restores a fresh editable ID and persistent unverified provenance without model use', async ({ page, request }) => {
  await page.goto('/'); const archive = await uploadArchive(page);
  await expect(page.getByLabel('Clip title', { exact: true })).toBeHidden();
  const [restored] = (await projects(request)).filter(project => !baseline.get(page)!.has(project.id));
  expect(restored).toEqual({ ...archive.project, id: restored.id }); expect(restored.id).not.toBe(archive.project.id);
  await page.getByRole('button', { name: 'Open imported clip', exact: true }).click();
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(archive.project.title);
  await expect(page.locator('#archive-status')).toContainText(/imported.*unverified/i);
  for (const [role, name] of [['original', 'source.wav'], ['vocals', 'vocals.wav'], ['backing', 'backing.wav']]) {
    const media = await request.get(`/api/projects/${restored.id}/audio/${role}`); expect(hash(await media.body())).toBe(hash(archive.entries.get(name)!));
  }
  await page.reload(); await expect(page.locator('#archive-status')).toContainText(/imported.*unverified/i);
  await page.getByRole('button', { name: 'Back up saved clip', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download saved archive', exact: true })).toBeVisible({ timeout: 12000 });
  const output = archiveContents((await downloadArchive(page)).bytes);
  expect(JSON.parse(output.get('project.json')!.toString())).toEqual(restored);
  expect(JSON.parse(output.get('manifest.json')!.toString()).origin).toBe('imported-declared');
  for (const name of ['source.wav', 'vocals.wav', 'backing.wav', 'processing.json']) expect(output.get(name)).toEqual(archive.entries.get(name));
});

test('saved-only backup preserves invalid raw drafts, redo, original controls and native audio position', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await rawDraft(page);
  await page.getByRole('button', { name: 'Vocals', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(el => (el as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('audio').evaluate(el => { (el as HTMLAudioElement).currentTime = .75; });
  const field = await page.getByLabel('Start line 1', { exact: true }).elementHandle();
  await page.getByRole('button', { name: 'Back up saved clip', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download saved archive', exact: true })).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#job-panel')).toBeHidden(); await expectDraft(page);
  expect(await field!.evaluate(el => el.isConnected)).toBe(true);
  await expect(page.locator('audio')).toHaveAttribute('src', new RegExp(`/projects/${saved.id}/audio/vocals$`));
  expect(await page.locator('audio').evaluate(el => (el as HTMLAudioElement).currentTime)).toBeCloseTo(.75, 2);
  const output = await downloadArchive(page), files = archiveContents(output.bytes);
  expect(JSON.parse(files.get('project.json')!.toString())).toEqual(saved);
  expect(output.name).not.toContain('Unsent'); expect(output.name).toMatch(/\.karaoke\.zip$/);
  expect(await (await request.get(`/api/projects/${saved.id}`)).json()).toEqual(saved);
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await expect(page.getByLabel('End line 1', { exact: true })).toHaveValue('1.125');
});

test('restore never replaces the active raw editor and explicit opening alone asks to discard', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await rawDraft(page);
  const field = await page.getByLabel('Start line 1', { exact: true }).elementHandle();
  await page.getByLabel('Start line 1', { exact: true }).focus();
  const archive = await uploadArchive(page, 'Second restored film');
  await expect(page.getByLabel('Start line 1', { exact: true })).toBeFocused();
  await expectDraft(page); expect(await field!.evaluate(el => el.isConnected)).toBe(true);
  expect(new URL(page.url()).searchParams.get('project')).toBe(saved.id);
  await expect(page.getByRole('combobox', { name: 'Saved clips', exact: true })).toHaveValue(saved.id);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Open imported clip', exact: true }).click();
  await expectDraft(page); expect(new URL(page.url()).searchParams.get('project')).toBe(saved.id);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Open imported clip', exact: true }).click();
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(archive.project.title);
  await expect(page.getByRole('button', { name: 'Undo lyric edit', exact: true })).toBeDisabled();
});

test('malformed restore and stale backup errors leave current draft and earlier successful result intact', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await uploadArchive(page, 'Kept imported result'); await rawDraft(page);
  const result = await page.locator('#archive-result').textContent();
  await page.getByLabel('Import project archive', { exact: true }).setInputFiles({ name: 'broken.karaoke.zip', mimeType: 'application/zip', buffer: Buffer.from('not an archive') });
  await expect(page.locator('#job-panel')).toBeHidden({ timeout: 12000 });
  await expect(page.locator('#message')).toHaveClass(/error/); await expectDraft(page);
  expect(await page.locator('#archive-result').textContent()).toBe(result);
  const response = await request.put(`/api/projects/${saved.id}`, { headers: { 'X-Karaoke-Token': await token(request) }, data: { title: 'Other tab saved', cues: saved.cues, revision: saved.revision } });
  expect(response.status()).toBe(200);
  await page.getByRole('button', { name: 'Back up saved clip', exact: true }).click();
  await expect(page.locator('#message')).toContainText(/revision|stale/i); await expectDraft(page);
  expect(await page.locator('#archive-result').textContent()).toBe(result);
});

test('provenance failure does not prevent editing and explicit status check recovers without reopening', async ({ page, request }) => {
  const saved = await seed(request);
  await page.route(`**/api/projects/${saved.id}/archive-info`, route => route.fulfill({ status: 409, json: { error: 'Fixture provenance temporarily unavailable.' } }), { times: 1 });
  await page.goto(`/?project=${saved.id}`); await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(saved.title);
  await expect(page.locator('#archive-status')).toContainText(/unavailable/i); await expect(page.locator('#archive-backup')).toBeDisabled();
  await rawDraft(page); const field = await page.getByLabel('Start line 1', { exact: true }).elementHandle();
  await page.getByRole('button', { name: 'Check restore status', exact: true }).click();
  await expect(page.locator('#archive-status')).toContainText(/imported.*unverified/i);
  await expect(page.locator('#archive-backup')).toBeEnabled(); await expectDraft(page);
  expect(await field!.evaluate(el => el.isConnected)).toBe(true);
});

test('native cancellation keeps earlier restored result and raw editor without publishing a clip', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await uploadArchive(page, 'Earlier complete restore');
  await rawDraft(page); const result = await page.locator('#archive-result').textContent(), before = (await projects(request)).map(project => project.id).sort();
  const bytes = fixture('Cancelled restore').bytes;
  // The browser fixture delays real archive work for one second. Job admission,
  // cancellation, cleanup and absence of a published project are production.
  await page.getByLabel('Import project archive', { exact: true }).setInputFiles({ name: 'cancel.karaoke.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('#job-panel')).toBeVisible(); await page.getByRole('button', { name: 'Cancel job', exact: true }).click();
  await expect(page.locator('#job-panel')).toBeHidden({ timeout: 12000 }); await expect(page.locator('#message')).toContainText(/cancelled/i);
  await expectDraft(page); expect(await page.locator('#archive-result').textContent()).toBe(result);
  expect((await projects(request)).map(project => project.id).sort()).toEqual(before);
});

test('aborting a native upload after lost 202 discovers the completed clip without replay or editor replacement', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await rawDraft(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let accepted: Job | null = null, submissions = 0;
  await page.route('**/api/archives', async route => {
    submissions++; const response = await route.fetch(); accepted = (await response.json()).job;
    await gate;
    // The response is deliberately lost after a real native body was accepted.
    // Aborting an already-cancelled intercepted request may itself reject.
    await route.abort('failed').catch(() => {});
  });
  const bytes = fixture('Recovered after lost response').bytes;
  await page.getByLabel('Import project archive', { exact: true }).setInputFiles({ name: 'lost-response.karaoke.zip', mimeType: 'application/zip', buffer: bytes });
  try {
    await expect.poll(() => accepted?.id).toBeTruthy();
    await page.getByRole('button', { name: 'Cancel archive upload', exact: true }).click();
    await expect(page.locator('#message')).toContainText(/may|uncertain|status/i);
    await waitJob(request, accepted!.id);
  } finally { release(); }
  await page.getByRole('button', { name: 'Check restore status', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Saved clips', exact: true }).locator('option')).toContainText(['Recovered after lost response']);
  await expectDraft(page); expect(new URL(page.url()).searchParams.get('project')).toBe(saved.id);
  await page.getByRole('button', { name: 'Check restore status', exact: true }).click();
  await expect(page.locator('#archive-recheck')).toBeEnabled(); expect(submissions).toBe(1);
  expect((await projects(request)).filter(project => project.title === 'Recovered after lost response')).toHaveLength(1);
});

test('duplicate terminal cancellation polls stay owned until completion and cannot disrupt the next job', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await rawDraft(page);
  // Hold an actual completed reply. Cancellation must not create a second
  // terminal handler while the original poll still owns the request.
  let oldId = '', terminalSeen = false, held = false, oldPolls = 0, releaseOld!: () => void;
  const gate = new Promise<void>(resolve => { releaseOld = resolve; });
  await page.route('**/api/jobs/*', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch(), value = await response.json() as { job: Job };
    if (!oldId) oldId = value.job.id;
    if (value.job.id === oldId) oldPolls++;
    if (value.job.id === oldId && value.job.status === 'complete' && !held) { held = true; terminalSeen = true; await gate; }
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Back up saved clip', exact: true }).click();
  try {
    await expect.poll(() => terminalSeen).toBe(true);
    const count = oldPolls;
    const cancellation = page.waitForResponse(response => response.url().endsWith(`/api/jobs/${oldId}/cancel`));
    await page.getByRole('button', { name: 'Cancel job', exact: true }).click();
    await cancellation;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(oldPolls).toBe(count); await expect(page.locator('#job-panel')).toBeVisible();
    releaseOld();
    await expect(page.locator('#job-panel')).toBeHidden();
    await page.getByRole('button', { name: 'Back up saved clip', exact: true }).click();
    await expect(page.locator('#job-panel')).toBeVisible();
    await expect(page.locator('#job-panel')).toBeHidden({ timeout: 12000 });
    await expectDraft(page); await expect(page.getByRole('link', { name: 'Download saved archive', exact: true })).toBeVisible();
  } finally { releaseOld(); }
});

test('delayed terminal library refresh keeps job ownership and blocks replacement work until complete', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await rawDraft(page);
  let entered = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/projects', async route => {
    const response = await route.fetch(); entered = true; await gate; await route.fulfill({ response });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Back up saved clip', exact: true }).click();
  try {
    await expect.poll(() => entered).toBe(true);
    await expect(page.locator('#job-panel')).toBeVisible(); await expect(page.locator('#archive-backup')).toBeDisabled();
    await expect(page.locator('#archive-file')).toBeDisabled(); await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue('Unsent title ☃ <img>');
  } finally { release(); }
  await expect(page.locator('#job-panel')).toBeHidden(); await expectDraft(page);
  await page.getByRole('button', { name: 'Back up saved clip', exact: true }).click();
  await expect(page.locator('#job-panel')).toBeVisible(); await expect(page.locator('#job-panel')).toBeHidden({ timeout: 12000 });
  await expectDraft(page);
});

test('observing another page separation in an empty editor never auto-opens its completed clip', async ({ page, request }) => {
  test.skip(process.env.KARAOKE_ARCHIVE_NO_MODEL === '1', 'This separate legacy-job regression uses the explicitly injected audio separator; archive cases above prove no-model operation.');
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Check restore status', exact: true })).toBeEnabled();
  const response = await request.post('/api/projects', { headers: { 'X-Karaoke-Token': await token(request), 'Content-Type': 'application/octet-stream', 'X-Audio-Name': 'Other-page-fixture.wav' }, data: pcm(220) });
  expect(response.status()).toBe(202); const job: Job = (await response.json()).job;
  await page.getByRole('button', { name: 'Check restore status', exact: true }).click();
  await expect(page.locator('#job-panel')).toBeVisible(); await expect(page.getByRole('button', { name: 'Cancel job', exact: true })).toBeDisabled();
  await waitJob(request, job.id); await expect(page.locator('#job-panel')).toBeHidden({ timeout: 12000 });
  await expect(page.getByLabel('Clip title', { exact: true })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Saved clips', exact: true })).toHaveValue('');
  expect(new URL(page.url()).searchParams.has('project')).toBe(false);
  expect((await projects(request)).some(project => project.id === job.projectId)).toBe(true);
});


test('archive completion respects a newer user focus choice instead of stealing it back to a raw field', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await rawDraft(page);
  await page.getByLabel('Start line 1', { exact: true }).focus();
  await page.getByLabel('Import project archive', { exact: true }).setInputFiles({ name: 'focus-choice.karaoke.zip', mimeType: 'application/zip', buffer: fixture('Focus choice restore').bytes });
  await expect(page.locator('#job-panel')).toBeVisible();
  const track = page.getByRole('button', { name: 'Original', exact: true }); await track.click();
  await expect(track).toBeFocused(); await expect(page.locator('#job-panel')).toBeHidden({ timeout: 12000 });
  await expect(track).toBeFocused(); await expectDraft(page);
});

test('observing another page video export never downloads or replaces the current raw editor', async ({ page, request }) => {
  const saved = await seed(request); await open(page, saved); await rawDraft(page);
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  let job!: Job;
  // Start the genuine export from another client just as this page checks
  // status, so the observed session comes from the real active-job registry.
  await page.route('**/api/session', async route => {
    const response = await request.post(`/api/projects/${saved.id}/export`, { headers: { 'X-Karaoke-Token': await token(request) }, data: {} });
    expect(response.status()).toBe(202); job = (await response.json()).job;
    await route.fulfill({ response: await route.fetch() });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Check restore status', exact: true }).click();
  await expect(page.locator('#job-panel')).toBeVisible(); await expect(page.getByRole('button', { name: 'Cancel job', exact: true })).toBeDisabled();
  await waitJob(request, job.id); await expect(page.locator('#job-panel')).toBeHidden({ timeout: 12000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(downloads).toEqual([]); await expectDraft(page);
  expect(new URL(page.url()).searchParams.get('project')).toBe(saved.id);
  expect(await (await request.get(`/api/projects/${saved.id}`)).json()).toEqual(saved);
});

test('an unreadable accepted archive reply keeps the uncertain-restore guard until deliberate status review',async({page,request})=>{
 const saved=await seed(request);await open(page,saved);await rawDraft(page);let accepted:Job|null=null,submissions=0;
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/archives')submissions++;});
 await page.route('**/api/archives',async route=>{const response=await route.fetch();accepted=(await response.json()).job;await route.fulfill({status:202,contentType:'application/json',body:'{"job":'});},{times:1});
 await page.getByLabel('Import project archive',{exact:true}).setInputFiles({name:'unreadable.karaoke.zip',mimeType:'application/zip',buffer:fixture('Recovered unreadable archive').bytes});
 await expect(page.locator('#message')).toContainText('may have reached');await expect(page.locator('#archive-file')).toBeDisabled();await expectDraft(page);expect(submissions).toBe(1);
 await waitJob(request,accepted!.id);await page.locator('#archive-recheck').click();
 await expect(page.locator('#projects').locator('option')).toContainText(['Recovered unreadable archive']);await expect(page.locator('#archive-file')).toBeEnabled();await expectDraft(page);
 expect((await projects(request)).filter(p=>p.title==='Recovered unreadable archive')).toHaveLength(1);expect(submissions).toBe(1);
});
