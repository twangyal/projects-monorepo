// How much the automatic lyrics of every saved clip were corrected: the evidence of correction effort on real songs.
import { correction, type Correction, type Transcript } from './auto-lyrics.ts';
import type { Cue } from './lyrics.ts';

export interface ReportClip { title: string; duration: number; cues: readonly Cue[]; transcript: Transcript }
export interface ReportRow { title: string; recognizer: string; seconds: number; correction: Correction }
export interface CorrectionReport { rows: ReportRow[]; skipped: number; totals: Correction }

/** The recognizer that heard a clip, named briefly for a table. */
export function recognizerLabel(model: string): string {
  return model.startsWith('parakeet-tdt-0.6b-v2') ? 'English' : model.startsWith('parakeet-tdt-0.6b-v3') ? 'Multilingual'
    : model.startsWith('sensevoice') ? 'East Asian' : model.startsWith('whisper') ? 'Whisper' : 'Local';
}

/** One row per clip with automatic lyrics and saved lyrics, in library order, and their totals. */
export function correctionReport(clips: readonly ReportClip[]): CorrectionReport {
  const rows: ReportRow[] = [];
  for (const clip of clips) {
    if (!clip.transcript.available || !clip.transcript.words || !clip.cues.length) continue;
    rows.push({ title: clip.title, recognizer: recognizerLabel(clip.transcript.model), seconds: Math.round(clip.duration), correction: correction(clip.transcript.cues, clip.cues) });
  }
  const totals = rows.reduce((sum, { correction: c }) => ({ words: sum.words + c.words, changed: sum.changed + c.changed, lines: sum.lines + c.lines, moved: sum.moved + c.moved }),
    { words: 0, changed: 0, lines: 0, moved: 0 });
  return { rows, skipped: clips.length - rows.length, totals };
}

const percent = (part: number, whole: number) => (whole ? Math.round(100 * part / whole) : 0);

/** The report in a sentence or two. */
export function reportSummary({ rows, skipped, totals }: CorrectionReport): string {
  const left = skipped ? ` ${skipped} ${skipped === 1 ? 'clip has' : 'clips have'} no automatic or saved lyrics and ${skipped === 1 ? 'is' : 'are'} not counted.` : '';
  if (!rows.length) return `No saved clip has automatic lyrics to compare yet.${left}`;
  return `Across ${rows.length} ${rows.length === 1 ? 'clip' : 'clips'} with automatic lyrics, your saved lyrics changed ${totals.changed.toLocaleString('en-US')} of ${totals.words.toLocaleString('en-US')} words`
    + ` (${percent(totals.changed, totals.words)}%) and moved ${totals.moved.toLocaleString('en-US')} of ${totals.lines.toLocaleString('en-US')} line starts by over half a second.`
    + ` Clips you have not corrected count as unchanged.${left}`;
}

/** The rows as CSV: titles and numbers only, never lyrics. */
export function reportCsv({ rows }: CorrectionReport): string {
  const field = (value: string | number) => (typeof value === 'number' ? String(value) : /[",\n\r]/.test(value) || /^[=+\-@]/.test(value) ? `"${value.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : value);
  const header = ['title', 'recognizer', 'seconds', 'automatic_words', 'changed_words', 'changed_percent', 'saved_lines', 'moved_line_starts'];
  return [header.join(','), ...rows.map(({ title, recognizer, seconds, correction: c }) =>
    [title, recognizer, seconds, c.words, c.changed, percent(c.changed, c.words), c.lines, c.moved].map(field).join(','))].join('\r\n') + '\r\n';
}
