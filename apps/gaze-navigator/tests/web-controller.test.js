import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/web/controller.js';

function fakePage() {
  const log = [];
  const values = new Map();
  const node = name => ({ name, isConnected: true });
  const actions = {
    activate: (element, name) => { log.push(['activate', name]); return { ok: true, message: `${name} activated.` }; },
    submit: element => { log.push(['submit', element.name]); return { ok: true, message: 'Form submitted.' }; },
    selectOption: (element, index) => { log.push(['option', index]); return { ok: true, message: 'selected' }; },
    scroll: (region, direction) => { log.push(['scroll', region, direction]); return { ok: true, message: `scrolled ${direction}` }; },
    navigate: (window, direction) => { log.push([direction]); return { ok: true, message: direction }; },
    readValue: element => values.get(element) ?? '',
    writeValue: (element, value) => { log.push(['write', element.name, value]); values.set(element, value); },
  };
  return { log, values, actions, node };
}

const describe = (id, element, extra = {}) => ({ id, element, name: element.name, role: 'button', distance: id === 1 ? 0 : 20, editable: false, consequential: false, ...extra });

test('ordinary actions run immediately; consequential ones wait for confirmation', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Pricing'), { role: 'link' }), describe(2, page.node('Delete account'), { consequential: true })], region: 'page' };
  assert.equal(controller.handle('open pricing', context).performed, 'activate');
  const waiting = controller.handle('delete account', context);
  assert.equal(waiting.tone, 'question');
  assert.deepEqual(waiting.pending, { kind: 'confirm', candidates: null });
  assert.equal(page.log.length, 1, 'nothing ran before confirmation');
  assert.equal(controller.handle('confirm', { elements: [] }).performed, 'activate');
  assert.deepEqual(page.log.at(-1), ['activate', 'Delete account']);
});

test('denying, cancelling, rephrasing or waiting too long never performs the pending action', () => {
  const page = fakePage();
  let clock = 0;
  const controller = createController({ window: {}, actions: page.actions, now: () => clock, confirmMs: 1000 });
  const context = { elements: [describe(1, page.node('Place order'), { consequential: true }), describe(2, page.node('Help'))] };
  for (const answer of ['no', 'cancel', 'open help']) {
    controller.handle('place order', context);
    controller.handle(answer, context);
    controller.handle('yes', context);
  }
  assert.deepEqual(page.log, [['activate', 'Help']], 'a new instruction replaces the confirmation');
  controller.handle('place order', context);
  clock = 1001;
  assert.match(controller.handle('confirm', context).message, /expired/);
  assert.deepEqual(page.log, [['activate', 'Help']]);
});

test('clarification accepts only offered numbers and then performs the chosen action', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Read more'), { role: 'link' }), describe(2, page.node('Read more'), { role: 'link' }), describe(3, page.node('Contact'))] };
  const asked = controller.handle('read more', context);
  assert.equal(asked.pending.kind, 'clarify');
  assert.match(controller.handle('3', { elements: [] }).message, /Say one of 1, 2/);
  const done = controller.handle('two', { elements: [] });
  assert.equal(done.performed, 'activate');
  assert.equal(page.log.length, 1);
  assert.equal(controller.pending, null);
});

test('a clarified consequential choice still needs confirmation', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Remove item'), { consequential: true }), describe(2, page.node('Remove item'), { consequential: true })] };
  controller.handle('remove item', context);
  assert.equal(controller.handle('1', { elements: [] }).pending.kind, 'confirm');
  assert.equal(page.log.length, 0);
  controller.handle('yes', { elements: [] });
  assert.equal(page.log.length, 1);
});

test('pause blocks every action except resume and cancel', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Pricing'))], region: 'page' };
  assert.equal(controller.handle('pause', context).paused, true);
  for (const said of ['open pricing', 'scroll down', 'go back', '1']) assert.match(controller.handle(said, context).message, /Paused/);
  assert.equal(page.log.length, 0);
  controller.handle('resume', context);
  controller.handle('scroll down', context);
  assert.deepEqual(page.log, [['scroll', 'page', 'down']]);
});

test('field edits keep an undo history and report impossible corrections', () => {
  const page = fakePage();
  const field = page.node('Message');
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, field, { role: 'textbox', editable: true })], focusedId: 1 };
  controller.handle('type see you Tuesday', context);
  controller.handle('replace Tuesday with Friday', context);
  assert.equal(page.values.get(field), 'see you Friday');
  assert.match(controller.handle('replace Monday with Sunday', context).message, /"Monday" was not found in Message/);
  controller.handle('undo', context);
  assert.equal(page.values.get(field), 'see you Tuesday');
  controller.handle('undo', context);
  assert.equal(page.values.get(field), '');
  assert.match(controller.handle('undo', context).message, /Nothing to undo/);
});

test('search writes the query and submits without confirmation; other submits confirm', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const search = describe(0, page.node('Search books'), { role: 'searchbox', editable: true });
  const message = describe(1, page.node('Message'), { role: 'textbox', editable: true });
  const result = controller.handle('search for river', { elements: [message], pageSearch: search, focusedId: 1 });
  assert.equal(result.message, 'Searching for "river".');
  assert.deepEqual(page.log, [['write', 'Search books', 'river'], ['submit', 'Search books']]);
  assert.equal(controller.handle('submit', { elements: [message], focusedId: 1 }).pending.kind, 'confirm');
});

test('removed elements are not acted on', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const gone = { ...page.node('Pricing'), isConnected: false };
  assert.match(controller.handle('open pricing', { elements: [describe(1, gone)] }).message, /no longer on the page/);
  assert.equal(page.log.length, 0);
});

test('numbers without a question pick the numbered element; confirm without a question is explained', () => {
  const page = fakePage();
  const controller = createController({ window: {}, actions: page.actions });
  const context = { elements: [describe(1, page.node('Home')), describe(2, page.node('Help'))] };
  controller.handle('number 2', context);
  assert.deepEqual(page.log, [['activate', 'Help']]);
  assert.match(controller.handle('7', context).message, /no number 7/);
  assert.match(controller.handle('yes', context).message, /nothing waiting/);
});

test('tracking commands are delegated, work while paused, and clear pending questions', () => {
  const page = fakePage();
  const calls = [];
  const controller = createController({ window: {}, actions: page.actions, commands: {
    tracking: source => { calls.push(source); return { ok: true, message: `Using ${source}.` }; },
    calibrate: () => { calls.push('calibrate'); return { ok: false, message: 'Turn the camera on first.' }; },
  } });
  const context = { elements: [describe(1, page.node('Delete'), { consequential: true })] };
  controller.handle('delete', context);
  controller.handle('pause', context);
  assert.equal(controller.handle('stop camera', context).message, 'Using pointer.');
  assert.equal(controller.handle('recalibrate', context).tone, 'error');
  controller.handle('resume', context);
  assert.match(controller.handle('confirm', context).message, /nothing waiting/);
  assert.deepEqual(calls, ['pointer', 'calibrate']);
  assert.equal(page.log.length, 0);
  assert.equal(createController({ window: {}, actions: page.actions }).handle('use camera', context).tone, 'error');
});

test('a model-assisted answer follows only while it is still the latest instruction, and still confirms', async () => {
  const page = fakePage();
  let release;
  const assistant = {
    needs: (_utterance, _context, action) => action.type === 'unknown',
    improve: (_utterance, context) => new Promise(resolve => { release = () => resolve({ type: 'activate', targetId: context.elements[0].id }); }),
  };
  const controller = createController({ window: {}, actions: page.actions, assistant });
  const context = { elements: [describe(1, page.node('Reviews'), { role: 'link' }), describe(2, page.node('Place order'), { consequential: true })] };
  // The rules alone cannot name "the ratings": the controller says so and waits for the assistant.
  const first = controller.handle('show the ratings', context);
  assert.equal(first.assisting, true);
  assert.equal(page.log.length, 0);
  release();
  assert.equal((await first.followUp).performed, 'activate');
  assert.deepEqual(page.log.at(-1), ['activate', 'Reviews']);
  // A newer instruction (here cancel) makes the pending answer stale: nothing runs.
  const stale = controller.handle('show the ratings', context);
  controller.handle('cancel', { elements: [] });
  release();
  assert.equal(await stale.followUp, null);
  assert.equal(page.log.length, 1);
  // Pausing drops it as well.
  const paused = controller.handle('show the ratings', context);
  controller.handle('pause', { elements: [] });
  release();
  assert.equal(await paused.followUp, null);
  controller.handle('resume', { elements: [] });
  // Consequential picks still wait for confirmation.
  const consequential = { elements: [describe(2, page.node('Place order'), { consequential: true })] };
  const buy = controller.handle('complete my purchase', consequential);
  release();
  const asked = await buy.followUp;
  assert.equal(asked.tone, 'question');
  assert.deepEqual(asked.pending, { kind: 'confirm', candidates: null });
  assert.equal(page.log.length, 1, 'nothing ran before confirmation');
  // A failing assistant keeps the rule answer.
  const failing = createController({ window: {}, actions: page.actions, assistant: { needs: () => true, improve: () => Promise.reject(new Error('down')) } });
  assert.equal((await failing.handle('show the ratings', context).followUp).tone, 'error');
});
