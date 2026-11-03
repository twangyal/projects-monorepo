import test from 'node:test';
import assert from 'node:assert/strict';
import { correctionReport, recognizerLabel, reportCsv, reportSummary, type ReportClip } from '../src/correction-report.ts';

const cue = (start: number, text: string) => ({ start, end: start + 2, text });
const heard = (cues: { start: number; text: string }[], model = 'parakeet-tdt-0.6b-v2-int8') => ({
  available: true as const, model, words: cues.reduce((sum, c) => sum + c.text.split(' ').length, 0),
  cues: cues.map(c => ({ ...c, end: c.start + 2, confidence: 0.9, words: [] })),
});

test('the report counts words changed and line starts moved per clip, and in total', () => {
  const automatic = [cue(1, 'hello little world'), cue(4, 'this is our chorus')];
  const clips: ReportClip[] = [
    { title: 'First song', duration: 61.4, cues: [cue(1, 'Hello lovely world'), cue(6, 'this is our chorus')], transcript: heard(automatic) },
    { title: 'Untouched', duration: 30, cues: automatic, transcript: heard(automatic, 'whisper-turbo-int8+parakeet-tdt-0.6b-v3-timing') },
    { title: 'Pasted only', duration: 30, cues: [cue(1, 'words I typed')], transcript: { available: false } },
    { title: 'Empty', duration: 30, cues: [], transcript: heard(automatic) },
  ];
  const report = correctionReport(clips);
  assert.deepEqual(report.rows.map(row => [row.title, row.recognizer, row.seconds, row.correction]), [
    ['First song', 'English', 61, { words: 7, changed: 1, lines: 2, moved: 1 }],
    ['Untouched', 'Whisper', 30, { words: 7, changed: 0, lines: 2, moved: 0 }],
  ]);
  assert.equal(report.skipped, 2);
  assert.deepEqual(report.totals, { words: 14, changed: 1, lines: 4, moved: 1 });
  assert.equal(reportSummary(report), 'Across 2 clips with automatic lyrics, your saved lyrics changed 1 of 14 words (7%) and moved 1 of 4 line starts by over half a second.'
    + ' Clips you have not corrected count as unchanged. 2 clips have no automatic or saved lyrics and are not counted.');
  assert.equal(reportSummary(correctionReport([])), 'No saved clip has automatic lyrics to compare yet.');
  assert.equal(recognizerLabel('sensevoice-small-int8'), 'East Asian');
});

test('the CSV holds titles and numbers only, quoted where needed and safe to open in a spreadsheet', () => {
  const automatic = [cue(1, 'one two three')];
  const csv = reportCsv(correctionReport([
    { title: 'Song, "live"', duration: 10, cues: [cue(1, 'one two four')], transcript: heard(automatic) },
    { title: '=cmd()', duration: 10, cues: automatic, transcript: heard(automatic) },
  ]));
  assert.equal(csv, 'title,recognizer,seconds,automatic_words,changed_words,changed_percent,saved_lines,moved_line_starts\r\n'
    + '"Song, ""live""",English,10,3,1,33,1,0\r\n' + `"'=cmd()",English,10,3,0,0,1,0\r\n`);
  assert.ok(!csv.includes('four'), 'no lyrics in the download');
});
