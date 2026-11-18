import test from 'node:test';
import assert from 'node:assert/strict';
import { LOG_PREFIX, MAX_LOG_ENTRIES, appendLog, logEntry, logFileName, logKey, logReport, logSummary, storedLog } from '../src/web/session-log.js';

const at = Date.UTC(2026, 10, 18, 9, 30);
const report = { utterance: 'open my account', via: 'speech', source: 'eyes', outcome: 'acted', message: 'Opened "Account".' };

test('an entry keeps when, where, how and what happened, and the words only when asked for', () => {
  assert.deepEqual(logEntry(report, { at, site: 'shop.example', tookMs: 412.6 }), {
    at: '2026-11-18T09:30:00.000Z', site: 'shop.example', via: 'speech', pointer: 'eyes', outcome: 'acted', tookMs: 413,
  });
  const worded = logEntry(report, { at, site: 'shop.example', tookMs: 10, words: true });
  assert.equal(worded.said, 'open my account');
  assert.equal(worded.reply, 'Opened "Account".');
  assert.equal(logEntry({ ...report, outcome: 'surprising' }, { at, site: 'x', tookMs: -5 }).outcome, 'other');
  assert.equal(logEntry({ ...report, utterance: 'a'.repeat(900) }, { at, site: 'x', tookMs: 0, words: true }).said.length, 500);
});

test('the log keeps the newest entries and a report counts them in all and per website', () => {
  let log = 'not a list';
  for (let n = 0; n < MAX_LOG_ENTRIES + 5; n++) log = appendLog(log, { at: n, site: 'a', outcome: 'acted', tookMs: n });
  assert.equal(log.length, MAX_LOG_ENTRIES);
  assert.equal(log[0].at, 5);

  const rows = [
    logEntry(report, { at, site: 'shop.example', tookMs: 300 }),
    logEntry({ ...report, outcome: 'asked' }, { at: at + 1000, site: 'shop.example', tookMs: 100 }),
    logEntry({ ...report, outcome: 'failed' }, { at: at + 2000, site: 'news.example', tookMs: 900 }),
  ];
  const summary = logReport(rows, at + 5000);
  assert.equal(summary.kind, 'gaze-navigator-session-log');
  assert.equal(summary.downloadedAt, '2026-11-18T09:30:05.000Z');
  assert.deepEqual([summary.instructions, summary.acted, summary.asked, summary.failed, summary.cancelled], [3, 1, 1, 1, 0]);
  assert.equal(summary.medianAnswerMs, 300);
  assert.deepEqual(summary.sites['shop.example'], { instructions: 2, acted: 1, asked: 1, cancelled: 0, failed: 0, other: 0 });
  assert.equal(summary.entries.length, 3);
  assert.equal(logReport([]).medianAnswerMs, null);
});

test('entries kept under their own keys come back oldest first, and the oldest beyond the limit are dropped', () => {
  const first = logEntry(report, { at, site: 'a', tookMs: 1 }), second = logEntry(report, { at: at + 1, site: 'b', tookMs: 1 });
  const items = { [logKey(second, 0.5)]: second, [logKey(first, 0.25)]: first, 'gaze-my-details': { name: 'Sam' }, [`${LOG_PREFIX}broken`]: 'text' };
  assert.ok(logKey(first).startsWith(`${LOG_PREFIX}${first.at}:`));
  const { entries, keys, dropped } = storedLog(items);
  assert.deepEqual(entries, [first, second]);
  assert.equal(keys.length, 2);
  assert.deepEqual(dropped, []);

  const many = Object.fromEntries(Array.from({ length: MAX_LOG_ENTRIES + 2 }, (_, n) => {
    const entry = logEntry(report, { at: at + n * 1000, site: 'a', tookMs: 1 });
    return [logKey(entry, (n + 1) / 10_000), entry];
  }));
  const pruned = storedLog(many);
  assert.equal(pruned.entries.length, MAX_LOG_ENTRIES);
  assert.equal(pruned.dropped.length, 2);
  assert.equal(pruned.entries[0].at, new Date(at + 2000).toISOString());
});

test('the summary line and file name say what the log holds', () => {
  assert.equal(logSummary([], false), 'Logging is off.');
  assert.equal(logSummary([], true), 'Logging is on. No instructions logged yet.');
  assert.equal(logSummary([{ site: 'a' }], true), '1 instruction logged on 1 website.');
  assert.equal(logSummary([{ site: 'a' }, { site: 'b' }], false), '2 instructions logged on 2 websites; logging is off.');
  assert.equal(logFileName(at), 'gaze-navigator-log-2026-11-18.json');
});
