import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, topicScore } from '../src/web/interpreter.js';
import { relatedWords } from '../src/web/topics.js';

const link = (id, name) => ({ id, name, role: 'link', distance: id === 1 ? 0 : 10 * id, editable: false });
// The topic links of GOV.UK's home page, as a circle might hold them.
const govuk = { elements: [link(1, 'Driving and transport'), link(2, 'Passports, travel and living abroad'), link(3, 'Childcare and parenting'),
  link(4, 'Working, jobs and pensions'), link(5, 'Money and tax'), link(6, 'Education and learning')] };

test('everyday words for a topic find the section a site names differently', () => {
  for (const said of ['take me to the stuff about cars', 'open cars', 'show me information on vehicles', 'open the motoring stuff']) {
    assert.deepEqual(interpret(said, govuk), { type: 'activate', targetId: 1, related: true }, said);
  }
  assert.deepEqual(interpret('open the things about holidays', govuk), { type: 'activate', targetId: 2, related: true });
  assert.deepEqual(interpret('take me to the bit about kids', govuk), { type: 'activate', targetId: 3, related: true });
  assert.deepEqual(interpret('open careers', govuk), { type: 'activate', targetId: 4, related: true });
  assert.deepEqual(interpret('open the stuff about schools', govuk), { type: 'activate', targetId: 6, related: true });
});

test('the words a control says win over related words, and plain names behave as before', () => {
  assert.deepEqual(interpret('open money', govuk), { type: 'activate', targetId: 5 });
  assert.deepEqual(interpret('open jobs', govuk), { type: 'activate', targetId: 4 });
  // "Cars" is related to driving, but a control called Cars says it.
  assert.deepEqual(interpret('open cars', { elements: [link(1, 'Driving'), link(2, 'Cars')] }), { type: 'activate', targetId: 2 });
  assert.deepEqual(interpret('take me to the stuff about cars', { elements: [link(1, 'Driving'), link(2, 'Cars')] }), { type: 'activate', targetId: 2 });
});

test('two sections for the same topic become a question, and unrelated requests still name nothing', () => {
  const shop = { elements: [link(1, 'Trains'), link(2, 'Buses'), link(3, 'Gift cards')] };
  assert.deepEqual(interpret('open the stuff about transport', shop).candidates.map(candidate => candidate.label), ['Trains', 'Buses']);
  for (const said of ['open the stuff about weddings', 'open settings', 'open the stuff about everything']) {
    assert.notEqual(interpret(said, govuk).type, 'activate', said);
  }
});

test('words that are common in unrelated link text are never related', () => {
  const page = { elements: [link(1, 'Learn more'), link(2, 'Show more'), link(3, 'How it works'), link(4, 'Privacy policy'), link(5, 'Back to top'), link(6, 'Pay now')] };
  for (const said of ['open the stuff about schools', 'open movies', 'open careers', 'open politics', 'open clothes', 'open money']) {
    assert.notEqual(interpret(said, page).type, 'activate', said);
  }
  for (const word of ['learn', 'show', 'work', 'policy', 'top', 'pay', 'home', 'new']) assert.equal(relatedWords(word).size, 0, word);
});

test('a control found only by topic outside the circle is offered for confirmation, not used', () => {
  const outside = interpret('take me to the stuff about cars', { elements: [link(1, 'Contact')], nearby: [link(101, 'Driving and transport')] });
  assert.deepEqual(outside, { type: 'activate', targetId: 101, related: true, far: true });
  const named = interpret('open driving', { elements: [link(1, 'Contact')], nearby: [link(101, 'Driving and transport')] });
  assert.deepEqual(named, { type: 'activate', targetId: 101, outside: true });
});

test('topic scores credit related words below the words a control says', () => {
  assert.equal(topicScore('cars', 'Cars'), 0, 'plain matching covers a word the control says');
  assert.ok(topicScore('cars', 'Driving and transport') > 0.5);
  assert.ok(topicScore('cars', 'Driving and transport') < 0.7);
  assert.equal(topicScore('stuff about', 'Driving and transport'), 0);
});
