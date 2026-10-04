import type { Composition, Note } from './types.ts';
import { validateComposition } from './model.ts';

/** Joint transition: semitone interval, next duration ticks, preceding rest ticks. */
export type JointToken = [interval: number, durationTicks: number, restTicks: number];
export type ContextOrder = 0 | 1 | 2;

export interface SeedSelection {
  trackId: string;
  count: number;
  notes: Note[];
  startTick: number;
  endTick: number;
}

export interface OutcomeCount {
  token: JointToken;
  count: number;
}

export interface ContextCount {
  order: ContextOrder;
  context: JointToken[];
  /** All observed successors, before pitch/time filtering. */
  contextRawSupport: number;
  outcomes: OutcomeCount[];
}

export interface FittedEnding {
  sourceNoteCount: number;
  transitionCount: number;
  tokens: JointToken[];
  /** Ordered by order, then numeric lexicographic context; outcomes likewise. */
  tables: ContextCount[];
  medianVelocity: number;
}

export interface StepSupport {
  order: ContextOrder;
  contextRawSupport: number;
  /** Sum of retained outcome occurrence counts: the sampling denominator. */
  eligibleWeight: number;
  /** Number of distinct retained outcomes, not a confidence measure. */
  eligibleCount: number;
}

export interface ContinuationProposal {
  base: Composition;
  selection: SeedSelection;
  length: 4 | 8;
  randomSeed: number;
  notes: Omit<Note, 'id'>[];
  steps: StepSupport[];
}

function checkCount(count: number): void {
  if (!Number.isInteger(count) || count < 8 || count > 64) {
    throw new Error('Choose an ending count from 8 to 64 notes.');
  }
}

function compareNotes(a: Note, b: Note): number {
  return a.start - b.start || (a.start + a.duration) - (b.start + b.duration)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Recheck the public selection API; do not trust a caller-created count/boundary. */
function validatedSelection(selection: SeedSelection): SeedSelection {
  if (!selection || typeof selection !== 'object') throw new Error('Invalid ending selection.');
  checkCount(selection.count);
  if (!Array.isArray(selection.notes) || selection.notes.length !== selection.count) {
    throw new Error('Ending selection must contain the chosen note count.');
  }
  const checked = validateComposition({ version: 1, title: 'Ending', tempo: 120, tracks: [{
    id: selection.trackId, name: 'Ending', instrument: 'sine', volume: 1, muted: false,
    notes: selection.notes,
  }] });
  const notes = checked.tracks[0].notes;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (!Number.isInteger(note.start * 4) || !Number.isInteger(note.duration * 4)) {
      throw new Error('The selected ending must use exact quarter-beat grid starts and durations. Edit these notes first.');
    }
    if (note.velocity <= 0) throw new Error('The selected ending contains a silent note. Raise its velocity first.');
    if (i && note.start < notes[i - 1].start + notes[i - 1].duration) {
      throw new Error('The selected ending must be monophonic, without simultaneous starts or overlapping notes.');
    }
  }
  const startTick = notes[0].start * 4;
  const endTick = (notes[notes.length - 1].start + notes[notes.length - 1].duration) * 4;
  if (endTick - startTick > 64) throw new Error('The selected ending span must be at most 16 beats.');
  if (selection.startTick !== startTick || selection.endTick !== endTick) {
    throw new Error('Ending selection tick boundaries do not match its notes.');
  }
  return { trackId: checked.tracks[0].id, count: selection.count, notes, startTick, endTick };
}

export function selectEnding(project: Composition, trackId: string, count: number): SeedSelection {
  checkCount(count);
  const checked = validateComposition(project);
  const track = checked.tracks.find(item => item.id === trackId);
  if (!track) throw new Error('The selected track no longer exists.');
  if (track.notes.length < count) throw new Error(`This track needs at least ${count} notes for the selected ending.`);
  const ordered = [...track.notes].sort(compareNotes);
  const notes = ordered.slice(-count);
  const first = notes[0];
  const last = notes[notes.length - 1];
  const selection = validatedSelection({
    trackId, count, notes, startTick: first.start * 4, endTick: (last.start + last.duration) * 4,
  });
  if (ordered.slice(0, -count).some(note => note.start + note.duration > first.start)) {
    throw new Error('An earlier unselected note overlaps the selected ending. Choose a monophonic ending.');
  }
  return selection;
}

function compareTokens(a: JointToken, b: JointToken): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function compareContexts(a: JointToken[], b: JointToken[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = compareTokens(a[i], b[i]);
    if (difference) return difference;
  }
  return a.length - b.length;
}

export function fitEnding(selection: SeedSelection): FittedEnding {
  const checked = validatedSelection(selection);
  const tokens: JointToken[] = checked.notes.slice(1).map((note, i) => {
    const previous = checked.notes[i];
    return [note.pitch - previous.pitch, note.duration * 4, (note.start - previous.start - previous.duration) * 4];
  });
  const counts = new Map<string, ContextCount>();
  for (let j = 0; j < tokens.length; j++) {
    for (const order of [0, 1, 2] as const) {
      if (j < order) continue;
      const context = tokens.slice(j - order, j).map(token => [...token] as JointToken);
      const key = JSON.stringify(context);
      let row = counts.get(key);
      if (!row) {
        row = { order, context, contextRawSupport: 0, outcomes: [] };
        counts.set(key, row);
      }
      row.contextRawSupport++;
      const token = tokens[j];
      const existing = row.outcomes.find(outcome => compareTokens(outcome.token, token) === 0);
      if (existing) existing.count++;
      else row.outcomes.push({ token: [...token] as JointToken, count: 1 });
    }
  }
  const tables = [...counts.values()].sort((a, b) => a.order - b.order || compareContexts(a.context, b.context));
  for (const row of tables) row.outcomes.sort((a, b) => compareTokens(a.token, b.token));
  const velocities = checked.notes.map(note => note.velocity).sort((a, b) => a - b);
  const middle = Math.floor(velocities.length / 2);
  const medianVelocity = velocities.length % 2 ? velocities[middle] : (velocities[middle - 1] + velocities[middle]) / 2;
  return { sourceNoteCount: checked.count, transitionCount: tokens.length, tokens, tables, medianVelocity };
}

function allIds(project: Composition): Set<string> {
  return new Set(project.tracks.flatMap(track => [track.id, ...track.notes.map(note => note.id)]));
}

/** Deterministic scratch IDs never consume or reserve the eventual applied UUIDs. */
function appendScratch(base: Composition, trackId: string, notes: Omit<Note, 'id'>[]): Composition {
  const checked = validateComposition(base);
  const track = checked.tracks.find(item => item.id === trackId);
  if (!track) throw new Error('The selected track no longer exists.');
  const used = allIds(checked);
  let serial = 0;
  for (const note of notes) {
    let id: string;
    do { id = `continuation-scratch-${serial++}`; } while (used.has(id));
    used.add(id);
    track.notes.push({ ...note, id });
  }
  return validateComposition(checked);
}

export function suggestEnding(project: Composition, trackId: string, count: number, length: 4 | 8, randomSeed: number): ContinuationProposal {
  if (length !== 4 && length !== 8) throw new Error('Continuation length must be 4 or 8 notes.');
  if (!Number.isInteger(randomSeed) || randomSeed <= 0 || randomSeed > 0xffffffff) {
    throw new Error('Suggestion seed must be a nonzero uint32 integer.');
  }
  const base = validateComposition(project);
  const track = base.tracks.find(item => item.id === trackId);
  if (!track) throw new Error('The selected track no longer exists.');
  if (track.notes.length + length > 256) throw new Error('This continuation would exceed the track capacity of 256 notes.');
  const selection = selectEnding(base, trackId, count);
  const fitted = fitEnding(selection);
  const history = [...fitted.tokens];
  const notes: Omit<Note, 'id'>[] = [];
  const steps: StepSupport[] = [];
  const maximumEnd = Math.min(512, selection.endTick + 64);
  let cursor = selection.endTick;
  let pitch = selection.notes[selection.notes.length - 1].pitch;
  let state = randomSeed;
  for (let i = 0; i < length; i++) {
    let selected: { row: ContextCount; eligible: OutcomeCount[] } | undefined;
    for (const order of [2, 1, 0] as const) {
      const context = order ? history.slice(-order) : [];
      const row = fitted.tables.find(table => table.order === order && compareContexts(table.context, context) === 0);
      if (!row || (order > 0 && row.contextRawSupport < 2)) continue;
      const eligible = row.outcomes.filter(({ token: [interval, durationTicks, restTicks] }) => {
        const nextPitch = pitch + interval;
        const end = cursor + restTicks + durationTicks;
        return nextPitch >= 36 && nextPitch <= 96 && end + (length - i - 1) <= maximumEnd;
      });
      if (eligible.length) { selected = { row, eligible }; break; }
    }
    if (!selected) {
      throw new Error('No learned transition fits the pitch range and remaining beat/time space. Try a different ending or fewer notes.');
    }
    const eligibleWeight = selected.eligible.reduce((sum, outcome) => sum + outcome.count, 0);
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const draw = state / 4294967296 * eligibleWeight;
    let cumulative = 0;
    const outcome = selected.eligible.find(item => { cumulative += item.count; return cumulative > draw; });
    // Positive counts and u<1 guarantee an outcome; do not substitute a fallback.
    if (!outcome) throw new Error('The learned sampling counts are invalid.');
    const [interval, durationTicks, restTicks] = outcome.token;
    pitch += interval;
    notes.push({ pitch, start: (cursor + restTicks) / 4, duration: durationTicks / 4, velocity: fitted.medianVelocity });
    cursor += restTicks + durationTicks;
    history.push(outcome.token);
    steps.push({
      order: selected.row.order, contextRawSupport: selected.row.contextRawSupport,
      eligibleWeight, eligibleCount: selected.eligible.length,
    });
  }
  appendScratch(base, trackId, notes);
  return { base, selection, length, randomSeed, notes, steps };
}

/** Ephemeral proposals still receive a deterministic recheck before use. */
function checkedProposal(proposal: ContinuationProposal): ContinuationProposal {
  if (!proposal || typeof proposal !== 'object' || !proposal.selection) throw new Error('Invalid continuation proposal.');
  const expected = suggestEnding(proposal.base, proposal.selection.trackId, proposal.selection.count, proposal.length, proposal.randomSeed);
  if (JSON.stringify(proposal.selection) !== JSON.stringify(expected.selection)
    || JSON.stringify(proposal.notes) !== JSON.stringify(expected.notes)
    || JSON.stringify(proposal.steps) !== JSON.stringify(expected.steps)) {
    throw new Error('The continuation proposal was modified; generate it again.');
  }
  return expected;
}

export function applyContinuation(current: Composition, proposal: ContinuationProposal): Composition {
  const checked = validateComposition(current);
  if (!proposal || JSON.stringify(checked) !== JSON.stringify(validateComposition(proposal.base))) {
    throw new Error('The composition snapshot changed. Generate a new continuation.');
  }
  const expected = checkedProposal(proposal);
  const track = checked.tracks.find(item => item.id === expected.selection.trackId)!;
  const used = allIds(checked);
  for (const note of expected.notes) {
    let id: string | undefined;
    // A broken randomness provider must not turn Apply into an unbounded loop.
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = crypto.randomUUID();
      if (!used.has(candidate)) { id = candidate; break; }
    }
    if (!id) throw new Error('Could not allocate distinct note IDs. The composition was not changed.');
    used.add(id);
    track.notes.push({ ...note, id });
  }
  return validateComposition(checked);
}

export function auditionComposition(proposal: ContinuationProposal): Composition {
  const checked = checkedProposal(proposal);
  const candidate = appendScratch(checked.base, checked.selection.trackId, checked.notes);
  const source = candidate.tracks.find(track => track.id === checked.selection.trackId)!;
  const newNotes = source.notes.slice(-checked.length);
  const shift = checked.selection.startTick / 4;
  const notes = [...checked.selection.notes, ...newNotes].map(note => ({ ...note, start: note.start - shift }));
  return validateComposition({
    version: 1, title: checked.base.title, tempo: checked.base.tempo,
    tracks: [{ ...source, notes }],
  });
}
