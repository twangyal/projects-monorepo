// SpeechRecognition belongs to the extension origin, never the visited website. A separate instance of
// capture.html keeps microphone and camera lifetimes independent. Only this session's private port
// delivers utterance events; page scripts cannot access it or the recognition object.
const STARTUP_MS = 10000;

export function createFrameSpeech({ document, window, mount, runtime, ...callbacks }) {
  let wanted = false, session = 0, frame = null, port = null;
  const deadlines = new Set();
  function teardown() {
    const closing = port; port = null;
    try { closing?.disconnect(); } catch { /* Already closed. */ }
    frame?.remove(); frame = null;
    for (const pending of deadlines) { window.clearTimeout(pending.timer); pending.reject(new Error('Listening stopped.')); }
    deadlines.clear();
  }
  function bounded(promise, message) {
    let pending;
    const timeout = new Promise((_, reject) => {
      pending = { reject, timer: window.setTimeout(() => reject(new Error(message)), STARTUP_MS) };
      deadlines.add(pending);
    });
    return Promise.race([promise, timeout]).finally(() => { window.clearTimeout(pending.timer); deadlines.delete(pending); });
  }
  function stop() { wanted = false; session++; teardown(); }
  function fail(message) {
    stop();
    callbacks.onError?.(message);
    callbacks.onState?.('stopped');
  }
  async function open(current) {
    const nonce = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,'0')).join('');
    frame = document.createElement('iframe');
    frame.src = runtime.getURL(`capture.html#${nonce}`);
    frame.allow = 'microphone'; frame.title = 'Gaze Navigator microphone'; frame.tabIndex = -1;
    frame.setAttribute('aria-hidden','true');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, {once:true}));
    mount.prepend(frame);
    await bounded(loaded, 'The microphone frame did not load. Type instructions or try again.');
    if (current !== session || !wanted) return;
    const connection = runtime.connect({name:`gaze-capture:${nonce}`}); port = connection;
    await bounded(new Promise((resolve, reject) => {
      let starting = false, accepted = false, nativeReady = false;
      const admit = () => { if (accepted && nativeReady) resolve(); };
      connection.onMessage.addListener(message => {
        if (current !== session || !wanted || port !== connection) return;
        if (message?.type === 'ready' && !starting) {
          starting = true;
          if (!message.speechSupported) { reject(new Error('Speech recognition is not available in this browser. Type instructions instead.')); return; }
          try { connection.postMessage({id:1,op:'speech-start'}); } catch (error) { reject(error); }
        } else if (message?.id === 1) {
          if (message.error || !message.result) reject(new Error(message.error || 'Speech recognition could not start. Type instructions or try again.'));
          else { accepted = true; admit(); }
        } else if (message?.type === 'speech') {
          if (message.event === 'error') {
            if (message.code === 'not-allowed') {
              runtime.sendMessage({type:'gaze:microphone-permission'}).catch(() => {});
              fail('Gaze Navigator needs microphone permission. A setup tab has opened: allow the microphone there, then return and choose Start listening. You can type instructions meanwhile.');
            } else if (!message.listening) fail(message.value);
            else callbacks.onError?.(message.value);
          } else if (message.event === 'state' && message.value === 'listening') {
            nativeReady = true; callbacks.onState?.('listening'); admit();
          } else if (message.event === 'state' && message.value === 'stopped') {
            stop(); callbacks.onState?.('stopped');
          } else {
            const name = {start:'onSpeechStart',interim:'onInterim',final:'onFinal',immediate:'onImmediate',state:'onState'}[message.event];
            if (name) callbacks[name]?.(message.value);
          }
        }
      });
      connection.onDisconnect.addListener(() => {
        reject(new Error('The microphone frame closed. Type instructions or start listening again.'));
        if (current === session && wanted && port === connection) fail('The microphone frame closed. Type instructions or start listening again.');
      });
    }), 'Speech recognition did not start in time. Type instructions or try again.');
  }
  return {
    supported: Boolean(runtime),
    get listening() { return wanted; },
    start() {
      if (!runtime || wanted) return false;
      wanted = true; const current = ++session;
      void open(current).catch(error => { if (current === session && wanted) fail(error.message); });
      return true;
    },
    stop,
  };
}
