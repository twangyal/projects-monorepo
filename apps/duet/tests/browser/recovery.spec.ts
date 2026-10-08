import { test, expect, type Page } from '@playwright/test';

const firstRoom = 'a'.repeat(32), secondRoom = 'b'.repeat(32);
const firstTrack = '1'.repeat(32), secondTrack = '2'.repeat(32);
const token = 'c'.repeat(64), inviteToken = 'd'.repeat(64);
interface Playback { trackId: string; playing: boolean; position: number; revision: number }

// These cases isolate response ordering; real service/audio acceptance lives in
// workflow.spec.ts and sync.spec.ts. Every response uses the production schema.
async function fixture(page: Page) {
  let playback: Playback = { trackId: firstTrack, playing: false, position: 10, revision: 1 };
  const writes: Playback[] = [];
  const snapshot = (id: string) => ({
    id, title: id === firstRoom ? 'Room A' : 'Room B', createdAt: 1,
    profiles: { host: { name: 'Alex' }, guest: null }, myRole: 'host', serverTime: Date.now(),
    tracks: [firstTrack, secondTrack].map((id, index) => ({
      id, title: `Song ${index + 1}`, artist: '', duration: 100, uploadedBy: 'host', createdAt: index,
    })),
    ratings: { [firstTrack]: { host: 0, guest: 0 }, [secondTrack]: { host: 0, guest: 0 } }, blend: [], playlist: [firstTrack, secondTrack], playlistRevision: 0,
    savedMixes: [], savedMixesRevision: 0,
    playback: { ...playback }, memories: [], activeJob: null,
  });
  await page.addInitScript(({ firstRoom, secondRoom, token }) => {
    localStorage.setItem('duet-participants-v1', JSON.stringify({
      [firstRoom]: { token, title: 'Room A' }, [secondRoom]: { token, title: 'Room B' },
    }));
  }, { firstRoom, secondRoom, token });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/audio')) { await route.fulfill({ status: 404, body: '' }); return; }
    if (path.endsWith('/playback')) {
      const command = route.request().postDataJSON() as Playback;
      writes.push(command);
      playback = { ...command, revision: playback.revision + 1, playing: command.playing && command.position < 100 };
    }
    await route.fulfill({ json: snapshot(path.split('/')[3]) });
  });
  await page.goto(`/?room=${firstRoom}`);
  await expect(page.locator('#room-heading')).toHaveText('Room A');
  return { writes, update: (value: Playback) => { playback = value; } };
}

for (const changedTrack of [false, true]) {
  test(`seek gesture cannot overwrite a partner's ${changedTrack ? 'new song' : 'new position'}`, async ({ page }) => {
    const state = await fixture(page);
    await page.locator('#seek').evaluate((slider: HTMLInputElement) => {
      slider.value = '45'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const response = page.waitForResponse(async response => {
      if (!response.url().endsWith(`/api/rooms/${firstRoom}`)) return false;
      return (await response.json()).playback.revision === 2;
    });
    state.update({ trackId: changedTrack ? secondTrack : firstTrack, playing: false, position: 3, revision: 2 });
    await response;
    // The displayed position remains the user's draft while the new snapshot
    // arrives; the release must validate the revision captured at gesture start.
    if (changedTrack) await expect(page.locator('#playing-title')).toHaveText('Song 2');
    await page.locator('#seek').dispatchEvent('change');
    await expect(page.locator('#notice')).toContainText('Playback changed while you were seeking');
    expect(state.writes).toEqual([]);
    await expect(page.locator('#seek')).toHaveValue('3');
    // A fresh, intentional seek still works after rejecting the stale gesture.
    await page.locator('#seek').evaluate((slider: HTMLInputElement) => {
      slider.value = '12'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]).toMatchObject({ trackId: changedTrack ? secondTrack : firstTrack, revision: 2, position: 12 });
  });
}

test('an invitation response cannot publish an old room token after switching rooms', async ({ page }) => {
  await fixture(page);
  let release!: () => void, requested!: () => void, fulfilled!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = new Promise<void>(resolve => { requested = resolve; });
  const finished = new Promise<void>(resolve => { fulfilled = resolve; });
  await page.route(`**/api/rooms/${firstRoom}/invite`, async route => {
    requested(); await gate;
    await route.fulfill({ json: { inviteToken } }); fulfilled();
  });
  await page.locator('#invite').click(); await pending;
  await page.locator('#leave-room').click();
  await page.getByRole('button', { name: 'Room B', exact: true }).click();
  await expect(page.locator('#room-heading')).toHaveText('Room B');
  release(); await finished;
  // Wait until the response's continuation has run, rather than asserting while
  // the old request is still blocked in the route handler.
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 100)));
  await expect(page.locator('#link-panel')).toBeHidden();
  await expect(page.locator('#share-link')).toHaveValue('');
  await page.locator('#access-link').click();
  await expect(page.locator('#share-link')).toHaveValue(new RegExp(`room=${secondRoom}#access=${token}$`));
});

test('Play together restarts a song that has reached the end of the mix', async ({ page }) => {
  const state = await fixture(page);
  state.update({ trackId: secondTrack, playing: false, position: 100, revision: 2 });
  await expect(page.locator('#playing-title')).toHaveText('Song 2');
  await expect(page.locator('#seek')).toHaveValue('100');
  await page.getByRole('button', { name: 'Play together', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({ trackId: secondTrack, playing: true, position: 0, revision: 2 });
  await expect(page.locator('#play')).toHaveText('Pause together');
});
