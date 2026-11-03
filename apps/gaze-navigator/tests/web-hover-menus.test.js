import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const link = (id, name, extra = {}) => ({ id, role: 'link', name, distance: id === 1 ? 0 : 20, editable: false, ...extra });
const nav = { elements: [link(1, 'Shop'), link(2, 'Help'), { ...link(3, 'Account'), role: 'button', expanded: false }] };

test('pointing at a menu is read from speech, and only a named control is pointed at', () => {
  for (const say of ['show the shop menu', 'hover over shop', 'point at shop', 'hover shop', 'open the shop dropdown', 'put the mouse over shop']) {
    assert.deepEqual(interpret(say, nav), { type: 'hover', targetId: 1 }, say);
  }
  // A control with an open/closed state is expanded as before; "hover" still points at it.
  assert.deepEqual(interpret('show the account menu', nav), { type: 'disclosure', targetId: 3, expanded: true });
  assert.deepEqual(interpret('hover over account', nav), { type: 'hover', targetId: 3 });
  // No name, or no control of that name, is never a hover.
  assert.notEqual(interpret('show the menu', nav).type, 'hover');
  assert.equal(interpret('show the careers menu', nav).type, 'unknown');
  // "Close the menu" leaves a pointed-at menu, and only while there is one.
  assert.deepEqual(interpret('close the menu', { ...nav, hovering: true }), { type: 'unhover' });
  assert.notEqual(interpret('close the menu', nav).type, 'unhover');
});

test('a pointed-at menu reports what appeared, moves on to the next menu and is left again', async () => {
  const log = [];
  const node = name => ({ name, isConnected: true });
  const shop = node('Shop'), help = node('Help');
  const actions = {
    hover: (element, name, previous) => { log.push(['hover', name, previous?.name ?? null]); return { ok: true, message: `Pointing at ${name}…`, followUp: Promise.resolve({ ok: true, message: `Showing what is under ${name}.` }) }; },
    unhover: element => { log.push(['unhover', element.name]); return { ok: true, message: 'Left the menu.' }; },
    activate: (element, name) => { log.push(['activate', name]); return { ok: true, message: `${name} activated.` }; },
  };
  const controller = createController({ window: {}, actions });
  const context = { elements: [{ ...link(1, 'Shop'), element: shop }, { ...link(2, 'Help'), element: help }] };
  const first = controller.handle('show the shop menu', context);
  assert.equal(first.message, 'Pointing at Shop…');
  assert.equal((await first.followUp).message, 'Showing what is under Shop.');
  // Pointing at another menu leaves the first one.
  await controller.handle('hover over help', context).followUp;
  assert.deepEqual(log, [['hover', 'Shop', null], ['hover', 'Help', 'Shop']]);
  assert.equal(controller.handle('close the menu', context).message, 'Left the menu.');
  assert.deepEqual(log.at(-1), ['unhover', 'Help']);
  // Nothing was clicked.
  assert.ok(!log.some(([kind]) => kind === 'activate'));
});
