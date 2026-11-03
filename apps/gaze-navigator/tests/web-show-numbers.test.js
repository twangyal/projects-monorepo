import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';
import { NUMBERED_FIRST_ID } from '../src/web/page-context.js';

const numbered = (number, name, extra = {}) => ({ id: NUMBERED_FIRST_ID + number - 1, number, name, role: 'button', distance: 0, element: { name, isConnected: true }, ...extra });

test('numbers are shown and hidden by voice, and a number names a control', () => {
  for (const said of ['show numbers', 'show the numbers', 'number everything', 'turn on numbers', 'numbers on']) assert.deepEqual(interpret(said, { elements: [] }), { type: 'numbers', on: true }, said);
  for (const said of ['hide numbers', 'remove the numbers', 'numbers off', 'stop showing numbers']) assert.deepEqual(interpret(said, { elements: [] }), { type: 'numbers', on: false }, said);
  assert.deepEqual(interpret('click 12', { elements: [] }), { type: 'choose', index: 12 });
  assert.deepEqual(interpret('twelve', { elements: [] }), { type: 'choose', index: 12, bare: true });
  assert.deepEqual(interpret('click 104', { elements: [] }), { type: 'choose', index: 104 });
  assert.deepEqual(interpret('twenty three', { elements: [] }), { type: 'choose', index: 23, bare: true });
  assert.deepEqual(interpret('number one hundred and five', { elements: [] }), { type: 'choose', index: 105 });
  assert.notEqual(interpret('click 1.5', { elements: [] }).type, 'choose');
});

function setup(options = {}) {
  const pressed = [], shown = [];
  const actions = { activate: element => { pressed.push(element.name); return { ok: true, message: `${element.name} activated.` }; } };
  const controller = createController({ window: {}, interpret, actions, commands: { numbers: on => { shown.push(on); return { ok: true, message: on ? 'Numbers shown.' : 'Numbers hidden.' }; } }, ...options });
  return { controller, pressed, shown };
}

test('while numbers are shown, a number said on its own or with click uses that control anywhere on screen', () => {
  const { controller, pressed, shown } = setup();
  controller.handle('show numbers', { elements: [] });
  assert.deepEqual(shown, [true]);
  const page = { elements: [{ id: 1, name: 'Near the gaze', role: 'button', distance: 0, element: { name: 'Near the gaze', isConnected: true } }],
    numbered: [numbered(1, 'Home'), numbered(12, 'Add to cart'), numbered(13, 'Delete account', { consequential: true })] };
  assert.equal(controller.handle('twelve', page).tone, 'success');
  assert.equal(controller.handle('click 1', page).tone, 'success');
  assert.deepEqual(pressed, ['Add to cart', 'Home']);
  // A consequential control is still confirmed first.
  assert.equal(controller.handle('13', page).tone, 'question');
  assert.deepEqual(pressed, ['Add to cart', 'Home']);
  controller.handle('confirm', page);
  assert.deepEqual(pressed, ['Add to cart', 'Home', 'Delete account']);
  assert.match(controller.handle('click 30', page).message, /There is no number 30 on the screen\. The numbers go up to 13\./);
  // Without numbers, a number on its own still only answers a question.
  assert.match(controller.handle('twelve', { elements: page.elements }).message, /A number on its own only answers a question/);
  controller.handle('hide numbers', page);
  assert.deepEqual(shown, [true, false]);
});

test('numbers work when the camera has lost the gaze, but wait while paused and give way to a question', () => {
  const { controller, pressed } = setup();
  const lost = { elements: [], region: null, trackingUnavailable: true, numbered: [numbered(4, 'Next page')] };
  controller.handle('4', lost);
  assert.deepEqual(pressed, ['Next page']);
  assert.match(controller.handle('click Next page', lost).message, /Camera tracking is lost/);
  assert.match(controller.handle('click 4', { ...lost, trackingUnavailable: 'calibration' }).message, /calibration/i);
  controller.handle('pause', lost);
  assert.match(controller.handle('4', lost).message, /^Paused/);
  controller.handle('resume', lost);
  // Two controls named alike: the question's own numbers answer it.
  const twins = { elements: [1, 2].map(id => ({ id, name: 'Open', role: 'button', distance: id, element: { name: `Open ${id}`, isConnected: true } })), numbered: [numbered(2, 'Elsewhere')] };
  assert.equal(controller.handle('click open', twins).tone, 'question');
  controller.handle('2', twins);
  assert.deepEqual(pressed, ['Next page', 'Open 2']);
});
