import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, dictationControl } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';
import { addressedFeedback } from '../src/web/speech-address.js';

const control = (id, name, extra = {}) => ({ id, name, role: 'button', distance: 0, element: { isConnected: true }, ...extra });
const context = elements => ({ elements });

test('explicit navigator help is separate from website Help controls', () => {
  const c = context([control(1, 'Help')]);
  for (const phrase of ['what can I say?', 'what can I say here', 'help with the navigator', 'help with navigator'])
    assert.equal(interpret(phrase, c).type, 'help', phrase);
  assert.equal(interpret('open help', c).type, 'activate');
  assert.notEqual(interpret('help', c).type, 'help');
  assert.equal(dictationControl('help with the navigator').type, 'help');
  assert.equal(dictationControl('what can I say'), null);
});

test('help describes available controls without reading field values or acting', () => {
  const calls = [];
  const controller = createController({ window: {}, actions: new Proxy({}, { get: (_, key) => () => { calls.push(key); throw Error('Help must not use page actions'); } }) });
  const field = control(1, 'Message', { role: 'textbox', editable: true, value: 'PRIVATE DRAFT' });
  const result = controller.handle('what can I say', context([field]));
  assert.match(result.message, /type hello/); assert.match(result.message, /start dictation/);
  assert.ok(!result.message.includes('PRIVATE DRAFT')); assert.deepEqual(calls, []); assert.equal(result.help, true);
  const secret = controller.handle('what can I say', context([{ ...field, sensitive: true }]));
  assert.match(secret.message, /protected/); assert.ok(!secret.message.includes('PRIVATE DRAFT'));
});

test('help preserves confirmation and clarification without extending their deadlines', () => {
  let clock = 0; const clicks = [];
  const controller = createController({ window: {}, now: () => clock, actions: { activate: (_, name) => { clicks.push(name); return { ok: true, message: 'Done' }; } } });
  controller.handle('click Delete draft', context([control(1, 'Delete draft', { consequential: true })]));
  clock = 14000;
  const help = controller.handle('what can I say', { elements: [] });
  assert.equal(help.pending.kind, 'confirm'); assert.equal(help.keepPrompt, true); assert.match(help.message, /confirm/);
  clock = 16000;
  assert.match(controller.handle('confirm', { elements: [] }).message, /expired/); assert.deepEqual(clicks, []);
  clock = 20000;
  controller.handle('click Details', context([control(1, 'Details'), control(2, 'Details')]));
  const choice = controller.handle('help with the navigator', { elements: [] });
  assert.equal(choice.pending.kind, 'clarify'); assert.match(choice.message, /1.*2/);
  clock = 51000;
  const expired = controller.handle('what can I say', { elements: [] });
  assert.equal(expired.pending, null); assert.match(expired.message, /expired/);
  controller.handle('two', { elements: [] }); assert.deepEqual(clicks, []);
});

test('help supports paused and unavailable tracking recovery without changing those states', () => {
  const controller = createController({ window: {} });
  controller.handle('pause', { elements: [] });
  assert.match(controller.handle('what can I say', { elements: [] }).message, /resume/); assert.equal(controller.paused, true);
  controller.handle('resume', { elements: [] });
  assert.match(controller.handle('what can I say', { elements: [], trackingUnavailable: 'calibration' }).message, /recalibrate/);
  assert.match(controller.handle('what can I say', { elements: [], trackingUnavailable: true }).message, /show numbers/);
});

test('explicit help during dictation preserves the field, its text and phrase Undo', () => {
  const element = { isConnected: true, value: 'Draft', focus() {} };
  const field = control(1, 'Message', { element, role: 'textbox', editable: true });
  const controller = createController({ window: {}, actions: {
    canWrite: () => true, isSensitive: () => false, ownsFocus: () => true, selectText: () => ({ ok: true }),
    readValue: e => e.value, writeValue: (e, value) => { e.value = value; },
  } });
  controller.handle('start dictation', context([field])); controller.handle('hello', { elements: [] });
  const help = controller.handle('help with the navigator', { elements: [] });
  assert.match(help.message, /Dictation is active/); assert.equal(element.value, 'Draft hello'); assert.ok(controller.dictation);
  controller.handle('undo typing', { elements: [] }); assert.equal(element.value, 'Draft');
  controller.handle('what can I say', { elements: [] }); assert.equal(element.value, 'Draft what can I say');
});

test('addressed help guidance teaches the spoken address even without a question', () => {
  assert.match(addressedFeedback('Say type hello.', { kind: 'help' }, true), /Navigator help with the navigator/);
});

test('help leaves the saved-details fill available for immediate Undo', () => {
  const calls = [];
  const details = {
    plan: () => ({ ok: true, fields: [{ kind: 'email' }], message: 'Fill Email?' }),
    fill: () => ({ ok: true, filled: [{ kind: 'email' }], message: 'Filled.' }),
    restore: entries => { calls.push(entries); return { message: 'Restored.' }; },
  };
  const controller = createController({ window: {}, commands: { details } });
  controller.handle('fill in my details', { elements: [] }); controller.handle('confirm', { elements: [] });
  controller.handle('what can I say', { elements: [] });
  assert.equal(controller.handle('undo', { elements: [] }).message, 'Restored.'); assert.equal(calls.length, 1);
});

for (const [properties, example, expected] of [
  [{ nativeDate: true, dateSnapshot: {} }, 'set date field to November first', 'date'],
  [{ nativeTime: true, timeSnapshot: {} }, 'set time field to 2:30 pm', 'time'],
  [{ nativeMonth: true, monthSnapshot: {} }, 'set month field to November 2026', 'month'],
  [{ nativeWeek: true, weekSnapshot: {} }, 'set week field to week 43', 'week'],
  [{ nativeNumber: true, numberSnapshot: {}, role: 'spinbutton' }, 'set number field to four', 'number'],
  [{ role: 'slider' }, 'set slider to forty percent', 'range'],
]) test(`help gives an understood example for ${expected} controls`, () => {
  const c = context([control(1, 'Value', properties)]), controller = createController({ window: {} });
  assert.ok(controller.handle('what can I say', c).message.includes(example));
  assert.equal(interpret(example, c).type, expected);
});
