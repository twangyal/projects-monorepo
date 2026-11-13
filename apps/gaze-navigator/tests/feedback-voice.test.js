import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackVoice } from '../src/web/feedback-voice.js';

function setup() {
  const spoken = [];
  const window = { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { cancel() {}, speak(utterance) { spoken.push(utterance); } } };
  return { window, spoken, voice: createFeedbackVoice(window) };
}
test('feedback blocks from queueing until its own completion or error', () => {
  const { voice, spoken } = setup();
  assert.equal(voice.active, false); voice.say('Ready'); assert.equal(voice.active, true);
  spoken[0].onend(); assert.equal(voice.active, false);
  voice.say('Question'); spoken[1].onerror(); assert.equal(voice.active, false);
});
test('late completion of replaced or cancelled feedback cannot release newer output', () => {
  const { voice, spoken } = setup();
  voice.say('Old'); voice.say('New'); spoken[0].onerror(); assert.equal(voice.active, true);
  voice.cancel(); assert.equal(voice.active, false); voice.say('Newest');
  spoken[1].onend(); assert.equal(voice.active, true); spoken[2].onend(); assert.equal(voice.active, false);
});
test('missing or refused synthesis leaves typed and spoken recovery available', () => {
  const missing = createFeedbackVoice({}); assert.equal(missing.say('Ready'), false); assert.equal(missing.active, false); missing.cancel();
  const { voice, window } = setup(); window.speechSynthesis.speak = () => { throw new Error('Not allowed'); };
  assert.equal(voice.say('Ready'), false); assert.equal(voice.active, false);
  window.speechSynthesis.cancel = () => { throw new Error('Closed'); }; voice.cancel(); assert.equal(voice.active, false);
});
test('idle cleanup does not cancel another part of the page speaking', () => {
  const { voice, window, spoken } = setup(); let cancellations = 0;
  window.speechSynthesis.cancel = () => { cancellations++; };
  voice.cancel(); assert.equal(cancellations, 0);
  voice.say('Own reply'); assert.equal(cancellations, 0);
  voice.cancel(); assert.equal(cancellations, 1); voice.cancel(); assert.equal(cancellations, 1);
  voice.say('Next'); spoken.at(-1).onend(); voice.cancel(); assert.equal(cancellations, 1);
});
