// Speech stage: wraps the browser's SpeechRecognition. Where the browser can recognize speech on this device
// (Chrome, once its language pack is installed), it does, and no audio leaves the device; recognition can then
// also be biased toward expected phrases, such as the names of the controls around the gaze. Otherwise recognition
// may run through the browser vendor's service. The navigator never records or stores audio itself.

const ERRORS = {
  'not-allowed': 'Microphone or speech recognition permission was refused. Allow it in the browser, or type instructions.',
  'service-not-allowed': 'Speech recognition is not allowed here. Type instructions instead.',
  'audio-capture': 'No microphone was found. Type instructions instead.',
  network: 'Speech recognition could not reach its service. Type instructions or try again.',
  'language-not-supported': 'This language is not supported for speech recognition. Type instructions instead.',
};
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);
const IMMEDIATE = /^\s*(cancel|stop|pause)\s*$/i;
// Phrases are favoured this much (0 to 10; 1 is neutral), at most MAX_PHRASES of them.
const PHRASE_BOOST = 3, MAX_PHRASES = 50;
// New phrases are taken up by restarting a session that has heard nothing for this long, at most this often.
const QUIET_MS = 1500, REFRESH_MS = 3000;

// `onMode` reports where recognition runs once listening has started: 'device', 'downloadable' (it could, after
// installLocal()) or 'service'; until then the mode is 'unknown'.
export function createSpeechInput(window, { onSpeechStart, onInterim, onFinal, onImmediate, onError, onState, onMode }) {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  let recognition = null;
  let wanted = false;
  let failures = 0;
  let mode = 'unknown', probed = false, phrases = [], applied = '', heardAt = 0, refreshedAt = 0, stale = false;
  const lang = () => window.navigator?.language || 'en-US';
  const options = () => ({ langs: [lang()], processLocally: true });
  const setMode = next => { if (next !== mode) { mode = next; onMode?.(mode); } };
  // The first time listening starts, ask whether on-device recognition is installed (or can be); a session that
  // started on the online service meanwhile restarts on the device. A failure to ask leaves the online service.
  function probe() {
    if (probed) return;
    probed = true;
    if (typeof Recognition?.available !== 'function') { setMode('service'); return; }
    Promise.resolve().then(() => Recognition.available(options())).then(status => {
      if (status === 'available') {
        setMode('device');
        stale = true;
        if (wanted) recognition.abort();
      } else setMode(status === 'downloadable' || status === 'downloading' ? 'downloadable' : 'service');
    }, () => setMode('service'));
  }
  // Results already handled from an interim "cancel" are not executed again when finalized.
  const handled = new Set();
  // Continuous sessions fire speechstart once, so each new result also marks an utterance start.
  const started = new Set();

  function setup() {
    recognition = new Recognition();
    const current = recognition;
    handled.clear();
    started.clear();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang();
    stale = false;
    applied = phrases.join('\n');
    refreshedAt = window.performance?.now?.() ?? Date.now();
    if (mode === 'device') {
      recognition.processLocally = true;
      if (phrases.length && typeof window.SpeechRecognitionPhrase === 'function') {
        recognition.phrases = phrases.map(phrase => new window.SpeechRecognitionPhrase(phrase, PHRASE_BOOST));
      }
    }
    recognition.onstart = () => { if (wanted && recognition === current) onState?.('listening'); };
    recognition.onspeechstart = () => { if (wanted && recognition === current) onSpeechStart?.(); };
    recognition.onresult = event => {
      if (!wanted || recognition !== current) return;
      failures = 0;
      heardAt = window.performance?.now?.() ?? Date.now();
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? '';
        if (!started.has(index)) {
          started.add(index);
          onSpeechStart?.();
        }
        if (handled.has(index)) {
          if (result.isFinal) handled.delete(index);
          continue;
        }
        if (result.isFinal) onFinal?.(transcript.trim());
        else if (IMMEDIATE.test(transcript)) {
          handled.add(index);
          onImmediate?.(transcript.trim());
        } else onInterim?.(transcript);
      }
    };
    recognition.onerror = event => {
      if (!wanted || recognition !== current) return;
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      // On-device recognition that fails falls back to the online service in a fresh session.
      if (mode === 'device' && event.error !== 'not-allowed' && event.error !== 'audio-capture') {
        setMode('service');
        stale = true;
        onError?.('On-device speech recognition failed, so the browser\'s online service is used instead.', 'device-failed');
        return;
      }
      failures++;
      if (FATAL.has(event.error) || failures >= 3) wanted = false;
      onError?.(ERRORS[event.error] ?? `Speech recognition stopped (${event.error}). Type instructions or try again.`, event.error);
    };
    // Browsers end continuous sessions after silence; restart while the user still wants to listen.
    recognition.onend = () => {
      if (recognition !== current) return;
      handled.clear();
      started.clear();
      if (!wanted) {
        onState?.('stopped');
        return;
      }
      try {
        // A changed mode or phrase list needs a new session object; otherwise the same one listens again.
        if (stale || phrases.join('\n') !== applied) setup();
        recognition.start();
      } catch {
        wanted = false;
        onState?.('stopped');
      }
    };
  }

  return {
    supported: Boolean(Recognition),
    get listening() { return wanted; },
    get mode() { return mode; },
    // Favours `list` (for example control names) once recognition runs on this device. A quiet session restarts
    // to take them up; otherwise they apply when the browser next restarts it.
    setPhrases(list) {
      phrases = [...new Set(list.map(text => String(text).replace(/\s+/g, ' ').trim()).filter(text => text && text.length <= 60))].slice(0, MAX_PHRASES);
      const now = window.performance?.now?.() ?? Date.now();
      if (wanted && mode === 'device' && phrases.join('\n') !== applied && now - heardAt >= QUIET_MS && now - refreshedAt >= REFRESH_MS) {
        refreshedAt = now;
        recognition.abort();
      }
    },
    // Installs on-device recognition for this language (a one-time download the browser manages).
    async installLocal() {
      if (typeof Recognition?.install !== 'function') return false;
      const installed = await Recognition.install(options());
      if (installed) {
        setMode('device');
        stale = true;
        if (wanted) recognition.abort();
      }
      return Boolean(installed);
    },
    start() {
      if (!Recognition || wanted) return false;
      setup();
      wanted = true;
      failures = 0;
      probe();
      try {
        recognition.start();
      } catch (error) {
        wanted = false;
        onError?.(`Speech recognition could not start: ${error.message}`, error.name === 'NotAllowedError' ? 'not-allowed' : undefined);
        return false;
      }
      return true;
    },
    stop() {
      if (!recognition || !wanted) return;
      wanted = false;
      recognition.abort();
    },
  };
}
