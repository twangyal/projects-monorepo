// Tasks for trying the navigator with someone on real websites. The person running the session writes them in the
// extension's toolbar popup, one per line, and starts the trial; the panel shows the task at hand on every website, and
// saying "task done" or "skip task" moves on, noting how long it took. While a trial runs, each session log entry says
// which task it belonged to (see session-log.js), and the downloaded log reports each task: its outcome, time and how
// its instructions went. Real websites cannot check a task themselves, as the practice site does, so the person says.
// The trial's results stay until the log is cleared or another trial starts, so ending it early loses nothing.

/** The trial, in the extension's own storage, which websites cannot read. */
export const TRIAL_KEY = 'gaze-navigator-trial';
export const MAX_TASKS = 20, MAX_TASK_CHARS = 200;
const OUTCOMES = ['done', 'skipped'];

/** The tasks written one per line: blank lines left out, each at most MAX_TASK_CHARS, at most MAX_TASKS. */
export function parseTasks(text) {
  return String(text ?? '').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map(line => line.slice(0, MAX_TASK_CHARS)).slice(0, MAX_TASKS);
}

/** A new trial of `tasks`, starting with the first at `now` (ms). */
export function startTrial(tasks, now) {
  return { tasks: [...tasks], current: 0, startedAt: now, taskStartedAt: now, results: [] };
}

/** The task at hand, numbered from 1, or null when there is no trial, or it is finished or ended. */
export function currentTask(trial) {
  if (!trial || trial.endedAt != null || trial.current >= trial.tasks.length) return null;
  return { number: trial.current + 1, total: trial.tasks.length, text: trial.tasks[trial.current] };
}

/** The trial with the task at hand finished as 'done' or 'skipped' at `now`: its result noted, and the next begun. */
export function finishTask(trial, outcome, now) {
  const task = currentTask(trial);
  if (!task || !OUTCOMES.includes(outcome)) return { trial, finished: null, next: task };
  const result = { number: task.number, text: task.text, outcome, seconds: Math.max(0, Math.round((now - trial.taskStartedAt) / 100) / 10) };
  const next = { ...trial, current: trial.current + 1, taskStartedAt: now, results: [...trial.results, result] };
  return { trial: next, finished: result, next: currentTask(next) };
}

/** The trial ended at `now` from the popup, whether or not every task was reached; the panel no longer shows it. */
export function endTrial(trial, now) {
  return trial && trial.endedAt == null ? { ...trial, endedAt: now } : trial;
}

/** Whether the trial is still shown in the panel: started and not ended, though its tasks may all be finished. */
export function trialOpen(trial) {
  return Boolean(trial) && trial.endedAt == null;
}

/** A task's time as said: "42 seconds", "2 minutes 5 seconds". */
export function spokenDuration(seconds) {
  const whole = Math.max(0, Math.round(seconds)), unit = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (whole < 60) return unit(whole, 'second');
  return `${unit(Math.floor(whole / 60), 'minute')}${whole % 60 ? ` ${unit(whole % 60, 'second')}` : ''}`;
}

/** A stored trial, if it is well formed; anything else is no trial. */
export function validTrial(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.tasks) || !Array.isArray(value.results)) return null;
  const text = item => typeof item === 'string' && item.length > 0 && item.length <= MAX_TASK_CHARS;
  const time = item => typeof item === 'number' && Number.isFinite(item) && item >= 0;
  if (!value.tasks.length || value.tasks.length > MAX_TASKS || !value.tasks.every(text)) return null;
  if (!Number.isInteger(value.current) || value.current < 0 || value.current > value.tasks.length || !time(value.startedAt) || !time(value.taskStartedAt)) return null;
  if (value.endedAt != null && !time(value.endedAt)) return null;
  // Storage events and message replies may enumerate nested keys differently; compare the same admitted fields.
  const results = value.results.filter(item => item && Number.isInteger(item.number) && text(item.text) && OUTCOMES.includes(item.outcome) && time(item.seconds))
    .map(({ number, text, outcome, seconds }) => ({ number, text, outcome, seconds }));
  return { tasks: [...value.tasks], current: value.current, startedAt: value.startedAt, taskStartedAt: value.taskStartedAt, results,
    ...(typeof value.id === 'string' && value.id.length <= 64 ? { id: value.id } : {}),
    ...(value.endedAt != null ? { endedAt: value.endedAt } : {}) };
}

/** Where the trial stands: "Task 2 of 5: …", or how it ended. */
export function trialSummary(trial) {
  const task = currentTask(trial);
  if (!trial) return 'No trial is running.';
  if (task) return `Task ${task.number} of ${task.total}: ${task.text}`;
  const count = outcome => trial.results.filter(result => result.outcome === outcome).length;
  const done = count('done'), skipped = count('skipped'), left = trial.tasks.length - trial.results.length;
  const parts = [`${done} of ${trial.tasks.length} ${trial.tasks.length === 1 ? 'task' : 'tasks'} done`, ...(skipped ? [`${skipped} skipped`] : []), ...(left ? [`${left} not finished`] : [])];
  return `The trial ${left ? 'was ended' : 'is finished'}: ${parts.join(', ')}.`;
}

/** Each task's report, from the trial and the session log entries made during it (an earlier trial's entries, made
 * before this one started, are left out). */
export function trialReport(trial, entries) {
  if (!trial) return null;
  const list = (Array.isArray(entries) ? entries : []).filter(entry => Date.parse(entry?.at) >= trial.startedAt);
  const unfinished = trial.endedAt == null ? 'in progress' : 'stopped';
  return {
    startedAt: new Date(trial.startedAt).toISOString(), endedAt: trial.endedAt == null ? null : new Date(trial.endedAt).toISOString(),
    tasks: trial.tasks.map((text, index) => {
      const number = index + 1, result = trial.results.find(item => item.number === number), rows = list.filter(entry => entry.task === number);
      const count = outcome => rows.filter(row => row.outcome === outcome).length;
      return { number, text, outcome: result?.outcome ?? (index === trial.current ? unfinished : 'not reached'), seconds: result?.seconds ?? null,
        instructions: rows.length, acted: count('acted'), asked: count('asked'), cancelled: count('cancelled'), failed: count('failed') };
    }),
  };
}
