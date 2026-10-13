import { test, expect, type Page, type Browser } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';
import { cleanup } from './saved-mixes-fixtures';

// tests/browser_server.py starts a loopback fake of Spotify's accounts service and Web API.
const FAKE = `http://127.0.0.1:${process.env.DUET_TEST_SPOTIFY_PORT ?? 4221}`;
async function spotify(command: Record<string, unknown>) {
  const response = await fetch(`${FAKE}/__test/control`, { method: 'POST', body: JSON.stringify(command) });
  expect(response.ok).toBe(true);
}

const section = (page: Page) => page.locator('#listening');

// A genuine 24×16 PNG so the browser must actually decode the stored photo.
function png(): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(kind), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(24, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 16 }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.alloc(72, y * 12)])));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function pair(page: Page, browser: Browser, baseURL: string | undefined) {
  await page.goto('/'); await page.locator('#host-name').fill('Ada'); await page.locator('#room-title').fill('Our listening');
  await page.getByRole('button', { name: 'Create our room', exact: true }).click();
  await expect(page.locator('#room-heading')).toHaveText('Our listening');
  const invite = await page.locator('#share-link').inputValue(); await page.locator('#close-link').click();
  const context = await browser.newContext({ baseURL }), guest = await context.newPage();
  await guest.goto(invite); await guest.locator('#guest-name').fill('Ben');
  await guest.getByRole('button', { name: 'Join the room', exact: true }).click(); await expect(guest.locator('#room-view')).toBeVisible();
  return { guest, close: () => context.close() };
}

// Connecting leaves Duet for the (fake) Spotify approval page and returns to the room.
async function connect(page: Page, user: string | null) {
  await spotify({ nextUser: user });
  await section(page).getByRole('button', { name: 'Connect my Spotify' }).click();
  await page.waitForURL(/\?room=[a-f0-9]{32}$/);
  await expect(page.locator('#room-view')).toBeVisible();
}

test('two people connect Spotify, see automatic entries, curate them durably and disconnect', async ({ page, browser, baseURL }) => {
  const suffix = Date.now().toString(36);
  const [ada, ben] = [`ada${suffix}`, `ben${suffix}`];
  await spotify({ users: { [ada]: 'Ada Spotify', [ben]: 'Ben Spotify' }, plays: [
    { user: ada, minutesAgo: 2 * 1440, id: `Shared${suffix}`, title: 'Harbour Lights', artist: 'The Tides' },
    { user: ben, minutesAgo: 3 * 1440, id: `Shared${suffix}`, title: 'Harbour Lights', artist: 'The Tides' },
  ] });
  const { guest, close } = await pair(page, browser, baseURL);
  try {
    await expect(section(page)).toContainText('Your Spotify is not connected.');
    await expect(section(guest)).toContainText('Ada has not connected Spotify yet.');

    await connect(page, ada);
    await expect(section(page)).toContainText('Ada · connected as Ada Spotify');
    await expect(section(page)).toContainText('Nothing yet', { timeout: 10000 });

    await connect(guest, ben);
    const shared = section(guest).locator('.timeline-entry.kind-both');
    await expect(shared).toContainText('You both played “Harbour Lights” by The Tides');
    await expect(shared).toContainText('Played separately; not necessarily together.');
    await expect(shared.getByRole('link', { name: 'Open in Spotify' })).toHaveAttribute('href', `https://open.spotify.com/track/Shared${suffix}`);

    // New listening becomes entries with no approval step.
    await spotify({ plays: [{ user: ada, minutesAgo: 1, id: `Fresh${suffix}`, title: 'Paper Boats' }],
      likes: [{ user: ben, minutesAgo: 0, id: `Fave${suffix}`, title: 'Late Train' }] });
    await section(page).getByRole('button', { name: 'Check Spotify now' }).click();
    const fresh = section(page).locator('.timeline-entry', { hasText: 'Ada heard “Paper Boats” by Artist for the first time' });
    await expect(fresh).toBeVisible();
    await expect(section(page).locator('.timeline-entry.kind-favorite')).toContainText('Ben added “Late Train” by Artist to Liked Songs');

    // Hidden entries stay hidden after later checks and can be restored.
    await fresh.getByRole('button', { name: 'Hide' }).click();
    await expect(fresh).toBeHidden();
    await spotify({ plays: [{ user: ada, minutesAgo: 0, id: `Fresh${suffix}`, title: 'Paper Boats' }] });
    await section(page).getByRole('button', { name: 'Check Spotify now' }).click();
    await expect(section(page).getByRole('button', { name: 'Show hidden (1)' })).toBeVisible();
    await expect(section(page).locator('.timeline-entry', { hasText: 'Paper Boats' })).toHaveCount(0);
    await section(page).getByRole('button', { name: 'Show hidden (1)' }).click();
    const restored = section(page).locator('.timeline-entry.is-hidden', { hasText: 'Paper Boats' });
    await expect(restored).toContainText('played twice so far');
    await restored.getByRole('button', { name: 'Restore' }).click();
    await section(page).getByRole('button', { name: 'Hide removed entries' }).click();
    await expect(section(page).locator('.timeline-entry', { hasText: 'Paper Boats' })).toBeVisible();

    // Captions and written entries are shared; only the writer can delete a written entry.
    const sharedForHost = section(page).locator('.timeline-entry.kind-both');
    await sharedForHost.getByRole('button', { name: 'Add caption' }).click();
    await sharedForHost.getByLabel('Caption').fill('Our first road trip song');
    await sharedForHost.getByRole('button', { name: 'Save caption' }).click();
    await expect(sharedForHost.locator('.caption')).toHaveText('Our first road trip song');
    const form = section(guest).locator('#timeline-manual');
    await form.getByLabel('Date').fill('2025-06-01');
    await form.getByLabel('What happened').fill('Concert in the rain');
    await form.getByLabel('Song').fill('Harbour Lights');
    await form.getByRole('button', { name: 'Add to our timeline' }).click();
    await expect(form.getByLabel('What happened')).toHaveValue('');
    await page.reload(); await expect(page.locator('#room-view')).toBeVisible();
    const written = section(page).locator('.timeline-entry.kind-manual');
    await expect(written).toContainText('Concert in the rain');
    await expect(written).toContainText('Written by Ben');
    await expect(written.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(section(page).locator('.timeline-entry.kind-both .caption')).toHaveText('Our first road trip song');

    // A memory with a photo attaches to the song and appears for both people.
    const sharedForGuest = section(guest).locator('.timeline-entry.kind-both');
    await sharedForGuest.getByRole('button', { name: 'Add a memory' }).click();
    const memoryForm = sharedForGuest.locator('.memory-form');
    await memoryForm.getByLabel('Memory date').fill('2025-07-04');
    await memoryForm.getByLabel('Memory', { exact: true }).fill('Windows down on the coast road');
    await memoryForm.getByLabel('Photo (optional)').setInputFiles({ name: 'coast.png', mimeType: 'image/png', buffer: png() });
    await memoryForm.getByRole('button', { name: 'Keep this memory' }).click();
    await expect(sharedForGuest.locator('.memory-item img')).toBeVisible();
    await page.reload(); await expect(page.locator('#room-view')).toBeVisible();
    const hostMemory = section(page).locator('.timeline-entry.kind-both .memory-item');
    await expect(hostMemory).toContainText('Windows down on the coast road');
    await expect(hostMemory).toContainText('Ben');
    // The photo is lazy-loaded, as on a real page: bring it into view like a reader would.
    await hostMemory.locator('img').scrollIntoViewIfNeeded();
    await expect.poll(() => hostMemory.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(24);
    await expect(hostMemory.getByRole('button', { name: 'Edit memory' })).toHaveCount(0);
    await expect(section(page).locator('.all-memories summary')).toHaveText('All our memories (1)');
    // Only the author edits; an edit keeps the photo.
    const guestMemory = section(guest).locator('.timeline-entry.kind-both .memory-item');
    await guestMemory.getByRole('button', { name: 'Edit memory' }).click();
    await guestMemory.getByLabel('Memory', { exact: true }).fill('Windows down on the coast road, singing');
    await guestMemory.getByRole('button', { name: 'Save memory' }).click();
    await expect(section(guest).locator('.timeline-entry.kind-both .memory-item').first()).toContainText('singing');
    await expect(section(guest).locator('.timeline-entry.kind-both .memory-item img')).toBeVisible();

    // Credentials never reach the browser.
    const reply = await page.evaluate(async () => {
      const id = new URL(location.href).searchParams.get('room')!;
      const token = JSON.parse(localStorage.getItem('duet-participants-v1')!)[id].token;
      return (await fetch(`/api/rooms/${id}/listening`, { headers: { Authorization: `Bearer ${token}` } })).text();
    });
    expect(reply.toLowerCase()).not.toContain('token');

    page.once('dialog', dialog => void dialog.accept());
    await section(page).getByRole('button', { name: 'Disconnect my Spotify' }).click();
    await expect(section(page)).toContainText('Your Spotify is not connected.');
    await expect(section(page).locator('.timeline-entry.kind-both')).toHaveCount(0);
    await expect(section(page).locator('.timeline-entry.kind-manual')).toHaveCount(1);
    // Memories outlive the disconnected listening and stay revisitable in the full list.
    await expect(section(page).locator('.all-memories summary')).toHaveText('All our memories (1)');
  } finally {
    await cleanup(page); await close();
  }
});

test('a slice of the timeline becomes a private playlist in one person’s Spotify, after granting the new permission without losing listening', async ({ page, browser, baseURL }) => {
  const suffix = Date.now().toString(36);
  const [ada, ben] = [`pada${suffix}`, `pben${suffix}`];
  await spotify({ users: { [ada]: 'Ada Spotify', [ben]: 'Ben Spotify' }, plays: [
    { user: ada, minutesAgo: 2 * 1440, id: `Shared${suffix}`, title: 'Harbour Lights', artist: 'The Tides' },
    { user: ben, minutesAgo: 3 * 1440, id: `Shared${suffix}`, title: 'Harbour Lights', artist: 'The Tides' },
  ] });
  const { guest, close } = await pair(page, browser, baseURL);
  try {
    // Ada approved Duet before playlists existed: only the two read permissions.
    await spotify({ granted: 'user-read-recently-played user-library-read' });
    await connect(page, ada);
    await spotify({ granted: null });
    await connect(guest, ben);
    await spotify({ plays: [{ user: ada, minutesAgo: 1, id: `Fresh${suffix}`, title: 'Paper Boats' }] });
    await section(page).getByRole('button', { name: 'Check Spotify now' }).click();
    await expect(section(page).locator('.timeline-entry', { hasText: 'Paper Boats' })).toBeVisible();

    const panel = section(page).locator('#timeline-playlists');
    await panel.locator('summary').click();
    await expect(panel.locator('#playlist-hint')).toContainText('needs one more permission');
    await expect(panel.getByRole('button', { name: 'Create in my Spotify' })).toBeDisabled();
    // Reconnecting the same account grants it and keeps the imported listening.
    await spotify({ nextUser: ada });
    await panel.getByRole('button', { name: 'Reconnect my Spotify' }).click();
    await page.waitForURL(/\?room=[a-f0-9]{32}$/);
    await expect(section(page).locator('.timeline-entry', { hasText: 'Paper Boats' })).toBeVisible();
    await expect(section(page).locator('.timeline-entry.kind-both')).toContainText('Harbour Lights');

    await panel.locator('summary').click();
    await expect(panel.locator('#playlist-hint')).toHaveText('');
    await panel.getByLabel('Playlist name').fill('Our coast week');
    await panel.getByLabel('First-time songs').uncheck();
    await panel.getByRole('button', { name: 'Preview songs' }).click();
    await expect(panel.locator('#playlist-preview')).toContainText('1 song, oldest first');
    await expect(panel.locator('#playlist-preview li')).toHaveText(['“Harbour Lights” by The Tides']);
    await panel.getByLabel('First-time songs').check();
    await expect(panel.locator('#playlist-preview')).toBeEmpty();
    await panel.getByRole('button', { name: 'Preview songs' }).click();
    await expect(panel.locator('#playlist-preview li')).toHaveText(['“Harbour Lights” by The Tides', '“Paper Boats” by Artist']);
    await panel.getByRole('button', { name: 'Create in my Spotify' }).click();
    await expect(page.locator('#notice')).toContainText('Created “Our coast week” with 2 songs in your Spotify.');
    await expect(panel.getByLabel('Playlist name')).toHaveValue('');

    const made = (await (await fetch(`${FAKE}/__test/playlists`)).json()).playlists.filter((item: { name: string }) => item.name === 'Our coast week');
    expect(made).toEqual([{ user: ada, name: 'Our coast week', public: false, description: 'Made with Duet from our shared listening timeline.',
      uris: [`spotify:track:Shared${suffix}`, `spotify:track:Fresh${suffix}`] }]);
    const link = panel.getByRole('link', { name: 'Our coast week' });
    await expect(link).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/playlist\/[0-9a-f]+$/);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // Ben sees the playlist in the shared timeline; his own creation goes to his account.
    await guest.reload(); await expect(guest.locator('#room-view')).toBeVisible();
    const guestPanel = section(guest).locator('#timeline-playlists');
    await guestPanel.locator('summary').click();
    await expect(guestPanel.locator('#playlist-list')).toContainText('Our coast week · 2 songs · in Ada’s Spotify');
    await guestPanel.getByLabel('Playlist name').fill('Ben’s picks');
    await guestPanel.getByLabel('Songs we both played').uncheck();
    await guestPanel.getByLabel('First-time songs').uncheck();
    await guestPanel.getByRole('button', { name: 'Create in my Spotify' }).click();
    await expect(guest.locator('#notice')).toContainText('No timeline songs match these choices yet.');
  } finally {
    await spotify({ granted: null });
    await cleanup(page); await close();
  }
});

test('a refused Spotify approval returns to the room with an explanation and connects nothing', async ({ page, browser, baseURL }) => {
  const { close } = await pair(page, browser, baseURL);
  try {
    await connect(page, null);
    await expect(section(page)).toContainText('The Spotify connection was cancelled or refused. Nothing was connected.');
    await expect(section(page).getByRole('button', { name: 'Connect my Spotify' })).toBeVisible();
  } finally {
    await cleanup(page); await close();
  }
});

test('the timeline fits a phone-width screen', async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { close } = await pair(page, browser, baseURL);
  try {
    await expect(section(page).locator('#timeline-manual')).toBeVisible();
    await section(page).locator('#timeline-playlists summary').click();
    await expect(section(page).getByLabel('Playlist name')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await cleanup(page); await close();
  }
});
