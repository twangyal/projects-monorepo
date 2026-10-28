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
  for (let i = 0; i < 3; i++) instances.at(-1).onerror({ error: 'network' });
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

test('stopping ignores queued speech events and a previous session after restart', () => {
  const { window, instances } = fakeWindow();
  const heard = [];
  const speech = createSpeechInput(window, { onFinal: text => heard.push(text) });
  speech.start();
  const old = instances[0];
  speech.stop();
  emit(old, 0, result('confirm', true));
  assert.deepEqual(heard, [], 'queued final must not execute after stop');
  speech.start();
  emit(old, 0, result('confirm', true));
  assert.deepEqual(heard, [], 'old recognition must not execute in the new session');
  emit(instances.at(-1), 0, result('open help', true));
  assert.deepEqual(heard, ['open help']);
});

test('a synchronous microphone denial carries its permission code for extension recovery', () => {
  class Recognition { start() { throw Object.assign(new Error('denied'), {name:'NotAllowedError'}); } }
  const errors=[];
  const speech=createSpeechInput({SpeechRecognition:Recognition},{onError:(message,code)=>errors.push({message,code})});
  assert.equal(speech.start(),false); assert.equal(speech.listening,false); assert.equal(errors[0].code,'not-allowed');
});

// A recognizer that can run on the device: `status` is what available() answers.
function deviceWindow(status) {
  const instances = [], installs = [];
  class Phrase { constructor(phrase, boost) { this.phrase = phrase; this.boost = boost; } }
  class Recognition {
    static async available(options) { Recognition.asked = options; return status; }
    static async install(options) { installs.push(options); status = 'available'; return true; }
    constructor() { this.starts = 0; this.aborted = 0; instances.push(this); }
    start() { this.starts++; this.onstart?.(); }
    abort() { this.aborted++; this.onend?.(); }
  }
  let now = 0;
  const window = { SpeechRecognition: Recognition, SpeechRecognitionPhrase: Phrase, navigator: { language: 'en-GB' }, performance: { now: () => now } };
  return { window, instances, installs, Recognition, advance: ms => { now += ms; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('installed on-device recognition is used after the first start, favouring the phrases given', async () => {
  const { window, instances, Recognition, advance } = deviceWindow('available');
  const modes = [];
  const speech = createSpeechInput(window, { onMode: mode => modes.push(mode) });
  assert.equal(speech.mode, 'unknown', 'nothing is asked before listening starts');
  speech.setPhrases(['Buy now', ' Buy  now ', 'Sort by', '']);
  speech.start();
  await settle();
  assert.deepEqual(Recognition.asked, { langs: ['en-GB'], processLocally: true });
  assert.deepEqual(modes, ['device']);
  // The session that started on the online service restarts on the device with the phrases.
  const device = instances.at(-1);
  assert.equal(instances[0].aborted, 1);
  assert.equal(device.processLocally, true);
  assert.deepEqual(device.phrases.map(p => [p.phrase, p.boost]), [['Buy now', 3], ['Sort by', 3]]);
  // New phrases restart a quiet session, at most every three seconds.
  advance(3000);
  speech.setPhrases(['Checkout']);
  assert.deepEqual(instances.at(-1).phrases.map(p => p.phrase), ['Checkout']);
  const count = instances.length;
  speech.setPhrases(['Help']);
  assert.equal(instances.length, count, 'too soon to restart again');
});

test('on-device recognition can be installed, and a failing one falls back to the online service', async () => {
  const { window, instances, installs } = deviceWindow('downloadable');
  const modes = [], errors = [];
  const speech = createSpeechInput(window, { onMode: mode => modes.push(mode), onError: (message, code) => errors.push(code) });
  speech.start();
  await settle();
  assert.equal(speech.mode, 'downloadable');
  assert.equal(instances.at(-1).processLocally, undefined);
  assert.equal(await speech.installLocal(), true);
  assert.deepEqual(installs, [{ langs: ['en-GB'], processLocally: true }]);
  assert.equal(speech.mode, 'device');
  assert.equal(instances.at(-1).processLocally, true, 'listening continues on the device');
  // A device failure is reported once and the next session uses the online service.
  instances.at(-1).onerror({ error: 'language-not-supported' });
  instances.at(-1).onend();
  assert.deepEqual(errors, ['device-failed']);
  assert.equal(speech.mode, 'service');
  assert.equal(speech.listening, true);
  assert.equal(instances.at(-1).processLocally, undefined);
  assert.deepEqual(modes, ['downloadable', 'device', 'service']);
});

test('without on-device recognition, speech says it uses the online service', async () => {
  const { window } = fakeWindow();
  const speech = createSpeechInput(window, {});
  speech.start();
  await settle();
  assert.equal(speech.mode, 'service');
  assert.equal(await speech.installLocal(), false);
});

for (const ending of ['end','no-speech','aborted']) test(`an unfinished recognition capture is reset on ${ending}`, () => {
  const {window,instances}=fakeWindow(), events=[];
  const speech=createSpeechInput(window,{onSpeechStart:()=>events.push('start'),onReset:()=>events.push('reset'),onFinal:text=>events.push(text)});
  speech.start(); const current=instances[0];
  current.onspeechstart(); emit(current,0,result('open',false)); events.length=0;
  if(ending==='end') current.onend(); else current.onerror({error:ending});
  assert.deepEqual(events,['reset']); assert.equal(speech.listening,true);
  events.length=0;
  speech.stop(); events.length=0;
  current.onerror({error:'no-speech'}); current.onresult({resultIndex:0,results:[result('late',true)]});
  assert.deepEqual(events,[],'stopped recognizers cannot reset or execute a newer capture');
});
