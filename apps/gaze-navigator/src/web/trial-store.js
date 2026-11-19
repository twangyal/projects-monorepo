// The extension worker owns trial writes. Every request reads durable state after the preceding write, and carries
// the snapshot it was made for: two tabs finishing the same task can never finish two different tasks.
import { LOG_SETTINGS, storedLog } from './session-log.js';
import { TRIAL_KEY, currentTask, endTrial, finishTask, parseTasks, startTrial, trialOpen, validTrial } from './trial-tasks.js';

export function createTrialStore({ storage, now = () => Date.now(), id = () => crypto.randomUUID() }) {
  let tail = Promise.resolve();
  async function mutate(request, requestedAt) {
    const trial = validTrial((await storage.get(TRIAL_KEY))[TRIAL_KEY]);
    const refused = message => ({ ok: false, trial, message });
    if (!request || !['start', 'finish', 'end', 'clear', 'logging'].includes(request.op)) return refused('That trial request is not supported.');
    if (request.op === 'logging') {
      if (!['on', 'words'].includes(request.key) || typeof request.value !== 'boolean') return refused('That logging choice is not supported.');
      const choice = (await storage.get(LOG_SETTINGS))[LOG_SETTINGS] ?? {};
      await storage.set({ [LOG_SETTINGS]: { ...choice, [request.key]: request.value } });
      return { ok: true, trial };
    }
    const expected = validTrial(request.expected);
    if ((request.expected != null && !expected) || JSON.stringify(expected) !== JSON.stringify(trial)) {
      return refused('The trial changed in another tab or popup. No task was moved on. Ask what your task is, or reopen the popup.');
    }
    if (request.op === 'finish') {
      if (!currentTask(trial) || !['done', 'skipped'].includes(request.outcome)) return refused('There is no task to move on. Ask what your task is.');
      const result = finishTask(trial, request.outcome, requestedAt);
      await storage.set({ [TRIAL_KEY]: result.trial });
      return { ok: true, ...result };
    }
    if (request.op === 'start') {
      if (trialOpen(trial)) return refused('A trial is already running. End it before starting another.');
      if (!Array.isArray(request.tasks) || !request.tasks.every(task => typeof task === 'string')) return refused('Write at least one task, one per line.');
      const tasks = parseTasks(request.tasks.join('\n'));
      if (!tasks.length) return refused('Write at least one task, one per line.');
      // An identity distinguishes even identical trials started within the same clock tick. Legacy trials without one
      // remain readable; only a fresh start needs it.
      const next = { ...startTrial(tasks, now()), id: id() };
      const choice = (await storage.get(LOG_SETTINGS))[LOG_SETTINGS] ?? {};
      await storage.set({ [TRIAL_KEY]: next, ...(choice.on !== true ? { [LOG_SETTINGS]: { ...choice, on: true } } : {}) });
      return { ok: true, trial: next, loggingStarted: choice.on !== true };
    }
    if (request.op === 'end') {
      const ended = endTrial(trial, requestedAt);
      if (ended) await storage.set({ [TRIAL_KEY]: ended });
      return { ok: true, trial: ended };
    }
    const log = storedLog(await storage.get(null));
    await storage.remove([...log.keys, TRIAL_KEY]);
    return { ok: true, trial: null };
  }
  return request => {
    const requestedAt = now();
    const result = tail.then(() => mutate(request, requestedAt));
    tail = result.catch(() => {});
    return result;
  };
}
