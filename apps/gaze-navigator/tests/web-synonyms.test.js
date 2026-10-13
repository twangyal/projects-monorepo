import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';

const el = (id, role, name) => ({ id, role, name, distance: id === 1 ? 0 : 10 * id, editable: false });

test('equivalent control names work in both directions (found on Wikipedia: "sign in" for a "Log in" link)', () => {
  assert.deepEqual(interpret('sign in', { elements: [el(1, 'link', 'Log in'), el(2, 'link', 'Donate')] }), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('log in', { elements: [el(1, 'button', 'Sign in')] }), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('open my basket', { elements: [el(1, 'link', 'Cart'), el(2, 'link', 'Help')] }), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('open the cart', { elements: [el(1, 'link', 'Basket')] }), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('sign out', { elements: [el(1, 'button', 'Log out')] }), { type: 'activate', targetId: 1 });
});
