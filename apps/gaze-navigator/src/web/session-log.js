// A log of how instructions went, kept on this device only when the person turns it on, for trying the navigator with
// real users on real sites: when each was given, on which website, how (spoken or typed), with which pointer (the
// mouse, or the camera following the eyes or the head), what happened and how long the answer took. What was said and the replies are kept
// only when also asked for, since they can hold personal details. Nothing leaves the device until the log is downloaded.
import { trialReport } from './trial-tasks.js';

/** The most entries kept; the oldest give way. */
export const MAX_LOG_ENTRIES = 1000;
const OUTCOMES = ['acted', 'asked', 'cancelled', 'failed', 'other'];
/** In the extension each entry has its own storage key, so pages in several tabs never overwrite each other's entries. */
export const LOG_PREFIX = 'gaze-navigator-log:';
/** The extension's switches: `{ on, words }`, changed only from its toolbar popup. */
export const LOG_SETTINGS = 'gaze-navigator-log-settings';

/** One instruction's entry from its outcome report (see overlay.js `outcomeOf`); during a trial, its task's number (see
 * trial-tasks.js). */
export function logEntry(report, { at, site, tookMs, words = false, task = null }) {
  const entry = {
    at: new Date(at).toISOString(), site: String(site ?? '').slice(0, 253), via: report.via ?? 'unknown', pointer: report.source ?? 'unknown',
    outcome: OUTCOMES.includes(report.outcome) ? report.outcome : 'other', tookMs: Math.max(0, Math.round(tookMs ?? 0)),
  };
  if (words) Object.assign(entry, { said: String(report.utterance ?? '').slice(0, 500), reply: String(report.message ?? '').slice(0, 500) });
  if (Number.isInteger(task) && task > 0) entry.task = task;
  return entry;
}

/** The log with `entry` added, keeping at most MAX_LOG_ENTRIES. Anything that is not a list starts a new log. */
export function appendLog(entries, entry) {
  const kept = Array.isArray(entries) ? entries : [];
  return [...kept, entry].slice(-MAX_LOG_ENTRIES);
}

/** The downloadable log: every entry, and how many instructions went each way, in all and per website, and with a trial
 * (see trial-tasks.js), how each of its tasks went. */
export function logReport(entries, now = Date.now(), trial = null) {
  const list = Array.isArray(entries) ? entries : [];
  const count = rows => Object.fromEntries(OUTCOMES.map(outcome => [outcome, rows.filter(row => row.outcome === outcome).length]));
  const sites = [...new Set(list.map(row => row.site))].sort();
  const took = list.map(row => row.tookMs).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    kind: 'gaze-navigator-session-log', version: 1, downloadedAt: new Date(now).toISOString(),
    instructions: list.length, ...count(list), medianAnswerMs: took.length ? took[Math.floor((took.length - 1) / 2)] : null,
    sites: Object.fromEntries(sites.map(site => { const rows = list.filter(row => row.site === site); return [site, { instructions: rows.length, ...count(rows) }]; })),
    ...(trial ? { trial: trialReport(trial, list) } : {}),
    entries: list,
  };
}

/** The storage key for one entry in the extension. */
export function logKey(entry, random = Math.random()) {
  return `${LOG_PREFIX}${entry.at}:${random.toString(36).slice(2, 10)}`;
}

/** The entries kept under their own keys among `items` (a storage area's contents), oldest first, and the keys of the
 * oldest beyond MAX_LOG_ENTRIES, which should go. */
export function storedLog(items) {
  const rows = Object.entries(items ?? {}).filter(([key, value]) => key.startsWith(LOG_PREFIX) && value && typeof value === 'object')
    .sort(([a, x], [b, y]) => String(x.at).localeCompare(String(y.at)) || a.localeCompare(b));
  const excess = Math.max(0, rows.length - MAX_LOG_ENTRIES);
  return { entries: rows.slice(excess).map(([, value]) => value), keys: rows.map(([key]) => key), dropped: rows.slice(0, excess).map(([key]) => key) };
}

/** One line on the state of the log, for the extension popup and the practice website's panel. */
export function logSummary(entries, on) {
  const list = Array.isArray(entries) ? entries : [], sites = new Set(list.map(row => row.site)).size;
  if (!list.length) return on ? 'Logging is on. No instructions logged yet.' : 'Logging is off.';
  return `${list.length} ${list.length === 1 ? 'instruction' : 'instructions'} logged on ${sites} ${sites === 1 ? 'website' : 'websites'}${on ? '' : '; logging is off'}.`;
}

/** The downloaded file's name, dated. */
export function logFileName(now = Date.now()) {
  return `gaze-navigator-log-${new Date(now).toISOString().slice(0, 10)}.json`;
}
