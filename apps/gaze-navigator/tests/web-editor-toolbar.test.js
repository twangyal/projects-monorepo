import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';

const el = (id, role, name, extra = {}) => ({ id, role, name, distance: 10 * id, editable: false, ...extra });
const body = el(20, 'textbox', 'Message body', { editable: true, value: 'Hello Sam, see you soon', richText: true });
const toolbar = { elements: [el(1, 'button', 'Bold'), el(2, 'button', 'Italic'), el(3, 'button', 'Underline'), el(4, 'button', 'Insert link'),
  el(5, 'button', 'Insert image'), el(6, 'button', 'Bulleted list'), el(7, 'button', 'Numbered list'), el(8, 'button', 'Attach files'), body] };

test('inserting and formatting are said as people say them and press the toolbar control that does it', () => {
  for (const [say, id] of [['insert link', 4], ['insert a link', 4], ['add a hyperlink', 4], ['insert image', 5], ['add a picture', 5], ['insert a photo here', 5],
    ['attach a file', 8], ['add an attachment', 8], ['make it bold', 1], ['bold that', 1], ['bold', 1], ['make this italic', 2], ['italics', 2],
    ['underline the selection', 3], ['bullet points', 6], ['make a bullet list', 6], ['start a numbered list', 7], ['numbered list', 7]]) {
    assert.deepEqual(interpret(say, toolbar), { type: 'activate', targetId: id }, say);
  }
});

test('words that name no toolbar control are still typed, and two matching controls are asked about', () => {
  assert.deepEqual(interpret('insert hello', toolbar).edit, { kind: 'append', text: 'hello' });
  // Without a link control, "insert link" types as it did.
  assert.deepEqual(interpret('insert link', { elements: [body] }).edit, { kind: 'append', text: 'link' });
  assert.equal(interpret('add a table', toolbar).type, 'unknown');
  const two = interpret('insert a picture', { elements: [el(1, 'button', 'Insert image'), el(2, 'menuitem', 'Photo from your computer'), body] });
  assert.equal(two.type, 'clarify');
  assert.deepEqual(two.candidates.map(candidate => candidate.elementId), [1, 2]);
  // A toolbar just outside the circle is reached too.
  assert.deepEqual(interpret('make it bold', { elements: [body], nearby: [el(101, 'button', 'Bold')] }).targetId, 101);
});

test('"select all" with a Select all control there selects with it; otherwise it selects the field\'s text', () => {
  assert.deepEqual(interpret('select all', { elements: [el(1, 'checkbox', 'Select all', { checked: false }), body] }), { type: 'check', targetId: 1, checked: true });
  assert.deepEqual(interpret('select all', { elements: [body] }), { type: 'select-text', targetId: 20, position: 'all' });
});
