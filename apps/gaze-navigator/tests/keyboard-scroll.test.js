import test from 'node:test';
import assert from 'node:assert/strict';
import { setupKeyboard } from '../src/keyboard.js';
import { element } from '../test-support/dom.js';

function harness() {
  const ids = ['textKeyboard', 'keyboardKeys', 'keyboardTitle', 'keyboardPreview', 'keyboardCaps', 'closeKeyboard', 'keyboardUp', 'keyboardDown', 'searchInput', 'draftSubject', 'draftBody', 'editSearch', 'editSubject', 'editBody', 'composer'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const moves = [];
  let changes = 0;
  nodes.keyboardKeys.clientHeight = 180;
  nodes.keyboardKeys.scrollBy = options => moves.push(options);
  const document = { querySelector: selector => nodes[selector.slice(1)], createElement: element };
  setupKeyboard(document, () => { changes++; });
  return { nodes, moves, changes: () => changes };
}

test('gaze keyboard controls scroll the key grid without changing the edited text', () => {
  const app = harness();
  app.nodes.searchInput.value = 'calibration';
  app.nodes.editSearch.click();
  app.nodes.keyboardDown.click();
  app.nodes.keyboardUp.click();
  assert.deepEqual(app.moves, [{ top: 118, behavior: 'auto' }, { top: -118, behavior: 'auto' }]);
  assert.equal(app.changes(), 3, 'opening and each scroll clear pending navigation dwell');
  assert.equal(app.nodes.searchInput.value, 'calibration');
});

test('opening another field returns to the first keyboard row', () => {
  const app = harness();
  app.nodes.editSearch.click();
  app.nodes.keyboardKeys.scrollTop = 200;
  app.nodes.editSubject.click();
  assert.equal(app.nodes.keyboardKeys.scrollTop, 0);
  assert.match(app.nodes.keyboardTitle.textContent, /draft subject/);
});
