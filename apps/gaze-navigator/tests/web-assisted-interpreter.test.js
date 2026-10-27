import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistedInterpreter, describeElement, INTENT_QUESTION, NONE_OPTION, TARGET_QUESTION } from '../src/web/assisted-interpreter.js';
import { CONTEXTS } from '../src/web/instruction-suite.js';

// A scripted model: probabilities by option text, and a fixed "uses a control" answer.
function scripted(byName = {}, intent = 0) {
  const calls = [];
  return {
    calls,
    async decide(state, question, options) {
      calls.push({ kind: 'decide', state, question, options });
      const raw = options.map(option => Object.entries(byName).find(([name]) => option.includes(`"${name}"`))?.[1] ?? (option === NONE_OPTION ? byName.none ?? 0.01 : 0.01));
      const sum = raw.reduce((a, b) => a + b, 0);
      return { probs: raw.map(value => value / sum) };
    },
    async yes(state, question) { calls.push({ kind: 'yes', state, question }); return intent; },
  };
}

test('a named target the rules could not match is picked by the model only when it is confident', async () => {
  const model = scripted({ Reviews: 9 });
  const interpret = createAssistedInterpreter({ model });
  const action = await interpret('open the customer reviews', CONTEXTS.product);
  assert.deepEqual({ ...action, assisted: undefined }, { type: 'activate', targetId: 4, assisted: undefined });
  assert.equal(action.assisted.by, 'watersheep');
  assert.equal(model.calls[0].question, TARGET_QUESTION);
  assert.deepEqual(model.calls[0].options, ['dropdown "Format", choices: Paperback, Hardcover, Large print, Audiobook', 'button "Add to cart"',
    'button "Place order"', 'link "Reviews"', NONE_OPTION]);
  // A split answer becomes a numbered question about the likeliest controls; a weak one keeps the rule answer.
  const split = await createAssistedInterpreter({ model: scripted({ 'Add to cart': 4.5, 'Place order': 4 }) })('open the purchase thing', CONTEXTS.product);
  assert.equal(split.type, 'clarify');
  assert.deepEqual(split.candidates.map(candidate => candidate.elementId), [2, 3]);
  assert.deepEqual(split.choose(3), { type: 'activate', targetId: 3 });
  const weak = await createAssistedInterpreter({ model: scripted({ none: 9 }) })('open the purchase thing', CONTEXTS.product);
  assert.equal(weak.type, 'unknown');
});

test('unparsed phrases need a confident "uses a control" answer first, so safety-like phrases never press anything', async () => {
  const cautious = scripted({ 'Place order': 9 }, 0.2);
  assert.equal((await createAssistedInterpreter({ model: cautious })('hang on', CONTEXTS.product)).type, 'unknown');
  assert.deepEqual(cautious.calls.map(call => call.kind), ['yes'], 'no pick is requested');
  assert.equal(cautious.calls[0].question, INTENT_QUESTION);
  const willing = scripted({ 'Place order': 9 }, 0.95);
  const bought = await createAssistedInterpreter({ model: willing })('buy it now', CONTEXTS.product);
  assert.equal(bought.type, 'activate'); assert.equal(bought.targetId, 3);
  // Rule-handled instructions never reach the model.
  for (const say of ['cancel', 'pause', 'confirm', 'two', 'type hello', 'scroll down', 'go back', 'open pricing']) {
    const model = scripted({ Home: 9 }, 1);
    await createAssistedInterpreter({ model })(say, CONTEXTS.navigation);
    assert.equal(model.calls.length, 0, say);
  }
});

test('the model only breaks ties between the controls the rules proposed, keeping their action', async () => {
  const send = await createAssistedInterpreter({ model: scripted({ 'Send message': 9 }) })('click send', CONTEXTS.form);
  assert.deepEqual({ type: send.type, targetId: send.targetId }, { type: 'activate', targetId: 6 });
  // Identical names cannot be told apart, so the rules' numbered question stays.
  const readMore = await createAssistedInterpreter({ model: scripted({ 'Read more': 1 }) })('read more', CONTEXTS.list);
  assert.equal(readMore.type, 'clarify');
  assert.deepEqual(readMore.candidates.map(candidate => candidate.elementId), [1, 2, 3]);
  assert.equal(readMore.assisted, undefined);
  // Even a confident model may not pick between identically described controls (measured: "click remove").
  const confident = scripted({ Remove: 9 });
  const remove = await createAssistedInterpreter({ model: confident })('click remove', CONTEXTS.list);
  assert.equal(remove.type, 'clarify');
  assert.equal(confident.calls.length, 0);
});

test('a role word without an activation verb is not a request to name a control', async () => {
  // Measured: "put Ada in the name field" focused the field instead of typing. Without a verb it must pass the intent gate.
  const model = scripted({ 'Your name': 9 }, 0.1);
  const action = await createAssistedInterpreter({ model })('put Ada in the name field', CONTEXTS.form);
  assert.equal(action.type, 'unknown');
  assert.deepEqual(model.calls.map(call => call.kind), ['yes']);
});

test('only roles, names, checked state and choices are sent, and model failures keep the rule answer', async () => {
  const model = scripted({ Message: 9 }, 0.9);
  await createAssistedInterpreter({ model })('open the note thing', CONTEXTS.form);
  assert.ok(model.calls.every(call => !JSON.stringify(call).includes('Tuesday')), 'field values stay on the page');
  assert.equal(describeElement(CONTEXTS.form.elements[3]), 'checkbox "Send me a copy", not checked');
  const broken = { decide: async () => { throw new Error('model missing'); }, yes: async () => 1 };
  assert.equal((await createAssistedInterpreter({ model: broken })('open the customer reviews', CONTEXTS.product)).type, 'unknown');
  const malformed = { decide: async () => ({ probs: [2, -1] }), yes: async () => 1 };
  assert.equal((await createAssistedInterpreter({ model: malformed })('open the customer reviews', CONTEXTS.product)).type, 'unknown');
});

test('a request to choose never just opens a dropdown, and word corrections need a focused field', async () => {
  // Measured on the second held-out suite: "choose the audio version" opened the Format dropdown.
  const model = scripted({ Format: 9 });
  const action = await createAssistedInterpreter({ model })('choose the audio version', CONTEXTS.product);
  assert.notEqual(action.type, 'activate');
  assert.equal((await createAssistedInterpreter({ model: scripted({ Topic: 9 }) })('open the topic list', CONTEXTS.form)).type, 'activate');
  // "set the subject to …" with nothing focused no longer rewrites the gazed name field.
  const { interpret } = await import('../src/web/interpreter.js');
  assert.equal(interpret('set the subject to book suggestion', CONTEXTS.form).type, 'unknown');
  assert.deepEqual(interpret('change Tuesday to Friday', CONTEXTS.focused), { type: 'edit', targetId: 3, edit: { kind: 'replace', find: 'Tuesday', text: 'Friday' } });
});

// A model that finds none of the circle's controls meant, and weighs those outside by `outside` (by name).
function staged(outside) {
  const calls = [];
  return {
    calls,
    async decide(state, question, options) {
      calls.push({ options });
      const named = options.map(option => Object.entries(outside).find(([name]) => option.includes(`"${name}"`))?.[1] ?? 0);
      if (!named.some(Boolean)) return { probs: options.map(option => (option === NONE_OPTION ? 0.96 : 0.04 / (options.length - 1))) };
      const sum = named.reduce((a, b) => a + b, 0) + 1;
      return { probs: options.map((option, i) => (option === NONE_OPTION ? 1 : named[i]) / sum) };
    },
    async yes() { return 0; },
  };
}

test('when none of the circle\'s controls is meant, those just outside it are asked about, picked as outside, with small numbers', async () => {
  const link = (id, name) => ({ id, name, role: 'link', distance: id > 100 ? 150 : 0, element: { isConnected: true } });
  const context = { elements: [link(1, 'Benefits'), link(2, 'Money and tax')], nearby: [link(101, 'Driving and transport'), link(102, 'Passports')] };
  const model = staged({ 'Driving and transport': 40 });
  // A phrase with no topic words, which the rules alone cannot place.
  const picked = await createAssistedInterpreter({ model })('take me to the bit about getting around', context);
  assert.deepEqual({ ...picked, assisted: undefined }, { type: 'activate', targetId: 101, outside: true, assisted: undefined });
  assert.deepEqual(model.calls.map(call => call.options), [['link "Benefits"', 'link "Money and tax"', NONE_OPTION], ['link "Driving and transport"', 'link "Passports"', NONE_OPTION]]);
  // A control in the circle that is meant is picked without looking outside.
  const near = scripted({ 'Money and tax': 9 });
  assert.equal((await createAssistedInterpreter({ model: near })('take me to the tax stuff', context)).targetId, 2);
  assert.equal(near.calls.length, 1);
  const split = await createAssistedInterpreter({ model: staged({ 'Driving and transport': 4.5, Passports: 4 }) })('take me to the bit about getting around', context);
  assert.equal(split.type, 'clarify');
  assert.equal(split.outside, true);
  assert.deepEqual(split.candidates.map(candidate => [candidate.number, candidate.elementId]), [[1, 101], [2, 102]]);
  assert.match(split.message, /^Did you mean 1: Driving and transport; 2: Passports\?/);
  assert.deepEqual(split.choose(1), { type: 'activate', targetId: 101, outside: true });
  // Words for the topic let the rules find the section themselves; outside the circle they only offer it.
  const offered = await createAssistedInterpreter({ model: staged({}) })('take me to the stuff about cars', context);
  assert.deepEqual({ ...offered, assisted: undefined }, { type: 'activate', targetId: 101, related: true, far: true, assisted: undefined });
  // An empty circle with controls just outside still gets help.
  const empty = await createAssistedInterpreter({ model: staged({ Passports: 40 }) })('take me to the travel documents', { elements: [], nearby: context.nearby });
  assert.equal(empty.targetId, 102);
});
