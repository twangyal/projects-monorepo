import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameCamera } from '../src/web/frame-camera.js';

test('the camera frame preserves the sample time in the overlay clock', async () => {
  const listeners = () => {
    const handlers = new Set();
    return { addListener: fn => handlers.add(fn), removeListener: fn => handlers.delete(fn),
      send: data => { for (const fn of [...handlers]) fn(data); } };
  };
  const messages = listeners(), disconnect = listeners();
  const connection = { onMessage: messages, onDisconnect: disconnect,
    postMessage: ({ id }) => queueMicrotask(() => messages.send({ id, result: { ok: true } })),
    disconnect: () => disconnect.send() };
  const frame = Object.assign(new EventTarget(), { style: {}, setAttribute() {}, remove() {} });
  const estimates = [];
  const camera = createFrameCamera({
    document: { createElement: () => frame },
    window: { crypto: globalThis.crypto, setTimeout, clearTimeout, performance: { now: () => 900, timeOrigin: 1000 } },
    mount: { prepend: () => queueMicrotask(() => frame.dispatchEvent(new Event('load'))) },
    runtime: { getURL: path => path, connect: () => {
      queueMicrotask(() => messages.send({ type: 'ready' })); return connection;
    } },
    onGaze: (...estimate) => estimates.push(estimate),
    onLost() {},
  });
  assert.equal((await camera.start()).ok, true);
  messages.send({ type: 'gaze', x: 50, y: 70, sampledAt: 1150 });
  messages.send({ type: 'gaze', x: 50, y: 70 });
  messages.send({ type: 'gaze', x: 50, y: 70, sampledAt: 999 });
  messages.send({ type: 'gaze', x: 50, y: 70, sampledAt: 2100 });
  assert.deepEqual(estimates, [[50, 70, 150]]);
  camera.stop();
});
