import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const field = (id, name, holds, distance = id === 1 ? 0 : 20) => ({ id, name, role: 'textbox', distance, editable: true, ...(holds ? { holds } : {}) });
const typed = (said, context) => {
  const action = interpret(said, context);
  return [action.targetId, action.edit?.text, action.far ?? false];
};

test('dictated text of a clear kind goes to the field asking for it among several', () => {
  // The WAI-ARIA dialog example's address form, with the gaze resting nearest Special instructions.
  const form = { elements: [field(1, 'Special instructions:'), field(2, 'Zip:', 'postal-code', 20), field(3, 'State:', null, 40), field(4, 'Street:', 'street', 60)] };
  assert.deepEqual(typed('type 12 High Street', form), [4, '12 High Street', false]);
  assert.deepEqual(typed('type 221B Baker St', { elements: [field(1, 'Name'), field(2, 'Address line 1', 'street')] }), [2, '221B Baker St', false]);
  assert.deepEqual(typed('type SW1A 1AA', { elements: [field(1, 'Town'), field(2, 'Postcode', 'postal-code')] }), [2, 'SW1A 1AA', false]);
  assert.deepEqual(typed('type +44 20 7946 0958', { elements: [field(1, 'Name'), field(2, 'Phone', 'tel')] }), [2, '+44 20 7946 0958', false]);
  assert.deepEqual(typed('type jo@example.com', { elements: [field(1, 'Name'), field(2, 'Email', 'email')] }), [2, 'jo@example.com', false]);
  // Other words go to the field nearest the gaze, as before.
  assert.deepEqual(typed('type leave it with the neighbour', form), [1, 'leave it with the neighbour', false]);
});

test('text that only might be of a kind is typed where the gaze is', () => {
  const near = holds => ({ elements: [field(1, 'Notes'), field(2, 'Other', holds)] });
  // Short numbers, dates, five plain digits, card-length numbers and sentences that end like a street name.
  assert.deepEqual(typed('type 1234567', near('tel')), [1, '1234567', false]);
  assert.deepEqual(typed('type 2024-05-12', near('tel')), [1, '2024-05-12', false]);
  assert.deepEqual(typed('type 4111 1111 1111 1111', near('tel')), [1, '4111 1111 1111 1111', false]);
  assert.deepEqual(typed('type 90210', near('postal-code')), [1, '90210', false]);
  assert.deepEqual(typed('type 5 apples on the way', near('street')), [1, '5 apples on the way', false]);
  assert.deepEqual(typed('type meet me at noon', near('email')), [1, 'meet me at noon', false]);
});

test('a named field, a box for free text being typed in, and a field of the same kind keep the text', () => {
  const form = { elements: [field(1, 'Notes', 'text'), field(2, 'Street', 'street'), field(3, 'Phone', 'tel', 30)] };
  assert.deepEqual(typed('type 12 High Street into notes', form), [1, '12 High Street', false]);
  assert.deepEqual(typed('type 12 High Street', { ...form, focusedId: 1 }), [1, '12 High Street', false]);
  assert.deepEqual(typed('type the code is 020 7946 0958', { ...form, focusedId: 1 }), [1, 'the code is 020 7946 0958', false]);
  assert.deepEqual(typed('type 020 7946 0958', { ...form, focusedId: 1 }), [1, '020 7946 0958', false]);
  // A one-line field just filled gives way to the field asking for the next thing said.
  const address = { elements: [field(1, 'City'), field(2, 'Street', 'street'), field(3, 'Postcode', 'postal-code', 30)] };
  assert.deepEqual(typed('type 12 High Street', { ...address, focusedId: 1 }), [2, '12 High Street', false]);
  assert.deepEqual(typed('type LS1 4AP', { ...address, focusedId: 2 }), [3, 'LS1 4AP', false]);
  assert.deepEqual(typed('type 14 High Street', { ...address, focusedId: 2 }), [2, '14 High Street', false]);
  assert.deepEqual(typed('type Leeds', { ...address, focusedId: 2 }), [2, 'Leeds', false]);
});

test('a spelled-out email address is written as an address, but only into an email field', () => {
  assert.deepEqual(typed('type jo at example dot com', { elements: [field(1, 'Name'), field(2, 'Email address', 'email', 30)] }), [2, 'jo@example.com', false]);
  assert.deepEqual(typed('type jo dot smith at example dot co dot uk', { elements: [field(1, 'Email', 'email')] }), [1, 'jo.smith@example.co.uk', false]);
  assert.deepEqual(typed('replace it with jo at example dot com', { focusedId: 2, elements: [field(1, 'Name'), field(2, 'Email', 'email')] }), [2, 'jo@example.com', false]);
  // Elsewhere, and for words that are not an address, the words are typed as said.
  assert.deepEqual(typed('type jo at example dot com', { elements: [field(1, 'Message')] }), [1, 'jo at example dot com', false]);
  assert.deepEqual(typed('type meet me at noon', { elements: [field(1, 'Email', 'email')] }), [1, 'meet me at noon', false]);
});

test('when the gaze rests on a field asking for something else, the field just outside that asks for it is offered', () => {
  const zip = { elements: [field(2, 'Zip:', 'postal-code', 0)], nearby: [field(103, 'City:', null, 70), field(104, 'Street:', 'street', 140)] };
  assert.deepEqual(typed('type 12 High Street', zip), [104, '12 High Street', true]);
  // With no field in the circle, the nearby field of that kind is the one offered.
  assert.deepEqual(typed('type 12 High Street', { elements: [], nearby: zip.nearby }), [104, '12 High Street', true]);
  // A field asking for nothing in particular takes the text, as do fields when two nearby could.
  assert.deepEqual(typed('type 12 High Street', { elements: [field(1, 'Notes')], nearby: zip.nearby }), [1, '12 High Street', false]);
  assert.deepEqual(typed('type 12 High Street', { ...zip, nearby: [...zip.nearby, field(105, 'Billing street', 'street', 160)] }), [2, '12 High Street', false]);
});

test('the offered field is written only after a yes', () => {
  const values = new Map(), element = name => ({ name, isConnected: true });
  const zip = element('zip'), street = element('street');
  const actions = { readValue: el => values.get(el) ?? '', writeValue: (el, value) => values.set(el, value), canWrite: () => true };
  const controller = createController({ window: {}, interpret, actions });
  const context = { elements: [{ ...field(2, 'Zip:', 'postal-code', 0), element: zip }], nearby: [{ ...field(104, 'Street:', 'street', 140), element: street }] };
  const asked = controller.handle('type 12 High Street', context);
  assert.equal(asked.tone, 'question');
  assert.match(asked.message, /"Street:" is not near your gaze/);
  assert.equal(values.size, 0);
  controller.handle('confirm', context);
  assert.equal(values.get(street), '12 High Street');
  assert.equal(values.get(zip), undefined);
});
