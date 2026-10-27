// Injected into embedded frames (iframes from other sites) where Gaze Navigator has host access. It answers the
// navigator in the top frame, through the extension's background only: which of the top page's iframes it is, what
// controls lie within the gaze circle there, and to perform one already-confirmed action on one of them.
if (window !== window.top && !globalThis.__gazeFrameAgent) {
  globalThis.__gazeFrameAgent = true;
  let modules = null, context = null, controller = null;
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
    'sensitive', 'hasValue', 'nativeNumber', 'nativeDate', 'nativeTime', 'nativeMonth', 'nativeWeek', 'customRange', 'customList', 'distance'];
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
        context = pageContext.captureContext(document, { x: message.x, y: message.y, radius: message.radius });
        context.nearby = [];
        respond({ ok: true, elements: context.elements.map(describe) });
      }, () => respond({ ok: false }));
      return true;
    }
    if (message?.type === 'gaze:frame-act') {
      load().then(async ([, control]) => {
        if (!context) return respond({ ok: false, message: 'The embedded page changed. Look at it again.' });
        controller ??= control.createController({ window });
        const reply = controller.run(message.action, context);
        const later = reply.followUp ? await reply.followUp : reply;
        respond(later ? { ok: later.tone === 'success', message: later.message } : { ok: false, message: 'The action was stopped.' });
      }, () => respond({ ok: false, message: 'The embedded page could not be controlled.' }));
      return true;
    }
    return false;
  });
}
