import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { CONTEXTS } from '../src/web/instruction-suite.js';

const said = (say, context = CONTEXTS.navigation) => interpret(say, context);
const kind = (say, context) => said(say, context).type;

test('everyday words pause, carry on, confirm, decline and cancel', () => {
  for (const say of ['hang on a second', 'hold up', 'wait a bit', 'one sec', 'give me a moment', 'be right back']) assert.equal(kind(say), 'pause', say);
  for (const say of ['carry on', 'go on', 'I am back', "okay let's continue", 'start listening again']) assert.equal(kind(say), 'resume', say);
  for (const say of ['yeah', 'yup sure', 'ok do it', 'sure thing', 'yes go ahead', "that's right", 'absolutely']) assert.equal(kind(say), 'confirm', say);
  for (const say of ['nope', 'nah', 'no thank you', "don't do that", 'no way']) assert.equal(kind(say), 'deny', say);
  for (const say of ['abort', 'stop it all', 'cancel everything', 'never mind about that', 'forget about that']) assert.equal(kind(say), 'cancel', say);
  // A bare "second" still answers "which one?"; "right" alone is not a yes; dictated words stay words.
  assert.equal(kind('second'), 'choose');
  assert.notEqual(kind('right'), 'confirm');
  assert.deepEqual(said('type hang on a minute', CONTEXTS.focused).edit, { kind: 'append', text: 'hang on a minute' });
  // "Not now" is a button on many prompts, so it is pressed rather than read as a no.
  const prompt = { elements: [{ id: 1, role: 'button', name: 'Not now', distance: 0 }, { id: 2, role: 'button', name: 'Turn on', distance: 10 }] };
  assert.deepEqual(said('not now', prompt), { type: 'activate', targetId: 1 });
});

test('everyday scrolling: a bit, some more, the page, all the way', () => {
  const scroll = say => { const action = said(say, CONTEXTS.empty); return action.type === 'scroll' ? [action.direction, action.amount, action.scope ?? null] : action.type; };
  assert.deepEqual(scroll('scroll down some more'), ['down', 'page', null]);
  assert.deepEqual(scroll('up a tad'), ['up', 'small', null]);
  assert.deepEqual(scroll('a little lower'), ['down', 'small', null]);
  assert.deepEqual(scroll('a bit higher'), ['up', 'small', null]);
  assert.deepEqual(scroll('go back up'), ['up', 'page', null]);
  assert.deepEqual(scroll('move down the page'), ['down', 'page', 'page']);
  assert.deepEqual(scroll('all the way to the bottom'), ['bottom', 'page', null]);
  assert.deepEqual(scroll('head to the very top'), ['top', 'page', null]);
  assert.deepEqual(scroll('back up to the top of the page'), ['top', 'page', 'page']);
});

test('everyday editing: scratch that, take it back, wipe it, swap one word for another', () => {
  const edit = (say, context = CONTEXTS.focused) => { const action = said(say, context); return action.type === 'edit' ? [action.targetId, action.edit] : action.type; };
  assert.deepEqual(edit('scratch it'), [3, { kind: 'undo' }]);
  assert.deepEqual(edit('take it back'), [3, { kind: 'undo' }]);
  assert.deepEqual(edit('undo the last edits'), [3, { kind: 'undo' }]);
  assert.deepEqual(edit('get rid of the last word'), [3, { kind: 'delete-word' }]);
  assert.deepEqual(edit('wipe it'), [3, { kind: 'clear' }]);
  assert.deepEqual(edit('delete everything'), [3, { kind: 'clear' }]);
  assert.deepEqual(edit('wipe the email field', CONTEXTS.form), [2, { kind: 'clear' }]);
  assert.deepEqual(edit('swap Tuesday with Thursday'), [3, { kind: 'replace', find: 'Tuesday', text: 'Thursday' }]);
  assert.deepEqual(edit('begin a new paragraph'), [3, { kind: 'append', text: '\n', raw: true }]);
});

test('a choice said as "go with", "make it", "switch to" or "I\'ll take" picks the option, and only an option', () => {
  const option = (say, context = CONTEXTS.product) => { const action = said(say, context); return action.type === 'select-option' ? [action.targetId, action.optionIndex] : action.type; };
  assert.deepEqual(option('go with the paperback'), [1, 0]);
  assert.deepEqual(option("I'll take the audiobook"), [1, 3]);
  assert.deepEqual(option('make it large print'), [1, 2]);
  assert.deepEqual(option('make the format audiobook'), [1, 3]);
  assert.deepEqual(option('switch to hardcover'), [1, 1]);
  assert.deepEqual(option("i'd like the paperback version"), [1, 0]);
  assert.deepEqual(option('make the topic order problem', CONTEXTS.form), [5, 1]);
  assert.notEqual(kind('make it bigger', CONTEXTS.product), 'select-option');
  assert.equal(kind('switch to camera mode', CONTEXTS.product), 'tracking');
});

test('dictation names its field the way people do, and ordinary words stay text', () => {
  const typed = (say, context = CONTEXTS.form) => { const action = said(say, context); return action.type === 'edit' ? [action.targetId, action.edit.text] : action.type; };
  assert.deepEqual(typed('write running late in the message'), [3, 'running late']);
  assert.deepEqual(typed('type see you in the park'), [1, 'see you in the park']);
  assert.deepEqual(typed('put jo@example.com into the email address'), [2, 'jo@example.com']);
  assert.deepEqual(typed('fill in your name with Ada Lovelace'), [1, 'Ada Lovelace']);
  assert.notEqual(kind('put it in my basket', CONTEXTS.product), 'edit');
});

test('list entries are counted as people say them, and search drops "me some"', () => {
  assert.deepEqual(said('open the third post', CONTEXTS.list), { type: 'activate', targetId: 3 });
  assert.deepEqual(said('read the second one', CONTEXTS.list), { type: 'activate', targetId: 2 });
  assert.deepEqual(said('remove the last one', CONTEXTS.list), { type: 'activate', targetId: 5 });
  assert.equal(said('find me a few cookbooks').text, 'cookbooks');
  assert.equal(said('look for some gift ideas').text, 'gift ideas');
});

test('support, customer service, ratings and testimonials name the usual controls, and nothing else', () => {
  assert.equal(said('open support').targetId, 3);
  assert.equal(said('call customer support').targetId, 3);
  assert.equal(said('sign me in').targetId, 4);
  assert.equal(said('show the testimonials', CONTEXTS.product).targetId, 4);
  assert.equal(said('open the ratings', CONTEXTS.product).targetId, 4);
  assert.equal(kind('open the reviews'), 'unknown');
});
