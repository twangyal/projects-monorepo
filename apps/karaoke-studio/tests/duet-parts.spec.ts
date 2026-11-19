import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function tone(): Buffer {
  const frames = 16 * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 44100) * 5000), 44 + i * 4 + channel * 2);
  return wav;
}
async function withClip(page: Page, run: (id: string) => Promise<void>) {
  const before = new Set<string>((await (await page.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id));
  let ownedId: string | null = null;
  try {
    await page.goto('/');
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'duet.wav', mimeType: 'audio/wav', buffer: tone() });
    const response = await accepted;
    expect(response.status()).toBe(202);
    ownedId = (await response.json()).job.projectId;
    expect(typeof ownedId).toBe('string');
    await expect(page.locator('#message')).toContainText('3 automatically timed lyric lines', { timeout: 15000 });
    await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
    expect(await page.locator('#projects').inputValue()).toBe(ownedId);
    await run(ownedId!);
  } finally {
    const session = await (await page.request.get('/api/session')).json();
    if (ownedId && session.activeJob?.projectId === ownedId) {
      await page.request.post(`/api/jobs/${session.activeJob.id}/cancel`, { headers: { 'X-Karaoke-Token': session.token }, data: {} });
      await expect.poll(async () => (await (await page.request.get(`/api/jobs/${session.activeJob.id}`)).json()).job.status).not.toBe('running');
    }
    const projects = (await (await page.request.get('/api/projects')).json()).projects;
    if (ownedId && projects.some((p: { id: string }) => p.id === ownedId)) {
      expect((await page.request.delete(`/api/projects/${ownedId}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} })).ok()).toBe(true);
    }
    const after: string[] = (await (await page.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id);
    expect(after.filter(id => before.has(id)).sort()).toEqual([...before].sort());
    if (ownedId) expect(after).not.toContain(ownedId);
  }
}

test('lines can be marked for singer 1, singer 2 or both: the preview colours them and says whose is next, and they are saved and exported', async ({ page }) => withClip(page, async id => {
  test.setTimeout(120000);
  const stage = page.locator('#stage');
  const seek = (time: number) => page.locator('audio').evaluate((node, at) => { (node as HTMLAudioElement).currentTime = at; node.dispatchEvent(new Event('timeupdate')); }, time);
  const cues = async () => (await (await page.request.get(`/api/projects/${id}`)).json()).cues as { start: number; end: number; text: string; singer?: 1 | 2 | 'both' }[];
  const lines = await cues();
  // The choice sits under the line's times, wide enough to read.
  const first = page.getByRole('combobox', { name: 'Singer line 1', exact: true });
  const [choice, end] = [await first.boundingBox(), await page.getByLabel('End line 1', { exact: true }).boundingBox()];
  expect(choice!.width).toBeGreaterThan(100);
  expect(choice!.y).toBeGreaterThan(end!.y + end!.height - 1);
  await first.selectOption('1');
  await page.getByRole('combobox', { name: 'Singer line 2', exact: true }).selectOption('2');
  await page.getByRole('combobox', { name: 'Singer line 3', exact: true }).selectOption('both');
  // In the preview each line takes its singer's colours, unlike a line for anyone.
  // The colours on the canvas, as "r,g,b".
  const colours = () => stage.evaluate(canvas => { const data = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data, seen = new Set<string>(); for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`); return [...seen]; });
  // Singer 2's words still to be sung lean toward singer 2's blue (classic style: #d8e7f2, see part-colours.json).
  const singer2 = '216,231,242', anyone = '247,245,237';
  await seek(lines[1]!.start + 0.01);
  await expect(stage).toHaveAttribute('data-singer', '2');
  // The words still to be sung take that colour once their timing has come from the studio.
  await expect(stage).toHaveAttribute('data-word-timing', 'recognized');
  expect(await colours()).toContain(singer2);
  await seek(lines[2]!.start + 0.01);
  await expect(stage).toHaveAttribute('data-singer', 'both');
  await seek(lines[0]!.start + 0.01);
  await expect(stage).toHaveAttribute('data-singer', '1');
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect.poll(async () => (await cues()).map(cue => cue.singer ?? null)).toEqual([1, 2, 'both']);
  // Karaoke subtitles give each part its own style, named in each line.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export karaoke subtitles (ASS)', exact: true }).click();
  const ass = await readFile((await (await download).path())!, 'utf8');
  for (const part of ['Singer 1', 'Singer 2', 'Both']) expect(ass).toContain(`Style: ${part},`);
  expect(ass.split('\n').filter(line => line.startsWith('Dialogue:')).map(line => line.split(',')[4])).toEqual(['Singer 1', 'Singer 2', 'Both']);
  // Lines from a subtitle file that replace the duet's keep its parts.
  const stamp = (seconds: number) => { const ms = Math.round(seconds * 1000); return `00:${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  const srt = lines.map((line, index) => `${index + 1}\n${stamp(line.start)} --> ${stamp(line.end)}\nImported line ${index + 1}\n`).join('\n');
  await page.locator('#srt-file').setInputFiles({ name: 'duet.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await expect(page.locator('#srt-review')).toBeVisible();
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Imported line 1');
  for (const [line, singer] of [[1, '1'], [2, '2'], [3, 'both']] as const) await expect(page.getByRole('combobox', { name: `Singer line ${line}`, exact: true })).toHaveValue(singer);
  // Back to anyone: the part goes.
  await page.getByRole('combobox', { name: 'Singer line 2', exact: true }).selectOption('');
  await seek(lines[1]!.start + 0.01);
  await expect(stage).toHaveAttribute('data-singer', '');
  await expect.poll(async () => (await colours()).includes(singer2)).toBe(false);
  expect(await colours()).toContain(anyone);
}));

for (const width of [1280, 390]) test(`bulk singer assignment keeps passage bounds, drafts and one-step Undo at ${width}px`, async ({ page }) => withClip(page, async id => {
  await page.setViewportSize({ width, height: 900 });
  const tool = page.getByText('Assign duet parts', { exact: true }); await expect(tool).toBeVisible({ timeout: 3000 }); await tool.click();
  const choices = () => page.locator('#cue-list .cue-singer select').evaluateAll(nodes => nodes.map(node => (node as HTMLSelectElement).value));
  const apply = page.getByRole('button', { name: 'Assign singer to lines', exact: true });
  const scope = page.getByRole('combobox', { name: 'Singer assignment scope', exact: true }), role = page.getByRole('combobox', { name: 'Assign these lines to', exact: true });
  const selectPassage = async () => { await scope.selectOption('passage'); await page.getByRole('combobox', { name: 'First line for singer', exact: true }).selectOption('1'); await page.getByRole('combobox', { name: 'Last line for singer', exact: true }).selectOption('2'); };
  const before = (await (await page.request.get(`/api/projects/${id}`)).json()).cues;
  await role.selectOption('1'); await apply.click(); expect(await choices()).toEqual(['1', '1', '1']);
  await selectPassage(); await role.selectOption('2'); await apply.click(); expect(await choices()).toEqual(['1', '2', '2']);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); expect(await choices()).toEqual(['1', '1', '1']);
  await expect(page.locator('#singer-assignment-status')).toHaveText('');
  // An identical assignment must not discard the redo branch or add an undo step.
  await scope.selectOption('all'); await role.selectOption('1'); await apply.click();
  await expect(page.locator('#singer-assignment-status')).toContainText('already');
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click(); expect(await choices()).toEqual(['1', '2', '2']);
  // A raw timing draft and pasted words remain literal when only parts change.
  const raw = page.getByLabel('Start line 3', { exact: true }), rawValue = '0' + Number(before[2].start).toFixed(3); await raw.fill(rawValue);
  await page.getByLabel('Paste lyrics, one line per cue', { exact: true }).fill('Unapplied words');
  await selectPassage(); await role.selectOption(''); await apply.click(); expect(await choices()).toEqual(['1', '', '']);
  await expect(raw).toHaveValue(rawValue); await expect(page.locator('#lyric-draft')).toHaveValue('Unapplied words');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); expect(await choices()).toEqual(['1', '2', '2']);
  await expect(raw).toHaveValue(rawValue); await expect(page.locator('#lyric-draft')).toHaveValue('Unapplied words');
  await page.locator('#discard-draft').click();
  await scope.selectOption('all'); await role.selectOption('both'); await apply.click();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`)).json()).cues.map((cue: { singer?: string }) => cue.singer)).toEqual(['both', 'both', 'both']);
  const saved = (await (await page.request.get(`/api/projects/${id}`)).json()).cues;
  expect(saved.map((cue: { start: number; end: number; text: string }) => [cue.start, cue.end, cue.text])).toEqual(before.map((cue: { start: number; end: number; text: string }) => [cue.start, cue.end, cue.text]));
  const wait = page.waitForEvent('download'); await page.locator('#ass-download').click();
  const ass = await readFile((await (await wait).path())!, 'utf8');
  expect(ass.split('\n').filter(line => line.startsWith('Dialogue:')).map(line => line.split(',')[4])).toEqual(['Both', 'Both', 'Both']);
  await page.reload(); await expect(page.getByRole('combobox', { name: 'Singer line 3', exact: true })).toHaveValue('both');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}));

test('bulk parts refuse incomplete or reversed ranges, preserve invalid timing, and wait for practice and reviews', async ({ page }) => withClip(page, async () => {
  await page.getByText('Assign duet parts', { exact: true }).click();
  const apply = page.locator('#singer-assignment-apply'), status = page.locator('#singer-assignment-status');
  const scope = page.locator('#singer-assignment-scope');
  await scope.selectOption('passage'); await apply.click(); await expect(status).toContainText('first and last');
  await expect(page.locator('#undo-lyrics')).toBeDisabled();
  await page.locator('#singer-assignment-first').selectOption('2'); await page.locator('#singer-assignment-last').selectOption('1');
  await apply.click(); await expect(status).toContainText('ordered'); await expect(page.locator('#undo-lyrics')).toBeDisabled();
  await scope.selectOption('all'); await page.locator('#singer-assignment-role').selectOption('2');
  const raw = page.getByLabel('Start line 3', { exact: true }); await raw.fill('');
  await apply.click(); await expect(raw).toHaveValue(''); await expect(page.locator('#save')).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Singer line 3', exact: true })).toHaveValue('2');
  await page.locator('#undo-lyrics').click(); await expect(raw).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Singer line 3', exact: true })).toHaveValue('');
  await raw.fill('9');
  await page.locator('#practice-repeat').click(); await expect(apply).toBeDisabled({ timeout: 3000 });
  await page.locator('#practice-stop').click(); await expect(apply).toBeEnabled();
  await page.locator('#srt-file').setInputFiles({ name: 'parts.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nReviewed wording\n') });
  await expect(page.locator('#srt-review')).toBeVisible(); await expect(apply).toBeDisabled();
  await page.locator('#srt-cancel').click(); await expect(apply).toBeEnabled();
  await page.locator('#timing-begin').click(); await expect(apply).toBeDisabled();
  await page.locator('#timing-cancel').click(); await expect(apply).toBeEnabled();
}));

test('role-only edits and their Undo/Redo keep native partially typed number inputs and live row bindings', async ({ page }) => withClip(page, async id => {
  await page.getByText('Assign duet parts', { exact: true }).click();
  const raw = page.getByLabel('Start line 3', { exact: true }), original = await raw.inputValue();
  const apply = page.locator('#singer-assignment-apply'); await page.locator('#singer-assignment-role').selectOption('2');
  for (const partial of ['1e', '-']) {
    await raw.fill(''); await raw.pressSequentially(partial);
    const node = await raw.elementHandle();
    await expect.poll(() => raw.evaluate(input => (input as HTMLInputElement).validity.badInput)).toBe(true);
    await apply.click();
    await expect.poll(() => raw.evaluate(input => (input as HTMLInputElement).validity.badInput)).toBe(true);
    expect(await node!.evaluate(input => input.isConnected)).toBe(true);
    await page.locator('#undo-lyrics').click();
    await expect.poll(() => raw.evaluate(input => (input as HTMLInputElement).validity.badInput)).toBe(true);
    await expect(page.getByRole('combobox', { name: 'Singer line 3', exact: true })).toHaveValue('');
    await page.locator('#redo-lyrics').click();
    await expect.poll(() => raw.evaluate(input => (input as HTMLInputElement).validity.badInput)).toBe(true);
    expect(await node!.evaluate(input => input.isConnected)).toBe(true);
    await page.locator('#undo-lyrics').click(); await raw.fill(original);
  }
  await apply.click(); await page.getByLabel('Lyric line 2', { exact: true }).fill('Still bound to the current line');
  await page.locator('#save').click();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`)).json()).cues[1].text).toBe('Still bound to the current line');
  await expect(page.locator('#singer-assignment-status')).toHaveText('');
}));

test('published lyric lookup locks bulk parts until a request or found review is dismissed', async ({ page }) => withClip(page, async () => {
  const words = 'Hello little world\nThis is our chorus\nSing it back to me';
  const record = { id: 42, trackName: 'Test song', artistName: 'Example singer', albumName: 'Demo', duration: 16, instrumental: false, plainLyrics: words };
  let release: () => void = () => undefined; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://lrclib.net/api/get?**', async route => { await gate; await route.fulfill({ json: record, headers: { 'access-control-allow-origin': '*' } }).catch(() => undefined); });
  await page.getByText('Assign duet parts', { exact: true }).click();
  await page.locator('#lyrics-lookup').evaluate(node => { (node as HTMLDetailsElement).open = true; });
  await page.getByLabel('Song title for lookup', { exact: true }).fill('Test song'); await page.getByLabel('Artist for lookup', { exact: true }).fill('Example singer');
  await page.locator('#lookup-find').click();
  try { await expect(page.locator('#singer-assignment-apply')).toBeDisabled({ timeout: 3000 }); }
  finally { release(); }
  await expect(page.locator('#lookup-preview')).toHaveText(words);
  await expect(page.locator('#singer-assignment-apply')).toBeDisabled();
  await page.getByRole('button', { name: 'Dismiss found lyrics', exact: true }).click();
  await expect(page.locator('#lookup-review')).toBeHidden(); await expect(page.locator('#singer-assignment-apply')).toBeEnabled();
  await page.locator('#singer-assignment-apply').click();
  await expect(page.getByRole('combobox', { name: 'Singer line 1', exact: true })).toHaveValue('1');
}));

test('bulk parts wait for word tapping and preserve hand-set word starts through role history', async ({ page }) => withClip(page, async id => {
  await page.getByText('Assign duet parts', { exact: true }).click();
  const apply = page.locator('#singer-assignment-apply');
  await page.getByRole('button', { name: 'Time words line 1', exact: true }).click();
  await expect(apply).toBeDisabled({ timeout: 3000 });
  await page.getByRole('button', { name: 'Cancel word timing', exact: true }).click(); await expect(apply).toBeEnabled();
  const project = await (await page.request.get(`/api/projects/${id}`)).json();
  const line = project.cues[0] as { start: number; end: number; text: string };
  const words = line.text.split(/\s+/), starts = words.map((_, i) => Math.round((line.start + (i + .5) * (line.end - line.start) / words.length) * 100) / 100);
  await page.getByRole('button', { name: 'Time words line 1', exact: true }).click();
  // Paused only once playing, or the player's start is cut short and word timing stops.
  await expect.poll(() => page.locator('audio').evaluate(node => !(node as HTMLAudioElement).paused)).toBe(true);
  await page.locator('audio').evaluate(node => (node as HTMLAudioElement).pause());
  const group = page.getByRole('group', { name: 'Time the words of line 1', exact: true });
  for (const [i, word] of words.entries()) {
    await page.locator('audio').evaluate((node, at) => { (node as HTMLAudioElement).currentTime = at; }, starts[i]);
    await group.getByRole('button', { name: `Word ${i + 1}: ${word}`, exact: true }).click();
  }
  await expect(apply).toBeEnabled(); await page.locator('#singer-assignment-role').selectOption('2'); await apply.click();
  await page.getByRole('button', { name: 'Time words line 1', exact: true }).click();
  await page.locator('#undo-lyrics').click(); await expect(group).toBeHidden({ timeout: 3000 });
  await expect(apply).toBeEnabled(); await page.locator('#redo-lyrics').click();
  await page.locator('#save').click();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`)).json()).cues[0]).toEqual({ ...line, wordStarts: starts, singer: 2 });
}));
