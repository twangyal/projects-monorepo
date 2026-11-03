import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

function page() {
  const log = [];
  const actions = {
    activate: (element, name) => { log.push(['activate', name]); return { ok: true, message: `${name} activated.` }; },
    scroll: (region, direction) => { log.push(['scroll', region?.id ?? 'page', direction]); return { ok: true, message: `Scrolled ${direction}.` }; },
    navigate: (window, type) => { log.push([type]); return { ok: true, message: type === 'back' ? 'Went back.' : 'Went forward.' }; },
  };
  return { log, actions };
}
const control = (id, name, extra = {}) => ({ id, name, role: 'button', distance: 0, element: { isConnected: true, name }, ...extra });

test('"again" repeats the last scroll in the same place, wherever the gaze is now', () => {
  const { log, actions } = page();
  let clock = 0;
  const controller = createController({ window: {}, interpret, actions, now: () => clock });
  const list = { id: 'list', isConnected: true };
  assert.equal(controller.handle('again', { elements: [] }).message, 'There is nothing to do again. Say the instruction itself.');
  controller.handle('scroll down', { elements: [], region: list, pageRegion: null });
  for (const said of ['again', 'do that again', 'once more', 'repeat']) controller.handle(said, { elements: [], region: null });
  assert.deepEqual(log, Array(5).fill(['scroll', 'list', 'down']));
  // After two minutes, or when the list has gone, nothing is repeated.
  clock = 121000;
  assert.match(controller.handle('again', { elements: [] }).message, /nothing to do again/);
  controller.handle('scroll down', { elements: [], region: list, pageRegion: null });
  list.isConnected = false;
  assert.match(controller.handle('again', { elements: [] }).message, /no longer on the page/);
});

test('"again" presses an ordinary control again and goes back again, but never repeats a consequential press', () => {
  const { log, actions } = page();
  const controller = createController({ window: {}, interpret, actions });
  const next = control(1, 'Next slide'), buy = control(2, 'Buy now', { consequential: true });
  controller.handle('click next slide', { elements: [next] });
  controller.handle('again', { elements: [] });
  assert.deepEqual(log, [['activate', 'Next slide'], ['activate', 'Next slide']]);
  controller.handle('go back', { elements: [] });
  controller.handle('again', { elements: [] });
  assert.deepEqual(log.slice(2), [['back'], ['back']]);
  // A consequential press is confirmed and done once; "again" then repeats the going back, not the purchase.
  controller.handle('click buy now', { elements: [buy] });
  controller.handle('confirm', { elements: [buy] });
  assert.deepEqual(log.at(-1), ['activate', 'Buy now']);
  controller.handle('again', { elements: [] });
  assert.deepEqual(log.at(-1), ['back']);
});
