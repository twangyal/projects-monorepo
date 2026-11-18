import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const field = (id, name, distance, role = 'textbox') => ({ id, name, role, distance, editable: true });
const link = (id, name) => ({ id, name, role: 'link', distance: 0, editable: false });
const missed = (nearby, screen = []) => ({ elements: [link(1, 'Home')], nearby, onScreen: () => screen });

test('typing after a gaze miss offers the text field just outside the circle, never types without a yes', () => {
  assert.deepEqual(interpret('type hello world', missed([field(101, 'Email', 150)])),
    { type: 'edit', targetId: 101, edit: { kind: 'append', text: 'hello world' }, far: true });
  const asked = interpret('type hello world', missed([field(101, 'Email', 150), field(102, 'Name', 170)]));
  assert.equal(asked.type, 'clarify');
  assert.equal(asked.message, 'No text field is inside the gaze circle. Type into: 1: Email; 2: Name. Say a number or cancel.');
  assert.deepEqual(asked.choose(2), { type: 'edit', targetId: 102, edit: { kind: 'append', text: 'hello world' } });
  // With nothing nearby, the only field on screen is offered; a page full of fields is not guessed at.
  assert.equal(interpret('search for shoes', { ...missed([], [field(201, 'Search', 400, 'searchbox')]), pageSearch: null }).far, true);
  const many = interpret('type hello', missed([], [1, 2, 3, 4].map(n => field(200 + n, `Field ${n}`, 300 + n))));
  assert.deepEqual(many, { type: 'unknown', message: 'No text field is inside the gaze circle.' });
});

test('text of a clear kind is offered to the one field asking for it, however far the gaze landed from it', () => {
  // The gaze landed below a dialog's address fields: the street goes to the Street field, not the nearest ones.
  const street = { ...field(201, 'Street', 450), holds: 'street' }, nearby = [field(101, 'Special instructions', 150), { ...field(102, 'Zip', 170), holds: 'postal-code' }];
  assert.deepEqual(interpret('type 12 High Street', missed(nearby, [street, field(202, 'City', 420)])),
    { type: 'edit', targetId: 201, edit: { kind: 'append', text: '12 High Street' }, far: true });
  // A postcode goes to the Zip field just outside the circle; text of no clear kind still offers the nearest fields.
  assert.equal(interpret('type SW1A 1AA', missed(nearby, [street])).targetId, 102);
  assert.match(interpret('type hello', missed(nearby, [street])).message, /^No text field is inside the gaze circle\. Type into: 1: Special instructions; 2: Zip\./);
  // Among several fields in the circle that ask for nothing in particular, the street field just outside comes first.
  const near = { ...field(103, 'Street', 160), holds: 'street' };
  const inside = { elements: [field(1, 'Special instructions', 0), { ...field(2, 'Zip', 20), holds: 'postal-code' }], nearby: [near] };
  const asked = interpret('type 12 High Street', inside);
  assert.equal(asked.message, 'Which one? 1: Street; 2: Special instructions; 3: Zip. Say a number or cancel.');
  assert.deepEqual(asked.choose(1), { type: 'edit', targetId: 103, edit: { kind: 'append', text: '12 High Street' } });
  // Two fields asking for the same kind are not guessed between.
  const twice = interpret('type 12 High Street', missed(nearby, [street, { ...field(203, 'Billing street', 500), holds: 'street' }]));
  assert.notEqual(twice.targetId, 201);
});

test('changing text the person cannot see never reaches outside the circle', () => {
  for (const said of ['clear the field', 'delete the last word', 'new line', 'undo']) {
    assert.notEqual(interpret(said, missed([field(101, 'Email', 150)])).far, true, said);
    assert.notEqual(interpret(said, missed([field(101, 'Email', 150)])).type, 'edit', said);
  }
  // Inside the circle nothing changes.
  assert.deepEqual(interpret('type hello', { elements: [field(1, 'Email', 0)] }), { type: 'edit', targetId: 1, edit: { kind: 'append', text: 'hello' } });
});

test('the offered field asks for confirmation before anything is typed', () => {
  const writes = [];
  const element = { isConnected: true, value: '' };
  const actions = { writeValue: (target, value) => { writes.push(value); target.value = value; }, readValue: target => target.value };
  const controller = createController({ window: {}, interpret, actions });
  const context = missed([{ ...field(101, 'Email', 150), element, value: '' }]);
  const offered = controller.handle('type hello', context);
  assert.match(offered.message, /^"Email" is not near your gaze; it is outlined on the page\. Say confirm/);
  assert.deepEqual(writes, []);
});
