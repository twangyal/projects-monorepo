import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

function tone(): Buffer {
  const frames = 16 * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 44100) * 5000), 44 + i * 4 + channel * 2);
  return wav;
}
// The entries of a zip whose files are stored or deflated.
function entries(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    const method = bytes.readUInt16LE(offset + 8), length = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), start = offset + 30 + nameLength + extra;
    const data = bytes.subarray(start, start + length);
    expect([0, 8]).toContain(method);
    files.set(name, method === 8 ? inflateRawSync(data) : data); offset = start + length;
  }
  return files;
}
async function withClip(page: Page, run: (id: string) => Promise<void>) {
  let ownedId: string | null = null;
  try {
    await page.goto('/');
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'Nina - Blue Skies.wav', mimeType: 'audio/wav', buffer: tone() });
    ownedId = (await (await accepted).json()).job.projectId;
    await expect(page.locator('#message')).toContainText('3 automatically timed lyric lines', { timeout: 15000 });
    await run(ownedId!);
  } finally {
    const session = await (await page.request.get('/api/session')).json();
    if (ownedId) await page.request.delete(`/api/projects/${ownedId}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} });
  }
}

test('a clip exports as MP3+G karaoke: CD+G lyric graphics beside an MP3 of the backing, in the chosen lyric style', async ({ page }) => withClip(page, async id => {
  test.setTimeout(90000);
  await page.locator('#lyric-style').selectOption('contrast');
  const button = page.getByRole('button', { name: 'Export MP3+G karaoke', exact: true });
  await expect(button).toBeEnabled();
  const download = page.waitForEvent('download', { timeout: 60000 });
  await button.click();
  await expect(page.locator('#message')).toContainText('Preparing MP3+G karaoke in the original key');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mp3g\.zip$/);
  await expect(page.locator('#message')).toContainText('MP3+G karaoke ready');
  const files = entries(await readFile((await file.path())!));
  const names = [...files.keys()].sort(), base = names[0]!.replace(/\.cdg$/, '');
  expect(names).toEqual([`${base}.cdg`, `${base}.mp3`]);
  expect(files.get(`${base}.mp3`)!.length).toBeGreaterThan(10000);
  // 300 packets of 24 bytes a second, for the whole clip.
  const graphics = files.get(`${base}.cdg`)!;
  expect(graphics.length).toBe(16 * 300 * 24);
  const instructions = Array.from({ length: graphics.length / 24 }, (_, k) => graphics[k * 24] === 0x09 ? graphics[k * 24 + 1]! : -1);
  // The colours come first: high contrast's black background and white lyrics.
  expect(instructions.slice(0, 2)).toEqual([30, 31]);
  expect([...graphics.subarray(4, 8)]).toEqual([0, 0, 0x3f, 0x3f]);
  // The lyric lines are drawn in tiles and lit word by word with XOR tiles.
  expect(instructions.filter(kind => kind === 6).length).toBeGreaterThan(100);
  expect(instructions.filter(kind => kind === 38).length).toBeGreaterThan(20);
  // The download is refused for another saved revision, and a changed request is checked.
  const session = await (await page.request.get('/api/session')).json(), headers = { 'X-Karaoke-Token': session.token };
  const refused = await page.request.post(`/api/projects/${id}/mp3g`, { headers, data: { revision: 0, style: 'neon' } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toContain('lyric style');
}));

test('a saved duet keeps each singer in its MP3+G graphics and highlights with the part colours', async ({ page }) => withClip(page, async id => {
  test.setTimeout(90000);
  for (const [line, singer] of [[1, '1'], [2, '2'], [3, 'both']] as const) {
    await page.getByRole('combobox', { name: `Singer line ${line}`, exact: true }).selectOption(singer);
  }
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`)).json()).cues.map((cue: { singer?: string }) => cue.singer)).toEqual([1, 2, 'both']);
  const downloaded = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: 'Export MP3+G karaoke', exact: true }).click();
  const files = entries(await readFile((await (await downloaded).path())!));
  const data = [...files].find(([name]) => name.endsWith('.cdg'))![1];
  const drawn = new Set<number>(), flips = new Set<number>(), colours = new Map<number, number[]>();
  for (let offset = 0; offset < data.length; offset += 24) {
    if ((data[offset]! & 0x3f) !== 9) continue;
    const kind = data[offset + 1]! & 0x3f;
    if (kind === 6) drawn.add(data[offset + 5]! & 15);
    if (kind === 38) flips.add(data[offset + 5]! & 15);
    if (kind === 30 || kind === 31) for (let k = 0; k < 8; k++) {
      const high = data[offset + 4 + k * 2]!, low = data[offset + 5 + k * 2]!;
      colours.set((kind === 31 ? 8 : 0) + k, [high >> 2, ((high & 3) << 2) | (low >> 4), low & 15]);
    }
  }
  // All three roles are drawn; XOR 1 turns their unsung slots4/6/8 into sung slots5/7/9, leaving background alone.
  for (const colour of [4, 6, 8]) expect(drawn.has(colour)).toBe(true);
  expect([...flips]).toEqual([1]);
  expect(colours.get(5)).toEqual([13, 11, 7]);
  expect(colours.get(7)).toEqual([8, 12, 15]);
  expect(colours.get(9)).toEqual([12, 10, 15]);
}));
