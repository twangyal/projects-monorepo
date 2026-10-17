import test from 'node:test';
import assert from 'node:assert/strict';
import { selectText } from '../src/web/page-actions.js';

// Native selection arithmetic is tested here; real DOM/extension behavior lives in browser tests.
function field(value) {
  return {
    tagName: 'TEXTAREA', value, selectionStart: 2, selectionEnd: 2, readOnly: false,
    ownerDocument: { defaultView: { frameElement: null } },
    matches: () => false, closest: () => null, getRootNode() { return { activeElement: this }; }, focus() {},
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
}
const select = (element, text, occurrence = null) => selectText(element, 'phrase', { text, occurrence });
const range = element => [element.selectionStart, element.selectionEnd];

test('phrase selection finds literal case-insensitive native offsets without changing text', () => {
  for (const [value, text, expected] of [
    ['Meet Tuesday at noon', 'tuesday', [5, 12]],
    ['İ 😀 then CAFE and café', 'café', [19, 23]],
    ['Use a+b [x].', 'a+b [x].', [4, 12]],
    ['A next B', ' next ', [1, 7]],
    ['one\ntwo', 'one\ntwo', [0, 7]],
  ]) {
    const element = field(value);
    assert.equal(select(element, text).ok, true);
    assert.deepEqual(range(element), expected, value);
    assert.equal(element.value, value);
  }
});

test('repeated phrases require an occurrence and support first, indexed and last matches', () => {
  const element = field('Tuesday then TUESDAY then Tuesday');
  assert.equal(select(element, 'Tuesday').ok, false);
  assert.deepEqual(range(element), [2, 2]);
  for (const [occurrence, expected] of [[1, [0, 7]], [2, [13, 20]], ['last', [26, 33]]]) {
    assert.equal(select(element, 'Tuesday', occurrence).ok, true);
    assert.deepEqual(range(element), expected);
  }
});

test('missing, empty or unavailable phrase choices preserve the previous selection', () => {
  for (const [text, occurrence] of [['missing', null], ['', null], ['Tuesday', 2], ['Tuesday', 0]]) {
    const element = field('Meet Tuesday');
    assert.equal(select(element, text, occurrence).ok, false);
    assert.deepEqual(range(element), [2, 2]);
    assert.equal(element.value, 'Meet Tuesday');
  }
});

test('phrase selection rechecks value and writability after focus before applying offsets', () => {
  for (const change of [element => { element.value = 'Changed by website'; }, element => { element.readOnly = true; }]) {
    const element = field('Meet Tuesday');
    element.focus = () => change(element);
    assert.equal(select(element, 'Tuesday').ok, false);
    assert.deepEqual(range(element), [2, 2]);
  }
});


test('phrase selection refuses focus redirected to another field or outside its frame', () => {
  const element = field('Meet Tuesday');
  const root = { activeElement: element };
  element.getRootNode = () => root;
  element.focus = () => { root.activeElement = field('Unrelated'); };
  assert.equal(select(element, 'Tuesday').ok, false);
  assert.deepEqual(range(element), [2, 2]);
  const framed = field('Meet Tuesday');
  const frame = field('');
  frame.getRootNode = () => ({ activeElement: {} });
  framed.ownerDocument.defaultView.frameElement = frame;
  assert.equal(select(framed, 'Tuesday').ok, false);
  assert.deepEqual(range(framed), [2, 2]);
});
