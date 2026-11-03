import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

test('words are found on the page when the page is named, and found again', () => {
  const read = said => interpret(said, { elements: [] });
  assert.deepEqual(read('find gift cards on this page'), { type: 'find', text: 'gift cards' });
  assert.deepEqual(read('search the page for "free delivery"'), { type: 'find', text: 'free delivery' });
  assert.deepEqual(read('look on the page for returns'), { type: 'find', text: 'returns' });
  assert.deepEqual(read('find next'), { type: 'find', move: 'next' });
  assert.deepEqual(read('previous match'), { type: 'find', move: 'previous' });
  assert.deepEqual(read('stop finding'), { type: 'find', clear: true });
  // Without the page named, "find" and "look for" still use the site's search box.
  assert.notEqual(read('find gift cards').type, 'find');
  assert.notEqual(read('look for poetry').type, 'find');
});

test('a match inside a control becomes what "it" means, so it can be used', () => {
  const pressed = [], asked = [];
  const link = { id: 0, name: 'Return policy', role: 'link', distance: 0, element: { name: 'Return policy', isConnected: true } };
  const controller = createController({ window: {}, interpret,
    actions: { activate: element => { pressed.push(element.name); return { ok: true, message: `${element.name} activated.` }; } },
    commands: { find: action => { asked.push(action); return { ok: true, control: link, message: 'Found "return policy" (1 of 2).' }; } } });
  const page = { elements: [{ id: 1, name: 'Home', role: 'link', distance: 0, element: { name: 'Home', isConnected: true } }] };
  assert.equal(controller.handle('find return policy on this page', page).message, 'Found "return policy" (1 of 2).');
  controller.handle('click it', page);
  assert.deepEqual(pressed, ['Return policy']);
  controller.handle('next match', page);
  assert.deepEqual(asked, [{ type: 'find', text: 'return policy' }, { type: 'find', move: 'next' }]);
  // Found words need no gaze, but wait while paused.
  assert.equal(controller.handle('next match', { elements: [], trackingUnavailable: true }).tone, 'info');
  controller.handle('pause', page);
  assert.match(controller.handle('next match', page).message, /^Paused/);
});
