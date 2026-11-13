// An optional recognized-text address, not speaker authentication or an acoustic wake-word detector.
const ADDRESS = /^navigator(?:\s*[:,]\s*|\s+)(\S[\s\S]*)$/i;
const SAFETY = /^(cancel|stop|pause|abort|hold on|hang on|never ?mind)[.!?]*$/i;
const body = text => ADDRESS.exec(text.trim())?.[1].trim() || null;

/** Safety controls remain immediate, including when an address is required. */
export function immediateSpeech(text) {
  return SAFETY.exec(body(text) ?? text.trim())?.[1].toLowerCase() ?? null;
}

/** The first reading must itself be addressed; another reading cannot supply a missing address. */
export function addressedSpeech(text, alternatives = [], required = false) {
  const safety = immediateSpeech(text);
  if (safety) return { text: safety, alternatives: [] };
  if (!required) return { text, alternatives };
  const addressed = body(text);
  if (!addressed) return null;
  return { text: addressed, alternatives: alternatives.map(body).filter(Boolean) };
}
