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
// The entries of a zip whose files are stored uncompressed.
function stored(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), start = offset + 30 + nameLength + extra;
    files.set(name, bytes.subarray(start, start + length)); offset = start + length;
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

test('a clip exports as an UltraStar song: its lyrics on the melody, beside the song, backing and vocals', async ({ page }) => withClip(page, async () => {
  test.setTimeout(90000);
  const button = page.getByRole('button', { name: 'Export UltraStar song', exact: true });
  await expect(button).toBeEnabled();
  const download = page.waitForEvent('download', { timeout: 60000 });
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.ultrastar\.zip$/);
  await expect(page.locator('#message')).toContainText('UltraStar song ready');
  const files = stored(await readFile((await file.path())!));
  const folder = [...files.keys()].find(name => name.endsWith('.txt'))!.split('/')[0]!;
  expect([...files.keys()].sort()).toEqual([`${folder}/${folder} [INSTR].mp3`, `${folder}/${folder} [VOC].mp3`, `${folder}/${folder}.mp3`, `${folder}/${folder}.txt`]);
  for (const [name, data] of files) if (name.endsWith('.mp3')) expect(data.length).toBeGreaterThan(10000);
  const text = files.get(`${folder}/${folder}.txt`)!.toString('utf8');
  expect(text).toContain(`#MP3:${folder}.mp3`);
  expect(text).toContain(`#INSTRUMENTAL:${folder} [INSTR].mp3`);
  expect(text).toMatch(/#BPM:400\n#GAP:\d+\n/);
  // The fixture's lines, each word a note: the tone's A (MIDI 57, three below middle C) where the melody guide found it.
  const sung = text.split('\n').filter(line => /^[:F] /.test(line)).map(line => line.split(' ').slice(4).join(' ').trim());
  expect(sung.filter(word => word !== '~')).toEqual(['Hello', 'little', 'world', 'This', 'is', 'our', 'chorus', 'Sing', 'it', 'back', 'to', 'me']);
  expect(text.split('\n').filter(line => line.startsWith(': ')).every(line => line.split(' ')[3] === '-3')).toBe(true);
  expect(text.split('\n').filter(line => line.startsWith('- '))).toHaveLength(2);
  expect(text.trimEnd().endsWith('E')).toBe(true);
}));

for(const width of [1280,390])test(`saved duet assignments export two UltraStar voices at ${width}px`,async({page})=>withClip(page,async id=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:900});
  for(const [index,singer] of ['1','2','both'].entries())await page.getByRole('combobox',{name:`Singer line ${index+1}`,exact:true}).selectOption(singer);
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
  const before=await(await page.request.get(`/api/projects/${id}`)).json();
  const pending=page.waitForEvent('download',{timeout:60000});await page.getByRole('button',{name:'Export UltraStar song',exact:true}).click();
  const files=stored(await readFile((await(await pending).path())!)),text=[...files].find(([name])=>name.endsWith('.txt'))![1].toString('utf8');
  expect(text).toContain('#P1:Singer 1');expect(text).toContain('#P2:Singer 2');
  const [first,second]=text.split('\nP1\n')[1]!.split('\nP2\n');
  const words=(track:string)=>track.split('\n').filter(line=>/^[:F] /.test(line)).map(line=>line.split(' ').slice(4).join(' ').trim()).filter(word=>word!=='~');
  expect(words(first!)).toEqual(['Hello','little','world','Sing','it','back','to','me']);
  expect(words(second!)).toEqual(['This','is','our','chorus','Sing','it','back','to','me']);
  expect((await(await page.request.get(`/api/projects/${id}`)).json())).toEqual(before);
  expect([...files.keys()].filter(name=>name.endsWith('.mp3'))).toHaveLength(3);
}));
