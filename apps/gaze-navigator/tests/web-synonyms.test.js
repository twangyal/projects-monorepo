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

test('everyday names for page tools reach their controls, and the words said win over a synonym', () => {
  const link = (id, name) => ({ id, name, role: 'link', distance: id * 10 });
  const wiki = { elements: [link(1, 'Read'), link(2, 'Edit'), link(3, 'View history'), link(4, 'Talk')] };
  for (const said of ['show me the past versions of this page', 'open the revisions', 'view the edit history', 'open the old versions of this article']) {
    assert.deepEqual(interpret(said, wiki), { type: 'activate', targetId: 3 }, said);
  }
  const site = { elements: [link(1, 'Options'), link(2, 'Settings'), link(3, 'FAQ'), link(4, 'Save changes')] };
  assert.deepEqual(interpret('open options', site), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('open preferences', site), { type: 'activate', targetId: 2 });
  assert.deepEqual(interpret('open the frequently asked questions', site), { type: 'activate', targetId: 3 });
  // "Help" stays an ordinary word: it never reaches a control by a synonym.
  assert.notEqual(interpret('help', site).type, 'activate');
  assert.deepEqual(interpret('click save changes', site), { type: 'activate', targetId: 4 });
});
