// Own only this navigator's output, including time spent queued before onstart.
// A replaced utterance can report its cancellation after the next one is queued.
export function createFeedbackVoice(window) {
  let current = null;
  function cancel() {
    if (!current) return;
    current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* Output may already be unavailable. */ }
  }
  return {
    get active() { return current !== null; },
    cancel,
    say(message) {
      cancel();
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
      try {
        const utterance = new window.SpeechSynthesisUtterance(message);
        current = utterance;
        const finished = () => { if (current === utterance) current = null; };
        utterance.onend = finished; utterance.onerror = finished;
        window.speechSynthesis.speak(utterance);
        return true;
      } catch { current = null; return false; }
    },
  };
}
