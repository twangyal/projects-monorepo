import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const control = (id, name, role = 'button', distance = id * 10) => ({ id, name, role, distance });
const page = { elements: [control(1, 'Submit'), control(2, 'Sign in', 'link'), control(3, 'Cart', 'link'), control(4, 'Checkout'), { id: 5, name: 'Search', role: 'searchbox', editable: true, distance: 50 }] };
const offered = (said, context = page) => interpret(said, context).alike;

test('a name that sounds like a control in the circle is offered, never used directly', () => {
  for (const [said, id] of [['click signing', 2], ['open card', 3], ['click check out', 4], ['press summit', 1]]) {
    const action = interpret(said, page);
    assert.equal(action.type, 'unknown', said);
    assert.equal(action.alike?.targetId, id, said);
  }
  // Too short, too different, or two controls equally close: nothing is offered.
  assert.equal(offered('click man'), undefined);
  assert.equal(offered('click many'), undefined);
  assert.equal(offered('open the stuff about cars'), undefined);
  assert.equal(offered('click card', { elements: [control(1, 'Cart', 'link'), control(2, 'Card', 'link')] }), undefined, 'Card itself matches');
  assert.equal(offered('click carp', { elements: [control(1, 'Cart', 'link'), control(2, 'Card', 'link')] }), undefined, 'a tie');
  // A control named exactly, just outside the circle, comes before one that only sounds alike inside it.
  const near = interpret('click sign up', { elements: [control(1, 'Sign in', 'link')], nearby: [control(101, 'Sign up', 'link', 90)] });
  assert.equal(near.targetId, 101);
});

test('commonly misheard command words are corrected and offered; scrolling and cancelling just happen', () => {
  assert.deepEqual(offered('quick submit'), { type: 'activate', targetId: 1, heardAs: 'click submit' });
  assert.deepEqual(offered('dress submit'), { type: 'activate', targetId: 1, heardAs: 'press submit' });
  // ("Bag" is an everyday name for a cart, so this page has none.)
  assert.deepEqual(offered('go bag', { elements: [control(1, 'Submit')] }), { type: 'back', heardAs: 'go back' });
  assert.equal(offered('tight hello').heardAs, 'type hello');
  // Dictated words keep their capitals and punctuation.
  assert.deepEqual(offered('Tight Ada Lovelace.').edit, { kind: 'append', text: 'Ada Lovelace.' });
  for (const said of ['school down', 'scroll town', 'scrawl down']) assert.equal(interpret(said, page).type, 'scroll', said);
  assert.equal(interpret('cancer', page).type, 'cancel');
  // Words understood as heard are left alone, and a correction that names nothing is not offered.
  assert.equal(interpret('click submit', page).type, 'activate');
  assert.equal(offered('quick links'), undefined);
});

test('the offer is outlined and done only after a yes; cancel leaves the page alone', () => {
  const clicks = [];
  const element = { isConnected: true, name: 'Submit' };
  const actions = { activate: (target, name) => { clicks.push(name); return { ok: true, message: `${name} activated.` }; } };
  const controller = createController({ window: {}, interpret, actions });
  const context = { elements: [{ ...control(1, 'Submit'), element }] };
  const asked = controller.handle('quick submit', context);
  assert.equal(asked.tone, 'question');
  assert.match(asked.message, /^Did you mean "click submit"\?/);
  assert.equal(controller.pending.kind, 'confirm');
  assert.ok(controller.pending.farTarget, 'the control is outlined');
  assert.equal(controller.handle('cancel', context).message, 'Cancelled. Nothing was changed.');
  const named = controller.handle('click summit', context);
  assert.match(named.message, /^Did you mean "Submit"\?/);
  assert.deepEqual(clicks, []);
  const done = controller.handle('confirm', context);
  assert.equal(done.message, 'Submit activated.');
  assert.deepEqual(clicks, ['Submit']);
});

test('when the first reading is not understood, the recogniser\'s first understood reading is used', () => {
  const used = [];
  const element = name => ({ isConnected: true, name });
  const actions = { activate: (target, name) => { used.push(name); return { ok: true, message: `${name} activated.` }; } };
  const controller = createController({ window: {}, interpret, actions });
  const context = { elements: [{ ...control(1, 'Sign in', 'link'), element: element('Sign in') }, { ...control(2, 'Sign up', 'link'), element: element('Sign up') }] };
  // An understood reading comes before an offer by sound, and the reply says which reading was used.
  const done = controller.handle('click signing', context, { alternatives: ['click sign in', 'quick sign in'] });
  assert.equal(done.message, 'Heard "click sign in". Sign in activated.');
  // The first reading wins when it is understood.
  assert.equal(controller.handle('click sign up', context, { alternatives: ['click sign in'] }).message, 'Sign up activated.');
  assert.deepEqual(used, ['Sign in', 'Sign up']);
  // With no understood reading, an offer by sound from the first reading still asks.
  assert.equal(controller.handle('click signing', context, { alternatives: ['quick signing'] }).tone, 'question');
  controller.handle('cancel', context);
  // Noise in every reading is still not understood.
  assert.equal(controller.handle('hmm', context, { alternatives: ['um', 'mm'] }).tone, 'error');
});
