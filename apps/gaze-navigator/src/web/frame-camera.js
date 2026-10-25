// The extension's camera (see camera-source.js for the interface). It embeds an invisible extension frame
// (capture.html) that owns the camera and the estimator, so the browser asks about, and remembers, camera
// access for Gaze Navigator rather than for each website, and the page cannot read the video. Gaze points
// and calibration requests travel over an extension port keyed by a per-frame nonce.
const READY_MS = 10000;

export function createFrameCamera({ document, window, mount, store = {}, onGaze, onLost, runtime = globalThis.chrome?.runtime }) {
  let state = 'off';
  let session = 0;
  let frame = null;
  let port = null;
  let nextId = 0;
  const waiting = new Map();

  function teardown() {
    const closing = port;
    port = null;
    try { closing?.disconnect(); } catch { /* Already closed. */ }
    // Removing the frame destroys its document, which releases the camera even if no request arrives.
    frame?.remove();
    frame = null;
    for (const { reject } of waiting.values()) reject(new Error('The camera stopped.'));
    waiting.clear();
  }

  function request(op, ...args) {
    if (!port) return Promise.reject(new Error('The camera is off.'));
    const id = ++nextId;
    const answer = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
    port.postMessage({ id, op, args });
    return answer;
  }

  function within(ms, promise, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), ms); })])
      .finally(() => window.clearTimeout(timer));
  }

  async function open(current) {
    // getRandomValues also works on plain-http pages, where randomUUID is unavailable.
    const nonce = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    frame = document.createElement('iframe');
    frame.src = runtime.getURL(`capture.html#${nonce}`);
    frame.allow = 'camera';
    frame.title = 'Gaze Navigator camera';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    // Full viewport so the estimator's coordinates match the page's; invisible and never in the way.
    frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;opacity:0;pointer-events:none;';
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    mount.prepend(frame);
    await within(READY_MS, loaded, 'The camera frame did not load.');
    if (current !== session) throw new Error('cancelled');
    const connection = runtime.connect({ name: `gaze-capture:${nonce}` });
    port = connection;
    await within(READY_MS, new Promise((resolve, reject) => {
      connection.onMessage.addListener(function ready(message) {
        if (message?.type !== 'ready') return;
        connection.onMessage.removeListener(ready);
        resolve();
      });
      connection.onDisconnect.addListener(() => reject(new Error('The camera frame closed.')));
    }), 'The camera frame did not answer.');
    connection.onMessage.addListener(message => {
      if (message?.type === 'gaze') {
        if (current === session && state === 'ready') onGaze(message.x, message.y, window.performance.now());
        return;
      }
      if (message?.type === 'lost') {
        if (current === session && state === 'ready') onLost();
        return;
      }
      const pending = waiting.get(message?.id);
      if (!pending) return;
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    // The frame went away (the website removed it, or the extension reloaded): the camera is off.
    connection.onDisconnect.addListener(() => {
      if (port !== connection) return;
      state = 'off';
      teardown();
      onLost();
    });
  }

  return {
    async start() {
      if (state !== 'off') return { ok: false, message: 'The camera is already on.' };
      const current = ++session;
      state = 'starting';
      try {
        await open(current);
        const result = await request('start');
        if (current !== session) return { ok: false, message: 'Camera start was cancelled.' };
        if (result?.ok) {
          state = 'ready';
          return result;
        }
        teardown();
        state = 'off';
        if (result?.reason === 'NotAllowedError') {
          runtime.sendMessage({ type: 'gaze:camera-permission' }).catch(() => {});
          return { ok: false, message: 'Gaze Navigator needs permission to use the camera. A setup tab has opened: allow the camera there, then say “use camera” again.' };
        }
        return result ?? { ok: false, message: 'Camera tracking could not start. Keep using the pointer, or try again.' };
      } catch (error) {
        if (current !== session) return { ok: false, message: 'Camera start was cancelled.' };
        teardown();
        state = 'off';
        return { ok: false, message: `Camera tracking could not start (${error.message}). Keep using the pointer, or try again.` };
      }
    },
    stop() {
      const was = state;
      session++;
      state = 'off';
      try { port?.postMessage({ op: 'stop' }); } catch { /* Closing anyway. */ }
      teardown();
      return was !== 'off';
    },
    get state() { return state; },
    get session() { return session; },
    resetCalibration() { request('reset').catch(() => {}); },
    recordSample: (x, y) => request('sample', x, y).catch(() => false),
    restoreCalibration: size => request('restore', size).catch(() => ({ ok: false, reason: 'stopped' })),
    saveCalibration(size) { request('save', size).catch(() => {}); },
    // Works with the camera off too: stopping the camera also forgets the saved calibration.
    clearCalibration: () => store.clearCalibration?.(),
  };
}
