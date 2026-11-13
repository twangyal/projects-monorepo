import test from 'node:test';
import assert from 'node:assert/strict';
import { addressedSpeech, immediateSpeech } from '../src/web/speech-address.js';
import { interpret } from '../src/web/interpreter.js';

test('optional Navigator addressing strips only an exact leading address and filters other readings', () => {
  assert.deepEqual(addressedSpeech(' Navigator, click help ', ['navigator: open help', 'submit', 'navigate open help'], true), { text: 'click help', alternatives: ['open help'] });
  for (const text of ['click help', 'navigate click help', 'navigatorial click help', 'hello navigator click help', 'Navigator', 'Navigator!']) assert.equal(addressedSpeech(text, ['Navigator click help'], true), null, text);
  assert.deepEqual(addressedSpeech('Hello navigator', ['other words'], false), { text: 'Hello navigator', alternatives: ['other words'] });
  assert.deepEqual(addressedSpeech('Navigator Navigator of the ship', [], true), { text: 'Navigator of the ship', alternatives: [] });
  assert.deepEqual(addressedSpeech('Navigator confirm', ['confirm', 'Navigator yes'], true), { text: 'confirm', alternatives: ['yes'] });
});
test('bare and addressed safety phrases stay immediate, but longer commands do not', () => {
  for (const text of ['pause', 'STOP', 'cancel', 'abort', 'hold on', 'hang on', 'never mind', 'nevermind']) {
    assert.equal(immediateSpeech(text), text.toLowerCase());
    assert.equal(immediateSpeech(`Navigator, ${text}!`), text.toLowerCase());
    assert.equal(addressedSpeech(text, [], true)?.text, text.toLowerCase());
  }
  for (const text of ['stop dictation', 'Navigator pause the song', 'please stop', 'navigatorial pause']) assert.equal(immediateSpeech(text), null);
});
test('addressing has explicit hands-free settings commands', () => {
  assert.deepEqual(interpret('require navigator prefix', { elements: [] }), { type: 'speech-prefix', required: true });
  assert.deepEqual(interpret('turn off navigator prefix', { elements: [] }), { type: 'speech-prefix', required: false });
});
