import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';

const el = (id, role, name, extra = {}) => ({ id, role, name, distance: 10 * id, editable: false, ...extra });
// Each page has a text field in the circle, which a command to find, search, type or enter would otherwise use.
const withField = (...elements) => ({ elements: [...elements, el(9, 'textbox', 'Email address', { editable: true })] });

test('a control named by everything said is pressed, though its name starts like a command for something else', () => {
  for (const name of ['Find out more', 'Search flights', 'Find a job', 'Enter the competition', 'Check availability', 'Check in', 'Check your eligibility',
    'Clear filters', 'Turn on notifications', 'Tick all', 'Type of account']) {
    const page = withField(el(1, name === 'Type of account' ? 'link' : 'button', name), el(2, 'link', 'Home'));
    assert.deepEqual(interpret(name.toLowerCase(), page), { type: 'activate', targetId: 1 }, name);
    // Politeness and "the" around the name change nothing.
    assert.deepEqual(interpret(`please ${name.toLowerCase()}`, page), { type: 'activate', targetId: 1 }, `please ${name}`);
  }
  // A checkbox or switch said by its whole name is ticked, never toggled off.
  const switches = withField(el(1, 'switch', 'Turn on notifications', { checked: true }));
  assert.deepEqual(interpret('turn on notifications', switches), { type: 'check', targetId: 1, checked: true });
  // Two controls of that name are asked about.
  const two = interpret('find out more', withField(el(1, 'link', 'Find out more'), el(2, 'link', 'Find out more')));
  assert.equal(two.type, 'clarify');
  assert.deepEqual(two.candidates.map(candidate => candidate.elementId), [1, 2]);
});

test('without a control of that name, the commands mean what they did', () => {
  const page = withField(el(1, 'button', 'Search'), el(2, 'checkbox', 'Remember me', { checked: false }));
  assert.equal(interpret('search for flights', page).type, 'search');
  assert.deepEqual(interpret('type hello', page).edit, { kind: 'append', text: 'hello' });
  assert.deepEqual(interpret('check remember me', page), { type: 'check', targetId: 2, checked: true });
  assert.deepEqual(interpret('find gift cards on this page', page), { type: 'find', text: 'gift cards' });
  // The immediate safety words keep their meaning whatever the page calls its buttons.
  assert.deepEqual(interpret('stop', withField(el(1, 'button', 'Stop'))), { type: 'cancel' });
});

test('a control of that name just outside the circle or elsewhere is looked for there, and nothing is typed', () => {
  const field = el(9, 'textbox', 'Email address', { editable: true });
  const near = interpret('find out more', { elements: [field], nearby: [el(101, 'link', 'Find out more')] });
  assert.equal(near.targetId, 101);
  assert.equal(near.outside, true);
  const far = interpret('enter the competition', { elements: [field], nearby: [], onScreen: () => [el(201, 'button', 'Enter the competition')] });
  assert.equal(far.targetId, 201);
  assert.equal(far.far, true, 'a far control is offered before it is pressed');
});

test('"check" with no checkbox of that name looks: the control of that name opens', () => {
  const page = withField(el(1, 'link', 'Order status'), el(2, 'link', 'Reviews'), el(3, 'checkbox', 'Gift wrap', { checked: false }));
  assert.deepEqual(interpret('check my order status', page), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('check the reviews', page), { type: 'activate', targetId: 2 });
  assert.deepEqual(interpret('check gift wrap', page), { type: 'check', targetId: 3, checked: true });
  // "Check out" is the checkout, and a last "now" says when.
  const shop = { elements: [el(1, 'button', 'Checkout'), el(2, 'checkbox', 'Gift wrap', { checked: false })] };
  for (const say of ['check out', "let's check out", 'check out now']) assert.deepEqual(interpret(say, shop), { type: 'activate', targetId: 1 }, say);
});
