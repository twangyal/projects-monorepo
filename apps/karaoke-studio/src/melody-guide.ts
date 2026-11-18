// The melody guide: the sung notes the studio finds in a clip's separated vocals (karaoke/melody.py), drawn as pitch
// bars scrolling past a playhead between the title and the lyrics, as karaoke/video.py draws them in the video.
import type { CardLayout } from './card-layout.ts';

/** A note: its start and end in seconds and its MIDI note number. */
export type Note = [number, number, number];

/** Where the lane lies in each layout, and where the line being sung moves to beside it (karaoke/video.py's GUIDES). */
export const GUIDE_LAYOUTS = {
  landscape: { laneTop: 132, laneBottom: 236, middle: 345, room: 210, saidMiddle: 320, saidRoom: 150 },
  portrait: { laneTop: 200, laneBottom: 366, middle: 560, room: 320, saidMiddle: 530, saidRoom: 220 },
} as const;
/** The lane shows this many seconds of notes, this many of them already sung (left of the playhead). */
export const GUIDE_SECONDS = 5, GUIDE_PAST = 1;
export const MAX_NOTES = 20000;

/** A card layout with the melody guide's lane in it. */
export function withGuide(place: CardLayout): CardLayout & { laneTop: number; laneBottom: number } {
  return { ...place, ...GUIDE_LAYOUTS[place.height > place.width ? 'portrait' : 'landscape'] };
}

/** The lane in a layout's own pixels: left, top, width and height, the playhead's x and the pixels a second takes. */
export function guideLane(place: CardLayout): { left: number; top: number; width: number; height: number; playhead: number; pps: number } {
  const guide = withGuide(place);
  return { left: (place.width - place.wrap) / 2, top: guide.laneTop, width: place.wrap, height: guide.laneBottom - guide.laneTop,
    playhead: (place.width - place.wrap) / 2 + place.wrap * GUIDE_PAST / GUIDE_SECONDS, pps: place.wrap / GUIDE_SECONDS };
}

/** The semitones the lane spans: the song's notes from its 5th to its 95th percentile note, two more either side, at
 * least an octave (karaoke/video.py's pitch_range). */
export function pitchRange(notes: readonly Note[]): [number, number] {
  const pitches = notes.map(note => note[2]).sort((a, b) => a - b);
  if (!pitches.length) pitches.push(60);
  let low = pitches[Math.floor(0.05 * (pitches.length - 1))]! - 2, high = pitches[Math.ceil(0.95 * (pitches.length - 1))]! + 2;
  if (high - low < 12) { const extra = 12 - (high - low); low -= Math.floor(extra / 2); high += extra - Math.floor(extra / 2); }
  return [low, high];
}

/** A note's bar in a lane `height` tall: its top and thickness, higher notes higher (karaoke/video.py's bar_box). */
export function barBox(pitch: number, low: number, high: number, height: number): [number, number] {
  const pad = height * 0.08, step = (height - 2 * pad) / (high - low + 1), thick = Math.max(height * 0.075, step * 0.8);
  const centre = pad + (high - Math.min(Math.max(pitch, low), high) + 0.5) * step;
  return [centre - thick / 2, thick];
}

/** Notes as the studio sends them, or null when the reply is not a list of [start, end, MIDI note] in order. */
export function parseNotes(value: unknown): Note[] | null {
  if (!Array.isArray(value) || value.length > MAX_NOTES) return null;
  let last = 0;
  const notes: Note[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 3 || !item.every(part => typeof part === 'number' && Number.isFinite(part))) return null;
    const [start, end, pitch] = item as Note;
    if (!Number.isInteger(pitch) || pitch < 21 || pitch > 108 || start < last - 1e-6 || end <= start) return null;
    notes.push([start, end, pitch]);
    last = end;
  }
  return notes;
}

/** The notes the lane shows at `time`, as bars from x0 to x1 in the layout's pixels: what lies left of the playhead is
 * sung. The lane's edges cut them, as the video's do. */
export function visibleBars(notes: readonly Note[], time: number, place: CardLayout): { x0: number; x1: number; top: number; thick: number; pitch: number }[] {
  const lane = guideLane(place), [low, high] = pitchRange(notes), bars = [];
  const first = time - GUIDE_PAST, last = time + GUIDE_SECONDS - GUIDE_PAST;
  for (const [start, end, pitch] of notes) {
    if (end < first || start > last) continue;
    const [top, thick] = barBox(pitch, low, high, lane.height);
    bars.push({ x0: lane.left + (start - first) * lane.pps, x1: lane.left + (end - first) * lane.pps, top: lane.top + top, thick, pitch });
  }
  return bars;
}
