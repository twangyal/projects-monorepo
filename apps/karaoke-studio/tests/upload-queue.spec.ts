import { test, expect } from '@playwright/test';

function tone(seconds = 4): Buffer {
  const frames = seconds * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * i / 44100) * 3000), 44 + i * 4 + c * 2);
  return wav;
}
const before = new Set<string>();
test.beforeEach(async ({ request }) => { for (const p of (await (await request.get('/api/projects')).json()).projects) before.add(p.id); });
test.afterEach(async ({ request }) => {
  const s = await (await request.get('/api/session')).json();
  for (const p of (await (await request.get('/api/projects')).json()).projects) if (!before.has(p.id)) await request.delete(`/api/projects/${p.id}`, { headers: { 'X-Karaoke-Token': s.token }, data: {} });
});

const ready = (name: string, more = '') => new RegExp(`“${name}” (is ready in Saved clips|is in Saved clips, but its automatic lyrics failed[^.]*)\\.${more}`);
const songs = (...names: string[]) => names.map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: tone() }));

test('several songs chosen together are prepared one after another without replacing the open clip', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles(songs('first-song', 'second-song', 'third-song'));
  await expect(page.locator('#upload-queue-text')).toContainText('2 songs are waiting.');
  await expect(page.locator('#upload-queue-list li span')).toHaveText(['second-song.wav', 'third-song.wav']);
  // The first song opens as usual; the others follow by themselves into Saved clips.
  await expect(page.getByLabel('Clip title')).toHaveValue('first-song', { timeout: 15000 });
  await expect(page.locator('#message')).toHaveText(ready('second-song', ' 1 more waiting'), { timeout: 20000 });
  await expect(page.locator('#message')).toHaveText(ready('third-song'), { timeout: 20000 });
  await expect(page.locator('#upload-queue')).toBeHidden();
  await expect(page.getByLabel('Clip title')).toHaveValue('first-song');
  for (const name of ['first-song', 'second-song', 'third-song']) await expect(page.locator('#projects option', { hasText: name })).toHaveCount(1);
});

test('waiting songs can be cleared before they start', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles(songs('kept-song', 'dropped-one', 'dropped-two'));
  await page.getByRole('button', { name: 'Clear waiting songs' }).click();
  await expect(page.locator('#message')).toContainText('2 waiting songs were removed.');
  await expect(page.getByLabel('Clip title')).toHaveValue('kept-song', { timeout: 15000 });
  await page.waitForTimeout(4500);
  await expect(page.locator('#projects option', { hasText: 'dropped' })).toHaveCount(0);
});

test('a song chosen while another is being prepared waits its turn instead of being dropped', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles(songs('busy-first'));
  await expect(page.locator('#cancel-job')).toBeVisible();
  // Choosing stays available while the studio works, and the new song joins the waiting list.
  await expect(page.getByLabel('Upload song clip')).toBeEnabled();
  await page.getByLabel('Upload song clip').setInputFiles(songs('busy-later'));
  await expect(page.locator('#message')).toHaveText('“busy-later.wav” is waiting until the studio is free. It lands in Saved clips.');
  await expect(page.locator('#upload-queue-text')).toContainText('1 song is waiting.');
  await expect(page.locator('#upload-queue-list li span')).toHaveText(['busy-later.wav']);
  await expect(page.getByLabel('Clip title')).toHaveValue('busy-first', { timeout: 15000 });
  await expect(page.locator('#message')).toHaveText(ready('busy-later'), { timeout: 20000 });
  await expect(page.getByLabel('Clip title')).toHaveValue('busy-first');
});

test('a waiting song can move to the front or be removed without changing the open clip or model', async ({ page }) => {
  test.setTimeout(60000);
  const uploads: [string,string][] = [];
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/projects',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    const headers=route.request().headers(), name=decodeURIComponent(headers['x-audio-name'] ?? '');
    uploads.push([name,headers['x-lyrics-model'] ?? 'auto']);
    if(name==='queue-owner.wav')await held;
    await route.continue();
  });
  try {
    await page.goto('/');
    await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
    await page.locator('#upload-recognition').selectOption('multilingual');
    await page.getByLabel('Upload song clip').setInputFiles(songs('queue-owner','keep-after','remove-me','move-first'));
    const list=page.getByRole('list',{name:'Waiting songs'});
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await page.getByRole('button',{name:'Move to front: move-first.wav',exact:true}).click();
    await expect(list.getByRole('listitem').first()).toContainText('move-first.wav');
    await expect(page.getByRole('button',{name:'Remove move-first.wav',exact:true})).toBeFocused();
    await page.getByRole('button',{name:'Remove remove-me.wav',exact:true}).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).not.toContainText('remove-me.wav');
    release();
    await expect(page.getByLabel('Clip title')).toHaveValue('queue-owner',{timeout:15000});
    await expect(page.locator('#message')).toHaveText(ready('keep-after'),{timeout:30000});
    expect(uploads).toEqual([['queue-owner.wav','multilingual'],['move-first.wav','multilingual'],['keep-after.wav','multilingual']]);
    await expect(page.getByLabel('Clip title')).toHaveValue('queue-owner');
    await expect(page.locator('#projects option',{hasText:'remove-me'})).toHaveCount(0);
  } finally { release(); }
});

test('clearing waiting songs does not resurrect a held busy upload', async ({ page }) => {
  test.setTimeout(60000);
  let attempts=0, release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/projects',async route=>{
    if(route.request().method()!=='POST'||route.request().headers()['x-audio-name']!=='held-busy.wav'){
      await route.continue();return;
    }
    attempts++;
    if (attempts > 1) await held;
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'A media job is already running.' }) });
  });
  try {
    await page.goto('/');
    await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
    await page.getByLabel('Upload song clip').setInputFiles(songs('clear-owner','held-busy','clear-tail'));
    await expect(page.getByLabel('Clip title')).toHaveValue('clear-owner',{timeout:15000});
    await expect.poll(() => attempts, { timeout: 15000 }).toBe(2);
    await expect(page.locator('#delete-project')).toBeDisabled();
    await page.getByRole('button',{name:'Clear waiting songs',exact:true}).click();
    release();
    await expect(page.locator('#delete-project')).toBeEnabled();
    await expect(page.locator('#upload-queue')).toBeHidden();
    await page.getByLabel('Upload song clip').setInputFiles(songs('clear-new'));
    await expect(page.getByLabel('Clip title')).toHaveValue('clear-new', { timeout: 15000 });
    expect(attempts).toBe(2);
    await expect(page.locator('#projects option',{hasText:'clear-tail'})).toHaveCount(0);
  } finally { release(); }
});

test('the first upload refused by a busy studio is retried before the rest of the batch', async ({ page }) => {
  test.setTimeout(60000);
  const uploads: [string, string][] = [];
  await page.route('**/api/projects', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const headers = route.request().headers();
    const name = decodeURIComponent(headers['x-audio-name'] ?? '');
    if (name === 'existing-clip.wav') { await route.continue(); return; }
    uploads.push([name, headers['x-lyrics-model'] ?? 'auto']);
    if (uploads.length === 1) {
      await route.fulfill({ status: 409, json: { error: 'A media job or upload is already running.' } });
    } else await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  const upload = page.getByLabel('Upload song clip');
  await upload.setInputFiles(songs('existing-clip'));
  await expect(page.getByLabel('Clip title')).toHaveValue('existing-clip', { timeout: 15000 });
  await page.locator('#upload-recognition').selectOption('multilingual');
  await upload.setInputFiles(songs('busy-head', 'busy-tail'));
  await expect(page.locator('#message')).toHaveText(ready('busy-tail'), { timeout: 25000 });
  expect(uploads).toEqual([
    ['busy-head.wav', 'multilingual'], ['busy-head.wav', 'multilingual'], ['busy-tail.wav', 'multilingual'],
  ]);
  await expect(page.locator('#projects option', { hasText: 'busy-head' })).toHaveCount(1);
  await expect(page.getByLabel('Clip title')).toHaveValue('existing-clip');
});

test('clearing the batch while the first upload waits for a reply does not restore a busy refusal', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  await page.route('**/api/projects', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    attempts++;
    await held;
    await route.fulfill({ status: 409, json: { error: 'A media job or upload is already running.' } });
  });
  try {
    await page.goto('/');
    await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
    await page.getByLabel('Upload song clip').setInputFiles(songs('cleared-head', 'cleared-tail'));
    await expect.poll(() => attempts).toBe(1);
    await page.getByRole('button', { name: 'Clear waiting songs' }).click();
    release();
    await expect(page.locator('#upload-recognition')).toBeEnabled();
    await expect(page.locator('#upload-queue')).toBeHidden();
    await expect(page.locator('#message')).toContainText('1 waiting song was removed.');
  } finally { release(); }
});
