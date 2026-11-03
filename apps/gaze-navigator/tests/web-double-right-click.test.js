import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const item = (id, name, extra = {}) => ({ id, role: 'link', name, distance: id === 1 ? 0 : 20, editable: false, ...extra });
const files = { elements: [item(1, 'Report.pdf'), item(2, 'Photos'), item(3, 'Delete', { role: 'button', consequential: true })] };

test('double-clicks and right-clicks are read from speech, by name or where the gaze is', () => {
  for (const say of ['double click report.pdf', 'double-click on report.pdf', 'double tap report.pdf']) assert.deepEqual(interpret(say, files), { type: 'double-click', targetId: 1 }, say);
  for (const say of ['right click photos', 'right-click on photos', 'open the menu for photos', 'show the context menu for photos']) {
    assert.deepEqual(interpret(say, files), { type: 'context-menu', targetId: 2 }, say);
  }
  assert.deepEqual(interpret('double click this', files), { type: 'double-click', targetId: 1 });
  assert.deepEqual(interpret('right click here', files), { type: 'context-menu', targetId: 1 });
  assert.equal(interpret('right click the careers page', files).type, 'unknown');
});

test('a double-click on a consequential control is confirmed first; a right-click is not', () => {
  const log = [];
  const node = name => ({ name, isConnected: true });
  const actions = {
    doubleClick: (element, name) => { log.push(['double', name]); return { ok: true, message: `Double-clicked ${name}.` }; },
    contextMenu: (element, name) => { log.push(['menu', name]); return { ok: true, message: `Opened the page's menu for ${name}.` }; },
  };
  const controller = createController({ window: {}, actions });
  const context = { elements: files.elements.map(element => ({ ...element, element: node(element.name) })) };
  assert.equal(controller.handle('right click delete', context).message, "Opened the page's menu for Delete.");
  assert.equal(controller.handle('double click delete', context).tone, 'question');
  assert.deepEqual(log, [['menu', 'Delete']]);
  assert.equal(controller.handle('confirm', context).message, 'Double-clicked Delete.');
});
