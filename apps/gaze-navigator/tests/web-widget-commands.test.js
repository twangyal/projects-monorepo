import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const el = (id, name, role, distance = 0) => ({ id, name, role, distance, editable: false });

test('switches and checkboxes turn on and off, enable and disable', () => {
  const context = { elements: [el(1, 'Notifications', 'switch'), el(2, 'Dark mode', 'checkbox', 10)] };
  const said = text => interpret(text, context);
  assert.deepEqual(said('turn on notifications'), { type: 'check', targetId: 1, checked: true });
  assert.deepEqual(said('turn notifications on'), { type: 'check', targetId: 1, checked: true });
  assert.deepEqual(said('switch dark mode off'), { type: 'check', targetId: 2, checked: false });
  assert.deepEqual(said('enable dark mode'), { type: 'check', targetId: 2, checked: true });
  assert.deepEqual(said('disable notifications'), { type: 'check', targetId: 1, checked: false });
  // The camera and pointer commands keep their meaning.
  assert.deepEqual(said('turn on the camera'), { type: 'tracking', source: 'camera' });
  assert.deepEqual(said('turn off the camera'), { type: 'tracking', source: 'pointer' });
});

test('a control named closely beats one inside the circle that only shares some of the words', () => {
  const lot = el(1, "What do I do if I have a permit for an assigned lot, but can't find a space there?", 'button');
  const lost = el(101, 'What do I do if I lose my permit or if my permit is stolen?', 'button', 150);
  const context = { elements: [lot], nearby: [lost] };
  assert.deepEqual(interpret('open what do I do if I lose my permit', context), { type: 'activate', targetId: 101, outside: true });
  // A strong match inside the circle is still used.
  assert.deepEqual(interpret('open what do I do if I have a permit', context), { type: 'activate', targetId: 1 });
  // Further away, both are offered rather than following the loose match.
  const link = el(1, 'Action Menu Button Example Using aria-activedescendant', 'link');
  const asked = interpret('open actions', { elements: [link], nearby: [], onScreen: () => [el(201, 'Actions', 'button', 400)] });
  assert.equal(asked.message, 'Which one? 1: Action Menu Button Example Using aria-activedescendant; 2: Actions. Say a number or cancel.');
  assert.deepEqual(asked.choose(2), { type: 'activate', targetId: 201 });
  // With nothing better anywhere, the loose match acts as before.
  assert.deepEqual(interpret('open actions', { elements: [link], nearby: [], onScreen: () => [] }), { type: 'activate', targetId: 1 });
});

test('"cancel" never presses a website button, but says how when one is in view', () => {
  const controller = createController({ window: {}, interpret });
  assert.equal(controller.handle('cancel', { elements: [el(1, 'Cancel', 'button')] }).message, 'Nothing to cancel. To press the website\'s Cancel button, say "click cancel".');
  assert.equal(controller.handle('cancel', { elements: [el(1, 'Save', 'button')] }).message, 'Cancelled.');
});
