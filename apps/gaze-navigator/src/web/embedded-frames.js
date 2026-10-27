// Embedded frames from other sites, reached in the extension through frame agents (extension/frame-agent.js) and the
// background. A cross-origin iframe in the gaze circle is identified by a random nonce posted into it, its controls
// near the gaze are captured there, and they join the circle's context with rectangles in this page's viewport.
// Actions on them are performed by the frame's own controller after this navigator has interpreted and confirmed them.
import { sameOriginFrames, viewportRect } from './page-context.js';

const PROBE_TRIES = 10;
const PROBE_WAIT_MS = 50;
const INJECT_RETRY_MS = 5000;
// A frame's last answer is reused for a new capture at nearly the same place, so an instruction given right after the
// gaze settles (or from the panel) can name controls the frame reported moments before.
const REUSE_MS = 3000;
const REUSE_PX = 24;
// Context ids below the ring of nearby controls, which starts at 101.
const LAST_ID = 100;

const nonce = window => [...window.crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export function createEmbeddedFrames({ window, runtime }) {
  const frameIds = new WeakMap(), injected = new WeakMap(), byId = new Map(), chains = new WeakMap(), answers = new WeakMap();
  const send = message => runtime.sendMessage(message).catch(() => null);
  const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

  async function frameIdOf(frame) {
    if (frameIds.has(frame)) return frameIds.get(frame);
    const now = window.performance.now();
    if (!(now - (injected.get(frame) ?? -Infinity) < INJECT_RETRY_MS)) {
      injected.set(frame, now);
      await send({ type: 'gaze:frame-inject' });
    }
    const probe = nonce(window);
    try { frame.contentWindow?.postMessage({ gazeNavigatorProbe: probe }, '*'); } catch { return null; }
    for (let tries = 0; tries < PROBE_TRIES; tries++) {
      await wait(PROBE_WAIT_MS);
      const reply = await send({ type: 'gaze:frame-resolve', nonce: probe });
      if (Number.isInteger(reply?.frameId)) { frameIds.set(frame, reply.frameId); byId.set(reply.frameId, frame); return reply.frameId; }
    }
    return null;
  }

  // Where an embedded frame's content starts in this page's viewport: inside its border and padding.
  function contentOrigin(frame, frames) {
    const box = viewportRect(frame, frames), style = frame.ownerDocument.defaultView.getComputedStyle(frame);
    return { left: box.left + frame.clientLeft + parseFloat(style.paddingLeft || '0'), top: box.top + frame.clientTop + parseFloat(style.paddingTop || '0') };
  }

  /**
   * Follows `document`'s embedded frames from other sites, so pointer moves over them reach `onPointer` in this page's
   * coordinates. Returns a function that stops following.
   */
  function attach({ document, exclude = null, onPointer }) {
    const discover = () => {
      const scopes = [{ document, frames: [] }, ...sameOriginFrames(document, exclude)];
      for (const { document: scope, frames } of scopes) {
        for (const frame of scope.querySelectorAll('iframe, frame')) {
          let reachable = false;
          try { reachable = Boolean(frame.contentDocument); } catch { reachable = false; }
          if (reachable || exclude?.contains(frame)) continue;
          chains.set(frame, frames);
          void frameIdOf(frame);
        }
      }
    };
    let pending = 0;
    const later = () => { pending ||= window.setTimeout(() => { pending = 0; discover(); }, 300); };
    // A frame that loads a new page needs a new agent.
    const onLoad = event => { if (/^I?FRAME$/.test(event.target?.tagName ?? '')) { frameIds.delete(event.target); injected.delete(event.target); later(); } };
    const observer = new window.MutationObserver(later);
    observer.observe(document, { subtree: true, childList: true });
    document.addEventListener('load', onLoad, true);
    const onMessage = (message, sender) => {
      if (message?.type !== 'gaze:frame-pointer' || sender.tab || sender.id !== runtime.id) return;
      const frame = byId.get(message.frameId);
      if (!frame?.isConnected) return;
      const origin = contentOrigin(frame, chains.get(frame) ?? []);
      onPointer(origin.left + message.x, origin.top + message.y, window.performance.now());
    };
    runtime.onMessage.addListener(onMessage);
    discover();
    return () => { observer.disconnect(); document.removeEventListener('load', onLoad, true); runtime.onMessage.removeListener(onMessage); window.clearTimeout(pending); };
  }

  /** Adds the controls of reachable embedded frames in `context.unreachable` to `context`; calls `changed` after each. */
  function extend(context, { isCurrent = () => true, changed = () => {} } = {}) {
    const add = (embedded, frameId, elements, origin) => {
      let id = Math.max(0, ...context.elements.map(element => element.id));
      for (const remote of elements) {
        if (id >= LAST_ID) break;
        const rect = { left: remote.rect.left + origin.left, top: remote.rect.top + origin.top, width: remote.rect.width, height: remote.rect.height };
        const frame = embedded.frame;
        context.elements.push({ ...remote, id: ++id, rect, frames: [], embeddedIn: embedded.name,
          element: { get isConnected() { return frame.isConnected; },
            remote: { id: remote.id, run: action => send({ type: 'gaze:frame-act', frameId, action }).then(result => result ?? { ok: false, message: 'The embedded page is not reachable.' }) } } });
      }
      context.unreachable = context.unreachable.filter(entry => entry !== embedded);
    };
    for (const embedded of [...(context.unreachable ?? [])]) {
      const { frame, frames } = embedded;
      if (!frame?.isConnected) continue;
      const origin = contentOrigin(frame, frames), x = context.x - origin.left, y = context.y - origin.top;
      const recent = answers.get(frame);
      if (recent && window.performance.now() - recent.time < REUSE_MS && Math.hypot(recent.x - x, recent.y - y) < REUSE_PX && recent.radius === context.radius) {
        add(embedded, recent.frameId, recent.elements, origin);
        continue;
      }
      (async () => {
        const frameId = await frameIdOf(frame);
        if (frameId === null || !isCurrent()) return;
        const reply = await send({ type: 'gaze:frame-capture', frameId, x, y, radius: context.radius });
        if (!reply?.ok) { frameIds.delete(frame); return; }
        answers.set(frame, { frameId, x, y, radius: context.radius, time: window.performance.now(), elements: reply.elements });
        if (!isCurrent() || !context.unreachable.includes(embedded)) return;
        add(embedded, frameId, reply.elements, contentOrigin(frame, frames));
        changed();
      })().catch(() => {});
    }
  }

  return { attach, extend };
}
