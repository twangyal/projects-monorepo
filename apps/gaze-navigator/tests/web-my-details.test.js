import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';
import { detailValue, planDetails } from '../src/web/page-actions.js';

const nothing = { elements: [] };

test('details are remembered, listed, filled and forgotten by voice', () => {
  assert.deepEqual(interpret('remember my email is jo at example dot com', nothing), { type: 'details', change: 'remember', field: 'email', value: 'jo@example.com' });
  assert.deepEqual(interpret('Remember my name is Jo Smith.', nothing), { type: 'details', change: 'remember', field: 'name', value: 'Jo Smith' });
  assert.deepEqual(interpret('remember my postcode is sw1a 1aa', nothing).value, 'SW1A 1AA');
  assert.deepEqual(interpret('fill in my details', nothing), { type: 'details', change: 'fill', only: null });
  assert.deepEqual(interpret('fill in this form with my details', nothing), { type: 'details', change: 'fill', only: null });
  assert.deepEqual(interpret('fill in my email', nothing), { type: 'details', change: 'fill', only: 'email' });
  assert.deepEqual(interpret('what details do you have', nothing), { type: 'details', change: 'list' });
  assert.deepEqual(interpret('forget my phone number', nothing), { type: 'details', change: 'forget', field: 'tel' });
  // Passwords are never details.
  assert.notEqual(interpret('remember my password is hunter2', nothing).type, 'details');
});

test('a fill writes saved details only into empty fields that ask for them, a first or last name from the full name', () => {
  const details = { name: 'Jo Smith', email: 'jo@example.com' };
  assert.equal(detailValue(details, 'given'), 'Jo');
  assert.equal(detailValue(details, 'family'), 'Smith');
  assert.equal(detailValue(details, 'tel'), null);
  const field = (kind, empty = true) => ({ element: { kind }, kind, name: kind, empty });
  const plan = planDetails([field('given'), field('family'), field('email', false), field('tel')], details);
  assert.deepEqual(plan.map(item => [item.kind, item.value]), [['given', 'Jo'], ['family', 'Smith']]);
  assert.deepEqual(planDetails([field('given'), field('email')], details, 'email').map(item => item.kind), ['email']);
});

test('a fill is asked first, and "undo" straight afterwards empties the fields again', () => {
  const calls = [];
  const details = {
    remember: action => (calls.push(['remember', action.field]), { ok: true, message: 'Saved.' }),
    plan: () => ({ ok: true, fields: [{ kind: 'email' }], message: 'Fill "Email" with your saved details? Say confirm, or cancel.' }),
    fill: plan => (calls.push(['fill', plan.length]), { ok: true, filled: [{ kind: 'email' }], message: 'Filled Email.' }),
    restore: entries => (calls.push(['restore', entries.length]), { message: 'Emptied Email again.' }),
  };
  const controller = createController({ window: {}, interpret, commands: { details } });
  assert.equal(controller.handle('remember my email is jo at example dot com', nothing).message, 'Saved.');
  const asked = controller.handle('fill in my details', nothing);
  assert.equal(asked.tone, 'question');
  assert.deepEqual(calls, [['remember', 'email']]);
  assert.equal(controller.handle('confirm', nothing).message, 'Filled Email.');
  assert.equal(controller.handle('undo', nothing).message, 'Emptied Email again.');
  assert.deepEqual(calls, [['remember', 'email'], ['fill', 1], ['restore', 1]]);
  // Only straight afterwards: another undo is an ordinary one.
  assert.notEqual(controller.handle('undo', nothing).message, 'Emptied Email again.');
});
