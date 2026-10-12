import { test, expect, type Page, type Browser } from '@playwright/test';
import { cleanup } from './saved-mixes-fixtures';

// tests/browser_server.py starts a loopback fake of Spotify's accounts service and Web API.
const FAKE = `http://127.0.0.1:${process.env.DUET_TEST_SPOTIFY_PORT ?? 4221}`;
async function spotify(command: Record<string, unknown>) {
  const response = await fetch(`${FAKE}/__test/control`, { method: 'POST', body: JSON.stringify(command) });
  expect(response.ok).toBe(true);
}

const section = (page: Page) => page.locator('#listening');

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
  } finally {
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
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await cleanup(page); await close();
  }
});
