import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { renderProject, exportPng } from '../src/jobs.ts';
import type { Project } from '../src/types.ts';

class WorkerDouble extends EventTarget {
  static instances: WorkerDouble[] = [];
  terminated = false; posted: unknown; listeners = 0;
  url: URL; options: WorkerOptions;
  constructor(url: URL, options: WorkerOptions) { super(); this.url = url; this.options = options; WorkerDouble.instances.push(this); }
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>) { this.listeners++; super.addEventListener(...args); }
  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) { this.listeners--; super.removeEventListener(...args); }
  postMessage(value: unknown) { this.posted = value; }
  terminate() { this.terminated = true; }
  result(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: value })); }
}
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
test.beforeEach(() => { WorkerDouble.instances = []; Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerDouble }); });
test.afterEach(() => { if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker); else Reflect.deleteProperty(globalThis, 'Worker'); });
function fixture(): Project {
  const png = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) } as PNG);
  return { schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', title: 'Worker test',
    photo: { id: '22222222-2222-4222-8222-222222222222', width: 1, height: 1, dataUrl: `data:image/png;base64,${png.toString('base64')}` },
    settings: { mode: 'fixed', sourceFocal: 50, targetFocal: 50, shiftX: 0, shiftY: 0, near: 0.6, far: 2 },
    depth: { width: 1, height: 1, labels: 'AQ==' } };
}
const frame = () => ({ width: 1, height: 1, rgba: new Uint8ClampedArray([255, 0, 0, 255]), missingFraction: 0 });
const latest = () => WorkerDouble.instances.at(-1)!;

test('valid render creates a module worker, captures snapshot and releases worker/listeners on completion', async () => {
  const project = fixture(); const pending = renderProject(project); const worker = latest();
  assert.ok(worker); assert.equal(worker.options.type, 'module');
  project.title = 'Changed during render';
  assert.equal((worker.posted as { project: Project }).project.title, 'Worker test');
  worker.result({ kind: 'rendered', frame: frame() });
  assert.deepEqual([...(await pending).rgba], [255, 0, 0, 255]); assert.equal(worker.terminated, true); assert.equal(worker.listeners, 0);
});

test('invalid project and already-aborted request leave the existing job alive', async () => {
  const pending = renderProject(fixture()); const worker = latest();
  await assert.rejects(renderProject({ ...fixture(), title: '' }));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(exportPng(fixture(), aborted.signal), { name: 'AbortError' });
  assert.equal(WorkerDouble.instances.length, 1); assert.equal(worker.terminated, false);
  worker.result({ kind: 'rendered', frame: frame() }); await pending;
});

test('export supersedes render module-wide, ignores retired messages, and cleans both workers', async () => {
  const old = renderProject(fixture()); const cancelled = assert.rejects(old, { name: 'AbortError' }); const retired = latest();
  const pending = exportPng(fixture()); const worker = latest(); await cancelled;
  assert.equal(retired.terminated, true); assert.equal(retired.listeners, 0);
  retired.result({ kind: 'rendered', frame: frame() });
  const bytes = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([128, 64, 32, 1]) } as PNG);
  worker.result({ kind: 'png', bytes: new Uint8Array(bytes) });
  const blob = await pending; assert.equal(blob.type, 'image/png'); assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array(bytes));
  assert.equal(worker.terminated, true); assert.equal(worker.listeners, 0);
});

test('live abort terminates its worker and permits a later successful render', async () => {
  const abort = new AbortController(); const old = renderProject(fixture(), abort.signal); const rejected = assert.rejects(old, { name: 'AbortError' }); const worker = latest();
  abort.abort(); await rejected; assert.equal(worker.terminated, true); assert.equal(worker.listeners, 0);
  const next = renderProject(fixture()); latest().result({ kind: 'rendered', frame: frame() }); await next;
});

test('30-second deadline rejects and terminates without fabricating a frame', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = renderProject(fixture()); const worker = latest(); const rejected = assert.rejects(pending, /timed out|30 seconds/i);
  t.mock.timers.tick(30_000); await rejected; assert.equal(worker.terminated, true); assert.equal(worker.listeners, 0);
});

test('malformed worker results and runtime errors are bounded safe failures', async () => {
  for (const value of [null, { kind: 'rendered', frame: { ...frame(), rgba: new Uint8ClampedArray() } }, { kind: 'rendered', frame: { ...frame(), missingFraction: NaN } }, { kind: 'png', bytes: new Uint8Array() }, { kind: 'error', message: 'PRIVATE_SOURCE_TEXT' }]) {
    const pending = renderProject(fixture()); const rejected = assert.rejects(pending, error => error instanceof Error && !error.message.includes('PRIVATE_SOURCE_TEXT'));
    const worker = latest(); worker.result(value); await rejected; assert.equal(worker.terminated, true); assert.equal(worker.listeners, 0);
  }
  const pending = renderProject(fixture()); const rejected = assert.rejects(pending, /worker|render/i); const worker = latest();
  worker.dispatchEvent(new Event('error')); await rejected; assert.equal(worker.terminated, true);
});
