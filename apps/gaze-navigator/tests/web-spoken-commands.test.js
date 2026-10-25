import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';

// What a speech recognizer actually produces must reach native value fields.
const now = new Date(2026, 9, 25, 10, 0);
const page = (...elements) => ({ now, elements: elements.map((element, index) => ({ id: index + 1, distance: index, role: 'textbox', ...element })) });

test('explicit field commands accept spoken values', () => {
  const context = page({ name: 'Departure', nativeDate: true }, { name: 'Appointment', nativeTime: true }, { name: 'Quantity', nativeNumber: true },
    { name: 'Reporting', nativeMonth: true }, { name: 'Sprint', nativeWeek: true }, { name: 'Volume', role: 'slider' });
  assert.deepEqual(interpret('set Departure date field to November first', context), { type: 'date', targetId: 1, value: '2026-11-01' });
  assert.deepEqual(interpret('set Departure date field to tomorrow', context), { type: 'date', targetId: 1, value: '2026-10-26' });
  assert.deepEqual(interpret('set Appointment time field to 2:30 p.m.', context), { type: 'time', targetId: 2, value: '14:30' });
  assert.deepEqual(interpret('set Appointment time field to half past nine', context), { type: 'time', targetId: 2, value: '09:30' });
  assert.deepEqual(interpret('set Quantity number field to three', context), { type: 'number', targetId: 3, value: '3' });
  assert.deepEqual(interpret('set Quantity number field to 1,200', context), { type: 'number', targetId: 3, value: '1200' });
  assert.deepEqual(interpret('set Reporting month field to November 2026', context), { type: 'month', targetId: 4, value: '2026-11' });
  assert.deepEqual(interpret('set Sprint week field to week forty three', context), { type: 'week', targetId: 5, value: '2026-W43' });
  assert.deepEqual(interpret('set Volume slider to forty percent', context), { type: 'range', targetId: 6, value: 40 });
});

test('natural "set <name> to <value>" reaches native fields by name or kind', () => {
  const context = page({ name: 'Departure', nativeDate: true }, { name: 'Return', nativeDate: true }, { name: 'Guests', nativeNumber: true },
    { name: 'Volume', role: 'slider' }, { name: 'Notes', editable: true });
  assert.deepEqual(interpret('set departure to November first', context), { type: 'date', targetId: 1, value: '2026-11-01' });
  assert.deepEqual(interpret('set the return date to next Friday', context), { type: 'date', targetId: 2, value: '2026-10-30' });
  assert.deepEqual(interpret('change guests to four', context), { type: 'number', targetId: 3, value: '4' });
  assert.deepEqual(interpret('set volume to seventy', context), { type: 'range', targetId: 4, value: 70 });
  // Saying the kind alone means the field under the gaze; with none there, the navigator asks which.
  assert.deepEqual(interpret('set the date to tomorrow', context), { type: 'date', targetId: 1, value: '2026-10-26' });
  const apart = { now, elements: context.elements.map(element => ({ ...element, distance: element.id + 5 })) };
  assert.equal(interpret('set the date to tomorrow', apart).type, 'clarify');
  // Ordinary text fields keep their behaviour.
  assert.deepEqual(interpret('set notes to bring snacks', context), { type: 'edit', targetId: 5, edit: { kind: 'replace-all', text: 'bring snacks' } });
});

test('values that are not understood explain what to say instead', () => {
  const context = page({ name: 'Departure', nativeDate: true });
  const action = interpret('set departure to sometime soon', context);
  assert.equal(action.type, 'unknown');
  assert.match(action.message, /November first/);
});
