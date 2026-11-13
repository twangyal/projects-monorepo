import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('extension fake speech assigns fresh final indexes, retains interim indexes and resets after native restart', () => {
  const context = { window: {}, localStorage: { getItem: () => null } };
  runInNewContext(readFileSync(new URL('../test-support/fake-speech.js', import.meta.url), 'utf8'), context);
  const api = context.window.__extensionSpeech, recognition = new context.window.SpeechRecognition(), seen = [];
  recognition.onresult = event => seen.push([event.resultIndex, event.results[event.resultIndex].isFinal]);
  recognition.start(); api.say('open', false); api.say('open help'); api.say('type words'); api.say('pause', false, 4); api.say('pause', true, 4); api.say('resume');
  recognition.start(); api.say('fresh');
  assert.deepEqual(seen, [[0, false], [0, true], [1, true], [4, false], [4, true], [5, true], [0, true]]);
});
