import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, createRoom, joinRoom, uploadOriginal, track, audioState, seat, accessLink } from './https-lan-fixtures.ts';

test('HTTPS setup authority is creation-only, immediately cleared, never stored, and failed mutation is not replayed', async ({ lan }) => {
  const context = await lan.browser.newContext(), page = await context.newPage();
  try {
    await page.goto(lan.origin); await expect(page.locator('#transport-status')).toContainText(lan.origin); await expect(page.locator('#setup-key')).toHaveAttribute('type', 'password'); await expect(page.locator('#setup-key')).toHaveAttribute('autocomplete', 'off');
    const denied = await page.evaluate(async () => (await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'No authority', name: 'Stranger' }) })).status); expect(denied).toBeGreaterThanOrEqual(400);
    await page.locator('#host-name').fill('Arden'); await page.locator('#room-title').fill('Lost response107'); await page.locator('#setup-key').fill(lan.setup);
    await page.evaluate(() => {
      const root = window as unknown as { creationEntered?: boolean; releaseCreation?: () => void; creationCount?: number }; const native = window.fetch;
      window.fetch = async (...args) => { const url = String(args[0]); if (url !== '/api/rooms' || args[1]?.method !== 'POST') return native(...args); root.creationCount = (root.creationCount ?? 0) + 1; await native(...args); root.creationEntered = true; await new Promise<void>(done => { root.releaseCreation = done; }); throw new TypeError('Controlled lost response after real HTTPS creation'); };
    });
    await page.getByRole('button', { name: 'Create our room', exact: true }).click(); await expect.poll(() => page.evaluate(() => (window as unknown as { creationEntered?: boolean }).creationEntered)).toBe(true); await expect(page.locator('#setup-key')).toHaveValue('');
    await page.evaluate(() => (window as unknown as { releaseCreation?: () => void }).releaseCreation?.()); await expect(page.locator('#notice')).toBeVisible();
    expect(await page.evaluate(key => JSON.stringify({ ...localStorage }).includes(key), lan.setup)).toBe(false); expect(await page.evaluate(() => (window as unknown as { creationCount?: number }).creationCount)).toBe(1);
 await page.locator('#setup-key').fill(lan.setup); await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await expect(page.locator('#setup-key')).toHaveValue('');
  } finally { await context.close(); }
});

test('two HTTPS seats retain actual Opus, secure media, independent ratings, consent, mix and memories across service restart', async ({ lan }, info) => {
  test.setTimeout(90000); const first = await lan.browser.newContext(), second = await lan.browser.newContext(), stranger = await lan.browser.newContext();
  const host = await first.newPage(), guest = await second.newPage(), outsider = await stranger.newPage();
  try {
    const invitation = await createRoom(host, lan); await joinRoom(guest, invitation); await expect(host.locator('#participants')).toContainText('Mira');
    await uploadOriginal(host, 'Amber orbit', 277); await uploadOriginal(guest, 'Indigo river', 415); await expect(track(host, 'Indigo river')).toBeVisible();
    await track(host, 'Amber orbit').getByRole('button', { name: 'Like Amber orbit', exact: true }).click(); await track(guest, 'Amber orbit').getByRole('button', { name: 'Like Amber orbit', exact: true }).click();
    await track(host, 'Indigo river').getByRole('button', { name: 'Pass Indigo river', exact: true }).click(); await track(guest, 'Indigo river').getByRole('button', { name: 'Like Indigo river', exact: true }).click();
    await expect(track(host, 'Amber orbit').locator('.rating-summary')).toHaveText('Arden: likes it · Mira: likes it'); await expect(track(host, 'Indigo river').locator('.rating-summary')).toHaveText('Arden: passes · Mira: likes it');
    await host.locator('#build-mix').click(); await expect(host.locator('#playlist .song-link')).toHaveText(['Amber orbit', 'Indigo river']); await host.getByRole('button', { name: 'Up Indigo river', exact: true }).click(); await expect(guest.locator('#playlist .song-link')).toHaveText(['Indigo river', 'Amber orbit']);
    await track(host, 'Amber orbit').getByRole('button', { name: 'Listen', exact: true }).click(); await expect.poll(async () => (await audioState(host)).paused).toBe(false); expect((await audioState(guest)).paused).toBe(true);
    await guest.locator('#enable-audio').click(); await expect.poll(async () => (await audioState(guest)).paused).toBe(false); await expect.poll(async () => Math.abs((await audioState(host)).position - (await audioState(guest)).position)).toBeLessThan(.5);
    await host.locator('#seek').evaluate((input: HTMLInputElement) => { input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }); await expect.poll(async () => (await audioState(guest)).position).toBeGreaterThan(2.8); await guest.locator('#play').click(); await expect.poll(async () => (await audioState(host)).paused && (await audioState(guest)).paused).toBe(true);
    const source = (await audioState(host)).source, own = await seat(host), other = await seat(guest); expect(own.room === other.room).toBe(true); expect(own.token === other.token).toBe(false);
    const fetchAudio = (page: typeof host) => page.evaluate(async url => { const full = await fetch(url); const bytes = [...new Uint8Array(await full.arrayBuffer())]; const range = await fetch(url, { headers: { Range: 'bytes=17-80' } }); return { status: full.status, bytes, rangeStatus: range.status, range: [...new Uint8Array(await range.arrayBuffer())], contentRange: range.headers.get('content-range') }; }, source);
    const a = await fetchAudio(host), b = await fetchAudio(guest); expect(a.status).toBe(200); expect(a.bytes).toEqual(b.bytes); expect(Buffer.from(a.bytes).subarray(0, 4).toString()).toBe('OggS'); expect(a.rangeStatus).toBe(206); expect(a.range).toEqual(a.bytes.slice(17, 81)); expect(a.contentRange).toBe(`bytes 17-80/${a.bytes.length}`);
    await writeFile(info.outputPath('original-normalized.opus'), Buffer.from(a.bytes));
    const cookie = (await first.cookies()).find(item => item.path === `/api/rooms/${own.room}`); expect(Boolean(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict')).toBe(true);
    expect(await host.evaluate(async id => (await fetch(`/api/rooms/${id}`)).status, own.room)).toBe(401);
    await outsider.goto(lan.origin); expect(await outsider.evaluate(async url => (await fetch(url)).status, source)).toBe(401); await outsider.goto(invitation); await outsider.locator('#guest-name').fill('Third seat'); await outsider.getByRole('button', { name: 'Join the room', exact: true }).click(); await expect(outsider.locator('#room-view')).toBeHidden();
    await createRoom(outsider, lan, 'Separate authority room107'); const separate = await seat(outsider);
    const isolated = await outsider.evaluate(async ({ room, token, source, setup }) => { const headers = { Authorization: `Bearer ${token}` }; return [(await fetch(`/api/rooms/${room}`, { headers })).status, (await fetch(source, { headers })).status, (await fetch(`/api/rooms/${room}`, { headers: { 'X-Duet-Setup-Key': setup } })).status]; }, { room: own.room, token: separate.token, source, setup: lan.setup }); expect(isolated).toEqual([401, 401, 401]);

    await guest.locator('#memory-track').selectOption({ label: 'Amber orbit' }); await guest.locator('#memory-date').fill('2026-10-04'); await guest.locator('#memory-text').fill('Original autumn memory <literal> Ω'); await guest.locator('#add-memory').click(); await expect(host.locator('#memory-list')).toContainText('Original autumn memory <literal> Ω');
    const hostAccess = await accessLink(host), guestAccess = await accessLink(guest); await lan.restart();
    await host.reload(); await guest.reload(); await expect(host.locator('#room-heading')).toHaveText('Original HTTPS listening room107'); await expect(guest.locator('#playlist .song-link')).toHaveText(['Indigo river', 'Amber orbit']); await expect(host.locator('#memory-list')).toContainText('Original autumn memory <literal> Ω'); expect((await audioState(host)).paused).toBe(true); await expect(host.locator('#enable-audio')).toHaveText('Enable audio on this device'); expect((await fetchAudio(host)).bytes).toEqual(a.bytes);
    const fresh = await lan.browser.newContext(), recovered = await fresh.newPage(); try { await recovered.goto(hostAccess); await recovered.locator('#restore-access').click(); await expect(recovered.locator('#participants .host')).toContainText('YOU'); await recovered.goto(guestAccess); await recovered.locator('#restore-access').click(); await expect(recovered.locator('#participants .guest')).toContainText('YOU'); } finally { await fresh.close(); }
    const download = host.waitForEvent('download'); await host.locator('#room-export').click(); const exported = await download; const bytes = await readFile((await exported.path())!); const text = bytes.toString(); expect([lan.setup, own.token, other.token].some(secret => text.includes(secret))).toBe(false); expect(text).toContain('Original autumn memory <literal> Ω'); await exported.saveAs(info.outputPath('public-room.json'));
    await host.screenshot({ path: info.outputPath('https-room-desktop.png'), fullPage: true });
    await host.setViewportSize({ width: 390, height: 844 }); expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await host.screenshot({ path: info.outputPath('https-room-390.png'), fullPage: true });
    await info.attach('public-transport-and-media-receipt', { contentType: 'application/json', body: JSON.stringify({ certificateSha256: lan.certificateSha256, fixtureSpki: lan.spki, trust: 'Only exact fixture SPKI bypass; strict CA/SAN protocol negatives are separate', opusBytes: a.bytes.length, opusSha256: createHash('sha256').update(Buffer.from(a.bytes)).digest('hex'), range: [17, 80], contexts: 4, browserVersion: lan.browser.version(), serviceRestart: true, physicalDevices: false }) });
  } finally { await first.close(); await second.close(); await stranger.close(); }
});

test('held real HTTPS poll does not erase newer literal draft and leaving retires old room publication', async ({ lan }) => {
  const context = await lan.browser.newContext(), page = await context.newPage();
  try {
    await createRoom(page, lan, 'Held response107'); const own = await seat(page);
    await page.evaluate(id => {
      const root = window as unknown as { pollEntered?: boolean; releasePoll?: () => void; pollFinished?: boolean }; const native = window.fetch; let held = false;
      window.fetch = async (...args) => { const response = await native(...args); if (!held && String(args[0]) === `/api/rooms/${id}` && (!args[1]?.method || args[1].method === 'GET')) { held = true; root.pollEntered = true; await new Promise<void>(done => { root.releasePoll = done; }); root.pollFinished = true; } return response; };
    }, own.room);
    await expect.poll(() => page.evaluate(() => (window as unknown as { pollEntered?: boolean }).pollEntered)).toBe(true); await page.locator('#memory-text').fill('New raw memory <unpublished>'); await page.locator('#memory-text').focus();
    await page.evaluate(() => (window as unknown as { releasePoll?: () => void }).releasePoll?.()); await expect.poll(() => page.evaluate(() => (window as unknown as { pollFinished?: boolean }).pollFinished)).toBe(true);
    await expect(page.locator('#memory-text')).toHaveValue('New raw memory <unpublished>'); await expect(page.locator('#memory-text')).toBeFocused();
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#leave-room').click(); await expect(page.locator('#room-view')).toBeVisible(); page.once('dialog', dialog => dialog.accept()); await page.locator('#leave-room').click(); await expect(page.locator('#welcome')).toBeVisible(); await expect(page.locator('#setup-key')).toHaveValue('');
  } finally { await context.close(); }
});


test('late actual HTTPS room response cannot reactivate a deliberately departed room', async ({ lan }) => {
  const context = await lan.browser.newContext(), page = await context.newPage();
  try {
    await createRoom(page, lan, 'Departed room107'); const own = await seat(page);
    await page.evaluate(id => {
      const state = window as unknown as { entered?: boolean; release?: () => void; completed?: boolean }; const native = window.fetch; let held = false;
      window.fetch = async (...args) => { const response = await native(...args); if (!held && String(args[0]) === `/api/rooms/${id}` && (!args[1]?.method || args[1].method === 'GET')) { held = true; state.entered = true; await new Promise<void>(done => { state.release = done; }); state.completed = true; } return response; };
    }, own.room);
    await expect.poll(() => page.evaluate(() => (window as unknown as { entered?: boolean }).entered)).toBe(true);
    await page.locator('#leave-room').click(); await expect(page.locator('#welcome')).toBeVisible();
    await createRoom(page, lan, 'New current room107', false); await page.evaluate(() => (window as unknown as { release?: () => void }).release?.()); await expect.poll(() => page.evaluate(() => (window as unknown as { completed?: boolean }).completed)).toBe(true);
    await expect(page.locator('#room-heading')).toHaveText('New current room107'); expect((await seat(page)).room === own.room).toBe(false); await expect(page.locator('#link-panel')).toBeHidden();
  } finally { await context.close(); }
});

test('unknown transport status blocks creation but independently retained seat access still works', async ({ lan }) => {
  const ownerContext = await lan.browser.newContext(), freshContext = await lan.browser.newContext(), owner = await ownerContext.newPage(), page = await freshContext.newPage();
  try {
    await createRoom(owner, lan, 'Independent recovery107'); const privateLink = await accessLink(owner);
    await page.route('**/api/status', route => route.abort('failed')); await page.goto(lan.origin); await expect(page.getByRole('button', { name: 'Create our room', exact: true })).toBeDisabled();
    await page.goto(privateLink); await page.locator('#restore-access').click(); await expect(page.locator('#room-heading')).toHaveText('Independent recovery107'); await expect(page.locator('#participants .host')).toContainText('YOU'); await expect(page.locator('#setup-key')).toHaveValue('');
    await page.locator('#leave-room').click(); await page.unroute('**/api/status'); await page.locator('#retry-transport-status').click(); await expect(page.locator('#transport-status')).toContainText(lan.origin); await expect(page.locator('#setup-key')).toBeVisible();
  } finally { await ownerContext.close(); await freshContext.close(); }
});
