import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelJobs, exportPng, exportReport, normalize, preview } from '../src/jobs.ts';
import { encodePng } from '../src/png.ts';
import type { Project } from '../src/types.ts';
function fixture(): Project { return { schemaVersion: 1, id: '12345678-1234-4234-8234-123456789012', title: 'First', image: { id: '12345678-1234-4234-8234-123456789013', width: 1, height: 1, rgba: 'ChQe/w==', source: { fileName: 'original.png', format: 'png', width: 1, height: 1 } }, settings: { mode: 'solid', border: 0, colorA: '#ffffff', colorB: '#000000', cellSize: 4 } }; }
class ControlledWorker {
  static all: ControlledWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: unknown;
  terminated = 0;
  constructor(url: URL, options: WorkerOptions) { assert.match(url.href, /image.worker.ts$/); assert.equal(options.type, 'module'); ControlledWorker.all.push(this); }
  postMessage(value: unknown) { this.request = value; }
  terminate() { this.terminated++; }
  reply(value: unknown) { this.onmessage?.({ data: value }); }
}
async function workers(run: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  ControlledWorker.all = [];
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ControlledWorker });
  try { await run(); } finally { cancelJobs(); if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker'); }
}
const latest = () => ControlledWorker.all.at(-1)!;
const report = '<!doctype html><html>original report</html>';
test('latest valid job supersedes previous once, and late detached callback cannot resolve newer owner', async () => workers(async () => {
  const first = exportReport(fixture()); const rejected = assert.rejects(first, { name: 'AbortError' });
  const old = latest(); const callback = old.onmessage!;
  const second = exportReport(fixture()); const current = latest();
  assert.equal(old.terminated, 1);
  callback({ data: { ok: true, kind: 'report', value: 'old' } });
  current.reply({ ok: true, kind: 'report', value: report });
  assert.equal(await second, report); await rejected;
  assert.equal(current.terminated, 1);
}));
test('invalid projects, variants, files, options and preabort leave admitted worker alive', async () => workers(async () => {
  const active = exportReport(fixture()); const worker = latest();
  const signal = new AbortController(); signal.abort();
  await assert.rejects(preview(fixture(), { signal: signal.signal }), { name: 'AbortError' });
  await assert.rejects(preview({ ...fixture(), title: '' }));
  await assert.rejects(exportPng(fixture(), 'bad' as 'source'));
  await assert.rejects(normalize(new File([], 'empty.png')));
  await assert.rejects(exportReport(fixture(), { signal: {} as AbortSignal }));
  assert.equal(worker.terminated, 0); assert.equal(ControlledWorker.all.length, 1);
  worker.reply({ ok: true, kind: 'report', value: report }); await active;
}));
test('project admission snapshots before posting and cancellation cleans ownership/listeners', async () => workers(async () => {
  const project = fixture(); const controller = new AbortController();
  const pending = exportReport(project, { signal: controller.signal }); const rejected = assert.rejects(pending, { name: 'AbortError' });
  const worker = latest(); project.title = 'Changed'; project.settings.border = 1;
  assert.equal((worker.request as { project: Project }).project.title, 'First');
  controller.abort(); await rejected;
  assert.equal(worker.terminated, 1); assert.equal(worker.onmessage, null);
  cancelJobs(); assert.equal(worker.terminated, 1);
}));
test('malformed/error replies and transport errors are bounded, with no raw exception details', async () => workers(async () => {
  for (const reply of [{ ok: true, kind: 'report', value: 42 }, { ok: true, kind: 'png', value: new Uint8Array() }, { ok: false, error: 'secret source path' }]) {
    const pending = exportReport(fixture()); const rejected = assert.rejects(pending, error => error instanceof Error && !error.message.includes('secret'));
    latest().reply(reply); await rejected; assert.equal(latest().terminated, 1);
  }
  const pending = preview(fixture()); const rejected = assert.rejects(pending, /processing|worker|retry/i);
  latest().onerror?.({ preventDefault() {} }); await rejected;
}));
test('PNG and preview replies admit exact bounded typed payloads and cancelJobs rejects active work', async () => workers(async () => {
  const png = encodePng({ width: 1, height: 1, rgba: Uint8ClampedArray.of(10, 20, 30, 255) });
  const pending = exportPng(fixture(), 'source'); latest().reply({ ok: true, kind: 'png', value: png }); assert.deepEqual(await pending, png);
  const comparison = { baseline: { width: 1, height: 1, rgba: Uint8ClampedArray.of(10, 20, 30, 255) }, result: { width: 1, height: 1, rgba: Uint8ClampedArray.of(10, 20, 30, 255) }, metrics: { artworkChangedPixels: 0, artworkMaxChannelDelta: 0, surroundPixels: 0, totalPixels: 1, rgbRmse: 0, maxRgbDelta: 0, meanAbsoluteLuminanceDelta: 0 } };
  const shown = preview(fixture()); latest().reply({ ok: true, kind: 'preview', value: comparison }); assert.deepEqual(await shown, comparison);
  const cancelled = exportReport(fixture()); const rejected = assert.rejects(cancelled, { name: 'AbortError' }); cancelJobs(); await rejected;
}));
test('normalization sends immutable File and validates returned raw asset, not arbitrary worker object', async () => workers(async () => {
  const file = new File([Uint8Array.of(1).buffer], 'original.png', { type: 'image/png' });
  const pending = normalize(file); assert.equal((latest().request as { file: File }).file, file);
  latest().reply({ ok: true, kind: 'normalize', value: fixture().image }); assert.equal((await pending).rgba, 'ChQe/w==');
  const invalid = normalize(file); const rejected = assert.rejects(invalid); latest().reply({ ok: true, kind: 'normalize', value: { ...fixture().image, rgba: 'bad' } }); await rejected;
}));
test('single aggregate30second timer terminates owned worker and leaves subsequent request usable', async context => workers(async () => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const timed = exportReport(fixture()); const rejected = assert.rejects(timed, /timed out/i);
  const worker = latest(); context.mock.timers.tick(30_000); await rejected;
  assert.equal(worker.terminated, 1); assert.equal(worker.onmessage, null);
  const next = exportReport(fixture()); latest().reply({ ok: true, kind: 'report', value: report }); assert.equal(await next, report);
}));
