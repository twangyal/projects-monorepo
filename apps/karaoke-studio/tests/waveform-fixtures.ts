import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export interface FixtureCue { start: number; end: number; text: string }
export interface FixtureProject { id: string; duration: number; revision: number; title: string; cues: FixtureCue[] }
interface FixtureJob { id: string; projectId: string; status: string }
interface FixtureOptions { duration?: number; cues?: FixtureCue[]; pulses?: boolean }
interface OwnedClips { create(options?: FixtureOptions): Promise<FixtureProject> }

// Original PCM fixture. A quiet tone keeps codec checks meaningful; the two
// opposite-phase pulse regions have extrema which channel averaging would lose.
export function waveformAudio(duration: number, pulses = false): Buffer {
  const frames = Math.round(duration * 44100), bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(176400, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / 44100;
    const pulse = pulses && (time >= 1 && time < 1.15 || time >= 3 && time < 3.15);
    const amplitude = pulses ? pulse ? 28000 : 0 : 4000;
    const left = pulse ? amplitude : Math.round(Math.sin(2 * Math.PI * 220 * time) * amplitude);
    bytes.writeInt16LE(left, 44 + frame * 4);
    bytes.writeInt16LE(pulse ? -left : left, 46 + frame * 4);
  }
  return bytes;
}

export const test = base.extend<{ clips: OwnedClips; networkGuard: void }>({
  networkGuard: [async ({ page }, use) => {
    const errors: string[] = [], external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (url.hostname !== '127.0.0.1') external.push(url.origin);
      }
    });
    await use();
    expect(errors).toEqual([]); expect(external).toEqual([]);
  }, { auto: true }],
  clips: async ({ request }, use) => {
    const token = (await (await request.get('/api/session')).json() as { token: string }).token;
    const ids: string[] = [];
    const jobs: string[] = [];
    try {
      await use({ create: async (options = {}) => {
        const duration = options.duration ?? 4;
        const response = await request.post('/api/projects', {
          headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Name': 'owned-waveform-fixture.wav', 'X-Karaoke-Token': token },
          data: waveformAudio(duration, options.pulses),
        });
        expect(response.status()).toBe(202);
        const job = (await response.json() as { job: FixtureJob }).job;
        ids.push(job.projectId); jobs.push(job.id);
        await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json() as { job: FixtureJob }).job.status,
          { timeout: 10000 }).toBe('complete');
        const project = await (await request.get(`/api/projects/${job.projectId}`)).json() as FixtureProject;
        const saved = await request.put(`/api/projects/${project.id}`, {
          headers: { 'X-Karaoke-Token': token },
          data: { title: 'Owned waveform fixture', revision: project.revision, cues: options.cues ?? [
            { start: .5, end: 1.5, text: 'I' }, { start: 2, end: 3, text: 'WWWWWWWW' },
          ] },
        });
        expect(saved.status()).toBe(200);
        return await saved.json() as FixtureProject;
      } });
    } finally {
      // Clean only this test's projects. Cancel any owned export before deleting,
      // including on assertion failures, so the shared 20-project cap stays free.
      const session = await (await request.get('/api/session')).json() as { activeJob: FixtureJob | null };
      if (session.activeJob && ids.includes(session.activeJob.projectId)) {
        jobs.push(session.activeJob.id);
        await request.post(`/api/jobs/${session.activeJob.id}/cancel`, { headers: { 'X-Karaoke-Token': token }, data: {} });
      }
      for (const jobId of jobs) await expect.poll(async () => {
        const response = await request.get(`/api/jobs/${jobId}`);
        return response.status() === 404 || (await response.json() as { job: FixtureJob }).job.status !== 'running';
      }, { timeout: 10000 }).toBe(true);
      for (const id of ids) {
        const response = await request.delete(`/api/projects/${id}`, { headers: { 'X-Karaoke-Token': token }, data: {} });
        expect([200, 404]).toContain(response.status());
      }
    }
  },
});
export { expect };

export async function openWaveform(page: Page, project: FixtureProject, ready = true): Promise<void> {
  await page.goto(`/?project=${project.id}`);
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(project.title);
  await expect.poll(() => page.locator('#audio').evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  if (ready) await waveformReady(page);
}
export async function waveformReady(page: Page): Promise<void> {
  await expect(page.locator('#waveform-status')).toContainText(/ready|loaded/i, { timeout: 10000 });
}
export async function storedProject(request: APIRequestContext, id: string): Promise<FixtureProject> {
  const response = await request.get(`/api/projects/${id}`); expect(response.status()).toBe(200);
  return await response.json() as FixtureProject;
}
export async function handleValue(page: Page, boundary: 'start' | 'end'): Promise<number> {
  return Number(await page.locator(`#cue-${boundary}-handle`).getAttribute('aria-valuenow'));
}
export async function detailWindow(page: Page): Promise<{ start: number; end: number }> {
  const canvas = page.locator('#waveform-detail');
  return { start: Number(await canvas.getAttribute('data-window-start')), end: Number(await canvas.getAttribute('data-window-end')) };
}
export async function beginDrag(page: Page, boundary: 'start' | 'end', delta: number): Promise<void> {
  const handle = page.locator(`#cue-${boundary}-handle`);
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox(), canvas = await page.locator('#waveform-detail').boundingBox();
  if (!box || !canvas) throw new Error('Expected visible timing handle and detail canvas.');
  const view = await detailWindow(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta * canvas.width / (view.end - view.start), box.y + box.height / 2, { steps: 8 });
}
export async function downloadedText(page: Page, name: string): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Expected an actual downloaded subtitle file.');
  return readFile(path, 'utf8');
}

interface GeometryGate { hold(): void; release(): void }
type GeometryTestWindow = Window & typeof globalThis & { __waveformGeometryGate: GeometryGate };

// Delay only notifications: viewport/layout changes and pointer/key releases
// still use the actual browser. Installed before production event registration.
export async function installGeometryGate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let held = false, pendingResize = false;
    const callbacks: (() => void)[] = [];
    const OriginalObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class extends OriginalObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          if (held) callbacks.push(() => callback(entries, observer));
          else callback(entries, observer);
        });
      }
    };
    globalThis.addEventListener('resize', event => {
      if (!held) return;
      event.stopImmediatePropagation(); pendingResize = true;
    }, { capture: true });
    (globalThis as GeometryTestWindow).__waveformGeometryGate = {
      hold() { held = true; },
      release() {
        held = false;
        if (pendingResize) { pendingResize = false; globalThis.dispatchEvent(new Event('resize')); }
        for (const callback of callbacks.splice(0)) callback();
      },
    };
  });
}
export async function holdGeometryNotifications(page: Page): Promise<void> {
  await page.evaluate(() => (globalThis as GeometryTestWindow).__waveformGeometryGate.hold());
}
export async function releaseGeometryNotifications(page: Page): Promise<void> {
  await page.evaluate(() => (globalThis as GeometryTestWindow).__waveformGeometryGate.release());
}
