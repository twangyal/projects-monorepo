import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

test('the navigator panel is hidden, shown and moved by voice', () => {
  const said = text => interpret(text, { elements: [] });
  for (const text of ['hide the navigator', 'minimise the navigator panel', 'shrink the gaze navigator']) assert.deepEqual(said(text), { type: 'panel', change: 'collapse' }, text);
  for (const text of ['show the navigator', 'restore the navigator panel']) assert.deepEqual(said(text), { type: 'panel', change: 'expand' }, text);
  assert.deepEqual(said('move the navigator to the top left'), { type: 'panel', change: 'move', left: true, top: true });
  assert.deepEqual(said('put the navigator in the bottom right corner'), { type: 'panel', change: 'move', left: false, top: false });
  assert.deepEqual(said('move the navigator left'), { type: 'panel', change: 'move', left: true, top: null });
  assert.deepEqual(said('move the navigator up'), { type: 'panel', change: 'move', left: null, top: true });
  assert.deepEqual(said('place the navigator automatically'), { type: 'panel', change: 'auto' });
  // A website's own panels are still the website's.
  const faq = { elements: [{ id: 1, name: 'FAQ panel', role: 'button', distance: 0, expanded: true, editable: false }] };
  assert.notEqual(interpret('collapse that panel', faq).type, 'panel');
  assert.notEqual(interpret('hide the panel', faq).type, 'panel');
});

test('changing the panel keeps a question open and works while paused', () => {
  const calls = [];
  const controller = createController({ window: { setTimeout, clearTimeout }, interpret, commands: { panel: action => { calls.push(action.change); return { ok: true, message: 'moved' }; } } });
  const link = id => ({ id, name: 'Pricing', role: 'link', distance: 0, editable: false, element: { isConnected: true } });
  const context = { elements: [link(1), link(2)] };
  const asked = controller.handle('open pricing', context);
  assert.ok(asked.pending, 'a question is open');
  const moved = controller.handle('move the navigator to the top left', context);
  assert.equal(moved.message, 'moved');
  assert.ok(moved.pending && moved.keepPrompt, 'the question stays open');
  controller.handle('pause', context);
  assert.equal(controller.handle('hide the navigator', context).message, 'moved');
  assert.deepEqual(calls, ['move', 'collapse']);
});
