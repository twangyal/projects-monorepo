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
