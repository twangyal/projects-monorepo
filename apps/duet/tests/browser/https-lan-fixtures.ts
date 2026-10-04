import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, chmod, rm, access } from 'node:fs/promises';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { createServer } from 'node:net';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const execute = promisify(execFile);
export function originalPcm(frequency: 277 | 415): Buffer {
  const samples = 192000, bytes = samples * 2, b = Buffer.alloc(44 + bytes);
  b.write('RIFF'); b.writeUInt32LE(36 + bytes, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.floor(4000 * Math.sin(2 * Math.PI * frequency * i / 16000) + .5), 44 + 2 * i); return b;
}
export interface Lan { origin: string; setup: string; browser: Browser; certificateSha256: string; spki: string; restart(): Promise<void>; }
export const test = base.extend<{ lan: Lan }>({
  lan: async ({ playwright }, use, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'duet107-native-')), cert = join(directory, 'certificate.pem'), key = join(directory, 'key.pem'), setupPath = join(directory, 'setup');
    let child: ChildProcess | null = null, browser: Browser | null = null; const servicePids: number[] = [], browserPids: number[] = [];
    const stop = async () => { const old = child; child = null; if (!old || old.exitCode !== null) return; const ended = new Promise<void>((done, reject) => { const timer = setTimeout(() => { old.kill('SIGKILL'); reject(new Error('Owned HTTPS service did not stop within ten seconds.')); }, 10000); old.once('exit', () => { clearTimeout(timer); done(); }); }); old.kill('SIGTERM'); await ended; };
    try {
      await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']); await chmod(key, 0o600);
      const setup = randomBytes(32).toString('hex'); await writeFile(setupPath, setup + '\n', { mode: 0o600 });
      const certificate = await readFile(cert), publicKey = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' }), spki = createHash('sha256').update(publicKey).digest('base64');
      const port = await new Promise<number>(done => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port.'); server.close(() => done(address.port)); }); });
      const origin = `https://127.0.0.1:${port}`;
      const ready = () => new Promise<boolean>(done => { const req = request(origin + '/api/status', { ca: certificate, timeout: 1000 }, response => { response.resume(); done(response.statusCode === 200); }); req.on('error', () => done(false)); req.on('timeout', () => req.destroy()); req.end(); });
      const start = async () => { child = spawn(process.env.DUET_PYTHON ?? 'python3', ['-m', 'duet', '--data-dir', join(directory, 'library'), '--port', String(port), '--bind', '127.0.0.1', '--origin', origin, '--tls-cert', cert, '--tls-key', key, '--setup-token-file', setupPath], { cwd: resolve(import.meta.dirname, '../..'), stdio: 'ignore' }); if (child.pid) servicePids.push(child.pid); await expect.poll(ready, { timeout: 15000, message: 'The actual HTTPS service becomes ready with strict certificate validation.' }).toBe(true); };
      await start(); browser = await playwright.chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: [`--ignore-certificate-errors-spki-list=${spki}`] });
      const cdp = await browser.newBrowserCDPSession(); const processes = await cdp.send('SystemInfo.getProcessInfo'); browserPids.push(...processes.processInfo.filter(item => item.type === 'browser').map(item => item.id)); await cdp.detach();
      await use({ origin, setup, browser, certificateSha256: createHash('sha256').update(certificate).digest('hex'), spki, restart: async () => { await stop(); await start(); } });
    } finally { await browser?.close(); await stop(); await rm(directory, { recursive: true, force: true }); const pids = [...servicePids, ...browserPids]; const exited = await Promise.all(pids.map(async pid => { try { await access(`/proc/${pid}`); return false; } catch { return true; } })); await writeFile(info.outputPath('owned-process-closure.json'), JSON.stringify({ servicePids, browserPids, allObservedPidsExited: exited.every(Boolean), noSecretMaterial: true }, null, 2)); }
  },
});
export { expect };
export async function createRoom(page: Page, lan: Lan, title = 'Original HTTPS listening room107', navigate = true) {
  if (navigate) await page.goto(lan.origin); await expect(page.locator('#setup-key')).toBeVisible(); await page.locator('#host-name').fill('Arden'); await page.locator('#room-title').fill(title); await page.locator('#setup-key').fill(lan.setup);
  await page.getByRole('button', { name: 'Create our room', exact: true }).click(); await expect(page.locator('#room-heading')).toHaveText(title); await expect(page.locator('#setup-key')).toHaveValue('');
  const invite = await page.locator('#share-link').inputValue(); await page.locator('#close-link').click(); return invite;
}
export async function joinRoom(page: Page, invite: string) { await page.goto(invite); await expect.poll(() => new URL(page.url()).hash).toBe(''); await page.locator('#guest-name').fill('Mira'); await page.getByRole('button', { name: 'Join the room', exact: true }).click(); await expect(page.locator('#room-view')).toBeVisible(); }
export function track(page: Page, title: string) { return page.locator('.track').filter({ has: page.getByRole('heading', { name: title, exact: true }) }); }
export async function uploadOriginal(page: Page, title: string, frequency: 277 | 415) { await expect(page.locator('#audio-file')).toBeEnabled(); await page.locator('#audio-file').setInputFiles({ name: `${title}.wav`, mimeType: 'audio/wav', buffer: originalPcm(frequency) }); await page.locator('#track-artist').fill('Original procedural tone107'); await page.locator('#upload').click(); await expect(track(page, title)).toBeVisible({ timeout: 20000 }); await expect(page.locator('#upload-job')).toBeHidden(); }
export async function audioState(page: Page) { return page.locator('#audio').evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, position: audio.currentTime, source: audio.currentSrc })); }
export async function seat(page: Page) { return page.evaluate(() => { const room = new URL(location.href).searchParams.get('room')!; return { room, token: (JSON.parse(localStorage.getItem('duet-participants-v1')!) as Record<string, { token: string }>)[room].token }; }); }
export async function accessLink(page: Page) { await page.locator('#access-link').click(); const link = await page.locator('#share-link').inputValue(); await page.locator('#close-link').click(); return link; }
