import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, punctuate } from '../src/web/interpreter.js';

const field = { elements: [{ id: 1, name: 'Message', role: 'textbox', editable: true, distance: 0, focused: true }], focusedId: 1 };
const typed = said => interpret(said, field).edit?.text;

test('spoken punctuation is typed as marks, and a new sentence or line starts with a capital', () => {
  assert.equal(typed('type hello comma how are you question mark'), 'hello, how are you?');
  assert.equal(typed('type great exclamation mark see you there full stop'), 'great! See you there.');
  assert.equal(typed('type dear Sam comma new paragraph thanks for the note period'), 'dear Sam,\n\nThanks for the note.');
  assert.equal(typed('type first line new line second line'), 'first line\nSecond line');
  assert.equal(typed('type I said open quote hello close quote'), 'I said “hello”');
  assert.equal(typed('type call me open bracket after six close bracket'), 'call me (after six)');
  assert.equal(typed('type note colon bring snacks semicolon and water'), 'note: bring snacks; and water');
  assert.equal(typed('type wait dot dot dot what question mark'), 'wait… what?');
});

test('words without spoken punctuation, and quoted phrases, are typed as said', () => {
  assert.equal(typed('type the Victorian era'), 'the Victorian era');
  assert.equal(typed('type “a comma splice”'), 'a comma splice');
  assert.equal(punctuate('meet at the cafe'), 'meet at the cafe');
  // "Continue typing" and "change it to" take spoken punctuation too.
  assert.equal(interpret('continue typing see you soon period', field).edit?.text, 'see you soon.');
  assert.equal(interpret('change it to yes comma tomorrow', field).edit?.text, 'yes, tomorrow');
});
