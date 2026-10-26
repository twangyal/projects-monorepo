import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { test } from './sequential-timing-fixtures';

function wav(): Buffer {
  const frames = 18 * 44100, data = Buffer.alloc(44 + frames * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(44100, 24); data.writeUInt32LE(176400, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 4, 40);
  return data;
}
interface Job { id: string; projectId: string; status: string; retainedOnCancel?: boolean }
async function upload(page: Page): Promise<Job> {
  const response = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
  await page.getByLabel('Upload song clip').setInputFiles({ name:'cancel-recognition.wav', mimeType:'audio/wav', buffer:wav() });
  const reply = await response; expect(reply.status()).toBe(202);
  return (await reply.json() as { job:Job }).job;
}
async function cleanup(request: APIRequestContext, jobs: Job[]) {
  const { token } = await (await request.get('/api/session')).json() as { token:string };
  for (const job of jobs) {
    await request.post(`/api/jobs/${job.id}/cancel`, { headers:{'X-Karaoke-Token':token}, data:{} });
    await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json() as {job:Job}).job.status, {timeout:10000}).not.toBe('running');
    expect([200,404]).toContain((await request.delete(`/api/projects/${job.projectId}`, {headers:{'X-Karaoke-Token':token},data:{}})).status());
  }
}
for (const width of [1280,390]) test(`cancelled recognition keeps playable stems and supports recognition retry at ${width}px`, async ({page,request}) => {
  const jobs:Job[] = [];
  try {
    await page.setViewportSize({width,height:900}); await page.goto('/');
    jobs.push(await upload(page));
    await expect(page.locator('#job-stage')).toHaveText('Waiting for recognition cancellation in browser fixture');
    await page.getByRole('button',{name:'Cancel job',exact:true}).click();
    await expect(page.locator('#message')).toContainText('Recognition cancelled', {timeout:10000});
    await expect(page.locator('#message')).toContainText('stems');
    await expect(page.getByLabel('Clip title',{exact:true})).toHaveValue('cancel-recognition');
    await expect(page.getByRole('button',{name:'Backing',exact:true})).toBeEnabled();
    const done = (await (await request.get(`/api/jobs/${jobs[0].id}`)).json() as {job:Job}).job;
    expect(done).toMatchObject({status:'complete',retainedOnCancel:true});
    const transcript = await (await request.get(`/api/projects/${jobs[0].projectId}/transcript`)).json();
    expect(transcript).toEqual({available:false});
    await page.getByRole('button',{name:'Transcribe lyrics',exact:true}).click();
    await expect(page.locator('#message')).toContainText('Lyrics recognized', {timeout:10000});
    await expect(page.locator('#auto-status')).toContainText('12 words were recognized');
    expect(await page.locator('#cue-list textarea').count()).toBe(0);
  } finally { await cleanup(request,jobs); }
});


test('another page retains its dirty editor when recognition cancellation saves a new clip', async ({page,request,timingClips}) => {
  const existing = await timingClips.create();
  const jobs:Job[] = [];
  try {
    await page.goto(`/?project=${existing.id}`);
    await expect(page.getByLabel('Clip title',{exact:true})).toHaveValue(existing.title);
    await page.getByLabel('Clip title',{exact:true}).fill('Unsaved correction belongs here');
    const {token} = await (await request.get('/api/session')).json() as {token:string};
    const response = await request.post('/api/projects',{headers:{'Content-Type':'application/octet-stream','X-Audio-Name':'cancel-recognition.wav','X-Karaoke-Token':token},data:wav()});
    expect(response.status()).toBe(202); jobs.push((await response.json() as {job:Job}).job);
    await expect.poll(async () => (await (await request.get(`/api/jobs/${jobs[0].id}`)).json() as {job:{stage:string}}).job.stage).toBe('Waiting for recognition cancellation in browser fixture');
    await page.getByRole('button',{name:'Refresh projects',exact:true}).click();
    await expect(page.getByRole('button',{name:'Cancel job',exact:true})).toBeDisabled();
    await request.post(`/api/jobs/${jobs[0].id}/cancel`,{headers:{'X-Karaoke-Token':token},data:{}});
    await expect(page.locator('#message')).toContainText('Recognition cancelled', {timeout:10000});
    await expect(page.locator('#message')).toContainText('Saved clips');
    await expect(page.getByLabel('Clip title',{exact:true})).toHaveValue('Unsaved correction belongs here');
    await expect(page.locator('#save-state')).toContainText('Unsaved lyric edits');
    expect(await (await request.get(`/api/projects/${existing.id}`)).json()).toEqual(existing);
  } finally { await cleanup(request,jobs); }
});
