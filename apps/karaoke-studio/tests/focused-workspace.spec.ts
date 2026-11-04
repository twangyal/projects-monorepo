import { test, expect, type Page } from '@playwright/test';

// The studio's default view: the preview beside one tool at a time. (Other specs list every tool.)
test.use({ storageState: { cookies: [], origins: [] } });

const words = 'Hello, little world!\nThis is our chorus\nSing it back to me';
const record = { id: 42, trackName: 'Test song', artistName: 'Example singer', albumName: 'Demo', duration: 16, instrumental: false, plainLyrics: words };
const SRT = '1\n00:00:01,000 --> 00:00:03,000\nFirst imported line\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond imported line\n';
const TOOLS = ['#tool-song', '#tool-lyrics', '#tool-get', '#tool-timing', '#tool-practice', '#tool-export'];
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
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
async function upload(page: Page, name = 'Midnight Drive.wav', buffer = tone()) {
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles({ name, mimeType: 'audio/wav', buffer });
  await expect(page.locator('#message')).toContainText('Your stems and 3 automatically timed lyric lines', { timeout: 15000 });
}

for (const width of [1280, 390]) test(`the studio starts on the song, then shows a new clip's lyrics beside the preview, at ${width}px`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await expect(tab(page, 'Song')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Choose an audio clip', { exact: true })).toBeVisible();
  for (const id of TOOLS.slice(1)) await expect(page.locator(id)).toBeHidden();
  await expect(page.locator('.intro')).toBeHidden();
  await upload(page);
  // The song is ready: its lyrics come forward.
  await expect(tab(page, 'Lyrics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tool-song')).toBeHidden();
  const line = page.getByLabel('Lyric line 1', { exact: true });
  await expect(line).toHaveValue('Hello little world');
  if (width === 1280) {
    // The preview and the first lines share the first screen, side by side.
    const stage = (await page.locator('#stage').boundingBox())!, first = (await line.boundingBox())!;
    expect(stage.x + stage.width).toBeLessThan(first.x);
    expect(stage.y + stage.height).toBeLessThan(800);
    expect(first.y + first.height).toBeLessThan(800);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  // A correction is saved from the bar above the tools, whichever tool is open.
  await line.fill('Hello little world tonight');
  await expect(page.locator('#save-state')).toContainText('Unsaved lyric edits');
  await tab(page, 'Export').click();
  await expect(page.locator('#tool-lyrics')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export karaoke MP4', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.srt$/);
  // The tabs follow the arrow keys, Home and End.
  await tab(page, 'Export').focus(); await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Song')).toBeFocused(); await expect(page.locator('#tool-song')).toBeVisible();
  await page.keyboard.press('End'); await expect(tab(page, 'Export')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft'); await expect(tab(page, 'Practice')).toBeFocused(); await expect(page.locator('#tool-practice')).toBeVisible();
  await page.keyboard.press('Home'); await expect(tab(page, 'Song')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('a tool that needs another brings it forward', async ({ page }) => {
  await page.goto('/');
  await upload(page);
  // Select timing opens the waveform on that line.
  await page.getByRole('button', { name: 'Select timing line 2', exact: true }).click();
  await expect(tab(page, 'Timing')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#waveform-detail')).toBeVisible();
  await expect(page.locator('#waveform-cue')).toHaveValue('1');
  // Pasted lyrics become the lines, shown in Lyrics; focus left on the hidden button moves to its tab.
  await tab(page, 'Get lyrics').click();
  await page.getByLabel('Paste lyrics, one line per cue').fill('One\nTwo\nThree');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(tab(page, 'Lyrics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('One');
  await expect(tab(page, 'Lyrics')).toBeFocused();
  // A chosen SRT file is checked and reviewed beside the lines.
  await tab(page, 'Get lyrics').click();
  await page.locator('#srt-file').setInputFiles({ name: 'lines.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
  await expect(tab(page, 'Lyrics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#srt-review')).toBeVisible();
  await expect(page.locator('#srt-review-list [data-srt-cue]')).toHaveCount(2);
  await page.locator('#srt-cancel').click();
  await expect(page.locator('#srt-review')).toBeHidden();
  // The automatic lyrics are reviewed there too.
  await tab(page, 'Practice').click();
  await tab(page, 'Lyrics').click();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.locator('#srt-review')).toBeVisible();
  await expect(page.locator('#srt-review-list li')).toHaveCount(3);
});

test('published lyrics are looked up in Get lyrics, and pointed to from the lyrics until used', async ({ page }) => {
  await page.route('https://lrclib.net/api/get?**', route => route.fulfill({ json: record, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/');
  await upload(page, '03 - track.wav', tagged('Test song', 'Example singer'));
  await expect(tab(page, 'Lyrics')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Look up published lyrics', exact: true }).click();
  await expect(tab(page, 'Get lyrics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#lookup-preview')).toHaveText(words);
  await tab(page, 'Lyrics').click();
  const found = page.locator('#lookup-found');
  await expect(found).toContainText('Published lyrics were found for “Test song” by Example singer');
  await found.getByRole('button', { name: 'Review published lyrics', exact: true }).click();
  await expect(tab(page, 'Get lyrics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#lookup-review')).toBeVisible();
  await page.getByRole('button', { name: 'Use lyrics and align', exact: true }).click();
  await expect(tab(page, 'Lyrics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Hello, little world!');
  await expect(found).toBeHidden();
});

test('Show all tools lists every tool and is remembered in this browser', async ({ page }) => {
  await page.goto('/');
  const mode = page.getByRole('button', { name: 'Show all tools', exact: true });
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await mode.click();
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tablist')).toBeHidden();
  for (const id of TOOLS) await expect(page.locator(id)).toBeVisible();
  await page.reload();
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  for (const id of TOOLS) await expect(page.locator(id)).toBeVisible();
  await mode.click();
  await expect(tab(page, 'Song')).toHaveAttribute('aria-selected', 'true');
  for (const id of TOOLS.slice(1)) await expect(page.locator(id)).toBeHidden();
  await page.reload();
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#tool-export')).toBeHidden();
});
