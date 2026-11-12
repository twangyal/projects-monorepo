import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const field = (id, name, distance = 0) => ({ id, name, distance, role: 'textbox', editable: true });
test('dictation starts with the named field, asks about ambiguous fields and confirms distant ones', () => {
  const a = field(1, 'Message'), b = field(2, 'Notes');
  assert.deepEqual(interpret('start dictation into Message', { elements: [a, b] }), { type: 'dictation', targetId: 1 });
  assert.deepEqual(interpret('start dictating', { elements: [a] }), { type: 'dictation', targetId: 1 });
  assert.equal(interpret('start dictation', { elements: [a, b] }).type, 'clarify');
  assert.deepEqual(interpret('start dictation into Message', { elements: [b], onScreen: () => [field(201, 'Message', 500)] }), { type: 'dictation', targetId: 201, far: true });
  assert.equal(interpret('stop dictation', { elements: [] }).type, 'stop-dictation');
});

function setup() {
  const element = { value: 'Draft', isConnected: true, focus() {} };
  const target = { ...field(1, 'Message'), element };
  let focus = element;
  const controller = createController({ window: {}, actions: {
    selectText: () => ({ ok: true }), canWrite: () => true, isSensitive: () => false,
    ownsFocus: item => item === focus, readValue: item => item.value,
    writeValue: (item, value) => { item.value = value; },
  } });
  const context = { elements: [target] };
  return { controller, element, context, focus: value => { focus = value; } };
}
test('dictation keeps speech as text, supports phrase undo and returns to commands only on explicit stop', () => {
  const { controller, element, context } = setup();
  assert.equal(controller.handle('start dictation', context).tone, 'success');
  controller.handle('hello comma world', { elements: [] });
  controller.handle('click Send', { elements: [] });
  assert.equal(element.value, 'Draft hello, world click Send');
  controller.handle('undo typing', { elements: [] });
  assert.equal(element.value, 'Draft hello, world');
  controller.handle('stop dictation', { elements: [] });
  assert.equal(controller.dictation, null);
  controller.handle('unprefixed words', { elements: [] });
  assert.equal(element.value, 'Draft hello, world');
});
test('a changed focus retires dictation instead of redirecting or later resuming it', () => {
  const { controller, element, context, focus } = setup();
  controller.handle('start dictation', context); focus({});
  assert.equal(controller.handle('private words', { elements: [] }).tone, 'error');
  focus(element); controller.handle('more words', context);
  assert.equal(element.value, 'Draft'); assert.equal(controller.dictation, null);
});

test('tracking loss, cancel and pause retire dictation and preserve the last phrase', () => {
  for (const interruption of ['tracking', 'cancel', 'pause']) {
    const { controller, element, context } = setup();
    controller.handle('start dictation', context); controller.handle('hello', context);
    if (interruption === 'tracking') controller.handle('lost phrase', { elements: [], trackingUnavailable: true });
    else controller.handle(interruption, { elements: [] });
    controller.handle('resume', context); controller.handle('unprefixed words', context);
    assert.equal(element.value, 'Draft hello'); assert.equal(controller.dictation, null);
  }
});

test('dictation does not autocorrect literal words into stop commands', () => {
  const { controller, element, context } = setup();
  controller.handle('start dictation', context);
  controller.handle('cancer', context); controller.handle('council', context);
  assert.equal(element.value, 'Draft cancer council');
  assert.ok(controller.dictation);
});
