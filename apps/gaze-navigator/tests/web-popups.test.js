import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';
import { choosePopupControl, popupKind } from '../src/web/page-actions.js';

const nothing = { elements: [] };
const button = name => ({ name, role: 'button', consequential: /accept|reject/i.test(name) });

test('cookie banner and pop-up commands are read from speech', () => {
  assert.deepEqual(interpret('accept cookies', nothing), { type: 'popup', want: 'accept' });
  assert.deepEqual(interpret('reject all cookies', nothing), { type: 'popup', want: 'reject' });
  assert.deepEqual(interpret('only necessary cookies', nothing), { type: 'popup', want: 'reject' });
  assert.deepEqual(interpret('cookie settings', nothing), { type: 'popup', want: 'settings' });
  assert.deepEqual(interpret('close the pop-up', nothing), { type: 'popup', want: 'close' });
  assert.notEqual(interpret('close', nothing).type, 'popup');
});

test('a banner button is chosen by what it does, rejecting before accepting', () => {
  assert.equal(popupKind('Accept only necessary'), 'reject');
  assert.equal(popupKind('Use necessary cookies only'), 'reject');
  assert.equal(popupKind('Allow all'), 'accept');
  assert.equal(popupKind('Manage preferences'), 'settings');
  assert.equal(popupKind('×'), 'close');
  assert.equal(popupKind('Close'), 'close');
  assert.equal(popupKind('Subscribe'), null);
  const banner = { consent: true, dialog: false, controls: [button('Allow selection'), button('Allow all'), button('Deny')] };
  assert.equal(choosePopupControl([banner], 'accept').control.name, 'Allow all');
  assert.equal(choosePopupControl([banner], 'reject').control.name, 'Deny');
  // A banner without a reject button says how to get to one.
  const sneaky = { consent: true, dialog: false, controls: [button('Accept all'), button('Cookie settings')] };
  assert.match(choosePopupControl([sneaky], 'reject').message, /no reject button on its first page\. Say cookie settings/);
  assert.match(choosePopupControl([], 'accept').message, /^No cookie banner was found/);
  // "Close the pop-up" prefers a dialog's close button to a sticky header's.
  const header = { consent: false, dialog: false, controls: [button('Close menu')] }, dialog = { consent: false, dialog: true, controls: [button('Sign up'), button('Close')] };
  assert.equal(choosePopupControl([header, dialog], 'close').control.name, 'Close');
});

test('a banner button is pressed without the usual question, and not while paused', () => {
  const pressed = [];
  const element = { isConnected: true };
  const actions = { activate: (target, name) => { pressed.push(name); return { ok: true, message: `Activated ${name}.` }; } };
  const controller = createController({ window: {}, interpret, actions, commands: {
    popup: ({ want }) => (want === 'accept' ? { target: { id: 1, element, name: 'Accept all', role: 'button', consequential: true }, message: 'Pressed "Accept all" on the cookie banner.' } : { message: 'No cookie banner was found on this page.' }),
  } });
  const accepted = controller.handle('accept cookies', { ...nothing, trackingUnavailable: true });
  assert.equal(accepted.message, 'Pressed "Accept all" on the cookie banner.');
  assert.equal(accepted.tone, 'success');
  assert.deepEqual(pressed, ['Accept all']);
  assert.equal(controller.handle('reject cookies', nothing).tone, 'error');
  controller.handle('pause', nothing);
  assert.match(controller.handle('accept cookies', nothing).message, /^Paused/);
  assert.deepEqual(pressed, ['Accept all']);
});
