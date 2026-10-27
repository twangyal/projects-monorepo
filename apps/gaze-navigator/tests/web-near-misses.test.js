import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

// Webcam gaze often lands 100-200 px from the intended control; a named control just outside the circle
// is still found, while unnamed requests never reach outside it.
const control = (id, name, role = 'link', extra = {}) => ({ id, name, role, distance: id > 100 ? 150 : 0, editable: false, consequential: false, element: { name, isConnected: true }, ...extra });

test('a named control just outside the circle is used and marked as outside', () => {
  const context = { elements: [control(1, 'Main page')], nearby: [control(101, 'Lord Byron'), control(102, 'Talk')] };
  assert.deepEqual(interpret('open Lord Byron', context), { type: 'activate', targetId: 101, outside: true });
});

test('a match inside the circle wins over one outside it', () => {
  const context = { elements: [control(1, 'Contact')], nearby: [control(101, 'Contact us')] };
  assert.deepEqual(interpret('open contact', context), { type: 'activate', targetId: 1 });
});

test('unnamed requests never reach outside the circle', () => {
  const context = { elements: [], nearby: [control(101, 'Delete account', 'button')] };
  assert.equal(interpret('click this', context).type, 'unknown');
  assert.equal(interpret('open something that is not there', { elements: [], nearby: [control(101, 'Help')] }).type, 'unknown');
});

test('several nearby matches become a question with small numbers', () => {
  const context = { elements: [], nearby: [control(101, 'Read more'), control(102, 'Read more'), control(103, 'Share')] };
  const asked = interpret('open read more', context);
  assert.equal(asked.type, 'clarify');
  assert.deepEqual(asked.candidates.map(candidate => [candidate.number, candidate.elementId]), [[1, 101], [2, 102]]);
  assert.match(asked.message, /nearby: 1: Read more; 2: Read more/);
  assert.deepEqual(asked.choose(2), { type: 'activate', targetId: 102 });
});

test('the controller acts on the nearby control, says where it was, and still confirms consequential ones', () => {
  const log = [];
  const actions = { activate: (element, name) => { log.push(name); return { ok: true, message: `${name} activated.` }; } };
  const controller = createController({ window: {}, actions });
  const context = { elements: [], nearby: [control(101, 'Lord Byron'), control(102, 'Delete page', 'button', { consequential: true })] };
  const done = controller.handle('open Lord Byron', context);
  assert.equal(done.tone, 'success');
  assert.match(done.message, /Lord Byron activated\. It was just outside the gaze circle\./);
  const waiting = controller.handle('press delete page', context);
  assert.equal(waiting.tone, 'question');
  assert.match(waiting.message, /^Just outside the gaze circle: .*confirm/);
  assert.deepEqual(log, ['Lord Byron']);
  controller.handle('confirm', { elements: [] });
  assert.deepEqual(log, ['Lord Byron', 'Delete page']);
});

test('clarification expires after thirty seconds and noise cannot revive it', () => {
  let clock = 0;
  const log = [];
  const controller = createController({ window: {}, now: () => clock,
    actions: { activate: (_, name) => { log.push(name); return { ok: true, message: 'Opened.' }; } } });
  const context = { elements: [], nearby: [control(101, 'Read more'), control(102, 'Read more')] };
  for (const answer of ['two', 'nine', 'murmur banana']) {
    clock = 0;
    controller.handle('open read more', context);
    clock = 30000;
    const result = controller.handle(answer, { elements: [] });
    assert.equal(result.tone, 'error');
    assert.match(result.message, /question expired.*instruction again/i);
    assert.equal(controller.pending, null);
    controller.handle('two', { elements: [] });
  }
  assert.deepEqual(log, []);
});

test('noise does not extend a question and a fresh instruction works after expiry', () => {
  let clock = 0;
  const log = [];
  const controller = createController({ window: {}, now: () => clock,
    actions: { activate: (_, name) => { log.push(name); return { ok: true, message: 'Opened.' }; } } });
  const context = { elements: [control(1, 'Help')], nearby: [control(101, 'Read more'), control(102, 'Read more')] };
  controller.handle('open read more', context);
  clock = 29999;
  assert.equal(controller.handle('murmur banana', context).tone, 'question');
  clock = 30001;
  assert.match(controller.handle('two', context).message, /expired/);
  controller.handle('open read more', context);
  clock = 60001;
  assert.equal(controller.handle('open help', context).performed, 'activate');
  assert.deepEqual(log, ['Help']);
});

test('a timely nearby choice retains consequential confirmation with its own deadline', () => {
  let clock = 0;
  const log = [];
  const controller = createController({ window: {}, now: () => clock,
    actions: { activate: (_, name) => { log.push(name); return { ok: true, message: 'Opened.' }; } } });
  const context = { elements: [], nearby: [control(101, 'Delete page', 'button', { consequential: true }), control(102, 'Delete page', 'button', { consequential: true })] };
  controller.handle('open delete page', context);
  clock = 29999;
  assert.equal(controller.handle('two', { elements: [] }).pending.kind, 'confirm');
  clock = 40000;
  assert.equal(controller.handle('confirm', { elements: [] }).performed, 'activate');
  assert.deepEqual(log, ['Delete page']);
});
