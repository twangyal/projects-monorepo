import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Project } from '../src/lyrics.ts';

interface Job { id: string; projectId: string; status: string; kind: string; stage: string }

function tone(): Buffer {
  const frames = 66150;
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(Math.sin(2 * Math.PI * 220 * i / 44100) * 5000);
    wav.writeInt16LE(sample, 44 + i * 4); wav.writeInt16LE(sample, 46 + i * 4);
  }
  return wav;
}

async function submitClip(request: APIRequestContext, name: string): Promise<Job> {
  const session = await (await request.get('/api/session')).json() as { token: string };
  const response = await request.post('/api/projects', {
    headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Name': encodeURIComponent(name), 'X-Karaoke-Token': session.token },
    data: tone(),
  });
  expect(response.status()).toBe(202);
  return (await response.json() as { job: Job }).job;
}

async function completedClip(request: APIRequestContext, name: string): Promise<Project> {
  const job = await submitClip(request, name);
  await expect.poll(async () => {
    return (await (await request.get(`/api/jobs/${job.id}`)).json() as { job: Job }).job.status;
  }, { timeout: 10000 }).toBe('complete');
  return await (await request.get(`/api/projects/${job.projectId}`)).json() as Project;
}

async function openClip(page: Page, project: Project): Promise<void> {
  await page.goto(`/?project=${project.id}`);
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(project.title);
  await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toBeEnabled();
}

async function savedLyrics(request: APIRequestContext, name: string): Promise<Project> {
  const project = await completedClip(request, name);
  const session = await (await request.get('/api/session')).json() as { token: string };
  const response = await request.put(`/api/projects/${project.id}`, {
    headers: { 'X-Karaoke-Token': session.token },
    data: { title: project.title, revision: project.revision, cues: [
      { start: 0, end: .5, text: 'First saved line' },
      { start: .75, end: 1.5, text: 'Second saved line' },
    ] },
  });
  expect(response.status()).toBe(200);
  return await response.json() as Project;
}

test('draft history restores removed lines, invalid timings and regenerated pasted words', async ({ page, request }) => {
  const project = await savedLyrics(request, 'history-draft.wav');
  await openClip(page, project);
  const undo = page.getByRole('button', { name: 'Undo lyric edit', exact: true });
  const redo = page.getByRole('button', { name: 'Redo lyric edit', exact: true });
  const save = page.getByRole('button', { name: 'Save lyrics', exact: true });
  await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
  await page.getByRole('button', { name: 'Remove line 2', exact: true }).click();
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveCount(0);
  await undo.click();
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('Second saved line');
  await expect(save).toBeDisabled();
  await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  await redo.click(); await undo.click();
  await page.getByLabel('Start line 1', { exact: true }).fill('');
  await expect(page.locator('#cue-validation')).toContainText('within the clip');
  await undo.click();
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0');
  await redo.click();
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('');
  await expect(save).toBeDisabled();
  await undo.click();
  const paste = page.getByLabel('Paste lyrics, one line per cue', { exact: true });
  await paste.fill('Replacement chorus');
  await expect(redo).toBeDisabled();
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Replacement chorus');
  await undo.click();
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('Second saved line');
  await expect(paste).toHaveValue('Replacement chorus');
  await expect(page.locator('#save-state')).toContainText('Unsaved pasted words');
  await expect(save).toBeDisabled();
  await undo.click();
  await expect(paste).toHaveValue('First saved line\nSecond saved line');
  await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  const title = page.getByLabel('Clip title', { exact: true });
  await title.fill(''); await title.pressSequentially('New title');
  await undo.click();
  await expect(title).toHaveValue(project.title);
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
});

test('failed saves keep draft history and successful saves establish the latest revision baseline', async ({ page, request }) => {
  const project = await savedLyrics(request, 'history-save.wav');
  await openClip(page, project);
  const undo = page.getByRole('button', { name: 'Undo lyric edit', exact: true });
  const redo = page.getByRole('button', { name: 'Redo lyric edit', exact: true });
  const save = page.getByRole('button', { name: 'Save lyrics', exact: true });
  await page.getByLabel('Clip title', { exact: true }).fill('Saved new title');
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 409, json: { error: 'Fixture revision conflict.' } });
    else await route.continue();
  }, { times: 1 });
  await save.click();
  await expect(page.locator('#message')).toContainText('revision conflict');
  await undo.click();
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(project.title);
  await redo.click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() === 'PUT') await gate;
    await route.continue();
  }, { times: 1 });
  await save.click();
  try { await expect(page.locator('#save-state')).toHaveText('Saving lyrics…'); await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled(); }
  finally { release(); }
  await expect(page.locator('#message')).toContainText('saved locally');
  await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
  await page.getByLabel('Lyric line 1', { exact: true }).fill('Fresh draft');
  await undo.click();
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('First saved line');
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue('Saved new title');
  await redo.click(); await save.click();
  await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  const saved = await (await request.get(`/api/projects/${project.id}`)).json() as Project;
  expect(saved.revision).toBe(project.revision + 2);
  expect(saved.cues[0].text).toBe('Fresh draft');
  await expect(undo).toBeDisabled();
});

test('failed clip switches retain history, while successful switches and deletion reset it', async ({ page, request }) => {
  const current = await savedLyrics(request, 'history-current.wav');
  const next = await savedLyrics(request, 'history-next.wav');
  await openClip(page, current);
  const undo = page.getByRole('button', { name: 'Undo lyric edit', exact: true });
  const redo = page.getByRole('button', { name: 'Redo lyric edit', exact: true });
  await page.getByLabel('Clip title', { exact: true }).fill('Keep this draft');
  await page.route(`**/api/projects/${next.id}`, async route => { await route.fulfill({ status: 503, json: { error: 'Fixture clip temporarily unavailable.' } }); }, { times: 1 });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(next.id);
  await expect(page.locator('#message')).toContainText('temporarily unavailable');
  await undo.click();
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(current.title);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${next.id}`, async route => { await gate; await route.continue(); }, { times: 1 });
  await page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(next.id);
  try { await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled(); }
  finally { release(); }
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(next.title);
  await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
  await page.getByLabel('Clip title', { exact: true }).fill('Delete this draft');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click();
  await expect(page.locator('#message')).toContainText('selected clip was deleted');
  await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
  expect(await (await request.get(`/api/projects/${current.id}`)).json()).toEqual(current);
});

test('dismissing a project switch preserves raw pasted words that have no draft timings yet', async ({ page, request }) => {
  const current = await completedClip(request, 'raw-draft-current.wav');
  const other = await completedClip(request, 'raw-draft-other.wav');
  await openClip(page, current);
  const words = 'Keep these pasted words\nThey have no timings yet';
  await page.getByLabel('Paste lyrics, one line per cue', { exact: true }).fill(words);
  await expect(page.locator('#save-state')).toContainText('Unsaved pasted words');
  const prompted = page.waitForEvent('dialog');
  const switching = page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(other.id);
  const prompt = await prompted;
  expect(prompt.type()).toBe('confirm');
  expect(prompt.message()).toContain('unsaved');
  await prompt.dismiss();
  await switching;
  await expect(page.getByRole('combobox', { name: 'Saved clips', exact: true })).toHaveValue(current.id);
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(current.title);
  await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toHaveValue(words);
  await expect(page.getByRole('button', { name: 'Create draft timings', exact: true })).toBeEnabled();
});

test('a pending project open disables editing until the replacement response arrives', async ({ page, request }) => {
  const current = await completedClip(request, 'pending-open-current.wav');
  const next = await completedClip(request, 'pending-open-next.wav');
  await openClip(page, current);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  await page.route(`**/api/projects/${next.id}`, async route => {
    requested(); await gate; await route.continue();
  });
  await page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(next.id);
  await pending;
  try {
    await expect(page.getByLabel('Clip title', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create draft timings', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Upload song clip', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(current.title);
  } finally { release(); }
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(next.title);
  await expect(page.getByLabel('Clip title', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toBeEnabled();
});

test('Refresh discovers another tab separation job without overwriting the current unsaved draft', async ({ page, request }) => {
  const current = await completedClip(request, 'other-tab-current.wav');
  await openClip(page, current);
  await page.getByLabel('Clip title', { exact: true }).fill('My unsaved title');
  const words = 'My unfinished draft\nKeep the words here';
  await page.getByLabel('Paste lyrics, one line per cue', { exact: true }).fill(words);
  const otherJob = await submitClip(request, 'other-tab-new.wav');
  // Keep discovery deterministic even if the 300ms fixture finishes before Chromium
  // handles Refresh. Polling still reads the actual server job and completed project.
  await page.route('**/api/session', async route => {
    const response = await route.fetch();
    const session = await response.json();
    await route.fulfill({ response, json: { ...session, activeJob: otherJob } });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Refresh projects', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Your current lyric edits are still here', { timeout: 10000 });
  await expect(page.locator('#job-panel')).toBeHidden();
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue('My unsaved title');
  await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toHaveValue(words);
  await expect(page.getByRole('combobox', { name: 'Saved clips', exact: true })).toHaveValue(current.id);
  await expect(page.getByRole('combobox', { name: 'Saved clips', exact: true }).locator(`option[value="${otherJob.projectId}"]`)).toHaveText('other-tab-new');
  await expect(page.locator('#save-state')).toContainText('Unsaved pasted words');
});

test('cancelling an owned separation job preserves the previously completed clip', async ({ page, request }) => {
  const current = await completedClip(request, 'cancel-job-kept.wav');
  await openClip(page, current);
  await page.getByLabel('Upload song clip', { exact: true }).setInputFiles({ name: 'cancel-job-new.wav', mimeType: 'audio/wav', buffer: tone() });
  await expect(page.locator('#job-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel job', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Job cancelled. Completed clips are unchanged', { timeout: 10000 });
  await expect(page.locator('#job-panel')).toBeHidden();
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(current.title);
  await expect(page.getByRole('combobox', { name: 'Saved clips', exact: true })).toHaveValue(current.id);
  await expect(page.getByLabel('Upload song clip', { exact: true })).toBeEnabled();
  expect(await (await request.get(`/api/projects/${current.id}`)).json()).toEqual(current);
});

test('a completed job project-load failure is visible and can be retried from refreshed Saved clips', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  let failedProjectId = '';
  await page.route('**/api/projects/*', async route => {
    const path = new URL(route.request().url()).pathname;
    const match = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (route.request().method() === 'GET' && match && !failedProjectId) {
      failedProjectId = match[1];
      await route.fulfill({ status: 503, json: { error: 'Fixture project read temporarily unavailable.' } });
    } else await route.continue();
  });
  await page.getByLabel('Upload song clip', { exact: true }).setInputFiles({ name: 'terminal-retry.wav', mimeType: 'audio/wav', buffer: tone() });
  await expect(page.locator('#message')).toContainText('The job finished, but its project could not be loaded', { timeout: 10000 });
  await expect(page.locator('#message')).toHaveClass(/error/);
  await expect(page.locator('#job-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Refresh projects', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Upload song clip', { exact: true })).toBeEnabled();
  expect(failedProjectId).not.toBe('');
  await page.getByRole('button', { name: 'Refresh projects', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Saved clips', exact: true }).locator(`option[value="${failedProjectId}"]`)).toHaveText('terminal-retry');
  await page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(failedProjectId);
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue('terminal-retry');
  await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toBeEnabled();
  await expect(page.locator('#message')).toBeHidden();
  expect(errors).toEqual([]);
});
