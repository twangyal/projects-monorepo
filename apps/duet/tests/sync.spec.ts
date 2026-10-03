import { test, expect, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Tracing's DOM snapshots grant sticky browser activation and would invalidate
// the real autoplay rejection case. The native audio API is never stubbed.
test.use({ trace: 'off', launchOptions: {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--autoplay-policy=user-gesture-required'],
} });

test.beforeEach(async ({ page }) => {
  // Production deliberately serves only the app and fixed /assets files. Serve
  // test HTML here; its module script still loads the production Vite bundle.
  const html = await readFile(new URL('../dist/tests/sync-harness.html', import.meta.url), 'utf8');
  await page.route('**/tests/sync-harness.html', route => route.fulfill({ contentType: 'text/html', body: html }));
});

function tone(frequency = 440): Buffer {
  const frames = 441000;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(88200, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / 44100) * 3000), 44 + i * 2);
  return bytes;
}

async function serveTone(route: Route, frequency = 440): Promise<void> {
  const bytes = tone(frequency);
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
  await route.fulfill({
    status: range ? 206 : 200,
    contentType: 'audio/wav',
    headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) },
    body: bytes.subarray(start, end + 1),
  });
}

async function harness(page: Page): Promise<void> {
  await page.route('**/sync-tone-*.wav', route => serveTone(route, route.request().url().includes('-b.') ? 660 : 440));
  await page.goto('/tests/sync-harness.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.syncHarness))).toBe(true);
}

async function metadata(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.readyState)).toBeGreaterThanOrEqual(1);
}

test('remote playback remains paused until the listener explicitly enables native audio', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', true, 1)));
  await metadata(page);
  expect(await page.evaluate(() => window.syncHarness.sync.enabled)).toBe(false);
  expect(await page.evaluate(() => window.syncHarness.audio.paused)).toBe(true);
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.paused)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.currentTime)).toBeGreaterThan(1.2);
  await expect.poll(() => page.evaluate(() => window.syncHarness.drift())).toBeLessThan(.35);
});

test('metadata alignment uses the newest snapshot instead of its initial pending position', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/sync-tone-a.wav', async route => {
    requested(); await gate; await serveTone(route);
  });
  await page.goto('/tests/sync-harness.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.syncHarness))).toBe(true);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', false, 1)));
  await pending;
  try { await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', false, 3))); }
  finally { release(); }
  await metadata(page);
  await expect.poll(() => page.evaluate(() => Math.abs(window.syncHarness.audio.currentTime - 3))).toBeLessThan(.01);
});

test('a delayed old source cannot replace the native audio selected by a newer snapshot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await harness(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  let fulfilled!: () => void;
  const finished = new Promise<void>(resolve => { fulfilled = resolve; });
  await page.route('**/sync-tone-a.wav', async route => {
    requested(); await gate;
    try { await serveTone(route); } finally { fulfilled(); }
  });
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', true, 1)));
  await pending;
  try {
    await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('b', false, 4)));
    await metadata(page);
  } finally { release(); }
  await finished;
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.currentSrc)).toContain('/sync-tone-b.wav');
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.currentTime)).toBe(4);
  expect(await page.evaluate(() => window.syncHarness.audio.paused)).toBe(true);
  expect(errors).toEqual([]);
});

test('native paused audio keeps small drift and corrects differences above 0.35 seconds', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', false, 2)));
  await metadata(page);
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.currentTime)).toBe(2);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', false, 2.2)));
  expect(await page.evaluate(() => window.syncHarness.audio.currentTime)).toBe(2);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', false, 3)));
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.currentTime)).toBe(3);
});

test('real playback, remote seek and remote pause align without feedback writes', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await harness(page);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', false, 1)));
  await metadata(page);
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', true, 2)));
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.currentTime)).toBeGreaterThan(2.2);
  await expect.poll(() => page.evaluate(() => window.syncHarness.drift())).toBeLessThan(.2);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', true, 5)));
  await expect.poll(() => page.evaluate(() => window.syncHarness.drift())).toBeLessThan(.2);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', false, 5.5)));
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.paused)).toBe(true);
  await expect.poll(() => page.evaluate(() => Math.abs(window.syncHarness.audio.currentTime - 5.5))).toBeLessThan(.01);
  expect(writes).toEqual([]);
});

test('switching immediately after native play starts consumes its stale promise and preserves the newer pause', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await harness(page);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', false, 1)));
  await metadata(page);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', true, 1)));
  await page.evaluate(() => window.syncHarness.prepareSwitch(window.syncHarness.snapshot('b', false, 2)));
  await page.getByRole('button', { name: 'Enable and switch immediately', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.currentSrc)).toContain('/sync-tone-b.wav');
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.currentTime)).toBe(2);
  expect(await page.evaluate(() => window.syncHarness.audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.syncHarness.sync.enabled)).toBe(true);
  expect(await page.evaluate(() => window.syncHarness.statuses.some(status => /blocked|could not play/i.test(status)))).toBe(false);
  expect(errors).toEqual([]);
});

test('actual browser autoplay rejection is visible and recovers through an explicit enable click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/sync-tone-*.wav', route => serveTone(route));
  await page.goto('/tests/sync-harness.html');
  // Playwright page.evaluate grants sticky user activation, even for setup or
  // reads. Use CDP for all setup so native autoplay has no artificial gesture.
  const cdp = await page.context().newCDPSession(page);
  await expect.poll(async () => (await cdp.send('Runtime.evaluate', {
    expression: 'Boolean(window.syncHarness)', returnByValue: true, userGesture: false,
  })).result.value as boolean).toBe(true);
  await cdp.send('Runtime.evaluate', {
    expression: 'window.syncHarness.apply(window.syncHarness.snapshot("a", true, 1))', userGesture: false,
  });
  await expect.poll(async () => (await cdp.send('Runtime.evaluate', {
    expression: 'window.syncHarness.audio.readyState', returnByValue: true, userGesture: false,
  })).result.value as number).toBeGreaterThanOrEqual(1);
  expect((await cdp.send('Runtime.evaluate', { expression: 'navigator.userActivation.hasBeenActive', returnByValue: true, userGesture: false })).result.value).toBe(false);
  await cdp.send('Runtime.evaluate', { expression: 'window.syncHarness.sync.enable()', awaitPromise: true, userGesture: false });
  await cdp.detach();
  await expect(page.getByRole('status')).toContainText(/blocked|enable audio/i);
  expect(await page.evaluate(() => window.syncHarness.audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.syncHarness.sync.enabled)).toBe(false);
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.paused)).toBe(false);
  expect(await page.evaluate(() => window.syncHarness.sync.enabled)).toBe(true);
  expect(errors).toEqual([]);
});

test('disable and destroy stop native playback and prevent late metadata from restarting it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await harness(page);
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('a', true, 1)));
  await metadata(page);
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.syncHarness.audio.paused)).toBe(false);
  await page.getByRole('button', { name: 'Disable audio', exact: true }).click();
  expect(await page.evaluate(() => window.syncHarness.audio.paused)).toBe(true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  let fulfilled!: () => void;
  const finished = new Promise<void>(resolve => { fulfilled = resolve; });
  await page.route('**/sync-tone-b.wav', async route => {
    requested(); await gate;
    try { await serveTone(route, 660); } finally { fulfilled(); }
  });
  await page.evaluate(() => window.syncHarness.apply(window.syncHarness.snapshot('b', true, 2)));
  await pending;
  try {
    await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
    await page.evaluate(() => window.syncHarness.sync.destroy());
  } finally { release(); }
  await finished;
  expect(await page.evaluate(() => window.syncHarness.audio.hasAttribute('src'))).toBe(false);
  expect(await page.evaluate(() => window.syncHarness.sync.enabled)).toBe(false);
  expect(await page.evaluate(() => window.syncHarness.audio.paused)).toBe(true);
  expect(errors).toEqual([]);
});
