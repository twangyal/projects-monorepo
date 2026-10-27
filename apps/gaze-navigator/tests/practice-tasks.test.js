import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, newRun, record, report, stop } from '../practice-site/tasks.js';
import { outcomeOf } from '../src/web/overlay.js';

const page = name => ({ page: name, document: { querySelector: () => null }, location: { search: '' } });

test('answers are sorted into acted, asked, cancelled and failed', () => {
  assert.equal(outcomeOf({ performed: 'click', tone: 'success', message: 'Done' }).outcome, 'acted');
  assert.equal(outcomeOf({ tone: 'question', pending: { kind: 'confirm' }, message: 'Confirm?' }).outcome, 'asked');
  assert.equal(outcomeOf({ tone: 'info', cancelled: true, message: 'Cancelled.' }).outcome, 'cancelled');
  assert.equal(outcomeOf({ tone: 'error', message: 'No control' }).outcome, 'failed');
  assert.equal(outcomeOf({ tone: 'info', paused: true, message: 'Paused.' }).outcome, 'other');
});

test('a run times each task, counts its instructions and the actions nobody asked for, and reports them', () => {
  const run = newRun(0);
  assert.equal(run.tasks.length, TASKS.length);
  assert.equal(record(run, { kind: 'instruction', utterance: 'open help', via: 'speech', outcome: 'acted' }, page('index'), 1000), false);
  assert.equal(record(run, { kind: 'page', page: 'help' }, page('help'), 2000), false);
  assert.equal(record(run, { kind: 'instruction', utterance: 'open catalog', via: 'speech', outcome: 'acted' }, page('help'), 4000), false);
  assert.equal(record(run, { kind: 'page', page: 'catalog' }, page('catalog'), 5000), true);
  assert.deepEqual({ ...run.tasks[0], events: run.tasks[0].events.length }, { id: 'catalog', text: 'Open the Catalog.', startedAt: 1000, seconds: 4, outcome: 'completed',
    instructions: 2, acted: 2, asked: 0, cancelled: 0, failed: 0, unintended: 1, events: 3 });
  assert.equal(run.current, 1);
  record(run, { kind: 'cart', title: 'Gardens of Stone' }, page('catalog'), 6000);
  record(run, { kind: 'consequential', text: 'pressed Delete account' }, page('account'), 7000);
  stop(run, 9000);
  const summary = report(run);
  assert.equal(summary.completed, 1);
  assert.equal(summary.completedWithoutUnintended, 0);
  assert.equal(summary.unintended, 3);
  assert.deepEqual(summary.details.map(task => task.outcome), ['completed', 'stopped', ...Array(TASKS.length - 2).fill('not reached')]);
  assert.equal(summary.details[1].seconds, 4);
  assert.equal(summary.finishedAt, new Date(9000).toISOString());
});

test('adding the asked-for book completes its task without counting a mistake', () => {
  const run = newRun(0);
  run.current = TASKS.findIndex(task => task.id === 'cart');
  assert.equal(record(run, { kind: 'cart', title: 'The Quiet River' }, page('book'), 1000), true);
  assert.equal(run.tasks[run.current - 1].unintended, 0);
});
