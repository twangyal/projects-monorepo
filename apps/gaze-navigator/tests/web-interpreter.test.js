import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, interpret, matchScore, parseNumber } from '../src/web/interpreter.js';

const element = (id, name, role, extra = {}) => ({ id, name, role, distance: id === 1 ? 0 : id * 10, editable: false, ...extra });
const context = (...elements) => ({ elements });

test('control words are recognized before anything else', () => {
  for (const [said, type] of [['Cancel', 'cancel'], ['stop', 'cancel'], ['never mind', 'cancel'], ['pause', 'pause'], ['Resume', 'resume'],
    ['yes', 'confirm'], ['confirm', 'confirm'], ['no', 'deny'], ['go back', 'back'], ['back', 'back'], ['go forward', 'forward']]) {
    assert.equal(interpret(said, context()).type, type, said);
  }
});

test('numbers and ordinals answer questions or pick numbered elements', () => {
  assert.equal(parseNumber('three'), 3);
  assert.equal(parseNumber('number 12'), 12);
  assert.equal(parseNumber('the second'), null);
  assert.equal(parseNumber('second'), 2);
  assert.deepEqual(interpret('number two', context()), { type: 'choose', index: 2 });
  assert.deepEqual(interpret('click 3', context()), { type: 'choose', index: 3 });
  assert.deepEqual(interpret('first one', context()), { type: 'choose', index: 1 });
});

test('names resolve to the uniquely best element, with an optional verb and role hint', () => {
  const page = context(element(1, 'Pricing', 'link'), element(2, 'Sign in', 'button'), element(3, 'Pricing plans for teams', 'link'));
  assert.deepEqual(interpret('open pricing', page), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('Sign in', page), { type: 'activate', targetId: 2 });
  assert.deepEqual(interpret('click the sign in button', page), { type: 'activate', targetId: 2 });
  assert.equal(interpret('open teams', page).targetId, 3);
  assert.equal(interpret('open careers', page).type, 'unknown');
  assert.match(interpret('open careers', page).message, /No control called "careers"/);
  assert.match(interpret('make me a sandwich', page).message, /not understood/);
});

test('equally good matches ask a numbered question whose answer performs the action', () => {
  const page = context(element(1, 'Read more', 'link'), element(2, 'Read more', 'link'), element(3, 'Contact', 'link'));
  const question = interpret('read more', page);
  assert.equal(question.type, 'clarify');
  assert.deepEqual(question.candidates.map(candidate => candidate.number), [1, 2]);
  assert.deepEqual(question.candidates[0], { number: 1, label: 'Read more', elementId: 1 });
  assert.match(question.message, /1: Read more; 2: Read more/);
  assert.deepEqual(question.choose(2), { type: 'activate', targetId: 2 });
});

test('word order matters for near-identical option names', () => {
  assert.ok(matchScore('price low to high', 'Price, low to high') > matchScore('price low to high', 'Price, high to low') + 0.1);
  const select = element(1, 'Sort by', 'combobox', { options: ['Newest', 'Price, low to high', 'Price, high to low'] });
  assert.deepEqual(interpret('choose price low to high', context(select)),
    { type: 'select-option', targetId: 1, optionIndex: 1, optionName: 'Price, low to high' });
  const options = interpret('select price', context(select));
  assert.equal(options.type, 'clarify', 'a partial name does not silently pick an option');
  assert.deepEqual(options.candidates.map(candidate => candidate.label), ['Price, low to high', 'Price, high to low']);
  assert.deepEqual(options.choose(2), { type: 'select-option', targetId: 1, optionIndex: 2, optionName: 'Price, high to low' });
});

test('deictic words use the element under the circle center, otherwise ask', () => {
  const page = context(element(1, 'Save', 'button'), element(2, 'Share', 'button'));
  assert.deepEqual(interpret('click that', page), { type: 'activate', targetId: 1 });
  const nothingTouching = context({ ...element(1, 'Save', 'button'), distance: 5 }, element(2, 'Share', 'button'));
  assert.equal(interpret('click this', nothingTouching).type, 'clarify');
});

test('dictation keeps wording and targets a named, focused, or touched field', () => {
  const page = context(element(1, 'Name', 'textbox', { editable: true }), element(2, 'Message', 'textbox', { editable: true }));
  assert.deepEqual(interpret('Type Ada Lovelace', page), { type: 'edit', targetId: 1, edit: { kind: 'append', text: 'Ada Lovelace' } });
  assert.deepEqual(interpret('type Meet me in the park', page).edit, { kind: 'append', text: 'Meet me in the park' }, 'unquoted "in" is dictation');
  assert.deepEqual(interpret('type hello there into message', page), { type: 'edit', targetId: 2, edit: { kind: 'append', text: 'hello there' } });
  assert.deepEqual(interpret('write "Hi, Sam!" in the message field', page), { type: 'edit', targetId: 2, edit: { kind: 'append', text: 'Hi, Sam!' } });
  assert.equal(interpret('type hi', { ...page, focusedId: 2 }).targetId, 2);
  assert.match(interpret('type hi', context(element(1, 'Go', 'button'))).message, /No text field/);
});

test('corrections map to explicit edit operations', () => {
  const page = { ...context(element(1, 'Message', 'textbox', { editable: true })), focusedId: 1 };
  assert.deepEqual(interpret('delete last word', page).edit, { kind: 'delete-word' });
  assert.deepEqual(interpret('clear it', page).edit, { kind: 'clear' });
  assert.deepEqual(interpret('clear the message field', page).edit, { kind: 'clear' });
  assert.deepEqual(interpret('replace Tuesday with Friday', page).edit, { kind: 'replace', find: 'Tuesday', text: 'Friday' });
  assert.deepEqual(interpret('change it to Thanks!', page).edit, { kind: 'replace-all', text: 'Thanks!' });
  assert.deepEqual(interpret('new line', page).edit, { kind: 'append', text: '\n', raw: true });
  assert.deepEqual(interpret('undo', page).edit, { kind: 'undo' });
});

test('search prefers a nearby search field, then the page search field', () => {
  const pageSearch = element(0, 'Search books', 'searchbox', { editable: true });
  assert.deepEqual(interpret('search for river songs', { elements: [element(1, 'Home', 'link')], pageSearch }),
    { type: 'search', targetId: 0, text: 'river songs' });
  const nearby = element(1, 'Search catalog', 'searchbox', { editable: true });
  assert.equal(interpret('search for maps', { elements: [nearby], pageSearch }).targetId, 1);
});

test('scrolling takes direction and size', () => {
  assert.deepEqual(interpret('scroll down', context()), { type: 'scroll', direction: 'down', amount: 'page' });
  assert.deepEqual(interpret('scroll up a bit', context()), { type: 'scroll', direction: 'up', amount: 'small' });
  assert.deepEqual(interpret('scroll the list right', context()), { type: 'scroll', direction: 'right', amount: 'page' });
  assert.deepEqual(interpret('scroll to the top', context()), { type: 'scroll', direction: 'top', amount: 'page' });
  assert.deepEqual(interpret('page down', context()), { type: 'scroll', direction: 'down', amount: 'page' });
});

test('submit targets the focused field or the only form control near gaze', () => {
  const page = context(element(1, 'Send', 'button', { submits: true }), element(2, 'Home', 'link'));
  assert.deepEqual(interpret('submit', page), { type: 'submit', targetId: 1 });
});

test('applyEdit implements corrections and reports impossible ones as null', () => {
  assert.equal(applyEdit('', { kind: 'append', text: 'Hi' }), 'Hi');
  assert.equal(applyEdit('Hi', { kind: 'append', text: 'there' }), 'Hi there');
  assert.equal(applyEdit('Hi ', { kind: 'append', text: 'there' }), 'Hi there');
  assert.equal(applyEdit('Hi', { kind: 'append', text: '\n', raw: true }), 'Hi\n');
  assert.equal(applyEdit('one two three', { kind: 'delete-word' }), 'one two');
  assert.equal(applyEdit('one', { kind: 'delete-word' }), '');
  assert.equal(applyEdit('see you Tuesday', { kind: 'replace', find: 'tuesday', text: 'Friday' }), 'see you Friday');
  assert.equal(applyEdit('see you', { kind: 'replace', find: 'Monday', text: 'Friday' }), null);
  assert.equal(applyEdit('new', { kind: 'undo' }, ['old']), 'old');
  assert.equal(applyEdit('new', { kind: 'undo' }, []), null);
  assert.equal(applyEdit('anything', { kind: 'clear' }), '');
});
