import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

// A control named clearly but far from where webcam gaze landed (beyond the ring just outside the circle) is
// found anywhere on screen; it is only used after confirmation, and a few matches become a question.
const control = (id, name, role = 'link', extra = {}) => ({ id, name, role, distance: id > 200 ? 400 : id > 100 ? 150 : 0, editable: false, consequential: false, element: { name, isConnected: true }, ...extra });
const screen = elements => { let calls = 0; const list = () => { calls++; return elements; }; list.calls = () => calls; return list; };

test('a named control far from the gaze is offered, and the screen is searched only when needed', () => {
  const onScreen = screen([control(201, 'Log in'), control(202, 'Donate')]);
  assert.deepEqual(interpret('open log in', { elements: [control(1, 'Main page')], nearby: [control(101, 'Talk')], onScreen }), { type: 'activate', targetId: 201, far: true });
  assert.deepEqual(interpret('open main page', { elements: [control(1, 'Main page')], onScreen }), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('open talk', { elements: [], nearby: [control(101, 'Talk')], onScreen }), { type: 'activate', targetId: 101, outside: true });
  assert.equal(onScreen.calls(), 1);
});

test('a bare everyday name reaches the control it means, nearby or far', () => {
  assert.deepEqual(interpret('sign in', { elements: [], nearby: [control(101, 'Log in')] }), { type: 'activate', targetId: 101, outside: true });
  assert.deepEqual(interpret('sign in', { elements: [], onScreen: screen([control(201, 'Log in')]) }), { type: 'activate', targetId: 201, far: true });
  const unheard = interpret('hello there', { elements: [], onScreen: screen([control(201, 'Log in')]) });
  assert.equal(unheard.type, 'unknown');
  assert.equal(unheard.unparsed, true, 'an assisting model can still be asked');
});

test('unnamed requests and unmatched names never reach across the screen', () => {
  const onScreen = screen([control(201, 'Delete account', 'button'), control(202, 'Help')]);
  assert.equal(interpret('click this', { elements: [], onScreen }).type, 'unknown');
  assert.equal(interpret('open something that is not there', { elements: [], onScreen }).type, 'unknown');
  assert.equal(onScreen.calls(), 1, 'only the named request looked');
});

test('two or three far matches become a numbered question; more keep the gaze message', () => {
  const asked = interpret('open read more', { elements: [], onScreen: screen([control(201, 'Read more'), control(202, 'Read more'), control(203, 'Share')]) });
  assert.equal(asked.type, 'clarify');
  assert.equal(asked.far, true);
  assert.match(asked.message, /^Not near your gaze: 1: Read more; 2: Read more\. Say a number or cancel\.$/);
  assert.deepEqual(asked.choose(2), { type: 'activate', targetId: 202 });
  const many = interpret('open read more', { elements: [], onScreen: screen([201, 202, 203, 204].map(id => control(id, 'Read more'))) });
  assert.equal(many.type, 'unknown');
  assert.match(many.message, /inside the gaze circle/);
});

test('the controller asks before using a far control, outlines it, and folds in consequences', () => {
  const log = [];
  const actions = { activate: (_, name) => { log.push(name); return { ok: true, message: `${name} activated.` }; } };
  const controller = createController({ window: {}, actions });
  const far = control(201, 'Log in'), risky = control(202, 'Delete account', 'button', { consequential: true });
  const context = { elements: [], onScreen: screen([far, risky]) };
  const asked = controller.handle('open log in', context);
  assert.equal(asked.tone, 'question');
  assert.equal(asked.message, '"Log in" is not near your gaze; it is outlined on the page. Say confirm to use it, or cancel.');
  assert.equal(controller.pending.farTarget, far);
  assert.deepEqual(log, []);
  assert.equal(controller.handle('confirm', { elements: [] }).performed, 'activate');
  assert.deepEqual(log, ['Log in']);
  assert.match(controller.handle('press delete account', context).message, /not near your gaze and may have consequences/);
  controller.handle('cancel', { elements: [] });
  assert.deepEqual(log, ['Log in']);
  assert.equal(controller.pending, null);
});

test('setting a named list or field that is outside the circle reaches it; word corrections never do', () => {
  const fruit = control(101, 'Favorite Fruit', 'combobox', { customList: true });
  assert.deepEqual(interpret('set favorite fruit to banana', { elements: [], nearby: [fruit] }), { type: 'choose-option', targetId: 101, optionName: 'banana', outside: true });
  assert.deepEqual(interpret('set favorite fruit to banana', { elements: [], onScreen: screen([{ ...fruit, id: 201 }]) }), { type: 'choose-option', targetId: 201, optionName: 'banana', far: true });
  const correction = interpret('change tuesday to friday', { elements: [], nearby: [control(101, 'Message', 'textbox', { editable: true })], onScreen: screen([control(201, 'Friday')]) });
  assert.equal(correction.type, 'unknown');
  assert.match(correction.message, /first select the text field/);
});

test('"press enter" submits the field being typed in even when the gaze has drifted from it', () => {
  const field = control(200, 'Search Wikipedia', 'searchbox', { editable: true });
  assert.deepEqual(interpret('press enter', { elements: [control(1, 'Main page')], focusedField: field }), { type: 'submit', targetId: 200 });
  // Typing still goes where the user is looking, not into the field that merely has focus.
  const looked = control(1, 'Comment', 'textbox', { editable: true });
  assert.equal(interpret('type hello', { elements: [looked], focusedField: field }).targetId, 1);
  const log = [];
  const controller = createController({ window: {}, actions: { submit: element => { log.push(element.name); return { ok: true, message: 'Submitted.' }; } } });
  assert.equal(controller.handle('press enter', { elements: [], focusedField: field }).performed, 'submit');
  assert.deepEqual(log, ['Search Wikipedia']);
});

test('a correction reaches the field being typed in when the gaze has drifted, if the words are in it', () => {
  const field = control(200, 'Search Wikipedia', 'searchbox', { editable: true, value: 'Alan Turnig' });
  const drifted = { elements: [control(1, 'Main page')], focusedField: field };
  assert.deepEqual(interpret('change Turnig to Turing', drifted), { type: 'edit', targetId: 200, edit: { kind: 'replace', find: 'Turnig', text: 'Turing' } });
  assert.deepEqual(interpret('replace Turnig with Turing', drifted), { type: 'edit', targetId: 200, edit: { kind: 'replace', find: 'Turnig', text: 'Turing' } });
  // Words that are not in the field, or a password field whose text is never read, are not corrected there.
  assert.equal(interpret('change Lovelace to Byron', drifted).type, 'unknown');
  assert.equal(interpret('change Turnig to Turing', { ...drifted, focusedField: { ...field, sensitive: true, value: '' } }).type, 'unknown');
  // A field in the circle still comes first.
  const looked = control(1, 'Comment', 'textbox', { editable: true, value: 'see Turnig' });
  assert.equal(interpret('replace Turnig with Turing', { elements: [looked], focusedField: field }).targetId, 1);
});

test('explicit continuation uses only focused text and ordinary typing stays gaze-based', () => {
  const field = control(200, 'Message', 'textbox', { editable: true });
  const looked = control(1, 'Other', 'textbox', { editable: true });
  const context = { elements: [looked], focusedField: field };
  for (const command of ['continue typing Hello there', 'keep typing Hello there', 'continue writing Hello there']) {
    assert.deepEqual(interpret(command, context), { type: 'edit', targetId: 200, edit: { kind: 'append', text: 'Hello there' }, requireFocus: true });
  }
  assert.equal(interpret('type Hello there', context).targetId, 1);
  assert.equal(interpret('continue typing Hello', { elements: [looked] }).type, 'unknown');
  assert.equal(interpret('continue typing Hello', { elements: [looked], focusedField: { ...field, sensitive: true } }).type, 'unknown');
  assert.deepEqual(interpret('undo typing', { elements: [], focusedField: field }), { type: 'edit', targetId: 200, edit: { kind: 'undo' }, requireFocus: true });
});

test('unavailable continuation is a recognized refusal, not a model target-matching request', async () => {
  const { createAssistedInterpreter } = await import('../src/web/assisted-interpreter.js');
  const assistant = createAssistedInterpreter({ model: { decide: () => { throw new Error('must not match another control'); } } });
  for (const command of ['continue typing', 'continue typing hello']) {
    const context = { elements: [control(1, 'Continue', 'button')] }, action = interpret(command, context);
    assert.equal(action.type, 'unknown'); assert.equal(assistant.needs(command, context, action), false);
  }
});
