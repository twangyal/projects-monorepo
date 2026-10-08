import { expect, test, type Page } from '@playwright/test';
import { decompressFrames, parseGIF } from 'gifuct-js';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/export-harness.html');
  await expect(page.locator('#ready')).toHaveText('Actual export modules ready');
});

async function actualGif(page: Page, frameCount = 12, image = false): Promise<Uint8Array> {
  const bytes = await page.evaluate(async ({ frameCount, image }) => {
    const api = window.exportHarness;
    const blob = await api.exportGif(image ? api.imageFixture() : api.fixture(frameCount), () => {});
    if (blob.type !== 'image/gif') throw new Error('Incorrect export media type');
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { frameCount, image });
  return Uint8Array.from(bytes);
}

function decode(bytes: Uint8Array) {
  return decompressFrames(parseGIF(Uint8Array.from(bytes).buffer), true);
}

function center(patch: Uint8ClampedArray, color: 'red' | 'blue') {
  let total = 0, x = 0, y = 0;
  for (let index = 0; index < patch.length; index += 4) {
    const matches = color === 'red'
      ? patch[index] > 200 && patch[index + 1] < 80 && patch[index + 2] < 80
      : patch[index + 2] > 200 && patch[index] < 80 && patch[index + 1] < 80;
    if (matches && patch[index + 3] === 255) {
      x += (index / 4) % 640;
      y += Math.floor(index / 4 / 640);
      total++;
    }
  }
  expect(total).toBeGreaterThan(100);
  return { x: x / total, y: y / total };
}

test('real GIF has every ordered frame, exact rounded timing, loop and moving drawing pixels', async ({ page }) => {
  const bytes = await actualGif(page);
  expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a');
  const frames = decode(bytes);
  expect(frames).toHaveLength(12);
  expect(frames.map(frame => frame.delay)).toEqual([80, 90, 80, 80, 90, 80, 80, 90, 80, 80, 90, 80]);
  expect(frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(1000);
  for (const frame of frames) {
    expect(frame.dims).toEqual({ top: 0, left: 0, width: 640, height: 360 });
  }
  const positions = frames.map(frame => center(frame.patch, 'red'));
  positions.forEach((position, index) => {
    expect(position.x + .5).toBeCloseTo(100 + index * 40, 0);
    expect(position.y + .5).toBeCloseTo(180, 0);
  });
  const application = new TextDecoder('latin1').decode(bytes).indexOf('NETSCAPE2.0');
  expect(application).toBeGreaterThan(0);
  expect(Array.from(bytes.subarray(application + 11, application + 16))).toEqual([3, 1, 0, 0, 0]);
});

test('embedded normalized image exports through the worker with real decoded movement', async ({ page }) => {
  const frames = decode(await actualGif(page, 12, true));
  expect(frames).toHaveLength(12);
  expect(center(frames[0].patch, 'blue').x).toBeCloseTo(99.5, 0);
  expect(center(frames[11].patch, 'blue').x).toBeCloseTo(539.5, 0);
});

test('maximum timeline encodes 96 frames with total duration eight seconds', async ({ page }) => {
  const frames = decode(await actualGif(page, 96));
  expect(frames).toHaveLength(96);
  expect(frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(8000);
});

test('fractional-second timelines round total GIF duration within one centisecond', async ({ page }) => {
  const frames = decode(await actualGif(page, 13));
  expect(frames).toHaveLength(13);
  const duration = frames.reduce((sum, frame) => sum + frame.delay, 0);
  expect(Math.abs(duration - 13 / 12 * 1000)).toBeLessThanOrEqual(10);
});

test('export snapshots artwork and terminates its actual worker after completion', async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const NativeWorker = globalThis.Worker;
    let terminated = 0;
    class TrackedWorker extends NativeWorker {
      terminate() { terminated++; super.terminate(); }
    }
    Object.defineProperty(globalThis, 'Worker', { value: TrackedWorker, configurable: true });
    try {
      const project = window.exportHarness.fixture();
      const progress: number[] = [];
      const pending = window.exportHarness.exportGif(project, value => progress.push(value));
      project.layers[0].keys[0].x = -600;
      if (project.layers[0].kind === 'drawing') project.layers[0].cels[0].strokes = [];
      const blob = await pending;
      return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), progress, terminated };
    } finally {
      Object.defineProperty(globalThis, 'Worker', { value: NativeWorker, configurable: true });
    }
  });
  expect(outcome.terminated).toBe(1);
  expect(outcome.progress[0]).toBe(0);
  expect(outcome.progress.at(-1)).toBe(1);
  expect(outcome.progress.every((value, index) => value >= (outcome.progress[index - 1] ?? 0))).toBe(true);
  expect(center(decode(Uint8Array.from(outcome.bytes))[0].patch, 'red').x + .5).toBeCloseTo(100, 0);
});

test('abort during real worker progress releases it and leaves the project unchanged', async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const NativeWorker = globalThis.Worker;
    let terminated = 0;
    class TrackedWorker extends NativeWorker {
      terminate() { terminated++; super.terminate(); }
    }
    Object.defineProperty(globalThis, 'Worker', { value: TrackedWorker, configurable: true });
    try {
      const project = window.exportHarness.fixture(96);
      const before = JSON.stringify(project);
      const cancel = new AbortController();
      let name = '', message = '';
      try {
        await window.exportHarness.exportGif(project, progress => {
          if (progress > 0) cancel.abort();
        }, cancel.signal);
      } catch (error) {
        name = (error as Error).name;
        message = (error as Error).message;
      }
      return { name, message, terminated, unchanged: before === JSON.stringify(project) };
    } finally {
      Object.defineProperty(globalThis, 'Worker', { value: NativeWorker, configurable: true });
    }
  });
  expect(outcome.name).toBe('AbortError');
  expect(outcome.message.toLowerCase()).toContain('cancel');
  expect(outcome.terminated).toBe(1);
  expect(outcome.unchanged).toBe(true);
});

test('unsupported browser and already aborted exports reject without launching a worker', async ({ page }) => {
  const messages = await page.evaluate(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')!;
    Object.defineProperty(globalThis, 'OffscreenCanvas', { value: undefined, configurable: true });
    try {
      const messages = [];
      try { await window.exportHarness.exportGif(window.exportHarness.fixture(), () => {}); }
      catch (error) { messages.push((error as Error).message); }
      const cancel = new AbortController();
      cancel.abort();
      try { await window.exportHarness.exportGif(window.exportHarness.fixture(), () => {}, cancel.signal); }
      catch (error) { messages.push((error as Error).name); }
      return messages;
    } finally { Object.defineProperty(globalThis, 'OffscreenCanvas', descriptor); }
  });
  expect(messages[0].toLowerCase()).toContain('support');
  expect(messages[1]).toBe('AbortError');
});

test('client rejects an oversized encoded result and terminates the faulty worker', async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const NativeWorker = globalThis.Worker;
    let terminated = 0;
    class FaultyWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      postMessage() {
        queueMicrotask(() => this.onmessage?.(new MessageEvent('message', {
          data: { type: 'complete', buffer: new ArrayBuffer(32 * 1024 * 1024 + 1) },
        })));
      }
      terminate() { terminated++; }
    }
    Object.defineProperty(globalThis, 'Worker', { value: FaultyWorker, configurable: true });
    try {
      let message = '';
      try { await window.exportHarness.exportGif(window.exportHarness.fixture(), () => {}); }
      catch (error) { message = (error as Error).message; }
      return { message, terminated };
    } finally { Object.defineProperty(globalThis, 'Worker', { value: NativeWorker, configurable: true }); }
  });
  expect(outcome.message).toContain('32');
  expect(outcome.terminated).toBe(1);
});
