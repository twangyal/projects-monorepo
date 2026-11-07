// Injected into embedded frames (iframes from other sites) where Gaze Navigator has host access. It answers the
// navigator in the top frame, through the extension's background only: which of the top page's iframes it is, what
// controls lie within the gaze circle there, and to perform one already-confirmed action on one of them.
if (window !== window.top && !globalThis.__gazeFrameAgent) {
  globalThis.__gazeFrameAgent = true;
  let modules = null, controller = null;
  const captures = new Map();
  // Cover a 30 s clarification followed by 15 s confirmation, plus time reusing the last answer.
  const CAPTURE_MS = 60000;
  // The top navigator normally captures at most every 100 ms. Bound memory even if requests arrive faster.
  const CAPTURE_LIMIT = 640;
  const documentKey = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  let sequence = 0, expiryTimer = null;
  function dropExpired(now = performance.now()) {
    for (const [id, snapshot] of captures) {
      if (snapshot.expiresAt > now) break;
      captures.delete(id);
    }
  }
  function scheduleExpiry() {
    if (expiryTimer !== null || !captures.size) return;
    const next = captures.values().next().value.expiresAt;
    expiryTimer = window.setTimeout(() => {
      expiryTimer = null;
      dropExpired();
      scheduleExpiry();
    }, Math.max(1, next - performance.now()));
  }
  window.addEventListener('pagehide', () => {
    window.clearTimeout(expiryTimer);
    expiryTimer = null;
    captures.clear();
  });
  const load = () => (modules ??= Promise.all([
    import(chrome.runtime.getURL('src/web/page-context.js')),
    import(chrome.runtime.getURL('src/web/controller.js')),
  ]));
  // Pointer moves over this frame never reach the top page, where pointer mode follows them; pass them on (at most
  // 30 per second) for the navigator to place its circle.
  let lastPointer = 0, pointer = null;
  const sendPointer = () => chrome.runtime.sendMessage({ type: 'gaze:frame-pointer', x: pointer.x, y: pointer.y }).catch(() => {});
  window.addEventListener('pointermove', event => {
    pointer = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    if (event.timeStamp - lastPointer < 33) return;
    lastPointer = event.timeStamp;
    sendPointer();
  }, { capture: true, passive: true });
  // The top navigator posts a random nonce into this frame's window to learn which extension frame it is. A pointer
  // that came to rest here before then is passed on again once the navigator knows this frame.
  window.addEventListener('message', event => {
    if (event.source !== window.parent || typeof event.data?.gazeNavigatorProbe !== 'string' || !/^[0-9a-f]{32}$/.test(event.data.gazeNavigatorProbe)) return;
    chrome.runtime.sendMessage({ type: 'gaze:frame-hello', nonce: event.data.gazeNavigatorProbe }).catch(() => {});
    if (pointer && performance.now() - pointer.time < 5000) setTimeout(sendPointer, 250);
  });
  // Only what is needed to interpret and confirm: no element references, snapshots or sensitive values.
  const FIELDS = ['id', 'name', 'role', 'editable', 'submits', 'consequential', 'value', 'options', 'consequentialOptions', 'checked', 'expanded',
    'sensitive', 'hasValue', 'nativeNumber', 'nativeDate', 'nativeTime', 'nativeMonth', 'nativeWeek', 'customRange', 'customList', 'holds', 'distance'];
  const describe = element => {
    const plain = Object.fromEntries(FIELDS.filter(key => element[key] !== undefined).map(key => [key, element[key]]));
    const { left, top, width, height } = element.rect;
    return { ...plain, rect: { left, top, width, height } };
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    // Requests come from the extension's background (never from a tab), which relays only the top navigator's.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message?.type === 'gaze:frame-capture') {
      load().then(([pageContext]) => {
        const { elements } = pageContext.captureContext(document, { x: message.x, y: message.y, radius: message.radius });
        const now = performance.now();
        dropExpired(now);
        if (captures.size >= CAPTURE_LIMIT) captures.delete(captures.keys().next().value);
        const captureId = documentKey + ':' + ++sequence;
        // Keep only the controls we exposed, rather than the rest of the page context.
        captures.set(captureId, { elements, expiresAt: now + CAPTURE_MS });
        scheduleExpiry();
        respond({ ok: true, captureId, elements: elements.map(describe) });
      }).catch(() => respond({ ok: false }));
      return true;
    }
    if (message?.type === 'gaze:frame-act') {
      load().then(async ([, control]) => {
        const snapshot = captures.get(message.captureId);
        if (!snapshot || snapshot.expiresAt <= performance.now()) {
          return respond({ ok: false, message: 'The embedded page changed or the capture expired. Look at it again.' });
        }
        if (!snapshot.elements.some(element => element.id === message.action?.targetId)) {
          return respond({ ok: false, message: 'That control was not in the embedded page capture. Look at it again.' });
        }
        controller ??= control.createController({ window });
        const reply = controller.run(message.action, snapshot);
        const later = reply.followUp ? await reply.followUp : reply;
        respond(later ? { ok: later.tone === 'success', message: later.message } : { ok: false, message: 'The action was stopped.' });
      }).catch(() => respond({ ok: false, message: 'The embedded page could not be controlled.' }));
      return true;
    }
    return false;
  });
}
