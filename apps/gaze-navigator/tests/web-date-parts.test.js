import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const box = (id, name, parts) => ({ id, name, role: 'textbox', distance: id === 1 ? 0 : 20, editable: true, ...(parts ? { dateParts: parts } : {}) });
const now = new Date('2026-11-02T12:00:00');

test('a spoken date typed into a Day, Month and Year group fills all three; other words are typed as said', () => {
  const parts = { legend: 'When was your passport issued?' };
  const context = { now, elements: [box(1, 'Day', parts), box(2, 'Month', parts), box(3, 'Year', parts)] };
  for (const said of ['type 12 March 2019', 'type the twelfth of march twenty nineteen', 'set it to March 12th 2019']) {
    assert.deepEqual(interpret(said, context), { type: 'date-parts', targetId: 1, value: '2019-03-12' }, said);
  }
  assert.deepEqual(interpret('type 12', context), { type: 'edit', targetId: 1, edit: { kind: 'append', text: '12' } });
  // A field outside such a group types the words as said.
  assert.deepEqual(interpret('type 12 March 2019', { now, elements: [box(1, 'Notes')] }), { type: 'edit', targetId: 1, edit: { kind: 'append', text: '12 March 2019' } });
});

test('the three boxes are written and named in the reply', async () => {
  const writes = [];
  const field = name => ({ name, isConnected: true, value: '' });
  const parts = { day: field('day'), month: field('month'), year: field('year'), legend: 'When was your passport issued?' };
  const actions = { readValue: element => element.value, writeValue: (element, value, options = {}) => { options.onWrite?.(element.value); element.value = value; writes.push([element.name, value]); }, canWrite: () => true };
  const controller = createController({ window: { setTimeout }, interpret, actions });
  const context = { now, elements: [{ ...box(1, 'Day', parts), element: parts.day }] };
  const initial = controller.handle('type 12 March 2019', context);
  const result = initial.followUp ? await initial.followUp : initial;
  assert.equal(result.message, 'When was your passport issued?: 12 March 2019 (day 12, month 3, year 2019).');
  assert.deepEqual(writes, [['day', '12'], ['month', '3'], ['year', '2019']]);
  // A box that went away stops the whole date.
  parts.year.isConnected = false; writes.length = 0;
  assert.match(controller.handle('type 1 April 2020', context).message, /date boxes changed/);
  assert.deepEqual(writes, []);
});

test('boxes of one date group are never told apart for a date, but plain text still asks which box', () => {
  const group = { day: {}, legend: 'Date of birth' }, field = (id, name, distance) => ({ ...box(id, name, group), distance });
  const context = { now, elements: [field(1, 'Day', 10), field(2, 'Month', 4), field(3, 'Year', 30)] };
  assert.deepEqual(interpret('type 1 April 1990', context), { type: 'date-parts', targetId: 2, value: '1990-04-01' });
  assert.equal(interpret('type hello', context).type, 'clarify');
  // Just outside the circle, the group is offered once.
  const outside = interpret('type 1 April 1990', { now, elements: [{ id: 1, name: 'Home', role: 'link', distance: 0 }], nearby: [field(101, 'Month', 150), field(102, 'Year', 170), field(103, 'Day', 190)] });
  assert.deepEqual(outside, { type: 'date-parts', targetId: 101, value: '1990-04-01', far: true });
});

test('a dropdown is set by its own name followed by the choice', () => {
  const sort = { id: 1, name: 'Sort by', role: 'combobox', distance: 0, editable: false, options: ['Recently published', 'Most views'] };
  const country = { id: 2, name: 'Country:', role: 'combobox', distance: 10, editable: false, options: ['France', 'Germany'] };
  const context = { elements: [sort, country] };
  assert.deepEqual(interpret('sort by most views', context), { type: 'select-option', targetId: 1, optionIndex: 1, optionName: 'Most views' });
  assert.deepEqual(interpret('country to germany', context), { type: 'select-option', targetId: 2, optionIndex: 1, optionName: 'Germany' });
});

for (const effect of ['cancel', 'pause', 'lock', 'detach', 'override']) test(`date entry stops after a first-field ${effect}`, async () => {
  const parts = Object.fromEntries(['day', 'month', 'year'].map(name => [name, { name, isConnected: true, value: '' }]));
  const writes = [];
  let controller;
  const actions = {
    readValue: field => field.value, canWrite: field => !field.readOnly,
    writeValue(field, value, options = {}) {
      options.onWrite?.(field.value); field.value = value; writes.push(field.name);
      if (field === parts.day) {
        if (effect === 'cancel' || effect === 'pause') controller.handle(effect, { elements: [] });
        if (effect === 'lock') parts.year.readOnly = true;
        if (effect === 'detach') parts.month.isConnected = false;
        if (effect === 'override') queueMicrotask(() => { parts.year.value = '2030'; });
      }
    },
  };
  controller = createController({ window: { setTimeout }, actions });
  const initial = controller.handle('type 12 March 2019', { elements: [{ ...box(1, 'Day', parts), element: parts.day }] });
  const settled = initial.followUp ? await initial.followUp : initial;
  assert.deepEqual(writes, ['day'], 'the later fields must not receive writes');
  if (settled) { assert.equal(settled.tone, 'error'); assert.match(settled.message, /already entered|partial/i); }
});
