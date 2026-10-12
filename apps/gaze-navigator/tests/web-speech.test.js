import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechInput } from '../src/web/speech-input.js';

function fakeWindow() {
  const instances = [];
  class Recognition {
    constructor() { this.starts = 0; this.aborted = 0; instances.push(this); }
    start() { this.starts++; this.onstart?.(); }
    abort() { this.aborted++; this.onend?.(); }
  }
  return { window: { SpeechRecognition: Recognition, navigator: { language: 'en-GB' } }, instances };
}

const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });
const emit = (recognition, resultIndex, ...results) => recognition.onresult({ resultIndex, results });

test('reports unsupported browsers without throwing', () => {
  const speech = createSpeechInput({ navigator: {} }, {});
  assert.equal(speech.supported, false);
  assert.equal(speech.start(), false);
});

test('final transcripts are delivered and silence-ended sessions restart while listening', () => {
  const { window, instances } = fakeWindow();
  const heard = [];
  const states = [];
  const speech = createSpeechInput(window, { onFinal: text => heard.push(text), onInterim: text => heard.push(`~${text}`), onState: state => states.push(state) });
  assert.equal(speech.start(), true);
  const [recognition] = instances;
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);
  assert.equal(recognition.lang, 'en-GB');
  emit(recognition, 0, result('open', false));
  emit(recognition, 0, result(' open pricing ', true));
  assert.deepEqual(heard, ['~open', 'open pricing']);
  recognition.onend();
  assert.equal(recognition.starts, 2, 'restarted after the browser ended the session');
  speech.stop();
  assert.equal(speech.listening, false);
  assert.equal(recognition.starts, 2, 'no restart after a deliberate stop');
  assert.equal(states.at(-1), 'stopped');
});

test('an interim cancel acts immediately and its final transcript is not handled twice', () => {
  const { window, instances } = fakeWindow();
  const immediate = [];
  const finals = [];
  const speech = createSpeechInput(window, { onImmediate: text => immediate.push(text), onFinal: text => finals.push(text) });
  speech.start();
  const [recognition] = instances;
  emit(recognition, 0, result('cancel', false));
  emit(recognition, 0, result('cancel', true));
  emit(recognition, 1, result('cancel', true), result('scroll down', true));
  assert.deepEqual(immediate, ['cancel']);
  assert.deepEqual(finals, ['scroll down']);
});

test('permission errors stop listening; transient errors stop after repeated failures', () => {
  const { window, instances } = fakeWindow();
  const errors = [];
  const speech = createSpeechInput(window, { onError: message => errors.push(message) });
  speech.start();
  const [recognition] = instances;
  recognition.onerror({ error: 'no-speech' });
  assert.equal(errors.length, 0, 'silence is not an error');
  recognition.onerror({ error: 'not-allowed' });
  assert.match(errors[0], /permission was refused/);
  assert.equal(speech.listening, false);
  recognition.onend();
  assert.equal(recognition.starts, 1, 'no restart after refusal');

  speech.start();
  for (let i = 0; i < 3; i++) recognition.onerror({ error: 'network' });
  assert.equal(speech.listening, false);
  assert.match(errors.at(-1), /could not reach its service/);
});

test('each new utterance in a continuous session signals its start once', () => {
  const { window, instances } = fakeWindow();
  let starts = 0;
  const speech = createSpeechInput(window, { onSpeechStart: () => starts++ });
  speech.start();
  const [recognition] = instances;
  recognition.onspeechstart();
  emit(recognition, 0, result('open', false));
  emit(recognition, 0, result('open help', true));
  emit(recognition, 1, result('open help', true), result('scroll', false));
  emit(recognition, 1, result('open help', true), result('scroll down', true));
  assert.equal(starts, 3, 'speechstart plus the first sight of results 0 and 1');
  recognition.onend();
  emit(recognition, 0, result('back', true));
  assert.equal(starts, 4, 'indexes restart with a new session');
});
