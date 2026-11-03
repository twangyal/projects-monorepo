import { test, expect, type Page } from '@playwright/test';

const words = 'Hello, little world!\nThis is our chorus\nSing it back to me';
const record = { id: 42, trackName: 'Test song', artistName: 'Example singer', albumName: 'Demo', duration: 16, instrumental: false, plainLyrics: words };
function tone(duration = 16) {
  const n = duration * 44100, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(176400, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  return b;
}
// A WAV with RIFF INFO title and artist tags, as music libraries write them.
function tagged(title: string, artist: string) {
  const info = Buffer.concat([['INAM', title], ['IART', artist]].map(([id, text]) => {
    const data = Buffer.from(`${text}\0`, 'utf8'), padded = Buffer.alloc(data.length + (data.length % 2)); data.copy(padded);
    const head = Buffer.alloc(8); head.write(id); head.writeUInt32LE(data.length, 4); return Buffer.concat([head, padded]);
  }));
  const list = Buffer.alloc(12); list.write('LIST'); list.writeUInt32LE(info.length + 4, 4); list.write('INFO', 8);
  const wav = Buffer.concat([tone(), list, info]); wav.writeUInt32LE(wav.length - 8, 4); return wav;
}
test.afterEach(async ({ request }) => {
  const s = await (await request.get('/api/session')).json();
  for (const p of (await (await request.get('/api/projects')).json()).projects) await request.delete(`/api/projects/${p.id}`, { headers: { 'X-Karaoke-Token': s.token }, data: {} });
});
async function upload(page: Page, name: string, buffer: Buffer) {
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles({ name, mimeType: 'audio/wav', buffer });
  await expect(page.locator('#message')).toContainText('Your stems and 3 automatically timed lyric lines', { timeout: 15000 });
}

test('a song file that names its title and artist is offered the published-lyrics lookup beside its automatic lyrics, once', async ({ page }) => {
  const queries: URL[] = [];
  await page.route('https://lrclib.net/api/get?**', route => { queries.push(new URL(route.request().url())); return route.fulfill({ json: record, headers: { 'access-control-allow-origin': '*' } }); });
  await upload(page, '03 - track.wav', tagged('Test song', 'Example singer'));
  const offer = page.locator('#lookup-offer');
  await expect(offer).toContainText('Published lyrics may exist for “Test song” by Example singer');
  await expect(offer).toContainText('sends only the title, artist and clip length');
  expect(queries).toHaveLength(0);
  await offer.getByRole('button', { name: 'Look up published lyrics', exact: true }).click();
  await expect(page.locator('#lyrics-lookup')).toHaveAttribute('open', '');
  await expect(page.locator('#lookup-preview')).toHaveText(words);
  expect(queries).toHaveLength(1);
  expect(queries[0].searchParams.get('track_name')).toBe('Test song');
  await expect(offer).toBeHidden();
  // Once looked up, the clip is not offered it again.
  await page.reload();
  await expect(page.locator('#auto-status')).toContainText('words were recognized');
  await expect(offer).toBeHidden();
});

test('a song file that does not name its artist is not offered a lookup', async ({ page }) => {
  await upload(page, 'sing-along.wav', tone());
  await expect(page.locator('#auto-status')).toContainText('words were recognized');
  await expect(page.locator('#lookup-offer')).toBeHidden();
});
