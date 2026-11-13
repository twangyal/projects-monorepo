import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/web/controller.js';

function setup() {
  let focused = null, focusEffect = null, writeEffect = null;
  const writes = [];
  const element = { value: 'Draft', isConnected: true, locked: false, sensitive: false,
    focus() { if (focused === element) return; focused = element; const run = focusEffect; focusEffect = null; run?.(); } };
  const target = { id: 1, element, name: 'Message', role: 'textbox', editable: true, distance: 0 };
  const controller = createController({ window: {}, actions: {
    canWrite: e => !e.locked, isSensitive: e => e.sensitive, ownsFocus: e => e === focused,
    readValue: e => e.value,
    writeValue(e, value) { e.focus(); e.value = value; writes.push(value); writeEffect?.(); },
  } });
  const context = { elements: [target] };
  return { controller, element, target, context, writes,
    onFocus(effect) { focused = null; focusEffect = effect; }, redirect() { focused = {}; },
    onWrite(effect) { writeEffect = effect; } };
}

for (const effect of ['lock', 'detach', 'redirect', 'value', 'protect', 'cancel']) test(`ordinary editing refuses a focus-time ${effect} before writing`, () => {
  const page = setup();
  page.onFocus(() => {
    if (effect === 'lock') page.element.locked = true;
    if (effect === 'detach') page.element.isConnected = false;
    if (effect === 'redirect') page.redirect();
    if (effect === 'value') page.element.value = 'Website update';
    if (effect === 'protect') page.element.sensitive = true;
    if (effect === 'cancel') page.controller.cancel();
  });
  const result = page.controller.handle('type hello', page.context);
  assert.equal(result.tone, 'error'); assert.deepEqual(page.writes, []);
  assert.equal(page.element.value, effect === 'value' ? 'Website update' : 'Draft');
});

test('focus-time refusal never consumes typing Undo', () => {
  const page = setup(); page.controller.handle('type hello', page.context);
  page.onFocus(() => { page.element.locked = true; });
  assert.equal(page.controller.handle('undo typing', page.context).tone, 'error');
  page.element.locked = false;
  page.controller.handle('undo typing', page.context);
  assert.equal(page.element.value, 'Draft'); assert.deepEqual(page.writes, ['Draft hello', 'Draft']);
});

test('protected typing stays available but feedback rechecks protection after page input events', () => {
  const page = setup(); page.element.sensitive = true; page.target.sensitive = true;
  const protectedReply = page.controller.handle('type secret', page.context);
  assert.equal(page.element.value, 'Draft secret'); assert.match(protectedReply.message, /hidden/);
  assert.ok(!protectedReply.message.includes('secret'));
  const changed = setup(); changed.onWrite(() => { changed.element.sensitive = true; });
  const reply = changed.controller.handle('type secret', changed.context);
  assert.ok(!reply.message.includes('secret')); assert.match(reply.message, /hidden/);
});
