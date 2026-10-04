import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Private links are kept only in memory: no traces, screenshots, videos,
// attachments, command arguments, diagnostic values or archived tokens.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const python = process.env.PYTHON || 'python3';
const app = resolve('.');
const helper = join(app, 'tests/archive_browser_server.py');
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const fingerprint = (value: unknown) => sha(JSON.stringify(value));
interface Playback { trackId: string | null; playing: boolean; position: number; revision: number; updatedAt?: number }
interface Track { id: string; title: string; artist: string; duration: number; uploadedBy: string; createdAt: number }
interface Memory { id: string; trackId: string; trackTitle: string; date: string; text: string; author: string; createdAt: number }
interface Room {
  id: string; title: string; profiles: { host: { name: string }; guest: { name: string } | null };
  tracks: Track[]; ratings: Record<string, { host: number; guest: number }>; playlist: string[];
  playlistRevision: number; playback: Playback; memories: Memory[];
  capabilityFingerprints?: Record<string, string>; inviteFingerprint?: string;
}
interface Audit { rooms: Room[]; files?: string[]; manifest?: { kind: string; playbackPolicy: string } }
interface Running { process: ChildProcess; origin: string; stop: () => Promise<void> }

function wav(frequency: number, seconds = 24) {
  const rate = 16000, samples = rate * seconds, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(4500 * Math.sin(2 * Math.PI * frequency * i / rate)), 44 + i * 2);
  return buffer;
}
async function command(args: string[], timeout = 60000) {
  const child = spawn(python, args, { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 2 * 1024 * 1024) child.kill('SIGKILL'); });
  child.stderr.on('data', chunk => { stderr += String(chunk); if (stderr.length > 65536) child.kill('SIGKILL'); });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  try {
    const code = await new Promise<number | null>((done, fail) => { child.once('error', fail); child.once('close', done); });
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
async function audit(data: string, archive = false): Promise<Audit> {
  const result = await command([helper, archive ? 'archive' : 'records', archive ? '--archive' : '--data-dir', data]);
  expect(result.code, 'Independent stopped-library audit completed').toBe(0);
  return JSON.parse(result.stdout) as Audit;
}
async function launch(data: string): Promise<Running> {
  const child = spawn(python, [helper, 'serve', '--data-dir', data], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', settled = false;
  child.stderr.on('data', () => { /* No private subprocess diagnostics retained. */ });
  const origin = await new Promise<string>((done, fail) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); fail(new Error('Fixture service startup timed out.')); }, 15000);
    child.once('error', () => { clearTimeout(timer); fail(new Error('Fixture service failed to start.')); });
    child.once('exit', () => { if (!settled) { clearTimeout(timer); fail(new Error('Fixture service exited during startup.')); } });
    child.stdout.on('data', chunk => {
      output += String(chunk);
      const match = /^Duet archive fixture: (http:\/\/127\.0\.0\.1:\d+)\s*$/m.exec(output);
      if (match && !settled) { settled = true; clearTimeout(timer); done(match[1]); }
    });
  });
  return { process: child, origin, stop: async () => {
    if (child.exitCode !== null) { expect(child.exitCode, 'Fixture exited gracefully').toBe(0); return; }
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    const ended = new Promise<number | null>(done => child.once('exit', done));
    child.kill('SIGTERM');
    try { expect(await ended, 'Fixture stopped with SIGTERM cleanup').toBe(0); }
    finally { clearTimeout(timer); }
  } };
}
async function context(browser: Browser, origin: string) {
  const ctx = await browser.newContext({ baseURL: origin });
  return { context: ctx, page: await ctx.newPage() };
}
async function create(page: Page, title: string) {
  await page.goto('/'); await page.locator('#host-name').fill('First listener'); await page.locator('#room-title').fill(title);
  await page.getByRole('button', { name: 'Create our room' }).click();
  await expect(page.locator('#room-heading')).toHaveText(title);
  const invite = await page.locator('#share-link').inputValue(); await page.locator('#close-link').click();
  const id = new URL(invite).searchParams.get('room')!;
  expect(/^[a-f0-9]{32}$/.test(id)).toBe(true);
  return { id, invite };
}
async function privateLink(page: Page) {
  await page.locator('#access-link').click(); const link = await page.locator('#share-link').inputValue();
  await page.locator('#close-link').click();
  expect(/^#access=[a-f0-9]{64}$/.test(new URL(link).hash), 'Own private link is available').toBe(true);
  return link;
}
function token(link: string, kind = 'access') { return new URLSearchParams(new URL(link).hash.slice(1)).get(kind)!; }
async function visitPrivate(page: Page, origin: string, link: string) {
  const url = new URL(link); await page.goto(`${origin}${url.pathname}${url.search}`);
  // Actual production fragment handling, with secrets absent from goto logs.
  await page.evaluate(fragment => { location.hash = fragment; }, url.hash);
  await expect.poll(() => new URL(page.url()).hash).toBe('');
}
async function recover(page: Page, origin: string, link: string, role: 'host' | 'guest') {
  await visitPrivate(page, origin, link); await page.locator('#restore-access').click();
  await expect(page.locator('#room-view')).toBeVisible();
  await expect(page.locator(`#participants .${role}`)).toContainText('YOU');
  await expect(page.locator(`#participants .${role === 'host' ? 'guest' : 'host'}`)).not.toContainText('YOU');
}
async function upload(page: Page, title: string, frequency: number) {
  await expect(page.locator('#audio-file')).toBeEnabled();
  await page.locator('#audio-file').setInputFiles({ name: 'original-tone.wav', mimeType: 'audio/wav', buffer: wav(frequency) });
  await page.locator('#track-title').fill(title); await page.locator('#track-artist').fill('Original native archive tone');
  await page.locator('#upload').click();
  await expect(page.locator('#library-list h4').filter({ hasText: title })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#upload-job')).toBeHidden();
}
const track = (page: Page, title: string) => page.locator('.track').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
async function snapshot(page: Page, id: string, credential: string): Promise<Room> {
  const response = await page.request.get(`/api/rooms/${id}`, { headers: { Authorization: `Bearer ${credential}` } });
  expect(response.status()).toBe(200); return await response.json() as Room;
}
async function memory(page: Page, title: string, date: string, text: string) {
  await page.locator('#memory-track').selectOption({ label: title }); await page.locator('#memory-date').fill(date);
  await page.locator('#memory-text').fill(text); await page.locator('#add-memory').click();
  await expect(page.locator('#memory-list')).toContainText(text); await expect(page.locator('#memory-text')).toHaveValue('');
}
async function tree(directory: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(join(directory, prefix))).sort()) {
    const path = join(prefix, name), info = await stat(join(directory, path));
    if (info.isDirectory()) Object.assign(result, await tree(directory, path));
    else result[path] = `${info.mode}:${info.mtimeMs}:${info.size}:${sha(await readFile(join(directory, path)))}`;
  }
  return result;
}
async function backup(commandName: 'create' | 'inspect' | 'restore', paths: string[]) {
  const result = await command(['-m', 'duet.backup', commandName, ...paths]);
  expect(result.code, `Actual archive CLI ${commandName} succeeds`).toBe(0);
  expect(result.stderr.includes('Traceback')).toBe(false);
  return result;
}
function publicRecords(room: Room) {
  return { id: room.id, title: room.title, profiles: room.profiles, tracks: room.tracks,
    ratings: room.ratings, playlist: room.playlist, playlistRevision: room.playlistRevision, memories: room.memories };
}

test('complete editable archive preserves original seats, audio, votes, mix, memories and a pending invitation', async ({ browser }) => {
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), 'duet-archive-native-')), original = join(root, 'original'), restored = join(root, 'restored'), archive = join(root, 'complete.duet.zip');
  const contexts: BrowserContext[] = [], servers: Running[] = [];
  try {
    const source = await launch(original); servers.push(source);
    const host = await context(browser, source.origin), guest = await context(browser, source.origin), pendingHost = await context(browser, source.origin);
    contexts.push(host.context, guest.context, pendingHost.context);
    const paired = await create(host.page, 'Our original shared library');
    await visitPrivate(guest.page, source.origin, paired.invite); await guest.page.locator('#guest-name').fill('Second listener');
    await guest.page.getByRole('button', { name: 'Join the room' }).click(); await expect(guest.page.locator('#room-view')).toBeVisible();
    const hostLink = await privateLink(host.page), guestLink = await privateLink(guest.page);
    const hostToken = token(hostLink), guestToken = token(guestLink);
    const pending = await create(pendingHost.page, 'An invitation still waiting');
    const pendingLink = await privateLink(pendingHost.page);
    await upload(host.page, 'Original morning', 220); await upload(guest.page, 'Original evening', 330);
    await upload(host.page, 'Gone but remembered', 440);
    for (const [title, a, b] of [['Original morning', 'Like', 'Pass'], ['Original evening', 'Pass', 'Like']]) {
      await expect(track(host.page, title)).toBeVisible(); await expect(track(guest.page, title)).toBeVisible();
      await track(host.page, title).getByRole('button', { name: `${a} ${title}`, exact: true }).click();
      await track(guest.page, title).getByRole('button', { name: `${b} ${title}`, exact: true }).click();
    }
    await memory(host.page, 'Original morning', '2026-09-11', 'First authored memory');
    await memory(guest.page, 'Original evening', '2026-09-12', 'Second authored memory');
    await memory(guest.page, 'Gone but remembered', '2026-09-13', 'The missing song stays remembered');
    host.page.once('dialog', dialog => dialog.accept()); await track(host.page, 'Gone but remembered').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(track(host.page, 'Gone but remembered')).toHaveCount(0);
    await expect(host.page.locator('#memory-list')).toContainText('Audio removed; this memory is kept.');
    await host.page.locator('#build-mix').click();
    await expect(host.page.locator('#playlist .song-link')).toHaveText(['Original morning', 'Original evening']);
    await host.page.getByRole('button', { name: 'Up Original evening', exact: true }).click();
    await expect(host.page.locator('#playlist .song-link')).toHaveText(['Original evening', 'Original morning']);
    const before = await snapshot(host.page, paired.id, hostToken);
    const firstTrack = before.tracks.find(item => item.title === 'Original morning')!;
    const anchor = await host.page.request.put(`/api/rooms/${paired.id}/playback`, { headers: { Authorization: `Bearer ${hostToken}` }, data: { trackId: firstTrack.id, playing: true, position: 2.5, revision: before.playback.revision } });
    expect(anchor.status()).toBe(200);
    for (const ctx of contexts.splice(0)) await ctx.close();
    await source.stop();
    const originalTree = await tree(original), originals = await audit(original);
    const saved = originals.rooms.find(room => room.id === paired.id)!;
    expect(saved.playback.playing).toBe(true); expect(saved.playback.position).toBe(2.5);
    expect(saved.capabilityFingerprints!.host === fingerprint(sha(hostToken))).toBe(true);
    expect(saved.capabilityFingerprints!.guest === fingerprint(sha(guestToken))).toBe(true);
    expect(saved.inviteFingerprint === fingerprint(null)).toBe(true);
    const encoded = new Map<string, Buffer>(), decoded = new Map<string, unknown>();
    for (const song of saved.tracks) {
      const path = join(original, 'media', paired.id, `${song.id}.ogg`); encoded.set(song.id, await readFile(path));
      const check = await command([helper, 'decode', '--audio', path]); expect(check.code).toBe(0);
      const info = JSON.parse(check.stdout); expect(info.frames).toBe(24 * 48000); expect(info.peak).toBeGreaterThan(1000);
      expect(info.streams).toEqual([{ codec_name: 'opus', sample_rate: '48000', channels: 2 }]); decoded.set(song.id, info);
    }
    const created = await backup('create', ['--data-dir', original, '--output', archive]);
    const inspected = await backup('inspect', ['--archive', archive]);
    const contents = await readFile(archive);
    for (const raw of [hostToken, guestToken, token(pendingLink), token(paired.invite, 'invite'), token(pending.invite, 'invite')]) {
      expect(contents.includes(Buffer.from(raw)), 'Archive contains no original raw credential').toBe(false);
      expect((created.stdout + created.stderr + inspected.stdout + inspected.stderr).includes(raw), 'CLI does not expose credentials').toBe(false);
    }
    const archived = await audit(archive, true); expect(archived.rooms).toEqual(originals.rooms);
    expect(archived.manifest!.kind).toBe('duet-library'); expect(archived.manifest!.playbackPolicy).toBe('saved-anchor-paused');
    expect(archived.files).toEqual(['manifest.json', 'rooms.json', ...saved.tracks.map(song => `media/${paired.id}/${song.id}.ogg`).sort()]);
    expect(await tree(original), 'Create and inspect leave all original bytes/mtimes unchanged').toEqual(originalTree);
    await backup('restore', ['--archive', archive, '--data-dir', restored]);
    expect(await tree(original)).toEqual(originalTree);
    const restoredAudit = await audit(restored);
    for (const room of originals.rooms) {
      const actual = restoredAudit.rooms.find(item => item.id === room.id)!;
      expect(publicRecords(actual)).toEqual(publicRecords(room));
      expect(actual.capabilityFingerprints === undefined).toBe(false);
      for (const role of ['host', 'guest']) {
        expect(actual.capabilityFingerprints![role] === room.capabilityFingerprints![role], 'Original seat credential fingerprint is preserved').toBe(true);
      }
      expect(actual.inviteFingerprint === room.inviteFingerprint).toBe(true);
      expect(actual.playback).toMatchObject({ trackId: room.playback.trackId, position: room.playback.position, playing: false, revision: room.playback.revision + (room.playback.playing ? 1 : 0) });
    }
    for (const song of saved.tracks) {
      const path = join(restored, 'media', paired.id, `${song.id}.ogg`);
      expect(sha(await readFile(path))).toBe(sha(encoded.get(song.id)!));
      const check = await command([helper, 'decode', '--audio', path]); expect(check.code).toBe(0); expect(JSON.parse(check.stdout)).toEqual(decoded.get(song.id));
    }
    const copy = await launch(restored); servers.push(copy);
    const recoveredHost = await context(browser, copy.origin), recoveredGuest = await context(browser, copy.origin), stranger = await context(browser, copy.origin);
    contexts.push(recoveredHost.context, recoveredGuest.context, stranger.context);
    await recover(recoveredHost.page, copy.origin, hostLink, 'host'); await recover(recoveredGuest.page, copy.origin, guestLink, 'guest');
    await expect(recoveredHost.page.locator('#playlist .song-link')).toHaveText(['Original evening', 'Original morning']);
    await expect(recoveredGuest.page.locator('#memory-list')).toContainText('The missing song stays remembered');
    await expect(track(recoveredHost.page, 'Original morning').locator('.rating-summary')).toHaveText('First listener: likes it · Second listener: passes');
    await expect(track(recoveredHost.page, 'Original evening').locator('.rating-summary')).toHaveText('First listener: passes · Second listener: likes it');
    const restarted = await snapshot(recoveredHost.page, paired.id, hostToken);
    expect(restarted.playback).toMatchObject({ trackId: saved.playback.trackId, position: 2.5, playing: false, revision: saved.playback.revision + 1 });
    await recoveredHost.page.waitForTimeout(1250);
    expect((await snapshot(recoveredHost.page, paired.id, hostToken)).playback).toEqual(restarted.playback);
    const stale = await recoveredHost.page.request.put(`/api/rooms/${paired.id}/playback`, { headers: { Authorization: `Bearer ${hostToken}` }, data: { trackId: firstTrack.id, playing: false, position: 4, revision: saved.playback.revision } }); expect(stale.status()).toBe(409);
    expect((await stranger.page.request.get(`/api/rooms/${paired.id}`, { headers: { Authorization: `Bearer ${'0'.repeat(64)}` } })).status()).toBe(401);
    await visitPrivate(stranger.page, copy.origin, paired.invite); await stranger.page.locator('#guest-name').fill('Third listener'); await stranger.page.getByRole('button', { name: 'Join the room' }).click(); await expect(stranger.page.locator('#room-view')).toBeHidden(); await expect(stranger.page.locator('#notice')).toHaveClass(/error/);
    await visitPrivate(stranger.page, copy.origin, pending.invite); await stranger.page.locator('#guest-name').fill('New invited partner'); await stranger.page.getByRole('button', { name: 'Join the room' }).click(); await expect(stranger.page.locator('#room-heading')).toHaveText('An invitation still waiting');
    const again = await stranger.page.request.post(`/api/rooms/${pending.id}/join`, { data: { inviteToken: token(pending.invite, 'invite'), name: 'Another person' } }); expect(again.status()).toBe(409);
    await recoveredGuest.page.locator('#enable-audio').click(); await track(recoveredHost.page, 'Original morning').getByRole('button', { name: 'Listen', exact: true }).click();
    for (const page of [recoveredHost.page, recoveredGuest.page]) await expect.poll(() => page.locator('#audio').evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > .5 && audio.readyState >= 2)).toBe(true);
    const audioPath = `/api/rooms/${paired.id}/tracks/${firstTrack.id}/audio`;
    const full = await recoveredHost.page.request.get(audioPath); expect(full.status()).toBe(200); expect(sha(await full.body())).toBe(sha(encoded.get(firstTrack.id)!));
    const range = await recoveredGuest.page.request.get(audioPath, { headers: { Range: 'bytes=0-63' } }); expect(range.status()).toBe(206); expect(await range.body()).toEqual(encoded.get(firstTrack.id)!.subarray(0, 64));
    await recoveredGuest.page.locator('#play').click(); await expect.poll(() => recoveredHost.page.locator('#audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    await track(recoveredGuest.page, 'Original morning').getByRole('button', { name: 'Like Original morning', exact: true }).click();
    await memory(recoveredGuest.page, 'Original evening', '2026-09-14', 'A new memory after restoration');
    const edited = await snapshot(recoveredGuest.page, paired.id, guestToken);
    expect(edited.ratings[firstTrack.id]).toEqual({ host: 1, guest: 1 }); expect(edited.memories).toHaveLength(4);
    for (const ctx of contexts.splice(0)) await ctx.close(); await copy.stop();
    const final = await launch(restored); servers.push(final);
    const finalHost = await context(browser, final.origin), finalGuest = await context(browser, final.origin); contexts.push(finalHost.context, finalGuest.context);
    await recover(finalHost.page, final.origin, hostLink, 'host'); await recover(finalGuest.page, final.origin, guestLink, 'guest');
    expect(publicRecords(await snapshot(finalGuest.page, paired.id, guestToken))).toEqual(publicRecords(edited));
    expect((await snapshot(finalHost.page, paired.id, hostToken)).playback.revision).toBe(edited.playback.revision);
    await expect(finalHost.page.locator('#memory-list')).toContainText('A new memory after restoration');
  } finally {
    for (const ctx of contexts) await ctx.close();
    for (const server of servers.reverse()) await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('offline CLI refuses a running library and never replaces an existing restore directory', async ({ browser }) => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), 'duet-archive-refusal-')), data = join(root, 'source'), archive = join(root, 'safe.zip'), blocked = join(root, 'busy.zip'), destination = join(root, 'existing');
  const servers: Running[] = [], contexts: BrowserContext[] = [];
  try {
    const source = await launch(data); servers.push(source);
    const host = await context(browser, source.origin); contexts.push(host.context);
    await create(host.page, 'Keep the original'); await host.context.close(); contexts.splice(0);
    const before = await tree(data);
    const busy = await command(['-m', 'duet.backup', 'create', '--data-dir', data, '--output', blocked]);
    expect(busy.code).toBe(2); expect(busy.stderr.includes('Traceback')).toBe(false);
    expect(await tree(data)).toEqual(before); expect((await readdir(root)).includes('busy.zip')).toBe(false);
    await source.stop(); await backup('create', ['--data-dir', data, '--output', archive]);
    await mkdir(destination); await writeFile(join(destination, 'keep.txt'), 'Existing unrelated directory must remain unchanged.');
    const preserved = await tree(destination), failed = await command(['-m', 'duet.backup', 'restore', '--archive', archive, '--data-dir', destination]);
    expect(failed.code).toBe(2); expect(failed.stderr.includes('Traceback')).toBe(false); expect(await tree(destination)).toEqual(preserved);
    const again = await command(['-m', 'duet.backup', 'create', '--data-dir', data, '--output', archive]);
    expect(again.code).toBe(2); expect(again.stderr.includes('Traceback')).toBe(false);
    await backup('inspect', ['--archive', archive]);
  } finally {
    for (const ctx of contexts) await ctx.close();
    for (const server of servers.reverse()) await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});
