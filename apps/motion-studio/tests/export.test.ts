import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, test } from 'node:test';
import { exportGif } from '../src/export.ts';
import { createProject } from '../src/model.ts';

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = 0;
  sent: unknown = null;
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(value: unknown) { this.sent = value; }
  terminate() { this.terminated++; }
  emit(value: unknown) { this.onmessage?.(new MessageEvent('message', { data: value })); }
}

let descriptors: Map<string, PropertyDescriptor | undefined>;
beforeEach(() => {
  descriptors = new Map(['Worker', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  ControlledWorker.instances = [];
  Object.defineProperty(globalThis, 'Worker', { value: ControlledWorker, configurable: true });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { value: class {}, configurable: true });
});
afterEach(() => {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test('an already cancelled export creates no worker', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(exportGif(createProject(), () => {}, signal), { name: 'AbortError' });
  assert.equal(ControlledWorker.instances.length, 0);
});

test('unsupported OffscreenCanvas fails without launching a worker', async () => {
  Object.defineProperty(globalThis, 'OffscreenCanvas', { value: undefined, configurable: true });
  await assert.rejects(exportGif(createProject(), () => {}), /support/i);
  assert.equal(ControlledWorker.instances.length, 0);
});

test('abort terminates a running worker and clears its callbacks', async () => {
  const cancel = new AbortController();
  const pending = exportGif(createProject(), () => {}, cancel.signal);
  const failure = assert.rejects(pending, { name: 'AbortError' });
  const worker = ControlledWorker.instances[0];
  cancel.abort();
  await failure;
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.equal(worker.onmessageerror, null);
});

test('worker progress and completion return a GIF blob and release the worker', async () => {
  const progress: number[] = [];
  const signal = new AbortController().signal;
  const pending = exportGif(createProject(), fraction => progress.push(fraction), signal);
  const worker = ControlledWorker.instances[0];
  worker.emit({ type: 'progress', fraction: .5 });
  worker.emit({ type: 'progress', fraction: 1 });
  // A test-only valid one-pixel GIF exercises the client's lifecycle. Native
  // browser tests independently decode the actual production worker's frames.
  const bytes = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  worker.emit({ type: 'complete', buffer: bytes.buffer });
  const blob = await pending;
  assert.equal(blob.type, 'image/gif');
  assert.equal(blob.size, bytes.length);
  assert.deepEqual(progress, [0, .5, 1]);
  assert.equal(worker.terminated, 1);
  assert.equal(getEventListeners(signal, 'abort').length, 0);
});

test('invalid worker output and encoded size limit reject and terminate', async () => {
  for (const buffer of ['invalid', new ArrayBuffer(32 * 1024 * 1024 + 1)]) {
    const pending = exportGif(createProject(), () => {});
    const failure = assert.rejects(pending, /invalid|32/i);
    const worker = ControlledWorker.instances.at(-1)!;
    worker.emit({ type: 'complete', buffer });
    await failure;
    assert.equal(worker.terminated, 1);
  }
});

test('worker failures reject with bounded useful errors and release it', async () => {
  const pending = exportGif(createProject(), () => {});
  const failure = assert.rejects(pending, /image decode failed/);
  const worker = ControlledWorker.instances[0];
  worker.emit({ type: 'error', message: 'image decode failed' });
  await failure;
  assert.equal(worker.terminated, 1);
});

test('uncaught worker errors and message decoding errors release their workers', async () => {
  const uncaught = exportGif(createProject(), () => {});
  const failure = assert.rejects(uncaught, /unexpected worker failure/);
  const worker = ControlledWorker.instances[0];
  worker.onerror?.({ message: 'unexpected worker failure', preventDefault() {} } as ErrorEvent);
  await failure;
  assert.equal(worker.terminated, 1);
  const decoding = exportGif(createProject(), () => {});
  const decodingFailure = assert.rejects(decoding, /receive/i);
  const second = ControlledWorker.instances[1];
  second.onmessageerror?.();
  await decodingFailure;
  assert.equal(second.terminated, 1);
});

test('30-second timeout terminates a worker that never replies', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = exportGif(createProject(), () => {});
  const failure = assert.rejects(pending, /30|timed out/i);
  const worker = ControlledWorker.instances[0];
  context.mock.timers.tick(30_001);
  await failure;
  assert.equal(worker.terminated, 1);
});

test('a throwing progress callback releases its worker', async () => {
  const pending = exportGif(createProject(), () => { throw new Error('progress callback failed'); });
  await assert.rejects(pending, /progress callback failed/);
  assert.equal(ControlledWorker.instances[0].terminated, 1);
});
