import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, keyCombo } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';
import { keyLabel } from '../src/web/page-actions.js';

const nothing = { elements: [] };
const key = (k, extra = {}) => ({ type: 'key', key: k, ctrl: false, alt: false, shift: false, meta: false, ...extra });

test('keys are read from speech, with modifiers, and word keys give way to controls named like them', () => {
  assert.deepEqual(interpret('press escape', nothing), key('Escape'));
  assert.deepEqual(interpret('hit shift tab', nothing), key('Tab', { shift: true }));
  assert.deepEqual(interpret('press page down', nothing), key('PageDown'));
  assert.deepEqual(interpret('press control enter', nothing), key('Enter', { ctrl: true }));
  assert.deepEqual(interpret('press command plus a', nothing), key('a', { meta: true }));
  assert.deepEqual(interpret('press the down arrow', nothing), key('ArrowDown'));
  const home = { elements: [{ id: 1, name: 'Home', role: 'link', distance: 0 }] };
  assert.equal(interpret('press home', home).type, 'activate');
  assert.deepEqual(interpret('press the home key', home), key('Home'));
  assert.deepEqual(interpret('press home', nothing), key('Home'));
  // A letter alone is not a key, and Enter alone still submits.
  assert.equal(keyCombo('a'), null);
  assert.notEqual(interpret('press enter', nothing).type, 'key');
  assert.equal(keyLabel({ key: 'Tab', shift: true }), 'Shift+Tab');
});

test('keys go to the page without the gaze, and Control+Enter is asked first', () => {
  const pressed = [];
  const controller = createController({ window: {}, interpret, commands: { keys: action => { pressed.push(keyLabel(action)); return { ok: true, message: `Pressed ${keyLabel(action)}.` }; } } });
  assert.equal(controller.handle('press escape', { elements: [], trackingUnavailable: true }).message, 'Pressed Escape.');
  const asked = controller.handle('press control enter', nothing);
  assert.equal(asked.tone, 'question');
  assert.deepEqual(pressed, ['Escape']);
  controller.handle('confirm', nothing);
  assert.deepEqual(pressed, ['Escape', 'Control+Enter']);
  controller.handle('pause', nothing);
  assert.match(controller.handle('press tab', nothing).message, /^Paused/);
  assert.deepEqual(pressed, ['Escape', 'Control+Enter']);
});
