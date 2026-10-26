// Speech stage: wraps the browser's SpeechRecognition. Recognition may run through the browser
// vendor's service; the navigator never records or stores audio itself.

const ERRORS = {
  'not-allowed': 'Microphone or speech recognition permission was refused. Allow it in the browser, or type instructions.',
  'service-not-allowed': 'Speech recognition is not allowed here. Type instructions instead.',
  'audio-capture': 'No microphone was found. Type instructions instead.',
  network: 'Speech recognition could not reach its service. Type instructions or try again.',
  'language-not-supported': 'This language is not supported for speech recognition. Type instructions instead.',
};
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);
const IMMEDIATE = /^\s*(cancel|stop|pause)\s*$/i;

export function createSpeechInput(window, { onSpeechStart, onInterim, onFinal, onImmediate, onError, onState }) {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  let recognition = null;
  let wanted = false;
  let failures = 0;
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
    recognition.lang = window.navigator?.language || 'en-US';
    recognition.onstart = () => { if (wanted && recognition === current) onState?.('listening'); };
    recognition.onspeechstart = () => { if (wanted && recognition === current) onSpeechStart?.(); };
    recognition.onresult = event => {
      if (!wanted || recognition !== current) return;
      failures = 0;
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
    start() {
      if (!Recognition || wanted) return false;
      setup();
      wanted = true;
      failures = 0;
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
