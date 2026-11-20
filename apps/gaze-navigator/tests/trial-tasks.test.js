import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';
import { logEntry, logReport } from '../src/web/session-log.js';
import { commandHelp } from '../src/web/command-help.js';
import { MAX_TASKS, MAX_TASK_CHARS, currentTask, endTrial, finishTask, parseTasks, spokenDuration, startTrial, trialOpen, trialReport, trialSummary, validTrial } from '../src/web/trial-tasks.js';

const control = (id, name, role = 'button', extra = {}) => ({ id, name, role, distance: id * 10, element: { isConnected: true, name }, ...extra });

test('trial comparisons ignore transported result key order while preserving real state changes', () => {
  const saved = finishTask({ ...startTrial(['One', 'Two'], 1000), id: 'same-trial' }, 'done', 2400).trial;
  const transported = { ...saved, results: saved.results.map(result => Object.fromEntries(Object.entries(result).reverse())) };
  assert.equal(JSON.stringify(validTrial(saved)), JSON.stringify(validTrial(transported)));
  for (const changed of [{ ...saved, id: 'other-trial' }, { ...saved, current: 2 },
    { ...saved, results: [{ ...saved.results[0], outcome: 'skipped' }] },
    { ...saved, results: [{ ...saved.results[0], seconds: 8 }] }]) {
    assert.notEqual(JSON.stringify(validTrial(saved)), JSON.stringify(validTrial(changed)));
  }
});

test('tasks are written one per line, and a trial moves through them noting each outcome and time', () => {
  assert.deepEqual(parseTasks('  Find the opening hours \n\n\tPut a book on hold\r\nRenew a loan  '), ['Find the opening hours', 'Put a book on hold', 'Renew a loan']);
  assert.equal(parseTasks(Array.from({ length: 30 }, (_, k) => `Task ${k}`).join('\n')).length, MAX_TASKS);
  assert.equal(parseTasks('x'.repeat(500))[0].length, MAX_TASK_CHARS);
  assert.deepEqual(parseTasks(''), []);

  let trial = startTrial(['Find the opening hours', 'Put a book on hold', 'Renew a loan'], 1_000);
  assert.deepEqual(currentTask(trial), { number: 1, total: 3, text: 'Find the opening hours' });
  assert.equal(trialSummary(trial), 'Task 1 of 3: Find the opening hours');
  let step = finishTask(trial, 'done', 43_400);
  assert.deepEqual(step.finished, { number: 1, text: 'Find the opening hours', outcome: 'done', seconds: 42.4 });
  assert.deepEqual(step.next, { number: 2, total: 3, text: 'Put a book on hold' });
  assert.equal(finishTask(step.trial, 'maybe', 50_000).finished, null, 'only done or skipped');
  step = finishTask(step.trial, 'skipped', 168_400);
  assert.equal(step.finished.seconds, 125);
  step = finishTask(step.trial, 'done', 170_000);
  assert.equal(step.next, null);
  trial = step.trial;
  assert.equal(currentTask(trial), null);
  assert.ok(trialOpen(trial), 'finished, but shown until ended');
  assert.equal(trialSummary(trial), 'The trial is finished: 2 of 3 tasks done, 1 skipped.');
  assert.equal(finishTask(trial, 'done', 180_000).finished, null, 'nothing left to finish');
  const ended = endTrial(trial, 200_000);
  assert.equal(trialOpen(ended), false);
  assert.equal(endTrial(ended, 300_000).endedAt, 200_000, 'ended once');

  // Ended early, the tasks not reached are said.
  const early = endTrial(finishTask(startTrial(['One', 'Two', 'Three'], 0), 'done', 5_000).trial, 9_000);
  assert.equal(currentTask(early), null);
  assert.equal(trialSummary(early), 'The trial was ended: 1 of 3 tasks done, 2 not finished.');
  assert.equal(trialSummary(null), 'No trial is running.');

  assert.equal(spokenDuration(42.4), '42 seconds');
  assert.equal(spokenDuration(1), '1 second');
  assert.equal(spokenDuration(125), '2 minutes 5 seconds');
  assert.equal(spokenDuration(60), '1 minute');
});

test('a stored trial is used only when well formed', () => {
  const trial = finishTask(startTrial(['One', 'Two'], 1_000), 'done', 2_000).trial;
  assert.deepEqual(validTrial(JSON.parse(JSON.stringify(trial))), trial);
  assert.deepEqual(validTrial({ ...trial, endedAt: 3_000 }).endedAt, 3_000);
  for (const broken of [null, 'trial', { ...trial, tasks: [] }, { ...trial, tasks: ['One', 7] }, { ...trial, current: 5 }, { ...trial, startedAt: 'yesterday' },
    { ...trial, endedAt: -1 }, { ...trial, tasks: Array(MAX_TASKS + 1).fill('Task') }, { ...trial, results: 'none' }]) {
    assert.equal(validTrial(broken), null, JSON.stringify(broken)?.slice(0, 60));
  }
  // A malformed result is dropped, the rest kept.
  assert.equal(validTrial({ ...trial, results: [...trial.results, { number: 'two', outcome: 'done' }] }).results.length, 1);
});

test('the downloaded log reports each task with its instructions, leaving out an earlier trial', () => {
  const at = (ms, outcome, task) => logEntry({ via: 'speech', source: 'camera', outcome }, { at: ms, site: 'library.example', tookMs: 400, task });
  const started = Date.parse('2026-11-19T10:00:00Z');
  let trial = startTrial(['Find the opening hours', 'Put a book on hold', 'Renew a loan'], started);
  trial = finishTask(trial, 'done', started + 60_000).trial;
  trial = finishTask(trial, 'skipped', started + 90_000).trial;
  const entries = [
    at(started - 50_000, 'acted', 1), // the earlier trial's task 1
    at(started + 10_000, 'acted', 1), at(started + 20_000, 'asked', 1), at(started + 30_000, 'failed', 1),
    at(started + 70_000, 'cancelled', 2), at(started + 95_000, 'acted', 3), at(started + 99_000, 'acted', null),
  ];
  assert.equal(entries[1].task, 1);
  assert.equal('task' in entries[6], false, 'given outside a trial');
  assert.deepEqual(trialReport(trial, entries), {
    startedAt: '2026-11-19T10:00:00.000Z', endedAt: null,
    tasks: [
      { number: 1, text: 'Find the opening hours', outcome: 'done', seconds: 60, instructions: 3, acted: 1, asked: 1, cancelled: 0, failed: 1 },
      { number: 2, text: 'Put a book on hold', outcome: 'skipped', seconds: 30, instructions: 1, acted: 0, asked: 0, cancelled: 1, failed: 0 },
      { number: 3, text: 'Renew a loan', outcome: 'in progress', seconds: null, instructions: 1, acted: 1, asked: 0, cancelled: 0, failed: 0 },
    ],
  });
  const ended = endTrial(trial, started + 100_000);
  assert.equal(trialReport(ended, entries).tasks[2].outcome, 'stopped');
  const report = logReport(entries, started + 200_000, ended);
  assert.equal(report.instructions, entries.length, 'every entry is still in the log');
  assert.equal(report.trial.endedAt, '2026-11-19T10:01:40.000Z');
  assert.equal('trial' in logReport(entries, started + 200_000), false, 'no trial, no trial report');
  assert.equal(trialReport(startTrial(['One', 'Two'], started), []).tasks[1].outcome, 'not reached');
});

test('"task done", "skip task" and "what is my task" belong to a trial only while one is open', () => {
  const open = { elements: [control(1, 'Search')], trial: true };
  assert.deepEqual(interpret('Task done', open), { type: 'trial', change: 'done' });
  assert.deepEqual(interpret("I've finished the task.", open), { type: 'trial', change: 'done' });
  assert.deepEqual(interpret('next task', open), { type: 'trial', change: 'done' });
  assert.deepEqual(interpret('skip this task', open), { type: 'trial', change: 'skip' });
  assert.deepEqual(interpret("what's my task", open), { type: 'trial', change: 'show' });
  assert.deepEqual(interpret('repeat the task', open), { type: 'trial', change: 'show' });
  assert.notEqual(interpret('task done', { elements: [control(1, 'Search')] }).type, 'trial', 'no trial');
  // A control named by everything said is still the one meant.
  assert.deepEqual(interpret('next task', { elements: [control(1, 'Next task')], trial: true }), { type: 'activate', targetId: 1 });
  // Help says how to move on, only during a trial.
  assert.match(commandHelp({ context: open }), /For the trial, say “task done” when this task is done, “skip task” to move on/);
  assert.doesNotMatch(commandHelp({ context: { elements: [control(1, 'Search')] } }), /trial/);
});

test('the controller says the task at hand, moves on, and keeps a waiting question when only asked', () => {
  let trial = startTrial(['Find the opening hours', 'Renew a loan'], 0), clock = 0;
  const commands = { trial: {
    current: () => currentTask(trial),
    summary: () => trialSummary(trial),
    finish(outcome) { const result = finishTask(trial, outcome, clock); trial = result.trial; return result; },
  } };
  const actions = { activate: (target, name) => ({ ok: true, message: `${name} activated.` }) };
  const controller = createController({ window: {}, interpret, actions, commands, now: () => clock });
  const page = { elements: [control(1, 'Delete account', 'button', { consequential: true })], trial: true };

  assert.equal(controller.handle("what's my task", page).message, 'Task 1 of 2: Find the opening hours');
  const asked = controller.handle('delete account', page);
  assert.equal(asked.pending?.kind, 'confirm');
  const shown = controller.handle('what is my task', page);
  assert.equal(shown.pending?.kind, 'confirm', 'the question still waits');
  assert.equal(shown.trial, true);
  clock = 42_000;
  const done = controller.handle('task done', page);
  assert.equal(done.message, 'Task 1 done after 42 seconds. Task 2 of 2: Renew a loan');
  assert.equal(done.tone, 'success');
  assert.equal(done.pending, null, 'moving on drops the old question');
  clock = 170_000;
  assert.equal(controller.handle('skip task', page).message, 'Task 2 skipped after 2 minutes 8 seconds. That was the last task, so the trial is finished.');
  assert.equal(controller.handle('task done', page).message, 'The trial is finished: 1 of 2 tasks done, 1 skipped.');
  // Without a trial store (the practice website) there is nothing to move on.
  assert.equal(createController({ window: {}, interpret, actions, commands: {} }).handle('task done', page).message, 'Trial tasks are not available here.');
});

test('trial completion waits for a durable save and gives a retry after failure', async () => {
  const trial = startTrial(['One', 'Two'], 0);
  let resolve, reject;
  const controller = createController({ window: {}, commands: { trial: {
    current: () => currentTask(trial), summary: () => trialSummary(trial),
    finish: () => new Promise((yes, no) => { resolve = yes; reject = no; }),
  } } });
  const context = { elements: [], trial: true };
  const waiting = controller.handle('task done', context);
  assert.equal(waiting.tone, 'info');
  assert.match(waiting.message, /Saving/);
  resolve({ ok: true, ...finishTask(trial, 'done', 1200) });
  assert.equal((await waiting.followUp).message, 'Task 1 done after 1 second. Task 2 of 2: Two');
  const failed = controller.handle('task done', context);
  reject(new Error('storage unavailable'));
  assert.match((await failed.followUp).message, /Could not save.*try again/i);
  const stale = controller.handle('task done', context);
  resolve({ ok: false, trial: null, message: 'The trial changed. No task was moved on.' });
  assert.equal((await stale.followUp).tone, 'error');
});

test('a late trial save cannot replace feedback for a newer instruction', async () => {
  let resolve;
  const controller = createController({ window: {}, commands: { trial: {
    current: () => ({ number: 1, total: 1, text: 'One' }), summary: () => 'One',
    finish: () => new Promise(yes => { resolve = yes; }),
  } } });
  const context = { elements: [], trial: true };
  const waiting = controller.handle('task done', context);
  controller.handle('pause', context);
  resolve({ ok: true, ...finishTask(startTrial(['One'], 0), 'done', 1200) });
  assert.equal(await waiting.followUp, null);
});
