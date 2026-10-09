import { reverseSection } from './section-reverse.ts';
import { transposeSection, invertSection } from './section-pitch.ts';
import { quantizeSection } from './quantize.ts';
import { DEFAULT_ECHO, validateEcho } from './sound-echo.ts';
import { DEFAULT_ENVELOPE, ENVELOPE_KEYS, validateEnvelope } from './sound-envelope.ts';
import { DEFAULT_FILTER, validateFilter } from './sound-filter.ts';
import { isolatedTrack } from './track-render.ts';
import { createTimingView } from './timing-view.ts';
import { MAX_COMPOSITION_BEATS } from './limits.ts';
import { applyVelocityRamp } from './velocity-ramp.ts';
import { duplicateSection, removeSection } from './section-arrangement.ts';
import { sectionWindow, type SectionRange } from './section.ts';
import './style.css';
import { createLibraryView } from './library-view.ts';
import { createComposition, createDemoComposition, createNote, createTrack, validateComposition, compositionDurationBeats } from './model.ts';
import { createDemoMelody } from './audio.ts';
import { encodeMidi } from './midi.ts';
import { MelodyRecorder } from './recorder.ts';
import { BackedRecorder, type BackedProgress, type BackedCapture } from './backed-recorder.ts';
import { backingComposition } from './backing.ts';
import { loadProject } from './storage.ts';
import { notesOnly, withComposition, ReferenceHistory } from './reference-project.ts';
import { normalizeReference, referenceWindow, referenceSamples, comparisonComposition, cropComparison } from './reference-audio.ts';
import { encodeProjectBackup, decodeProjectBackup } from './reference-backup.ts';
import { ReferenceStorage, SavedCopyConflict } from './reference-storage.ts';
import { REFERENCE_LIMITS, type MelodyDocument, type ReferenceAsset, type ReferenceBundle, type ReferenceKind } from './reference-types.ts';
import { duplicateTrack, transposeTrack, repeatTrack } from './arrangement.ts';
import { selectEnding, suggestEnding, applyContinuation, auditionComposition, type ContinuationProposal, type SeedSelection } from './continuation.ts';
import { parseMidi, MIDI_IMPORT_LIMITS, type MidiPreview, type MidiName } from './midi-import.ts';
import { buildMidiReview, applyMidiImport, type MidiImportReview, type MidiImportChoices } from './midi-review.ts';
import type { Composition, Note, Track } from './types.ts';
import { createRollController } from './roll-controller.ts';
import type { RollSnap } from './roll-edit.ts';

const root = document.querySelector<HTMLDivElement>('#app')!;
const app = document.createElement('div');
const midiHost = document.createElement('section');
midiHost.id = 'midi-import'; midiHost.setAttribute('aria-labelledby', 'midi-heading');
const referenceHost = document.createElement('section');
referenceHost.id = 'reference-panel'; referenceHost.setAttribute('aria-labelledby', 'reference-heading');
const libraryHost = document.createElement('section');
libraryHost.id = 'composition-library'; libraryHost.setAttribute('aria-labelledby', 'library-heading');
const timingHost = document.createElement('section');
timingHost.id = 'track-timing'; timingHost.setAttribute('aria-labelledby', 'timing-heading');
root.append(app, timingHost, libraryHost, referenceHost, midiHost);
let timingView: ReturnType<typeof createTimingView> | null = null;
let libraryView: ReturnType<typeof createLibraryView> | null = null;
let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* Recovery is shown in the interface. */ }
let project = createComposition();
let history = new ReferenceHistory({ document: notesOnly(project), assets: [] });
let completeStorage: ReferenceStorage | null = null;
try { completeStorage = new ReferenceStorage(window.indexedDB); } catch { /* Protected recovery below. */ }
let startup = true, recovery = false, unsaved = false, saving = false, saveFailed = false, hasSavedCopy = false;
let savePending: { bundle: ReferenceBundle; generation: number } | null = null;
let replacing = false, replacementEpoch = 0, saveUiEpoch = 0, manualSaveRequired = false;
let loadEpoch = 0, projectFileEpoch = 0, projectFileReading = false;
let pendingLoad: { epoch: number; retired: boolean } | null = null;
let capture: Capture | null = null;
let nativeAudioPending = false;
// Cancel retires a recorder generation immediately; native microphone permission
// still owns cleanup until each start promise settles (including a late stream).
let pendingMicrophoneStarts = 0;
let comparisonOwner: { key: string; generation: number; window: string } | null = null;
const windowDrafts = new Map<string, { start: string; end: string }>();
let referenceKey = '';
let referenceMessage = '';
let actionPointer: { button: HTMLButtonElement; id: number; rect: DOMRect; cancelClick: boolean } | null = null;
let deferredRender = false;
let pointerReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let activeTrackId = project.tracks[0].id;
let selectedNoteId: string | null = null;
let message = 'Loading the complete saved project…';
let saveMessage = 'Loading saved project…';
let busy: 'loading' | 'requesting' | 'counting-in' | 'recording' | 'processing' | 'rendering' | null = 'loading';
let operation = 0;
let worker: Worker | null = null;
let rejectWorker: ((reason: Error) => void) | null = null;
let recordingTimer: ReturnType<typeof setInterval> | null = null;
let recordedAt = 0;
const recorder = new MelodyRecorder();
const backedRecorder = new BackedRecorder();
let backedCaptureLabel = '';
let audioContext: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let playbackGeneration = 0;
let playing = false;
let sectionStart = '1';
let sectionEnd = '5';
let rampStart = '0.3', rampEnd = '0.9';
let quantizeGrid = '0.25', quantizeStrength = '1';
let compositionGeneration = 0;
let proposal: ContinuationProposal | null = null;
let proposalGeneration = -1;
let seedCountText = String(Math.max(8, Math.min(16, project.tracks[0].notes.length)));
let continuationLength: 4 | 8 = 4;
let playbackJob: { token: number } | null = null;
let auditionOwner: ContinuationProposal | null = null;
type NoteDraft = Record<'pitch' | 'start' | 'duration' | 'velocity', string>;
const noteDrafts = new Map<string, NoteDraft>();
const fieldDrafts = new Map<string, string | boolean>();
const projectFields = new Set(['project-title', 'tempo']);
const envelopeFields = ENVELOPE_KEYS.map(key => `sound-${key}`);
const echoFields = ['echo-enabled', 'echo-beats', 'echo-decay', 'echo-repeats'];
const filterFields = ['filter-enabled', 'filter-cutoff', 'filter-resonance'];
const trackFields = new Set(['track-name', 'instrument', 'volume', 'muted', ...envelopeFields, ...filterFields, ...echoFields]);
function envelopeValues(track: Track): Record<string, string> { const envelope = track.envelope ?? DEFAULT_ENVELOPE; return Object.fromEntries(ENVELOPE_KEYS.map(key => [`sound-${key}`, String(envelope[key])])); }
function echoValues(track: Track): Record<string, string | boolean> { const echo = track.echo ?? DEFAULT_ECHO; return { 'echo-enabled': !!track.echo, 'echo-beats': String(echo.beats), 'echo-decay': String(echo.decay), 'echo-repeats': String(echo.repeats) }; }
function filterValues(track: Track): Record<string, string | boolean> { const filter = track.filter ?? DEFAULT_FILTER; return { 'filter-enabled': !!track.filter, 'filter-cutoff': String(filter.cutoff), 'filter-resonance': String(filter.resonance) }; }
let editorIntent = 0;
let rollTool: 'move' | 'draw' = 'move';
let rollSnap: RollSnap = .25;
let rollMessage = 'Drag notes to move them; drag the right edge to resize. Arrow keys edit a focused note.';
const roll = createRollController(root, {
  state: () => ({ composition: project, trackId: currentTrack().id, generation: compositionGeneration, intent: editorIntent,
    tool: rollTool, snap: rollSnap, blocked: startup || !!busy, drafts: fieldDrafts.size > 0 || noteDrafts.size > 0 }),
  begin: () => newEditorIntent(),
  publish: (next, noteId) => {
    const previous = selectedNoteId; selectedNoteId = noteId;
    if (commit(next, 'Piano roll edit applied. Undo restores the previous notes.')) return true;
    selectedNoteId = previous; return false;
  },
  status: text => { rollMessage = text; const node = app.querySelector('#roll-status'); if (node) node.textContent = text; },
});
let midiEpoch = 0;
let midiReading = false;
let midiSource: MidiPreview | null = null;
let midiReview: MidiImportReview | null = null;
let reviewedIntent = -1, reviewedGeneration = -1, reviewedEpoch = -1;
function fieldKey(id: string): string { return projectFields.has(id) ? id : `${activeTrackId}:${id}`; }
function fieldValue(id: string, value: string | number | boolean): string | boolean { return fieldDrafts.get(fieldKey(id)) ?? (typeof value === 'boolean' ? value : String(value)); }
function soundDraftGuard(fields: readonly string[] = envelopeFields): boolean {
  const own = new Set(fields.map(fieldKey));
  if (roll.active || noteDrafts.size || proposal || [...fieldDrafts.keys()].some(key => !own.has(key))) {
    announce('Apply or discard other editor drafts and suggestions, and finish the piano roll gesture before applying track sound settings. Your drafts are kept.'); return false;
  }
  return true;
}
function settleSoundFields(fields: readonly string[] = envelopeFields): void {
  const values = { ...envelopeValues(currentTrack()), ...filterValues(currentTrack()), ...echoValues(currentTrack()) };
  for (const id of fields) { fieldDrafts.delete(fieldKey(id)); const input = app.querySelector<HTMLInputElement>(`#${id}`); if (input) { if (input.type === 'checkbox') input.checked = values[id] === true; else input.value = String(values[id]); } }
  updateMidiControls();
}
function numericDraft(value: string, label: string): number {
  if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`Enter a nonempty finite number for ${label}. Your draft is kept.`);
  return Number(value);
}
function scratchExists(): boolean { return fieldDrafts.size > 0 || noteDrafts.size > 0 || proposal !== null; }
function newEditorIntent() {
  timingView?.retire();
  libraryView?.retire();
  roll.cancel();
  editorIntent++;
  const hadProjectRead = projectFileReading;
  projectFileEpoch++; projectFileReading = false;
  if (hadProjectRead) announce('The editor changed. The staged project import was cancelled; choose the file again.');
  if (capture) retireCapture();
  const hadImport = midiReading || midiSource !== null || midiReview !== null;
  midiReading = false; midiReview = null;
  const ack = midiHost.querySelector<HTMLInputElement>('#midi-discard-ack'); if (ack) ack.checked = false;
  if (hadImport) midiStatus('The editor changed. Review this phrase again. If a file was still loading, choose it again.');
  updateMidiControls(); updateReference(); timingView?.sync();
}
function commitField(id: string, action: () => boolean) {
  const key = fieldKey(id), raw = fieldDrafts.get(key);
  if (!action()) return;
  if (fieldDrafts.get(key) === raw) fieldDrafts.delete(key);
  const track = currentTrack();
  const values: Record<string, string | number | boolean> = { 'project-title': project.title, tempo: project.tempo, 'track-name': track.name, instrument: track.instrument, volume: track.volume, muted: track.muted, ...envelopeValues(track), ...filterValues(track), ...echoValues(track) };
  const node = app.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  if (node instanceof HTMLInputElement && node.type === 'checkbox') node.checked = Boolean(values[id]);
  else if (node) node.value = String(values[id]);
  updateMidiControls();
}

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const noteName = (pitch: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
const currentTrack = (): Track => project.tracks.find(track => track.id === activeTrackId) ?? project.tracks[0];
const disabled = () => busy || startup ? 'disabled' : '';

function announce(text: string) {
  message = text;
  document.querySelector('#notice')!.textContent = message;
}

function commit(next: Composition, text?: string, redraw = true, document?: MelodyDocument, incoming: readonly ReferenceAsset[] = []) {
  try {
    const validated = validateComposition(next);
    const changed = history.commit(document ?? withComposition(history.current, validated), incoming);
    const hadProposal = proposal !== null;
    if (changed) { compositionGeneration++; newEditorIntent(); clearContinuation(); stopPlayback(false); }
    project = history.current.composition;
    if (!project.tracks.some(track => track.id === activeTrackId)) { activeTrackId = project.tracks[0].id; defaultSeedCount(); }
    pruneNoteDrafts();
    if (changed) queueSave();
    if (text) message = text;
    const hasTrackControl = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-track]')).some(button => button.dataset.track === currentTrack().id);
    if (redraw || changed && hadProposal || !hasTrackControl) render();
    else {
      syncSaveStatus();
      documentNode('#notice').textContent = message;
      refreshTrackLabels(); syncHistory(); updateReference();
    }
    return true;
  } catch (error) {
    announce(error instanceof Error ? error.message : 'That change is not valid.');
    return false;
  }
}

function editTrack(update: (track: Track) => void, text?: string, redraw = true) {
  const next = structuredClone(project);
  update(next.tracks.find(track => track.id === activeTrackId) ?? next.tracks[0]);
  return commit(next, text, redraw);
}

function refreshTrackLabels() {
  const track = currentTrack();
  const button = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-track]')).find(button => button.dataset.track === track.id)!;
  button.setAttribute('aria-label', `Select track: ${track.name}`);
  button.querySelector('strong')!.textContent = track.name;
  button.querySelector('small')!.textContent = `${track.notes.length} notes · ${track.muted ? 'muted' : { sine: 'Soft keys', triangle: 'Warm flute', sawtooth: 'Bright synth' }[track.instrument]}`;
  app.querySelector('.editor-heading h2')!.textContent = track.name;
  app.querySelector('label[for=volume] span')!.textContent = `${Math.round(track.volume * 100)}%`;
}

function syncHistory() {
  const undo = app.querySelector<HTMLButtonElement>('[data-action=undo]');
  const redo = app.querySelector<HTMLButtonElement>('[data-action=redo]');
  if (undo) undo.disabled = !!busy || !history.canUndo;
  if (redo) redo.disabled = !!busy || !history.canRedo;
}

function restoreHistory(direction: 'undo' | 'redo') {
  if (busy) return;
  const next = history[direction]();
  if (!next) return;
  compositionGeneration++; newEditorIntent(); clearContinuation();
  stopPlayback(false);
  project = next.composition;
  pruneNoteDrafts();
  if (!project.tracks.some(track => track.id === activeTrackId)) activeTrackId = project.tracks[0].id;
  if (!currentTrack().notes.some(note => note.id === selectedNoteId)) selectedNoteId = null;
  queueSave();
  message = direction === 'undo' ? 'Undid the last change.' : 'Restored the next change.';
  render();
}

function arrange(action: string) {
  try {
    let next: Composition;
    let duplicateId: string | null = null;
    let document: MelodyDocument | undefined;
    if (action === 'duplicate-track') {
      const sourceId = currentTrack().id;
      next = duplicateTrack(project, sourceId);
      duplicateId = next.tracks[project.tracks.findIndex(track => track.id === sourceId) + 1].id;
      document = withComposition(history.current, next);
      const binding = history.current.references.find(item => item.trackId === sourceId);
      if (binding) document.references.push({ trackId: duplicateId, assetId: binding.assetId });
    } else if (action === 'repeat-phrase') next = repeatTrack(project, currentTrack().id);
    else next = transposeTrack(project, currentTrack().id, Number(action.slice('transpose:'.length)));
    if (commit(next, action === 'duplicate-track' ? 'Track duplicated, sharing its unchanged reference.' : action === 'repeat-phrase' ? 'Phrase repeated. Undo restores its original length.' : 'Track transposed. Undo restores the original pitches.', false, document)) {
      if (duplicateId) { activeTrackId = duplicateId; selectedNoteId = null; defaultSeedCount(); }
      render();
    }
  } catch (error) { announce(error instanceof Error ? error.message : 'Could not arrange this track.'); }
}

function pruneNoteDrafts(): void {
  const ids = new Set(project.tracks.flatMap(track => track.notes.map(note => note.id)));
  for (const id of noteDrafts.keys()) if (!ids.has(id)) noteDrafts.delete(id);
  for (const key of fieldDrafts.keys()) if (!projectFields.has(key) && !project.tracks.some(track => key.startsWith(`${track.id}:`))) fieldDrafts.delete(key);
}
function clearContinuation(): void {
  proposal = null; proposalGeneration = -1;
  if (auditionOwner) stopPlayback(false);
}
function defaultSeedCount(): void { seedCountText = String(Math.max(8, Math.min(16, currentTrack().notes.length))); }
function readSeedCount(): number {
  if (!/^(?:[89]|[1-5][0-9]|6[0-4])$/.test(seedCountText)) throw new Error('Choose a whole number of source notes from 8 to 64. Your input is kept.');
  return Number(seedCountText);
}
function noteValues(note: Note): NoteDraft {
  return { pitch: String(note.pitch), start: String(note.start + 1), duration: String(note.duration), velocity: String(note.velocity) };
}
function noteDraftGuard(): boolean {
  if (selectedNoteId && noteDrafts.has(selectedNoteId)) {
    announce('Apply or discard your note edits first. Your draft is kept.'); return false;
  }
  return true;
}
function suggestContinuation(): void {
  if (busy || !noteDraftGuard()) return;
  try {
    const count = readSeedCount();
    const random = new Uint32Array(1); crypto.getRandomValues(random);
    // xorshift32 excludes zero; selecting one here keeps generation bounded.
    const next = suggestEnding(project, currentTrack().id, count, continuationLength, random[0] || 1);
    const repeats = proposal !== null && JSON.stringify(proposal.notes) === JSON.stringify(next.notes);
    clearContinuation(); proposal = next; proposalGeneration = compositionGeneration;
    message = repeats ? 'The learned counts produced the same suggestion. Repetition is expected with a small phrase.' : 'Suggested notes are not saved. Audition, apply, or discard this local pattern variation.';
    render();
  } catch (error) { announce(error instanceof Error ? error.message : 'Could not suggest a continuation. Your notes are unchanged.'); }
}
function applyProposal(): void {
  if (busy || !proposal || !noteDraftGuard()) return;
  if (proposalGeneration !== compositionGeneration || proposal.selection.trackId !== activeTrackId) {
    clearContinuation(); message = 'The source changed. Generate a new suggestion.'; render(); return;
  }
  try { commit(applyContinuation(project, proposal), 'Continuation applied. Undo restores the original phrase.'); }
  catch (error) { announce(error instanceof Error ? error.message : 'Could not apply the continuation.'); }
}
function auditionProposal(): void {
  if (busy || !proposal || !noteDraftGuard()) return;
  const captured = proposal;
  if (proposalGeneration !== compositionGeneration || captured.selection.trackId !== activeTrackId) { announce('The source changed. Generate a new suggestion.'); return; }
  if (currentTrack().muted || currentTrack().volume === 0) { announce('Unmute or raise volume, then regenerate to audition.'); return; }
  try { void playSnapshot(auditionComposition(captured), 'Playing the selected ending and unsaved suggestion, solo.', captured); }
  catch (error) { announce(error instanceof Error ? error.message : 'Could not audition the suggestion.'); }
}
function continuationPanel(selection: SeedSelection | null, error: string): string {
  const muted = currentTrack().muted || currentTrack().volume === 0;
  const pending = proposal;
  const sourceDescription = selection
    ? `${selection.count} source notes · ${selection.count - 1} observed transitions · ${noteName(selection.notes[0].pitch)} to ${noteName(selection.notes.at(-1)!.pitch)} · beats ${selection.startTick / 4 + 1}–${selection.endTick / 4 + 1}`
    : error;
  return `<section id="continuation-panel" class="continuation-panel" aria-labelledby="continuation-heading">
    <p class="eyebrow">LEARN FROM YOUR OWN ENDING</p><h2 id="continuation-heading">Continue this phrase</h2>
    <p class="small">A local pattern suggestion learned only from this ending. Small samples often repeat; this does not learn your general style or judge musical quality.</p>
    <div class="continuation-controls"><label for="continuation-count">Learn from last notes<input id="continuation-count" type="text" inputmode="numeric" maxlength="12" value="${escape(seedCountText)}" ${disabled()} aria-describedby="continuation-source" /></label>
    <label for="continuation-length">Suggested notes<select id="continuation-length" ${disabled()}><option value="4" ${continuationLength === 4 ? 'selected' : ''}>4 notes</option><option value="8" ${continuationLength === 8 ? 'selected' : ''}>8 notes</option></select></label>
    <button data-action="suggest-continuation" ${busy || !selection ? 'disabled' : ''}>${pending ? 'Another suggestion' : 'Suggest continuation'}</button></div>
    <p id="continuation-source" class="small ${selection ? '' : 'continuation-error'}">${escape(currentTrack().name)}: ${escape(sourceDescription)}</p>
    <p class="small">Use 8–64 audible, nonoverlapping notes on a quarter-beat grid, spanning at most 16 beats. Suggestions add at most 16 beats. Repeat phrase remains available for an exact copy.</p>
    ${pending ? `<div id="continuation-proposal"><h3>Suggested notes — not saved</h3>
      <div class="proposal-table-wrap" role="region" aria-label="Suggested continuation notes" tabindex="0"><table id="proposal-notes"><caption>Read-only proposal. Start beats are one-based; rests are measured from the previous note end.</caption><thead><tr><th scope="col">Note</th><th scope="col">Pitch</th><th scope="col">Start beat</th><th scope="col">Duration</th><th scope="col">Rest before</th><th scope="col">Velocity</th></tr></thead><tbody>
      ${pending.notes.map((note, index) => `<tr data-proposal-index="${index}" data-pitch="${note.pitch}" data-start="${note.start}" data-duration="${note.duration}" data-velocity="${note.velocity}"><th scope="row">${index + 1}</th><td>${noteName(note.pitch)} (${note.pitch})</td><td>${note.start + 1}</td><td>${note.duration} beats</td><td>${note.start - (index ? pending.notes[index - 1].start + pending.notes[index - 1].duration : pending.selection.endTick / 4)} beats</td><td>${note.velocity}</td></tr>`).join('')}</tbody></table></div>
      <details><summary>Observed pattern support</summary><p class="small">${pending.selection.count} source notes and ${pending.selection.count - 1} transitions. Higher context orders require repeated observations. Counts describe this phrase, not confidence or musical quality.</p><ol>${pending.steps.map(step => `<li>Context order ${step.order} · ${step.contextRawSupport} observed successors before boundary filtering · ${step.eligibleWeight} retained occurrences used for sampling · ${step.eligibleCount} distinct eligible outcomes</li>`).join('')}</ol></details>
      <div class="button-row"><button data-action="audition-continuation" ${busy || muted ? 'disabled' : ''}>Audition ending + suggestion</button><button data-action="apply-continuation" ${disabled()}>Apply continuation</button><button data-action="discard-continuation" ${busy && !auditionOwner ? 'disabled' : ''}>Discard suggestion</button></div>
      ${muted ? '<p class="continuation-error">Unmute or raise volume, then regenerate to audition.</p>' : '<p class="small">Audition plays only this ending and proposal, using the selected track’s instrument and volume.</p>'}
      <p class="small">Project, MIDI and WAV exports contain committed notes only. Apply once to save these notes; Undo reverses that one edit.</p></div>` : ''}
  </section>`;
}

function render() {
  roll.cancel('The workspace refreshed. Start the piano roll edit again.');
  if (actionPointer) { deferredRender = true; return; }
  deferredRender = false;
  const oldRoll = app.querySelector<HTMLElement>('.piano-roll');
  const rollScroll = oldRoll ? { left: oldRoll.scrollLeft, top: oldRoll.scrollTop } : null;
  const focused = document.activeElement as HTMLElement | null;
  const inputSelection = focused instanceof HTMLInputElement && app.contains(focused)
    ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null;
  let focusSelector: string | null = null;
  if (focused && app.contains(focused)) {
    if (focused.id) focusSelector = `#${CSS.escape(focused.id)}`;
    else for (const attribute of ['name', 'data-action', 'data-note', 'data-track']) {
      const value = focused.getAttribute(attribute);
      if (value) { focusSelector = `[${attribute}="${CSS.escape(value)}"]`; break; }
    }
  }
  const track = currentTrack();
  const note = track.notes.find(item => item.id === selectedNoteId);
  const draft = note ? noteDrafts.get(note.id) ?? noteValues(note) : null;
  let selection: SeedSelection | null = null, seedError = '';
  try { selection = selectEnding(project, track.id, readSeedCount()); }
  catch (error) { seedError = error instanceof Error ? error.message : 'Choose a valid phrase ending.'; }
  const seedIds = new Set(selection?.notes.map(item => item.id));
  const proposedNotes = proposal?.notes ?? [];
  const totalNotes = project.tracks.reduce((count, item) => count + item.notes.length, 0);
  const beats = Math.max(8, Math.ceil(Math.max(compositionDurationBeats(project), ...proposedNotes.map(item => item.start + item.duration)) / 4) * 4);
  const pitches = [...track.notes, ...proposedNotes].map(item => item.pitch);
  const bottom = Math.max(36, Math.min(60, ...pitches) - 2);
  const top = Math.min(96, Math.max(72, ...pitches) + 2);
  const rows = top - bottom + 1;
  app.innerHTML = `
    <header class="site-header"><div class="brand"><span class="brand-mark" aria-hidden="true">m<span>♪</span></span><div><p class="eyebrow">FROM A HUM TO SOMETHING MORE</p><h1>Melody Studio</h1></div></div><span class="privacy-badge"><span aria-hidden="true">●</span> Made here. Stays here.</span></header>
    <main id="workspace">
      <section class="project-bar" aria-label="Project settings"><div class="project-title"><label for="project-title">Project title</label><input id="project-title" value="${escape(String(fieldValue('project-title', project.title)))}" maxlength="80" ${disabled()} /></div><div class="tempo-field"><label for="tempo">Tempo (BPM)</label><input id="tempo" type="number" min="40" max="240" step="any" value="${escape(String(fieldValue('tempo', project.tempo)))}" ${disabled()} /></div><div class="transport"><button class="primary" data-action="play" ${busy || !totalNotes || playing ? 'disabled' : ''} aria-label="Play composition"><span aria-hidden="true">▶</span> Play</button><button data-action="stop" ${!playing && !playbackJob && !capture?.backed ? 'disabled' : ''} aria-label="Stop playback">■ Stop</button></div><div class="history-controls"><button data-action="undo" title="Undo (Ctrl/Cmd+Z)" ${busy || !history.canUndo ? 'disabled' : ''}>Undo</button><button data-action="redo" title="Redo (Ctrl/Cmd+Shift+Z)" ${busy || !history.canRedo ? 'disabled' : ''}>Redo</button></div><span class="project-stats">${project.tracks.length} ${project.tracks.length === 1 ? 'track' : 'tracks'} · ${totalNotes} notes</span></section>
      <div id="notice" class="notice" role="status" aria-live="polite">${escape(message)}</div>
      <section class="capture-card" aria-labelledby="capture-heading"><div><p class="eyebrow">01 / CATCH AN IDEA</p><h2 id="capture-heading">Your next song starts with a hum.</h2><p>Sing one clear melody, then make it your own.<br />Record up to 20 seconds or bring in an audio file.</p></div><div class="capture-controls"><div class="button-row"><button class="record-button" data-action="record" ${disabled()}><span class="record-dot" aria-hidden="true"></span> Record melody</button><button id="record-backed" data-action="record-backed" ${disabled()}>Record with backing</button><label class="file-button ${busy ? 'is-disabled' : ''}">Import audio<input id="audio-file" type="file" accept="audio/*" aria-label="Import audio file" ${disabled()} /></label></div><div class="button-row"><button class="quiet" data-action="demo" ${disabled()}>Try demo melody</button><span class="small">No microphone needed</span></div><p class="small backing-guidance">Record with backing uses the other committed tracks and a four-beat count-in. Apply or discard unapplied fields and suggestions first. Use headphones, then listen back and check the detected timing.</p><div class="capture-progress" ${!busy || busy === 'loading' ? 'hidden' : ''}><span id="capture-state">${capture?.backed ? escape(backedCaptureLabel) : busy === 'requesting' ? 'Waiting for microphone permission…' : busy === 'recording' ? 'Recording…' : busy === 'rendering' ? 'Rendering your composition…' : 'Finding the notes…'}</span><button data-action="finish-record" ${capture?.backed ? (busy !== 'recording' ? 'disabled' : '') : (busy !== 'recording' ? 'hidden' : '')}>Finish recording</button><button data-action="cancel">Cancel</button></div></div></section>
      <section class="studio" aria-label="Composition editor"><aside class="tracks-panel"><div class="section-heading"><div><p class="eyebrow">02 / BUILD YOUR SOUND</p><h2>Tracks</h2></div><button class="icon-button" data-action="add-track" aria-label="Add track" ${busy || project.tracks.length >= 8 ? 'disabled' : ''}>+</button></div><div class="track-list">${project.tracks.map((item, index) => `<button class="track-card ${item.id === track.id ? 'is-selected' : ''}" data-track="${escape(item.id)}" aria-label="Select track: ${escape(item.name)}" aria-pressed="${item.id === track.id}" ${disabled()}><span class="track-icon" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span><strong>${escape(item.name)}</strong><small>${item.notes.length} notes · ${item.muted ? 'muted' : item.instrument === 'sine' ? 'Soft keys' : item.instrument === 'triangle' ? 'Warm flute' : 'Bright synth'}</small></span></button>`).join('')}</div><div class="track-settings"><label for="track-name">Track name</label><input id="track-name" value="${escape(String(fieldValue('track-name', track.name)))}" maxlength="80" ${disabled()} /><label for="instrument">Instrument</label><select id="instrument" ${disabled()}><option value="sine" ${fieldValue('instrument', track.instrument) === 'sine' ? 'selected' : ''}>Soft keys</option><option value="triangle" ${fieldValue('instrument', track.instrument) === 'triangle' ? 'selected' : ''}>Warm flute</option><option value="sawtooth" ${fieldValue('instrument', track.instrument) === 'sawtooth' ? 'selected' : ''}>Bright synth</option></select><label for="volume">Track volume <span>${Math.round(track.volume * 100)}%</span></label><input id="volume" type="range" min="0" max="1" step="0.05" value="${escape(String(fieldValue('volume', track.volume)))}" ${disabled()} /><label class="checkbox-label"><input id="muted" type="checkbox" ${fieldValue('muted', track.muted) ? 'checked' : ''} ${disabled()} /> Mute track</label><fieldset class="sound-envelope"><legend>Sound envelope</legend>${ENVELOPE_KEYS.map(key => `<label for="sound-${key}">${key[0].toUpperCase()+key.slice(1)}${key === 'sustain' ? ' level' : ' (seconds)'}</label><input id="sound-${key}" type="number" min="0" max="${key === 'sustain' ? 1 : 2}" step="any" value="${escape(String(fieldValue(`sound-${key}`, (track.envelope ?? DEFAULT_ENVELOPE)[key])))}" ${disabled()} />`).join('')}<button data-action="apply-envelope" ${disabled()}>Apply sound envelope</button><button class="quiet" data-action="discard-envelope" ${disabled()}>Discard sound edits</button><p class="small">Linear attack, decay, sustain and release. Project/WAV retain this sound; MIDI does not carry custom envelopes.</p></fieldset><fieldset class="sound-envelope"><legend>Sound filter</legend><label class="checkbox-label"><input id="filter-enabled" type="checkbox" ${fieldValue('filter-enabled', !!track.filter) ? 'checked' : ''} ${disabled()} /> Enable low-pass filter</label><label for="filter-cutoff">Filter cutoff (Hz)</label><input id="filter-cutoff" type="number" min="20" max="10000" step="any" value="${escape(String(fieldValue('filter-cutoff', (track.filter ?? DEFAULT_FILTER).cutoff)))}" ${disabled()} /><label for="filter-resonance">Filter resonance (Q)</label><input id="filter-resonance" type="number" min="0.5" max="8" step="any" value="${escape(String(fieldValue('filter-resonance', (track.filter ?? DEFAULT_FILTER).resonance)))}" ${disabled()} /><button data-action="apply-filter" ${disabled()}>Apply sound filter</button><button class="quiet" data-action="discard-filter" ${disabled()}>Discard filter edits</button><p class="small">Cut bright harmonics; raise Q for emphasis near the cutoff. Apply with Enable unchecked to bypass. Project/WAV retain this sound; MIDI does not.</p></fieldset><fieldset class="sound-envelope"><legend>Sound echo</legend><label class="checkbox-label"><input id="echo-enabled" type="checkbox" ${fieldValue('echo-enabled', !!track.echo) ? 'checked' : ''} ${disabled()} /> Enable rhythmic echo</label>${(['beats','decay','repeats'] as const).map(key => `<label for="echo-${key}">${key === 'beats' ? 'Echo spacing (beats)' : key === 'decay' ? 'Echo decay' : 'Echo repeats'}</label><input id="echo-${key}" type="number" min="${key === 'beats' ? .25 : key === 'decay' ? .05 : 1}" max="${key === 'beats' ? 4 : key === 'decay' ? .95 : 8}" step="${key === 'repeats' ? 1 : 'any'}" value="${escape(String(fieldValue(`echo-${key}`, (track.echo ?? DEFAULT_ECHO)[key])))}" ${disabled()} />`).join('')}<button data-action="apply-echo" ${disabled()}>Apply sound echo</button><button class="quiet" data-action="discard-echo" ${disabled()}>Discard echo edits</button><p class="small">Repeat each voice at beat intervals with decaying level. Full WAV includes the tail; sections crop it. MIDI omits echo.</p></fieldset><button class="quiet" data-action="solo-track" ${busy || playing || !track.notes.length ? 'disabled' : ''}>Solo track</button><button class="quiet danger" data-action="delete-track" ${busy || project.tracks.length <= 1 ? 'disabled' : ''}>Delete track</button></div><div class="arrangement-tools"><p class="eyebrow">ARRANGE THIS TRACK</p><button data-action="duplicate-track" ${busy || project.tracks.length >= 8 ? 'disabled' : ''}>Duplicate track</button><div class="transpose-controls" role="group" aria-label="Transpose track"><button data-action="transpose:-12" aria-label="Transpose down an octave" ${busy || !track.notes.length ? 'disabled' : ''}>−12</button><button data-action="transpose:-1" aria-label="Transpose down a semitone" ${busy || !track.notes.length ? 'disabled' : ''}>−1</button><button data-action="transpose:1" aria-label="Transpose up a semitone" ${busy || !track.notes.length ? 'disabled' : ''}>+1</button><button data-action="transpose:12" aria-label="Transpose up an octave" ${busy || !track.notes.length ? 'disabled' : ''}>+12</button></div><button data-action="repeat-phrase" ${busy || !track.notes.length ? 'disabled' : ''}>Repeat phrase</button><p class="small">Shift pitch by semitones. Notes stay within C2–C7 and ${MAX_COMPOSITION_BEATS} beats.</p></div></aside>
      <div class="editor-panel"><div class="editor-heading"><div><h2>${escape(track.name)}</h2><p class="small">Select a note to edit its pitch and timing.</p></div><button data-action="add-note" ${busy || track.notes.length >= 256 ? 'disabled' : ''}><span aria-hidden="true">+</span> Add note</button></div><div class="roll-controls"><label for="roll-tool">Piano roll tool<select id="roll-tool" ${disabled()}><option value="move" ${rollTool === 'move' ? 'selected' : ''}>Move notes</option><option value="draw" ${rollTool === 'draw' ? 'selected' : ''}>Draw note</option></select></label><label for="roll-snap">Snap movement<select id="roll-snap" ${disabled()}><option value="0.25" ${rollSnap === .25 ? 'selected' : ''}>Quarter beat</option><option value="0.125" ${rollSnap === .125 ? 'selected' : ''}>Eighth beat</option><option value="0" ${rollSnap === 0 ? 'selected' : ''}>Off</option></select></label></div><p id="roll-help" class="small">Move or resize in increments from the original timing; fractional offsets stay intact. Drawing snaps the start and duration. Focus a note: arrows move; Shift+Left/Right resize; Enter opens its numeric fields. Draw on empty space, or use Add note.</p><div class="piano-roll" aria-label="Piano roll"><div class="roll-inner" style="--beats:${beats};--rows:${rows};min-width:${Math.max(640, beats * 36)}px"><div class="beat-ruler">${Array.from({ length: beats }, (_, i) => `<span>${i + 1}</span>`).join('')}</div><div class="pitch-labels">${Array.from({ length: rows }, (_, i) => `<span>${noteName(top - i)}</span>`).join('')}</div><div class="roll-grid ${rollTool === 'draw' ? 'is-draw' : ''}" data-beats="${beats}" data-top="${top}" style="height:${rows * 22}px">${track.notes.map(item => `<button class="note-event ${item.id === selectedNoteId ? 'is-selected' : ''} ${seedIds.has(item.id) ? 'is-seed' : ''}" data-note="${escape(item.id)}" aria-describedby="roll-help" aria-label="${noteName(item.pitch)}, beat ${item.start + 1}, duration ${item.duration}" aria-pressed="${item.id === selectedNoteId}" style="left:${item.start / beats * 100}%;width:${item.duration / beats * 100}%;top:${(top - item.pitch) * 22 + 2}px" ${disabled()}><span>${noteName(item.pitch)}</span><span data-roll-resize aria-hidden="true" title="Drag to resize"></span></button>`).join('')}${proposedNotes.map((item, index) => `<span class="note-event proposal-note" data-proposal-index="${index}" role="img" aria-label="Suggested ${noteName(item.pitch)}, beat ${item.start + 1}, duration ${item.duration}; not saved" style="left:${item.start / beats * 100}%;width:${item.duration / beats * 100}%;top:${(top - item.pitch) * 22 + 2}px">${noteName(item.pitch)}</span>`).join('')}${!track.notes.length ? '<div class="empty-roll"><span aria-hidden="true">♫</span><strong>A little space for a big idea.</strong><p>Record, import, or add your first note.</p></div>' : ''}</div></div></div>
      <p id="roll-status" class="small" aria-live="polite">${escape(rollMessage)}</p>
      <form id="note-form" class="note-editor"><div class="note-editor-title"><strong>${note ? `Edit ${noteName(note.pitch)}` : 'Note details'}</strong><span class="small">${note ? 'Timing is measured in beats.' : 'Choose a note in the piano roll.'}</span></div><fieldset ${!note || busy ? 'disabled' : ''}><legend class="sr-only">Selected note</legend><label>Pitch (MIDI)<input name="pitch" type="number" min="36" max="96" step="1" value="${escape(draft?.pitch ?? '60')}" /></label><label>Start beat<input name="start" type="number" min="1" max="${MAX_COMPOSITION_BEATS + .75}" step="any" value="${escape(draft?.start ?? '1')}" /></label><label>Duration (beats)<input name="duration" type="number" min="0.25" max="16" step="any" value="${escape(draft?.duration ?? '1')}" /></label><label>Velocity<input name="velocity" type="number" min="0" max="1" step="any" value="${escape(draft?.velocity ?? '0.8')}" /></label><button type="submit">Apply note</button><button type="button" class="quiet" data-action="discard-note-edits">Discard note edits</button><button type="button" class="quiet danger" data-action="delete-note">Delete note</button></fieldset></form>${continuationPanel(selection, seedError)}</div></section>
      <section class="save-panel" aria-labelledby="section-heading"><div><p class="eyebrow">ARRANGEMENT AUDITION</p><h2 id="section-heading">Work on a section.</h2><p id="section-help" class="small">Beats start at 1; the end is exclusive. Committed synthesized mix only. Session-only range; hard loop boundaries can click. Duplicate inserts after the end. Remove deletes the section and closes the gap on all tracks. Crossing notes must be included whole; reference recordings stay unchanged. Both edits support Undo. End beat at most ${compositionDurationBeats(project) + 1}.</p></div><div class="export-actions"><label for="section-start">Section start beat<input id="section-start" type="text" inputmode="decimal" maxlength="40" value="${escape(sectionStart)}" aria-describedby="section-help" ${busy && !playbackJob ? 'disabled' : ''} /></label><label for="section-end">Section end beat (exclusive)<input id="section-end" type="text" inputmode="decimal" maxlength="40" value="${escape(sectionEnd)}" aria-describedby="section-help" ${busy && !playbackJob ? 'disabled' : ''} /></label><button data-action="play-section" ${busy || playing || !totalNotes ? 'disabled' : ''}>Play section</button><button data-action="loop-section" ${busy || playing || !totalNotes ? 'disabled' : ''}>Loop section</button><button data-action="duplicate-section" ${busy || !totalNotes ? 'disabled' : ''}>Duplicate section</button><button data-action="remove-section" ${busy || !totalNotes ? 'disabled' : ''}>Remove section and close gap</button><button data-action="wav-section" ${busy || !totalNotes ? 'disabled' : ''}>Export section WAV</button></div></section>
      <section class="save-panel" aria-labelledby="quantize-heading"><div><p class="eyebrow">NOTE TIMING</p><h2 id="quantize-heading">Tighten the rhythm.</h2><p id="quantize-help" class="small">Use the section range above on the selected track. Move original note starts toward the nearest song grid; midpoint ties go later. Strength 0 keeps timing, 1 fully aligns. Lengths, pitches and dynamics stay fixed. Starts may move outside the selection; timeline overflow refuses. Session-only settings; Apply supports Undo.</p></div><div class="export-actions"><label for="quantize-grid">Quantize grid<select id="quantize-grid" aria-label="Quantize grid" aria-describedby="quantize-help" ${disabled()}>${[['1','One beat'],['0.5','Half beat'],['0.25','Quarter beat'],['0.125','Eighth beat']].map(([value,label]) => `<option value="${value}" ${quantizeGrid === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label for="quantize-strength">Quantize strength<input id="quantize-strength" type="text" inputmode="decimal" maxlength="40" value="${escape(quantizeStrength)}" aria-describedby="quantize-help" ${disabled()} /></label><button data-action="quantize-section" ${busy || !track.notes.length ? 'disabled' : ''}>Quantize section note starts</button></div></section>
      <section class="save-panel" aria-labelledby="phrase-pitch-heading"><div><p class="eyebrow">PHRASE VARIATION</p><h2 id="phrase-pitch-heading">Create a phrase variation.</h2><p class="small">Use the section range above on the selected track. Change pitches at original onsets, keeping whole note lengths and dynamics. Invert mirrors intervals around the lowest pitch at the earliest included onset. Any result outside C2–C7 refuses the whole edit. Reverse mirrors whole note intervals and rests inside the section, keeping pitch and length; crossing notes refuse. Reference recordings stay unchanged; each change supports Undo.</p></div><div class="export-actions">${[[-12,'down an octave'],[-1,'down a semitone'],[1,'up a semitone'],[12,'up an octave']].map(([step,label]) => `<button data-action="transpose-section:${step}" ${busy || !track.notes.length ? 'disabled' : ''}>Transpose section ${label}</button>`).join('')}<button data-action="invert-section" ${busy || !track.notes.length ? 'disabled' : ''}>Invert section pitches</button><button data-action="reverse-section" ${busy || !track.notes.length ? 'disabled' : ''}>Reverse section note timing</button></div></section>
      <section class="save-panel" aria-labelledby="dynamics-heading"><div><p class="eyebrow">PHRASE DYNAMICS</p><h2 id="dynamics-heading">Shape a crescendo.</h2><p id="dynamics-help" class="small">Use the section range above on the selected track. Ramp from the first to the last distinct note onset; chords share a velocity. At least two onsets are needed. Values 0–1; zero is silent and omitted from MIDI. Timing, other tracks and reference recordings stay unchanged. Parameters are session-only; Apply is one reversible saved edit.</p></div><div class="export-actions"><label for="ramp-start">Ramp start velocity<input id="ramp-start" type="text" inputmode="decimal" maxlength="40" value="${escape(rampStart)}" aria-describedby="dynamics-help" ${disabled()} /></label><label for="ramp-end">Ramp end velocity<input id="ramp-end" type="text" inputmode="decimal" maxlength="40" value="${escape(rampEnd)}" aria-describedby="dynamics-help" ${disabled()} /></label><button data-action="apply-velocity-ramp" ${busy || !track.notes.length ? 'disabled' : ''}>Apply velocity ramp</button></div></section>
      <section class="save-panel" aria-labelledby="save-heading"><div><p class="eyebrow">03 / KEEP IT GOING</p><h2 id="save-heading">Take your idea with you.</h2><p id="save-status" class="small" aria-live="polite">${escape(saveMessage)}</p></div><div class="export-actions"><button data-action="save" ${disabled()}>Save project file</button><label class="file-button ${busy ? 'is-disabled' : ''}">Open project<input id="project-file" type="file" accept=".json,application/json" aria-label="Open project file" ${disabled()} /></label><button data-action="midi" ${busy || !totalNotes ? 'disabled' : ''}>Export MIDI</button><button data-action="wav" ${busy || !totalNotes ? 'disabled' : ''}>Export WAV</button><button data-action="wav-track" ${busy || !track.notes.length ? 'disabled' : ''}>Export track WAV</button></div></section>
      <footer><div class="button-row"><button class="quiet" data-action="example" ${disabled()}>Load example</button><button class="quiet" data-action="new" ${disabled()}>New project</button></div><p>A music sketchbook, built for first ideas. Single-voice pitch detection, editable by you.<br />Successful takes retain a normalized listen-back copy on this device. Export a project backup before clearing browser data.</p></footer>
    </main>`;
  const newRoll = app.querySelector<HTMLElement>('.piano-roll');
  if (newRoll && rollScroll) { newRoll.scrollLeft = rollScroll.left; newRoll.scrollTop = rollScroll.top; }
  if (focusSelector) {
    const replacement = app.querySelector<HTMLElement>(focusSelector);
    replacement?.focus({ preventScroll: true });
    if (replacement instanceof HTMLInputElement && inputSelection?.start !== null && inputSelection?.start !== undefined && inputSelection.end !== null) replacement.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? 'none');
  }
  updateMidiControls(); updateReference(); timingView?.sync();
}

function confirmReplace() {
  const target = currentTrack().id, generation = compositionGeneration, intent = editorIntent;
  const accepted = (!currentTrack().notes.length && !selectedAsset()) || window.confirm('Replace the notes and reference take in this track? Undo restores the previous committed take. Unapplied editor fields are kept.');
  if (!accepted) return false;
  if (target !== currentTrack().id || generation !== compositionGeneration || intent !== editorIntent || startup || busy) {
    announce('The editor changed during confirmation. Confirm the take replacement again.'); return false;
  }
  return true;
}

function clearRecordingTimer() {
  if (recordingTimer) clearInterval(recordingTimer);
  recordingTimer = null;
}

function cancelCapture() {
  const playbackWasActive = playbackJob !== null || playing;
  stopPlayback(false);
  retireCapture();
  projectFileEpoch++; projectFileReading = false;
  operation++;
  recorder.cancel();
  clearRecordingTimer();
  worker?.terminate();
  worker = null;
  rejectWorker?.(new Error('Cancelled'));
  rejectWorker = null;
  busy = startup ? 'loading' : null;
  message = playbackWasActive ? 'Playback cancelled. Your notes are unchanged.' : 'Capture cancelled. Your notes are unchanged.';
  render();
}

function runWorker<Result>(kind: 'transcribe' | 'render', payload: unknown, transfer: Transferable[] = [], timeoutMs = 30000): Promise<Result> {
  return new Promise((resolve, reject) => {
    const pending = kind === 'render'
      ? new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    worker = pending;
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Processing took too long. Try fewer notes or a shorter melody.')), timeoutMs);
    function finish(error?: Error, result?: Result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pending.terminate();
      if (worker === pending) { worker = null; rejectWorker = null; }
      if (error) reject(error); else resolve(result!);
    }
    rejectWorker = error => finish(error);
    pending.onmessage = (event: MessageEvent<{ result?: Result; error?: string }>) => {
      if (event.data.error) finish(new Error(event.data.error)); else finish(undefined, event.data.result);
    };
    pending.onerror = () => finish(new Error('Could not process audio locally. Refresh and try again.'));
    pending.postMessage(payload, transfer);
  });
}

interface Capture {
  token: number; targetId: string; generation: number; intent: number; tempo: number;
  kind: ReferenceKind; backed: boolean; finishing: boolean; decoder: AudioContext | null; controller: AbortController; timer: ReturnType<typeof setTimeout> | null;
}
function captureCurrent(owner: Capture): boolean {
  return capture === owner && owner.token === operation && !owner.controller.signal.aborted
    && owner.generation === compositionGeneration && owner.intent === editorIntent && currentTrack().id === owner.targetId;
}
function retireCapture(): void {
  const owner = capture;
  if (!owner) return;
  capture = null; owner.controller.abort();
  if (owner.decoder) void owner.decoder.close().catch(() => {});
  if (owner.timer) clearTimeout(owner.timer);
  recorder.cancel(); if (owner.backed) backedRecorder.cancel(); clearRecordingTimer();
  if (owner.token === operation) {
    operation++; rejectWorker?.(new Error('Capture cancelled')); busy = null;
  }
}
function beginCapture(kind: ReferenceKind, backed = false): Capture | null {
  if (nativeAudioPending) { announce('A cancelled audio decoder or normalizer is still finishing. Retry after it drains; reload if it never finishes.'); return null; }
  stopPlayback(false);
  const owner: Capture = { token: ++operation, targetId: currentTrack().id, generation: compositionGeneration,
    intent: editorIntent, tempo: project.tempo, kind, backed, finishing: false, decoder: null, controller: new AbortController(), timer: null };
  capture = owner;
  return owner;
}
function captureDeadline(owner: Capture, label: string): number {
  if (owner.timer) clearTimeout(owner.timer);
  const deadline = performance.now() + REFERENCE_LIMITS.operationMs;
  owner.timer = setTimeout(() => {
    if (!captureCurrent(owner)) return;
    retireCapture(); message = `${label} took too long. Your notes, reference and drafts are unchanged. Native audio may still be draining.`; render();
  }, REFERENCE_LIMITS.operationMs);
  return deadline;
}
function checkCapture(owner: Capture, deadline?: number): void {
  if (!captureCurrent(owner)) throw new Error('Capture no longer owns this editor.');
  if (deadline !== undefined && performance.now() >= deadline) throw new Error('Audio processing took too long. Your prior take is unchanged.');
}
function captureError(owner: Capture, error: unknown, prefix = 'Could not process this take'): void {
  if (captureCurrent(owner)) announce(`${prefix}: ${error instanceof Error ? error.message : 'Your prior take is unchanged.'}`);
}
function finishCapture(owner: Capture): void {
  if (owner.timer) clearTimeout(owner.timer);
  if (capture !== owner) { libraryView?.sync(); return; }
  capture = null; busy = null; clearRecordingTimer(); render();
}
async function processSamples(samples: Float32Array, sampleRate: number, channels: number, owner: Capture): Promise<void> {
  checkCapture(owner);
  if (samples.length / sampleRate > 20.1) throw new Error('Choose a melody no longer than 20 seconds.');
  const decodedFrames = samples.length;
  const analyzedFrames = Math.min(decodedFrames, Math.floor(sampleRate * REFERENCE_LIMITS.seconds));
  const analyzed = new Float32Array(samples.subarray(0, analyzedFrames));
  busy = 'processing'; clearRecordingTimer(); render();
  const deadline = captureDeadline(owner, 'Audio normalization and transcription');
  // The normalizer copies before returning; keep the original-rate analysis
  // buffer intact until the completed PCM copy exists, then transfer it once.
  const asset = await normalizeReference(analyzed, sampleRate, { kind: owner.kind, captureTempo: owner.tempo,
    decodedChannels: channels, decodedFrames }, owner.controller.signal);
  checkCapture(owner, deadline);
  const remaining = deadline - performance.now();
  const notes = await runWorker<Note[]>('transcribe', { samples: analyzed, sampleRate, tempo: owner.tempo }, [analyzed.buffer], remaining);
  checkCapture(owner, deadline);
  if (!notes.length) throw new Error('No clear notes found. Try a louder, single-voice melody in a quiet room.');
  const next = structuredClone(project);
  const target = next.tracks.find(track => track.id === owner.targetId);
  if (!target) throw new Error('The target track changed. Your prior take is unchanged.');
  target.notes = notes;
  const document = withComposition(history.current, next);
  document.references = document.references.filter(item => item.trackId !== owner.targetId);
  document.references.push({ trackId: owner.targetId, assetId: asset.id });
  // Atomic history admission happens before any selection/draft/proposal change.
  if (commit(next, `Detected ${notes.length} notes and retained a normalized reference take.${owner.backed ? ' The reference begins at backing beat zero. The count-in is excluded. Listen back and check the detected timing.' : ''}${decodedFrames > analyzedFrames ? ' Encoded padding beyond 20 seconds was cut.' : ''}`, false, document, [asset])) {
    selectedNoteId = notes[0].id; render();
  }
}
async function processBlob(blob: Blob, owner: Capture): Promise<void> {
  if (!captureCurrent(owner)) return;
  if (nativeAudioPending) { captureError(owner, new Error('Audio work is still draining. Retry when it finishes.')); finishCapture(owner); return; }
  nativeAudioPending = true;
  busy = 'processing'; clearRecordingTimer(); render();
  let context: AudioContext | null = null;
  const deadline = captureDeadline(owner, 'Audio file read and decode');
  try {
    if (!blob.size || blob.size > REFERENCE_LIMITS.sourceBytes) throw new Error('Choose a nonempty audio file no larger than 10 MiB.');
    const bytes = await blob.arrayBuffer(); checkCapture(owner, deadline);
    context = new AudioContext(); owner.decoder = context;
    const decoded = await context.decodeAudioData(bytes); checkCapture(owner, deadline);
    if (!Number.isInteger(decoded.sampleRate) || decoded.sampleRate < 8000 || decoded.sampleRate > 192000
      || !decoded.length || !Number.isInteger(decoded.numberOfChannels) || decoded.numberOfChannels < 1
      || decoded.numberOfChannels > REFERENCE_LIMITS.decodedChannels || decoded.length / decoded.sampleRate > 20.1) {
      throw new Error('Choose audio of at most 20 seconds with 1–32 decoded channels and an 8–192 kHz decoded rate.');
    }
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        if (!Number.isFinite(data[i])) throw new Error('Decoded audio contains invalid samples. Your prior take is unchanged.');
        samples[i] += data[i] / decoded.numberOfChannels;
      }
    }
    checkCapture(owner, deadline);
    await processSamples(samples, decoded.sampleRate, decoded.numberOfChannels, owner);
  } catch (error) { captureError(owner, error, 'Could not read this audio'); }
  finally {
    if (context) await context.close().catch(() => {});
    nativeAudioPending = false; finishCapture(owner);
  }
}
async function startRecording() {
  if (nativeAudioPending) { announce('Audio work is still draining. Retry when it finishes; reload if it never finishes.'); return; }
  if (!confirmReplace()) return;
  const owner = beginCapture('microphone'); if (!owner) return;
  pendingMicrophoneStarts++;
  busy = 'requesting'; message = 'Microphone access is used only while you record. You can cancel at any time.'; render();
  try {
    await recorder.start(blob => { void processBlob(blob, owner); }, error => {
      captureError(owner, error, 'Recording failed'); finishCapture(owner);
    });
    if (!captureCurrent(owner)) return;
    busy = 'recording'; recordedAt = Date.now(); render();
    recordingTimer = setInterval(() => {
      const label = document.querySelector('#capture-state');
      if (label) label.textContent = `Recording ${Math.min(20, Math.floor((Date.now() - recordedAt) / 1000))} / 20 seconds…`;
    }, 250);
  } catch (error) { captureError(owner, error, 'Microphone unavailable'); finishCapture(owner); }
  finally { pendingMicrophoneStarts--; libraryView?.sync(); }
}
function backedDraftGuard(): boolean {
  if (scratchExists() || roll.active) {
    announce('Apply or discard all unapplied fields and the continuation suggestion, and finish the piano roll edit before recording with backing. Your drafts are kept.');
    return false;
  }
  return true;
}
function checkedBackedCapture(result: BackedCapture): void {
  if (!(result.samples instanceof Float32Array) || !Number.isInteger(result.sampleRate)
    || result.sampleRate < 8000 || result.sampleRate > 192000 || !Number.isInteger(result.channels)
    || result.channels < 1 || result.channels > REFERENCE_LIMITS.decodedChannels
    || !Number.isSafeInteger(result.startFrame) || result.startFrame < 0
    || !Number.isSafeInteger(result.endFrame) || result.endFrame <= result.startFrame
    || result.endFrame - result.startFrame !== result.samples.length
    || result.samples.length > Math.floor(20 * result.sampleRate)
    || !result.samples.every(Number.isFinite)) {
    throw new Error('The microphone capture was incomplete or invalid. Your prior take is unchanged.');
  }
}
async function startBackedRecording(): Promise<void> {
  if (startup || busy || !backedDraftGuard()) return;
  if (nativeAudioPending) { announce('Audio work is still draining. Retry when it finishes; reload if it never finishes.'); return; }
  let snapshot: Composition;
  try { snapshot = backingComposition(project, currentTrack().id); }
  catch (error) { announce(error instanceof Error ? error.message : 'Add or unmute another part, or use Record melody.'); return; }
  if (!confirmReplace() || !backedDraftGuard()) return;
  newEditorIntent();
  const owner = beginCapture('microphone', true); if (!owner) return;
  nativeAudioPending = true;
  busy = 'rendering'; backedCaptureLabel = 'Preparing the other committed tracks…';
  message = 'Recording into the selected track. Use headphones to keep the backing out of your microphone.'; render();
  const deadline = captureDeadline(owner, 'Backing preparation');
  let armed = false;
  const progress = (value: BackedProgress): void => {
    if (!captureCurrent(owner) || owner.finishing) return;
    if (document.hidden) { cancelCapture(); return; }
    if (!armed && performance.now() >= deadline) {
      retireCapture(); message = 'Backing preparation took too long. Your prior take and drafts are unchanged. Native audio may still be draining.'; render(); return;
    }
    const previous = busy;
    switch (value.phase) {
      case 'preparing': busy = 'rendering'; backedCaptureLabel = 'Preparing the microphone and backing…'; break;
      case 'requesting': busy = 'requesting'; backedCaptureLabel = 'Waiting for microphone permission…'; break;
      case 'counting-in':
        armed = true; if (owner.timer) { clearTimeout(owner.timer); owner.timer = null; }
        busy = 'counting-in'; backedCaptureLabel = `Count-in beat ${value.beat} / 4. Recording begins after four beats.`; break;
      case 'recording':
        armed = true; if (owner.timer) { clearTimeout(owner.timer); owner.timer = null; }
        busy = 'recording'; backedCaptureLabel = `Recording ${(value.framesCaptured / value.sampleRate).toFixed(1)} / 20 seconds with backing…`; break;
    }
    if (busy !== previous) render();
    else { const label = app.querySelector('#capture-state'); if (label) label.textContent = backedCaptureLabel; }
  };
  try {
    audioContext ??= new AudioContext();
    const context = audioContext;
    const rendered = await runWorker<Float32Array>('render', { project: snapshot, wav: false }, [], deadline - performance.now());
    checkCapture(owner, deadline);
    if (!(rendered instanceof Float32Array) || !rendered.every(Number.isFinite)) throw new Error('Could not render valid backing audio.');
    const backing = new Float32Array(441000);
    backing.set(rendered.subarray(0, backing.length));
    const result = await backedRecorder.start({ context, backing, tempo: owner.tempo, signal: owner.controller.signal, onProgress: progress, setupDeadline: deadline });
    if (!captureCurrent(owner)) return;
    if (!result) { message = 'Backing recording cancelled. Your prior take and drafts are unchanged.'; return; }
    if (!armed) checkCapture(owner, deadline);
    checkedBackedCapture(result);
    backedCaptureLabel = 'Finding notes and retaining the microphone reference…';
    await processSamples(result.samples, result.sampleRate, result.channels, owner);
  } catch (error) { captureError(owner, error, 'Could not record with backing'); }
  finally { nativeAudioPending = false; finishCapture(owner); }
}
async function finishRecording() {
  const owner = capture; if (!owner || !captureCurrent(owner)) return;
  if (owner.backed) {
    if (busy !== 'recording') { cancelCapture(); return; }
    owner.finishing = true; busy = 'processing'; backedCaptureLabel = 'Finishing microphone capture…'; render();
    backedRecorder.finish(); return;
  }
  busy = 'processing'; clearRecordingTimer(); render();
  try { const blob = await recorder.stop(); if (blob) await processBlob(blob, owner); else finishCapture(owner); }
  catch (error) { captureError(owner, error); finishCapture(owner); }
}

function stopPlayback(redraw = true) {
  playbackGeneration++;
  if (playbackJob) {
    operation++; worker?.terminate(); worker = null;
    rejectWorker?.(new Error('Playback cancelled')); rejectWorker = null;
    playbackJob = null; busy = null;
  }
  auditionOwner = null; comparisonOwner = null;
  if (source) { source.onended = null; try { source.stop(); } catch { /* Already stopped. */ } source.disconnect(); }
  source = null;
  playing = false;
  syncTransport();
  updateReference();
  if (redraw) render();
}

function syncTransport() {
  const playButton = app.querySelector<HTMLButtonElement>('[data-action=play]');
  const stopButton = app.querySelector<HTMLButtonElement>('[data-action=stop]');
  const soloButton = app.querySelector<HTMLButtonElement>('[data-action=solo-track]');
  if (soloButton) soloButton.disabled = !!busy || playing || !currentTrack().notes.length;
  if (playButton) playButton.disabled = !!busy || playing || !project.tracks.some(track => track.notes.length);
  for (const action of ['play-section', 'loop-section']) {
    const button = app.querySelector<HTMLButtonElement>(`[data-action=${action}]`);
    if (button) button.disabled = !!busy || playing || !project.tracks.some(track => track.notes.length);
  }
  if (stopButton) stopButton.disabled = !playing && !playbackJob && !capture?.backed;
  timingView?.sync();
}

async function playSnapshot(snapshot: Composition, label: string, owner: ContinuationProposal | null = null, section?: SectionRange, loop = false) {
  stopPlayback(false);
  const generation = playbackGeneration;
  const token = ++operation;
  playbackJob = { token }; auditionOwner = owner;
  busy = 'rendering'; message = owner ? 'Rendering your ending and suggestion…' : 'Rendering your composition…'; render();
  const current = () => generation === playbackGeneration && token === operation && (!owner || proposal === owner && proposalGeneration === compositionGeneration);
  try {
    audioContext ??= new AudioContext();
    await audioContext.resume();
    if (!current()) return;
    const samples = await runWorker<Float32Array>('render', { project: snapshot, wav: false, section });
    if (!current()) return;
    const buffer = audioContext.createBuffer(1, samples.length, 22050);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const playingSource = audioContext.createBufferSource();
    playingSource.buffer = buffer; playingSource.loop = loop; playingSource.connect(audioContext.destination);
    playingSource.onended = () => {
      playingSource.disconnect();
      if (source !== playingSource) return;
      source = null; playing = false; auditionOwner = null; syncTransport();
    };
    source = playingSource; playingSource.start(); playing = true; message = label;
  } catch (error) {
    if (current()) message = `Playback unavailable: ${error instanceof Error ? error.message : 'Try again.'}`;
  } finally {
    if (token === operation && playbackJob?.token === token) {
      playbackJob = null; busy = null; if (!playing) auditionOwner = null; render();
    }
  }
}
async function play() { await playSnapshot(validateComposition(project), 'Playing your composition.'); }
async function playIsolatedTrack() {
  try { await playSnapshot(isolatedTrack(project, currentTrack().id), `Soloing ${currentTrack().name} at ${project.tempo} BPM from song beat 1.`); }
  catch (error) { announce(error instanceof Error ? error.message : 'Could not solo this track.'); }
}
function exportTrackWav() {
  try {
    const track = currentTrack(), snapshot = isolatedTrack(project, track.id);
    const name = track.name.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 35) || 'part';
    void exportWav(undefined, snapshot, `-track-${project.tracks.findIndex(item => item.id === track.id) + 1}-${name}.wav`);
  } catch (error) { announce(error instanceof Error ? error.message : 'Could not export this track.'); }
}

function sectionEditAction(action = ''): boolean {
  return ['duplicate-section', 'remove-section', 'apply-velocity-ramp', 'quantize-section', 'invert-section', 'reverse-section'].includes(action) || action.startsWith('transpose-section:');
}

function sectionArrangementGuard(): boolean {
  if (scratchExists() || roll.active) {
    announce('Apply or discard all unapplied fields and the continuation suggestion, and finish the piano roll edit before changing a section arrangement. Your drafts are kept.');
    return false;
  }
  return true;
}
function duplicateSelectedSection(): void {
  if (!sectionArrangementGuard()) return;
  try {
    const range = selectedSection();
    const next = duplicateSection(project, range);
    commit(next, `Section duplicated after beat ${range.end}; later notes on all tracks shifted by ${Number(range.end) - Number(range.start)} beats. Undo restores the complete arrangement.`);
  } catch (error) { announce(error instanceof Error ? error.message : 'Could not duplicate section.'); }
}
function removeSelectedSection(): void {
  if (!sectionArrangementGuard()) return;
  try {
    const range = selectedSection();
    commit(removeSection(project, range), `Section removed; later notes on all tracks shifted left by ${Number(range.end) - Number(range.start)} beats. Reference recordings are unchanged. Undo restores the complete arrangement.`);
  } catch (error) { announce(error instanceof Error ? error.message : 'Could not remove section.'); }
}
function selectedSection(): SectionRange {
  sectionWindow(sectionStart, sectionEnd, project.tempo, compositionDurationBeats(project), 22050);
  return { start: sectionStart, end: sectionEnd };
}
async function playSection(loop: boolean) {
  try {
    const section = selectedSection();
    const frames = sectionWindow(section.start, section.end, project.tempo, compositionDurationBeats(project), 22050);
    await playSnapshot(validateComposition(project), `${loop ? 'Looping' : 'Playing'} section beats ${section.start}–${section.end} (end exclusive), ${((frames.endFrame - frames.startFrame) / 22050).toFixed(4)} seconds.`, null, section, loop);
  } catch (error) { announce(error instanceof Error ? error.message : 'Invalid section.'); }
}
async function exportWav(section?: SectionRange, snapshot: Composition = project, trackSuffix?: string) {
  stopPlayback(false);
  const token = ++operation;
  busy = 'rendering';
  message = 'Rendering WAV…';
  render();
  try {
    const bytes = await runWorker<Uint8Array>('render', { project: snapshot, wav: true, section });
    if (token !== operation) return;
    download(new Uint8Array(bytes), trackSuffix ?? (section ? '-section.wav' : '.wav'), 'audio/wav');
    message = trackSuffix ? 'Track WAV exported from song beat 1, with full-song alignment and independent peak limiting.' : section ? `Section WAV exported: beats ${section.start}–${section.end} (end exclusive), rounded to 22,050 Hz frames.` : 'WAV exported with the current instruments and mix.';
  } catch (error) { if (token === operation) message = `Could not export WAV: ${error instanceof Error ? error.message : 'Try again.'}`; }
  finally { if (token === operation) { busy = null; render(); } }
}

function download(data: BlobPart, suffix: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.title.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 60) || 'composition'}${suffix}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Blur may commit a field and move an action button between down and up.
// Capture the real pointer on its original button, retaining that DOM node
// until the trusted click has finished. Keyboard activation is unchanged.
function releaseActionPointer(flush = true): void {
  if (pointerReleaseTimer) clearTimeout(pointerReleaseTimer);
  pointerReleaseTimer = null;
  const held = actionPointer; actionPointer = null;
  if (held) { try { held.button.releasePointerCapture(held.id); } catch { /* Already released. */ } }
  if (flush && deferredRender) { deferredRender = false; render(); }
}
root.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || actionPointer) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button || button.disabled || button.hasAttribute('data-note') || !root.contains(button)) return;
  if (libraryHost.contains(button)) event.preventDefault();
  if (sectionEditAction(button.dataset.action) && !sectionArrangementGuard()) {
    event.preventDefault(); event.stopImmediatePropagation(); return;
  }
  if (sectionEditAction(button.dataset.action) || ['quantize-section', 'apply-velocity-ramp', 'apply-envelope', 'discard-envelope', 'apply-filter', 'discard-filter', 'apply-echo', 'discard-echo'].includes(button.dataset.action ?? '')) event.preventDefault();
  if (button.dataset.action === 'apply-envelope' && !soundDraftGuard()) { event.stopImmediatePropagation(); return; }
  if (button.dataset.action === 'apply-echo' && !soundDraftGuard(echoFields)) { event.stopImmediatePropagation(); return; }
  if (button.dataset.action === 'apply-filter' && !soundDraftGuard(filterFields)) { event.stopImmediatePropagation(); return; }
  if (button.dataset.action === 'record-backed') {
    event.preventDefault();
    if (!backedDraftGuard()) { event.stopImmediatePropagation(); return; }
  }
  try {
    button.setPointerCapture(event.pointerId);
    actionPointer = { button, id: event.pointerId, rect: button.getBoundingClientRect(), cancelClick: false };
  } catch { /* Keyboard and browsers without pointer capture use ordinary clicks. */ }
}, true);
window.addEventListener('pointerup', event => {
  const held = actionPointer; if (!held || held.id !== event.pointerId) return;
  const inside = (rect: DOMRect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  held.cancelClick = !inside(held.rect) && !inside(held.button.getBoundingClientRect());
  pointerReleaseTimer = setTimeout(releaseActionPointer, 0);
}, true);
root.addEventListener('click', event => {
  if (actionPointer?.cancelClick) {
    event.preventDefault(); event.stopImmediatePropagation(); releaseActionPointer();
  } else {
    // The trusted click already has its captured target. Let its handler render
    // and focus the new editor; flush unrelated pending redraw only afterward.
    releaseActionPointer(false);
  }
}, true);
window.addEventListener('click', () => releaseActionPointer());
window.addEventListener('pointercancel', event => { if (actionPointer?.id === event.pointerId) releaseActionPointer(); });
window.addEventListener('lostpointercapture', event => {
  if (actionPointer?.id === event.pointerId && !pointerReleaseTimer) pointerReleaseTimer = setTimeout(releaseActionPointer, 0);
});

app.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button || button.disabled || startup) return;
  if (button.dataset.track && !busy) { newEditorIntent(); clearContinuation(); if (comparisonOwner) stopPlayback(false); activeTrackId = button.dataset.track; selectedNoteId = null; defaultSeedCount(); render(); return; }
  if (button.dataset.note && !busy) { newEditorIntent(); selectedNoteId = button.dataset.note; render(); document.querySelector<HTMLInputElement>('[name=pitch]')?.focus(); return; }
  const action = button.dataset.action;
  if (busy && action !== 'cancel' && action !== 'finish-record' && action !== 'stop' && !(action === 'discard-continuation' && auditionOwner)) return;
  if (sectionEditAction(action) && !sectionArrangementGuard()) return;
  if (action === 'apply-envelope' && !soundDraftGuard()) return;
  if (action === 'apply-echo' && !soundDraftGuard(echoFields)) return;
  if (action === 'apply-filter' && !soundDraftGuard(filterFields)) return;
  if (action && !['record-backed', 'save', 'midi', 'wav', 'wav-section', 'wav-track', 'solo-track', 'duplicate-section', 'remove-section', 'play-section', 'loop-section', 'play', 'stop', 'cancel', 'finish-record', 'audition-continuation'].includes(action)) newEditorIntent();
  switch (action) {
    case 'reverse-section': {
      try {
        const next = reverseSection(project, currentTrack().id, selectedSection());
        const unchanged = JSON.stringify(next) === JSON.stringify(project);
        commit(next, unchanged ? 'Section note timing is unchanged. No edit was made.' : 'Section note timing reversed on the selected track. Pitches, lengths, dynamics and reference recordings are unchanged. Undo restores the original timing.');
      } catch (error) { announce(error instanceof Error ? error.message : 'Could not reverse section notes.'); }
      break;
    }
    case 'transpose-section:-12':
    case 'transpose-section:-1':
    case 'transpose-section:1':
    case 'transpose-section:12':
    case 'invert-section': {
      try {
        const next = action === 'invert-section' ? invertSection(project, currentTrack().id, selectedSection()) : transposeSection(project, currentTrack().id, selectedSection(), Number(action.split(':')[1]));
        const unchanged = JSON.stringify(next) === JSON.stringify(project);
        commit(next, unchanged ? 'Section pitches are unchanged. No edit was made.' : 'Section pitches transformed on the selected track. Timing, dynamics and reference recordings are unchanged. Undo restores the original pitches.');
      } catch (error) { announce(error instanceof Error ? error.message : 'Could not transform section pitches.'); }
      break;
    }
    case 'quantize-section': {
      try {
        const next = quantizeSection(project, currentTrack().id, selectedSection(), Number(quantizeGrid), numericDraft(quantizeStrength, 'Quantize strength'));
        const unchanged = JSON.stringify(next) === JSON.stringify(project);
        commit(next, unchanged ? 'Note starts are unchanged. No edit was made.' : 'Section note starts quantized on the selected track. Lengths, pitches, dynamics and reference recordings are unchanged. Undo restores the original timing.');
      } catch (error) { announce(error instanceof Error ? error.message : 'Could not quantize note starts.'); }
      break;
    }
    case 'apply-velocity-ramp': {
      try {
        commit(applyVelocityRamp(project, currentTrack().id, selectedSection(), numericDraft(rampStart, 'Ramp start velocity'), numericDraft(rampEnd, 'Ramp end velocity')), 'Velocity ramp applied to selected track note onsets. Undo restores the previous dynamics; reference recordings are unchanged.');
      } catch (error) { announce(error instanceof Error ? error.message : 'Could not apply velocity ramp.'); }
      break;
    }
    case 'apply-echo': {
      try {
        const track = currentTrack(), enabled = fieldValue('echo-enabled', !!track.echo) === true;
        const echo = enabled ? validateEcho(Object.fromEntries(['beats','decay','repeats'].map(key => [key, numericDraft(String(fieldValue(`echo-${key}`, (track.echo ?? DEFAULT_ECHO)[key as keyof typeof DEFAULT_ECHO])), `Echo ${key}`)]))) : undefined;
        if (editTrack(track => { if (echo) track.echo = echo; else delete track.echo; }, 'Sound echo applied. Undo restores the previous sound.', false)) settleSoundFields(echoFields);
      } catch (error) { announce(error instanceof Error ? error.message : 'Invalid sound echo. Your draft is kept.'); }
      break;
    }
    case 'discard-echo':
      settleSoundFields(echoFields); announce('Echo drafts discarded. The committed track is unchanged.'); break;
    case 'apply-filter': {
      try {
        const track = currentTrack(), enabled = fieldValue('filter-enabled', !!track.filter) === true;
        const filter = enabled ? validateFilter({ cutoff: numericDraft(String(fieldValue('filter-cutoff', (track.filter ?? DEFAULT_FILTER).cutoff)), 'Filter cutoff'), resonance: numericDraft(String(fieldValue('filter-resonance', (track.filter ?? DEFAULT_FILTER).resonance)), 'Filter resonance') }) : undefined;
        if (editTrack(track => { if (filter) track.filter = filter; else delete track.filter; }, 'Sound filter applied. Undo restores the previous sound.', false)) settleSoundFields(filterFields);
      } catch (error) { announce(error instanceof Error ? error.message : 'Invalid sound filter. Your draft is kept.'); }
      break;
    }
    case 'discard-filter':
      settleSoundFields(filterFields); announce('Filter drafts discarded. The committed track is unchanged.'); break;
    case 'apply-envelope': {
      try {
        const track = currentTrack();
        const envelope = validateEnvelope(Object.fromEntries(ENVELOPE_KEYS.map(key => [key, numericDraft(String(fieldValue(`sound-${key}`, (track.envelope ?? DEFAULT_ENVELOPE)[key])), key)])));
        if (editTrack(track => { track.envelope = envelope; }, 'Sound envelope applied. Undo restores the previous sound.', false)) {
          settleSoundFields();
        }
      } catch (error) { announce(error instanceof Error ? error.message : 'Invalid sound envelope. Your draft is kept.'); }
      break;
    }
    case 'discard-envelope':
      settleSoundFields(); announce('Sound drafts discarded. The committed track is unchanged.'); break;
    case 'suggest-continuation': suggestContinuation(); break;
    case 'audition-continuation': auditionProposal(); break;
    case 'apply-continuation': applyProposal(); break;
    case 'discard-continuation':
      if (!noteDraftGuard()) break;
      clearContinuation(); message = 'Suggestion discarded. Committed notes are unchanged.'; render(); break;
    case 'discard-note-edits':
      if (selectedNoteId) noteDrafts.delete(selectedNoteId);
      message = 'Unapplied note edits discarded.'; render(); break;
    case 'undo': restoreHistory('undo'); break;
    case 'redo': restoreHistory('redo'); break;
    case 'duplicate-track':
    case 'repeat-phrase':
    case 'transpose:-12':
    case 'transpose:-1':
    case 'transpose:1':
    case 'transpose:12': arrange(action); break;
    case 'play': void play(); break;
    case 'solo-track': void playIsolatedTrack(); break;
    case 'wav-track': exportTrackWav(); break;
    case 'duplicate-section': duplicateSelectedSection(); break;
    case 'remove-section': removeSelectedSection(); break;
    case 'play-section': void playSection(false); break;
    case 'loop-section': void playSection(true); break;
    case 'wav-section':
      try { void exportWav(selectedSection()); } catch (error) { announce(error instanceof Error ? error.message : 'Invalid section.'); }
      break;
    case 'stop':
      if (capture?.backed) cancelCapture();
      else { message = 'Playback stopped.'; stopPlayback(); }
      break;
    case 'record': void startRecording(); break;
    case 'record-backed': void startBackedRecording(); break;
    case 'finish-record': void finishRecording(); break;
    case 'cancel': cancelCapture(); break;
    case 'demo': {
      if (!confirmReplace()) break;
      const owner = beginCapture('demo');
      if (!owner) break;
      nativeAudioPending = true;
      void processSamples(createDemoMelody(), 22050, 1, owner).catch(error => captureError(owner, error)).finally(() => { nativeAudioPending = false; finishCapture(owner); });
      break;
    }
    case 'add-track': {
      const next = structuredClone(project);
      const track = createTrack(`Track ${project.tracks.length + 1}`);
      next.tracks.push(track);
      if (commit(next, 'Track added. Record a melody or add notes.', false)) { activeTrackId = track.id; selectedNoteId = null; render(); }
      break;
    }
    case 'delete-track': {
      if (!window.confirm(`Delete ${currentTrack().name} and its notes?`)) break;
      const next = structuredClone(project);
      next.tracks = next.tracks.filter(track => track.id !== activeTrackId);
      if (commit(next, 'Track deleted.', false)) { activeTrackId = next.tracks[0].id; selectedNoteId = null; render(); }
      break;
    }
    case 'add-note': {
      const end = Math.max(0, ...currentTrack().notes.map(note => note.start + note.duration));
      if (end + 1 > MAX_COMPOSITION_BEATS) { announce(`This track has reached ${MAX_COMPOSITION_BEATS} beats. Move or shorten a note before adding more.`); break; }
      const note = createNote(60, end);
      if (editTrack(track => track.notes.push(note), 'Note added. Adjust its pitch and timing below.', false)) { selectedNoteId = note.id; render(); }
      break;
    }
    case 'delete-note': editTrack(track => { track.notes = track.notes.filter(note => note.id !== selectedNoteId); }, 'Note deleted.'); selectedNoteId = null; break;
    case 'save': void saveBackup(); break;
    case 'midi': download(new Uint8Array(encodeMidi(project)), '.mid', 'audio/midi'); announce('MIDI exported. Instruments may sound different in another music app.'); break;
    case 'wav': void exportWav(); break;
    case 'example':
    case 'new': {
      if ((project.tracks.some(track => track.notes.length) || history.current.references.length) && !window.confirm('Replace this composition and its references? Save a project file first to keep a backup.')) break;
      const next = action === 'example' ? createDemoComposition() : createComposition();
      if (commit(next, action === 'example' ? 'Example loaded. Press Play, then try changing an instrument.' : 'A fresh start. Capture your next idea.', false, notesOnly(next))) { activeTrackId = next.tracks[0].id; selectedNoteId = null; render(); }
      break;
    }
  }
});

app.addEventListener('input', event => {
  if (startup) return;
  const input = event.target as HTMLInputElement;
  if (input.id === 'quantize-grid' || input.id === 'quantize-strength') {
    if (input.id === 'quantize-grid') quantizeGrid = input.value; else quantizeStrength = input.value;
    return;
  }
  if (input.id === 'ramp-start' || input.id === 'ramp-end') {
    if (input.id === 'ramp-start') rampStart = input.value; else rampEnd = input.value;
    return;
  }
  if (input.id === 'section-start' || input.id === 'section-end') {
    if (input.id === 'section-start') sectionStart = input.value; else sectionEnd = input.value;
    if (playing || playbackJob) {
      const pending = !!playbackJob;
      stopPlayback(false); announce('Playback stopped because the section bounds changed.');
      if (pending) render();
    }
    return;
  }
  if (projectFields.has(input.id) || trackFields.has(input.id) || input.closest('#note-form') || ['continuation-count', 'continuation-length', 'roll-tool', 'roll-snap'].includes(input.id)) newEditorIntent();
  if (projectFields.has(input.id) || trackFields.has(input.id)) {
    const raw = input.type === 'checkbox' ? input.checked : input.value;
    const track = currentTrack();
    const values: Record<string, string | boolean> = { 'project-title': project.title, tempo: String(project.tempo), 'track-name': track.name, instrument: track.instrument, volume: String(track.volume), muted: track.muted, ...envelopeValues(track), ...filterValues(track), ...echoValues(track) };
    if (raw === values[input.id]) fieldDrafts.delete(fieldKey(input.id)); else fieldDrafts.set(fieldKey(input.id), raw);
    updateMidiControls();
  }
  if (input.id === 'continuation-count') {
    seedCountText = input.value; clearContinuation();
    // Preserve this input's caret and every unapplied note draft across render.
    const position = input.selectionStart; render();
    const replacement = document.querySelector<HTMLInputElement>('#continuation-count');
    if (position !== null) replacement?.setSelectionRange(position, position);
    return;
  }
  if (!input.closest('#note-form') || !selectedNoteId) return;
  const note = currentTrack().notes.find(item => item.id === selectedNoteId);
  const form = document.querySelector<HTMLFormElement>('#note-form');
  if (!note || !form) return;
  const data = new FormData(form);
  const draft: NoteDraft = { pitch: String(data.get('pitch') ?? ''), start: String(data.get('start') ?? ''), duration: String(data.get('duration') ?? ''), velocity: String(data.get('velocity') ?? '') };
  if (JSON.stringify(draft) === JSON.stringify(noteValues(note))) noteDrafts.delete(note.id);
  else noteDrafts.set(note.id, draft);
  updateMidiControls();
});

app.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (busy || startup) return;
  if (projectFields.has(input.id) || trackFields.has(input.id) || ['continuation-length', 'audio-file', 'project-file', 'roll-tool', 'roll-snap'].includes(input.id)) newEditorIntent();
  try { switch (input.id) {
    case 'roll-tool': rollTool = input.value === 'draw' ? 'draw' : 'move'; render(); break;
    case 'roll-snap': rollSnap = input.value === '0' ? 0 : input.value === '0.125' ? .125 : .25; render(); break;
    case 'continuation-length': continuationLength = input.value === '8' ? 8 : 4; clearContinuation(); render(); break;
    case 'project-title': commitField(input.id, () => commit({ ...project, title: input.value }, undefined, false)); break;
    case 'tempo': commitField(input.id, () => commit({ ...project, tempo: numericDraft(input.value, 'tempo') }, undefined, false)); break;
    case 'track-name': commitField(input.id, () => editTrack(track => { track.name = input.value; }, undefined, false)); break;
    case 'instrument': commitField(input.id, () => editTrack(track => { track.instrument = input.value as Track['instrument']; }, undefined, false)); break;
    case 'volume': commitField(input.id, () => editTrack(track => { track.volume = numericDraft(input.value, 'volume'); }, undefined, false)); break;
    case 'muted': commitField(input.id, () => editTrack(track => { track.muted = input.checked; }, undefined, false)); break;
    case 'audio-file': {
      const file = input.files?.[0];
      input.value = '';
      if (!file || !confirmReplace()) break;
      const owner = beginCapture('audio-file');
      if (owner) void processBlob(file, owner);
      break;
    }
    case 'project-file': {
      const file = input.files?.[0]; input.value = '';
      if (file) void openBackup(file);
      break;
    }
  } } catch (error) { announce(error instanceof Error ? error.message : 'That edit is not valid. Your draft is kept.'); }
});

app.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || startup || !selectedNoteId) return;
  const data = new FormData(event.target as HTMLFormElement);
  const editedId = selectedNoteId;
  try {
  const values = { pitch: numericDraft(String(data.get('pitch') ?? ''), 'pitch'), start: numericDraft(String(data.get('start') ?? ''), 'start beat') - 1, duration: numericDraft(String(data.get('duration') ?? ''), 'duration'), velocity: numericDraft(String(data.get('velocity') ?? ''), 'velocity') };
  const saved = editTrack(track => {
    const note = track.notes.find(item => item.id === editedId);
    if (note) Object.assign(note, values);
  }, 'Note updated.', false);
  if (saved) { noteDrafts.delete(editedId); render(); }
  } catch (error) { announce(error instanceof Error ? error.message : 'Check the note fields.'); }
});

window.addEventListener('pagehide', () => {
  if (replacing) { unsaved = true; saveMessage = 'Saved-copy replacement ownership was retired. The browser copy stays protected; Retry load or review replacement again.'; }
  if (saving && !recovery) { unsaved = true; manualSaveRequired = true; saveMessage = 'A pending save lost its page ownership. Your latest memory work remains unsaved until you explicitly Retry save.'; }
  replacementEpoch++; replacing = false; saveUiEpoch++; savePending = null;
  if (startup && pendingLoad) {
    loadEpoch++; pendingLoad.retired = true; recovery = true; unsaved = true;
    saveMessage = 'Load ownership was retired. The pending read must finish before editing or Retry load is available.';
  }
  timingView?.retire(); cancelMidi(); cancelCapture(); stopPlayback(false); void audioContext?.close(); audioContext = null; releaseActionPointer(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && capture?.backed) cancelCapture();
});
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || busy || startup) return;
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  const direction = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : null;
  if (!direction) return;
  event.preventDefault();
  restoreHistory(direction);
});
function midiStatus(text: string) {
  const node = midiHost.querySelector<HTMLElement>('#midi-status');
  if (node) node.textContent = text;
}
function updateMidiControls() {
  libraryView?.sync();
  const file = midiHost.querySelector<HTMLInputElement>('#midi-file'); if (!file) return;
  file.disabled = !!busy;
  midiHost.querySelector<HTMLButtonElement>('#midi-review')!.disabled = !!busy || midiReading || !midiSource;
  const ack = midiHost.querySelector<HTMLInputElement>('#midi-discard-ack')!;
  const scratch = scratchExists();
  ack.closest('label')!.hidden = !scratch || !midiReview;
  midiHost.querySelector<HTMLButtonElement>('#midi-apply')!.disabled = !!busy || !midiReview || midiReading || (scratch && !ack.checked);
  midiHost.querySelector<HTMLElement>('#midi-summary')!.hidden = !midiReview;
  midiHost.querySelector<HTMLButtonElement>('#midi-cancel')!.disabled = !midiReading && !midiSource && !midiHost.querySelector('#midi-status')!.textContent;
}
function invalidateMidiChoice() {
  midiReview = null;
  midiHost.querySelector<HTMLInputElement>('#midi-discard-ack')!.checked = false;
  midiStatus('Import choices changed. Review this phrase before replacing the composition.');
  updateMidiControls();
}
function cancelMidi() {
  midiEpoch++; midiReading = false; midiSource = null; midiReview = null;
  midiHost.querySelector<HTMLInputElement>('#midi-file')!.value = '';
  midiHost.querySelector<HTMLElement>('#midi-choices')!.replaceChildren();
  midiHost.querySelector<HTMLElement>('#midi-summary')!.replaceChildren();
  midiHost.querySelector<HTMLInputElement>('#midi-discard-ack')!.checked = false;
  midiStatus('MIDI import cancelled. Your composition, drafts and suggestion are unchanged.');
  updateMidiControls();
}
function describeMidiName(name: MidiName, fallback: string): string {
  if (name.status === 'usable') return `Usable source name: ${name.value}. The exact name is offered below; you can choose another.`;
  const reason = name.status === 'missing' ? 'No source name was supplied.' : `Source name needs a choice (${name.reason}).`;
  return `${reason} Suggested fallback: ${fallback}.`;
}
function showMidiSource(source: MidiPreview) {
  const end = Math.min(MAX_COMPOSITION_BEATS, Math.max(1, Math.ceil(source.lastTick / source.ppqn)));
  midiHost.querySelector<HTMLElement>('#midi-choices')!.innerHTML = `
    <p class="small">Format ${source.format} · ${source.ppqn} ticks per beat · ${source.rawTrackCount} raw tracks · ${source.eventCount} events · ${source.noteOnCount} source note attacks</p>
    <p class="small">Tempo: ${source.tempo} BPM (${source.tempoExplicit ? 'supplied constant tempo' : 'default 120 BPM'}). Beats are quarter-note positions, not bars.</p>
    <p class="small">${escape(describeMidiName(source.title, 'Imported MIDI'))}</p>
    ${source.title.status === 'needs-choice' && source.title.value !== null ? `<details><summary>Original source title text</summary><pre>${escape(source.title.value)}</pre></details>` : ''}
    <label for="midi-title">Imported project title<input id="midi-title" value="${escape(source.title.status === 'usable' ? source.title.value! : 'Imported MIDI')}" /></label>
    <div class="midi-window"><label for="midi-start">Source start beat<input id="midi-start" type="text" inputmode="numeric" value="1" /></label><label for="midi-end">Source end beat (exclusive)<input id="midi-end" type="text" inputmode="numeric" value="${end + 1}" /></label></div>
    <p class="small">Whole-beat boundaries only, at most ${MAX_COMPOSITION_BEATS} beats. Source end limit: ${Math.max(1, Math.ceil(source.lastTick / source.ppqn)) + 1}. The selected source start becomes destination beat 1. Crossing notes are rejected, never clipped.</p>
    <div class="midi-lanes">${source.lanes.map(lane => {
      const unsupported = lane.issues.length > 0;
      return `<section class="midi-lane" data-midi-lane="${lane.id}" aria-label="MIDI channel ${lane.channel + 1}">
        <h3>Channel ${lane.channel + 1} · ${lane.noteOnCount} source note attacks</h3>
        <p class="small">Raw tracks: ${lane.sourceTracks.map(index => index + 1).join(', ')}. Program ${lane.program} (${lane.programExplicit ? 'supplied' : 'default'}); CC7 ${lane.volume} (${lane.volumeExplicit ? 'supplied' : 'default'})${lane.volume === 0 ? ' — silent' : ''}. Onset velocity remains separate from track volume.</p>
        <p class="small">${escape(describeMidiName(lane.name, `Channel ${lane.channel + 1}`))}</p>
        ${lane.name.status === 'needs-choice' && lane.name.value !== null ? `<details><summary>Original source part text</summary><pre>${escape(lane.name.value)}</pre></details>` : ''}
        ${unsupported ? `<p class="midi-error">Unsupported / excluded: ${lane.issues.map(issue => escape(issue.message)).join(' ')}</p>` : ''}
        <label class="midi-include"><input name="included" type="checkbox" ${unsupported ? 'disabled' : ''} />Include channel ${lane.channel + 1}</label>
        <div class="midi-mapping"><label>Imported part name<input name="name" value="${escape(lane.name.status === 'usable' ? lane.name.value! : `Channel ${lane.channel + 1}`)}" ${unsupported ? 'disabled' : ''} /></label>
        <label>Local instrument<select name="instrument" ${unsupported ? 'disabled' : ''}><option value="">Choose an instrument</option><option value="sine">Soft keys</option><option value="triangle">Warm flute</option><option value="sawtooth">Bright synth</option></select></label></div>
      </section>`;
    }).join('')}</div>
    <details><summary>Source information not carried into the composition</summary><p>Metadata other than chosen names is omitted; release velocity is not used. Programs are sound hints, not reproduced General MIDI sounds.</p>
    <ul>${source.ignoredMeta.map(item => `<li>Metadata type 0x${item.type.toString(16).padStart(2, '0')}: ${item.count} events, ${item.bytes} bytes.</li>`).join('')}<li>${source.ignoredReleaseVelocityCount} nonzero note-off release velocities omitted.</li></ul></details>`;
}
function midiChoices(): MidiImportChoices {
  const value = (id: string) => midiHost.querySelector<HTMLInputElement>(`#${id}`)!.value;
  const wholeBeat = (id: string) => {
    const raw = value(id);
    if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new Error('Enter whole source beat positions starting at 1. Your import choices are kept.');
    return Number(raw) - 1;
  };
  const lanes: MidiImportChoices['lanes'] = [];
  for (const row of midiHost.querySelectorAll<HTMLElement>('[data-midi-lane]')) {
    if (!row.querySelector<HTMLInputElement>('[name=included]')!.checked) continue;
    const instrument = row.querySelector<HTMLSelectElement>('[name=instrument]')!.value;
    if (instrument !== 'sine' && instrument !== 'triangle' && instrument !== 'sawtooth') throw new Error('Choose a local instrument for every included channel.');
    lanes.push({ laneId: row.dataset.midiLane!, name: row.querySelector<HTMLInputElement>('[name=name]')!.value, instrument });
  }
  return { title: value('midi-title'), startBeat: wholeBeat('midi-start'), endBeat: wholeBeat('midi-end'), lanes };
}
function showMidiReview(review: MidiImportReview) {
  const selected = new Set(review.lanes.map(lane => lane.laneId));
  midiHost.querySelector<HTMLElement>('#midi-summary')!.innerHTML = `<h3>Reviewed phrase</h3>
    <p><strong>${review.includedNotes} included notes · ${review.excludedNoteOnCount} excluded source note attacks · ${review.lanes.length} parts</strong></p>
    <p>Source beats ${review.choices.startBeat + 1} to ${review.choices.endBeat + 1} (end exclusive) become destination beat 1 onward. Title: ${escape(review.choices.title)}.</p>
    <ul>${review.lanes.map(lane => `<li>Channel ${lane.channel + 1}: ${escape(lane.name)} · ${escape(lane.instrument)} · ${lane.includedNotes} included notes · ${lane.outsideNotes} notes outside the window.</li>`).join('')}
    ${midiSource!.lanes.filter(lane => !selected.has(lane.id)).map(lane => `<li>Excluded channel ${lane.channel + 1}: ${lane.noteOnCount} source note attacks (${lane.issues.length ? 'unsupported' : 'not selected'}).</li>`).join('')}</ul>
    <p>Trailing silence and source end-of-track padding are not retained. Playback and MIDI end with the imported notes; WAV adds the synthesizer’s 80 ms release. MIDI re-export rounds to 480 ticks per beat and may merge overlapping same-pitch notes. JSON preserves the imported beat values.</p>
    <ul>${review.warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul>`;
}
midiHost.innerHTML = `<div class="midi-heading"><div><p class="eyebrow">BRING IN A WRITTEN PHRASE</p><h2 id="midi-heading">MIDI import</h2><p class="small">Choose parts and instruments, review a phrase, then replace deliberately. Nothing is saved during review.</p></div>
  <label class="file-button">Import MIDI file<input id="midi-file" type="file" accept=".mid,.midi,audio/midi" aria-label="Import MIDI file" /></label></div>
  <p id="midi-status" aria-live="polite"></p><div id="midi-choices"></div>
  <div class="button-row"><button type="button" id="midi-review" disabled>Review MIDI phrase</button><button type="button" id="midi-cancel" disabled>Cancel MIDI import</button></div>
  <div id="midi-summary" hidden></div>
  <label class="midi-include midi-discard" hidden><input id="midi-discard-ack" type="checkbox" />Discard unapplied editor edits and suggestion on replacement</label>
  <button type="button" id="midi-apply" disabled>Replace composition</button>`;
midiHost.addEventListener('input', event => {
  const node = event.target as HTMLInputElement;
  if (node.id === 'midi-discard-ack') { updateMidiControls(); return; }
  if (node.id !== 'midi-file') invalidateMidiChoice();
});
midiHost.addEventListener('change', event => {
  const node = event.target as HTMLInputElement;
  if (node.id !== 'midi-file') { if (node.id !== 'midi-discard-ack') invalidateMidiChoice(); else updateMidiControls(); return; }
  const file = node.files?.[0]; node.value = '';
  if (!file || busy || startup) return;
  const epoch = ++midiEpoch, intent = editorIntent, generation = compositionGeneration;
  midiReading = true; midiSource = null; midiReview = null;
  midiHost.querySelector<HTMLElement>('#midi-choices')!.replaceChildren();
  midiHost.querySelector<HTMLInputElement>('#midi-discard-ack')!.checked = false;
  const current = () => epoch === midiEpoch && intent === editorIntent && generation === compositionGeneration;
  midiStatus('Reading MIDI locally…'); updateMidiControls();
  void (async () => {
    try {
      if (!file.size || file.size > MIDI_IMPORT_LIMITS.bytes) throw new Error('Choose a nonempty MIDI file no larger than 1 MiB.');
      const buffer = await file.arrayBuffer();
      if (!current()) return;
      const parsed = parseMidi(new Uint8Array(buffer));
      if (!current()) return;
      midiSource = parsed; showMidiSource(parsed);
      midiStatus('Source ready. No parts or instruments are selected automatically. Choose a phrase and review it.');
    } catch (error) { if (current()) midiStatus(error instanceof Error ? error.message : 'Could not read this MIDI file. Your editor is unchanged.'); }
    finally { if (current()) { midiReading = false; updateMidiControls(); } }
  })();
});
midiHost.querySelector('#midi-cancel')!.addEventListener('click', cancelMidi);
midiHost.querySelector('#midi-review')!.addEventListener('click', () => {
  if (busy || startup || midiReading || !midiSource) return;
  const epoch = midiEpoch, intent = editorIntent, generation = compositionGeneration;
  midiReview = null; midiHost.querySelector<HTMLInputElement>('#midi-discard-ack')!.checked = false;
  try {
    const review = buildMidiReview(project, midiSource, midiChoices());
    if (epoch !== midiEpoch || intent !== editorIntent || generation !== compositionGeneration) return;
    midiReview = review; reviewedEpoch = epoch; reviewedIntent = intent; reviewedGeneration = generation;
    showMidiReview(review); midiStatus('Phrase reviewed. Check the included and excluded parts before replacing.');
  } catch (error) { midiStatus(error instanceof Error ? error.message : 'Could not review this phrase. Your editor is unchanged.'); }
  updateMidiControls();
});
midiHost.querySelector('#midi-apply')!.addEventListener('click', () => {
  const review = midiReview;
  const current = () => !busy && !startup && !midiReading && review !== null && review === midiReview && reviewedEpoch === midiEpoch
    && reviewedIntent === editorIntent && reviewedGeneration === compositionGeneration
    && (!scratchExists() || midiHost.querySelector<HTMLInputElement>('#midi-discard-ack')!.checked);
  if (!review || !current()) return;
  try {
    applyMidiImport(project, review);
    const confirmation = `Replace the composition with ${review.includedNotes} notes in ${review.lanes.length} parts (${review.lanes.map(lane => lane.name).join(', ')})? ${review.excludedNoteOnCount} source note attacks are excluded. Source beats ${review.choices.startBeat + 1} to ${review.choices.endBeat + 1} (end exclusive). Names and fallback choices are those shown in the review. Undo restores the previous committed composition, not discarded raw edits or an unsaved suggestion.`;
    if (!window.confirm(confirmation)) return;
    if (!current()) { midiStatus('The editor changed. Review this phrase again.'); return; }
    const next = applyMidiImport(project, review);
    if (!current()) return;
    if (!commit(next, 'MIDI phrase imported. Undo restores the previous committed composition.', true, notesOnly(next))) return;
    fieldDrafts.clear(); noteDrafts.clear(); clearContinuation(); activeTrackId = project.tracks[0].id; selectedNoteId = null; defaultSeedCount();
    cancelMidi(); midiStatus('MIDI phrase replaced the composition. Review limits still apply: local instrument approximations, omitted metadata and trailing silence, and 480-tick MIDI re-export rounding.');
    render(); app.querySelector<HTMLInputElement>('#project-title')?.focus();
  } catch (error) { midiStatus(error instanceof Error ? error.message : 'Could not apply this review. Your editor is unchanged.'); }
});

function documentNode(selector: string): HTMLElement { return app.querySelector<HTMLElement>(selector)!; }
function syncSaveStatus(): void {
  libraryView?.sync();
  const node = app.querySelector<HTMLElement>('#save-status'); if (node) node.textContent = saveMessage;
  const retry = referenceHost.querySelector<HTMLButtonElement>('#retry-save');
  if (retry) { retry.hidden = recovery || (!unsaved && hasSavedCopy); retry.disabled = startup || saving || replacing; }
  const load = referenceHost.querySelector<HTMLButtonElement>('#retry-load');
  if (load) { load.hidden = !recovery; load.disabled = startup || saving || replacing || !!busy; }
  const replace = referenceHost.querySelector<HTMLButtonElement>('#replace-saved-copy');
  if (replace) { replace.hidden = !recovery; replace.disabled = startup || saving || replacing || !!busy; }
}
function queueSave(): void {
  unsaved = true;
  if (recovery) { saveMessage = 'Not saved in this browser — protected recovery. Retry load or explicitly Replace saved copy.'; syncSaveStatus(); return; }
  if (manualSaveRequired) { saveMessage = 'Newer local work is not saved. Download a complete project file or explicitly Retry save.'; syncSaveStatus(); return; }
  savePending = { bundle: history.snapshot(), generation: compositionGeneration };
  saveMessage = saveFailed ? 'Not saved in this browser — saving the latest complete project…' : 'Saving complete project…'; syncSaveStatus();
  if (!saving) void pumpSave();
}
async function pumpSave(): Promise<void> {
  saving = true; syncSaveStatus();
  try {
    while (savePending && !recovery) {
      const job = savePending, uiEpoch = saveUiEpoch; savePending = null;
      try {
        if (!completeStorage) throw new Error('Browser storage unavailable.');
        await completeStorage.save(job.bundle);
        if (uiEpoch === saveUiEpoch && job.generation === compositionGeneration && !savePending) {
          unsaved = false; saveFailed = false; hasSavedCopy = true; saveMessage = 'Saved in this browser';
        }
      } catch (error) {
        unsaved = true; saveFailed = true;
        if (error instanceof SavedCopyConflict) {
          recovery = true; savePending = null;
          saveMessage = 'Saved-copy conflict with another tab. Your current notes, reference audio and drafts remain unsaved here. Download a complete project file, Retry load, or explicitly Replace saved copy.';
          updateReference();
        } else saveMessage = 'Not saved in this browser. Download a complete project file or Retry save.';
      }
      syncSaveStatus();
    }
  } finally { saving = false; syncSaveStatus(); }
}
async function loadComplete(initial = false): Promise<void> {
  if (!initial && (startup || busy || saving || replacing)) return;
  if (!initial) {
    const beforeGeneration = compositionGeneration, beforeIntent = editorIntent;
    if ((unsaved || scratchExists()) && !window.confirm('Retry loading the saved complete project and replace current in-memory work and unapplied fields? Download a backup first.')) return;
    if (beforeGeneration !== compositionGeneration || beforeIntent !== editorIntent) { announce('The editor changed during confirmation. Retry load again.'); return; }
  }
  newEditorIntent();
  const epoch = ++loadEpoch, generation = compositionGeneration, intent = editorIntent;
  const owner = { epoch, retired: false }; pendingLoad = owner;
  startup = true; busy = 'loading'; saveMessage = 'Loading saved project…'; render();
  const current = () => epoch === loadEpoch && generation === compositionGeneration && intent === editorIntent;
  try {
    if (!completeStorage) completeStorage = new ReferenceStorage(window.indexedDB);
    const loaded = await completeStorage.load();
    if (!current()) return;
    let bundle = loaded.bundle;
    if (bundle === null) {
      const legacy = loadProject(storage);
      if (legacy.error) throw new Error('The legacy saved project could not be read. It has not been changed.');
      bundle = { document: notesOnly(legacy.project ?? createComposition()), assets: [] };
    }
    const restored = new ReferenceHistory(bundle);
    if (!current()) return;
    completeStorage.acceptLoad(loaded.receipt);
    history = restored; project = history.current.composition;
    activeTrackId = project.tracks[0].id; selectedNoteId = null;
    compositionGeneration++; projectFileEpoch++; cancelMidi(); stopPlayback(false);
    fieldDrafts.clear(); noteDrafts.clear(); clearContinuation(); defaultSeedCount();
    recovery = false; unsaved = false; saveFailed = false; manualSaveRequired = false; hasSavedCopy = loaded.bundle !== null;
    saveMessage = loaded.bundle ? 'Restored from this browser' : 'No complete saved copy yet. Edit or Retry save to save this project.';
    message = loaded.bundle ? 'Restored complete notes and reference takes. Auditions use applied notes.' : 'Start with a melody. Successful takes retain a normalized listen-back copy on this device.';
  } catch {
    if (current()) {
      recovery = true; unsaved = true;
      saveMessage = 'Not saved in this browser — protected recovery. Saved data has not been changed.';
      message = 'The saved complete project could not be read. Retry load, download your current project, or explicitly Replace saved copy. Damaged data has not been deleted.';
    }
  } finally {
    if (pendingLoad === owner) {
      pendingLoad = null; startup = false; busy = null;
      if (owner.retired) {
        recovery = true; unsaved = true; saveFailed = true;
        saveMessage = 'Not saved in this browser — protected recovery. The retired read finished without restoring or accepting its saved copy. Retry load to review it again.';
        message = 'The pending load finished after this page left. Its saved copy was not adopted; Retry load explicitly to restore it. Current memory and saved data are unchanged.';
      }
      render();
    }
  }
}
async function replaceSavedCopy(): Promise<void> {
  if (startup || busy || saving || replacing) return;
  newEditorIntent();
  const epoch = ++replacementEpoch, generation = compositionGeneration, intent = editorIntent;
  const snapshot = history.snapshot();
  const owns = () => epoch === replacementEpoch;
  const sameEditor = () => generation === compositionGeneration && intent === editorIntent;
  const matches = () => owns() && sameEditor() && !startup && !busy;
  replacing = true; recovery = true; savePending = null; unsaved = true;
  saveMessage = 'Reviewing the current saved copy. Your local work remains protected and unsaved.'; syncSaveStatus();
  try {
    if (!completeStorage) completeStorage = new ReferenceStorage(window.indexedDB);
    const review = await completeStorage.reviewReplacement();
    if (!matches()) {
      if (owns()) saveMessage = 'The editor changed while reviewing the saved copy. Your drafts are kept; explicitly Replace saved copy again.';
      return;
    }
    const saved = review.summary.readable
      ? `the saved project “${review.summary.title}” (${review.summary.tracks} tracks, ${review.summary.references} reference takes)`
      : 'the unreadable saved copy';
    if (!window.confirm(`Replace ${saved} with your current committed local notes and reference audio? Unapplied fields and suggestions are excluded. This overwrites the saved descriptor and assets; download backups first.`)) {
      saveMessage = 'Saved-copy replacement cancelled. Both copies and your unapplied fields are unchanged.'; return;
    }
    if (!matches()) { saveMessage = 'The editor changed during confirmation. Review and confirm the saved-copy replacement again.'; return; }
    saveMessage = 'Replacing the reviewed saved copy… It remains protected until the transaction completes.'; syncSaveStatus();
    await completeStorage.replace(snapshot, review.receipt);
    if (!owns()) return;
    recovery = false; hasSavedCopy = true; savePending = null;
    if (sameEditor()) {
      unsaved = false; saveFailed = false; manualSaveRequired = false; saveMessage = 'Saved in this browser';
    } else {
      unsaved = true; saveFailed = true; manualSaveRequired = true;
      saveMessage = 'The reviewed committed project was saved, but newer local work remains UNSAVED. Download a complete project file or explicitly Retry save.';
    }
  } catch (error) {
    if (owns()) {
      recovery = true; unsaved = true; saveFailed = true; savePending = null;
      saveMessage = error instanceof SavedCopyConflict
        ? 'Saved-copy conflict: another tab changed the copy after review. Your current work is kept. Explicitly Replace saved copy again to review it afresh.'
        : 'The saved-copy replacement failed. Your local notes, reference audio and drafts are kept; the browser copy remains protected. Download a complete project file or review replacement again.';
    }
  } finally {
    if (owns()) { replacing = false; syncSaveStatus(); updateReference(); }
  }
}
async function saveBackup(): Promise<void> {
  try {
    const snapshot = history.snapshot();
    const bytes = await encodeProjectBackup(snapshot);
    download(new Uint8Array(bytes), '.melody.json', 'application/json');
    announce('Complete project file saved, including committed notes and reference takes; unapplied fields and suggestions are excluded.');
  } catch (error) { announce(error instanceof Error ? error.message : 'Could not create a complete backup. Your project is unchanged.'); }
}
async function openBackup(file: File): Promise<void> {
  const epoch = ++projectFileEpoch, generation = compositionGeneration, intent = editorIntent;
  projectFileReading = true; announce('Reading complete project locally…'); updateReference();
  const current = () => epoch === projectFileEpoch && generation === compositionGeneration && intent === editorIntent && !startup && !busy;
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (epoch !== projectFileEpoch) return;
    projectFileEpoch++; projectFileReading = false; announce('Project read took too long. Your current project and drafts are unchanged.'); updateReference();
  }, REFERENCE_LIMITS.operationMs);
  try {
    if (!file.size || file.size > REFERENCE_LIMITS.backupBytes) throw new Error('Choose a nonempty complete project of at most 12 MiB (legacy notes-only files: 1 MiB).');
    const bytes = await file.arrayBuffer(); if (!current()) return;
    const bundle = await decodeProjectBackup(new Uint8Array(bytes)); if (!current()) return;
    const scratch = scratchExists();
    const text = `Open ${bundle.document.composition.tracks.length} tracks with ${bundle.document.references.length} reference takes and replace the current committed project? Undo restores the previous committed document, not discarded unapplied fields.${scratch ? ' This also discards your unapplied editor fields and unsaved suggestion.' : ''}`;
    if (!window.confirm(text)) return;
    if (!current()) { announce('The editor changed during confirmation. Choose the project file again.'); return; }
    if (!commit(bundle.document.composition, 'Project opened. Complete notes and reference takes restored. Undo restores the previous committed project.', false, bundle.document, bundle.assets)) return;
    fieldDrafts.clear(); noteDrafts.clear(); clearContinuation(); activeTrackId = project.tracks[0].id; selectedNoteId = null; defaultSeedCount();
    render();
  } catch (error) { if (current()) announce(`Could not open project: ${error instanceof Error ? error.message : 'Your editor is unchanged.'}`); }
  finally {
    if (timer) { clearTimeout(timer); timer = null; }
    if (epoch === projectFileEpoch) { projectFileReading = false; updateReference(); }
  }
}
function selectedAsset(): ReferenceAsset | null {
  const binding = history.current.references.find(item => item.trackId === currentTrack().id);
  return binding ? history.asset(binding.assetId) : null;
}
function selectedReferenceKey(asset = selectedAsset()): string { return asset ? `${currentTrack().id}:${asset.id}` : ''; }
function referenceDraft(asset: ReferenceAsset): { start: string; end: string } {
  const key = selectedReferenceKey(asset);
  let draft = windowDrafts.get(key);
  if (!draft) { draft = { start: '0', end: String(asset.frameCount / REFERENCE_LIMITS.sampleRate) }; windowDrafts.set(key, draft); }
  return draft;
}
function readReferenceWindow(asset: ReferenceAsset) {
  const draft = referenceDraft(asset);
  const decimal = (text: string) => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim())) throw new Error('Enter nonempty finite decimal comparison bounds. Your input is kept.');
    return numericDraft(text, 'comparison bounds');
  };
  return referenceWindow(decimal(draft.start), decimal(draft.end), asset.frameCount);
}
function updateReference(): void {
  if (!referenceHost.querySelector('#reference-summary')) return;
  const asset = selectedAsset(), key = selectedReferenceKey(asset);
  const start = referenceHost.querySelector<HTMLInputElement>('#reference-start')!;
  const end = referenceHost.querySelector<HTMLInputElement>('#reference-end')!;
  referenceHost.querySelector<HTMLElement>('#reference-empty')!.hidden = !!asset;
  referenceHost.querySelector<HTMLElement>('#reference-controls')!.hidden = !asset;
  if (asset) {
    const draft = referenceDraft(asset);
    if (key !== referenceKey) { start.value = draft.start; end.value = draft.end; referenceMessage = ''; }
    referenceHost.querySelector<HTMLElement>('#reference-summary')!.textContent = `${asset.kind} supplied capture · captured ${asset.captureTempo} BPM · current ${project.tempo} BPM · ${asset.frameCount / 22050} seconds · decoded ${asset.decodedSampleRate} Hz / ${asset.decodedChannels} channels. Mono PCM16 normalized copy at 22050 Hz, with lossy quantization/resampling; not amplitude normalized.${asset.decodedFrames > asset.analyzedFrames ? ' Padding after 20 seconds was cut.' : ''}`;
    try {
      const window = readReferenceWindow(asset);
      referenceHost.querySelector<HTMLElement>('#reference-effective')!.textContent = `Effective comparison: ${window.startFrame / 22050}–${window.endFrame / 22050} seconds, ${window.endFrame - window.startFrame} samples. Notes outside this window are not compared; use ordinary Play for the full arrangement.`;
    } catch (error) { referenceHost.querySelector<HTMLElement>('#reference-effective')!.textContent = error instanceof Error ? error.message : 'Invalid comparison bounds.'; }
  } else referenceHost.querySelector<HTMLElement>('#reference-summary')!.textContent = '';
  referenceKey = key;
  const disabled = startup || !!busy || !asset;
  start.disabled = startup || (!!busy && busy !== 'rendering') || !asset; end.disabled = start.disabled;
  referenceHost.querySelector<HTMLButtonElement>('#play-reference')!.disabled = disabled;
  const inaudible = currentTrack().muted || currentTrack().volume === 0;
  referenceHost.querySelector<HTMLButtonElement>('#play-reference-notes')!.disabled = disabled || inaudible;
  referenceHost.querySelector<HTMLElement>('#reference-status')!.textContent = referenceMessage || (inaudible && asset ? 'Unmute or raise track volume to audition applied notes. Reference audio ignores track mute and volume.' : 'Auditions use applied notes. Reference audio ignores track mute and volume and plays at its retained level.');
  referenceHost.querySelector<HTMLButtonElement>('#remove-reference')!.disabled = disabled;
  const clear = referenceHost.querySelector<HTMLButtonElement>('#clear-history')!;
  clear.hidden = !history.canUndo && !history.canRedo; clear.disabled = startup || !!busy;
  referenceHost.querySelector<HTMLButtonElement>('#cancel-project-read')!.hidden = !projectFileReading;
  const retained = new Set(history.current.references.map(item => `${item.trackId}:${item.assetId}`));
  for (const windowKey of windowDrafts.keys()) if (!retained.has(windowKey)) windowDrafts.delete(windowKey);
  syncSaveStatus();
}
async function playReference(notes: boolean): Promise<void> {
  const asset = selectedAsset(); if (!asset || busy || startup) return;
  let window;
  try { window = readReferenceWindow(asset); }
  catch (error) { referenceMessage = error instanceof Error ? error.message : 'Check comparison bounds.'; updateReference(); return; }
  stopPlayback(false);
  const generation = playbackGeneration, token = ++operation;
  const owner = { key: selectedReferenceKey(asset), generation: compositionGeneration, window: JSON.stringify(window) };
  comparisonOwner = owner; playbackJob = { token };
  busy = 'rendering'; referenceMessage = notes ? 'Rendering applied notes at capture tempo…' : 'Preparing the retained reference window…'; render();
  const current = () => generation === playbackGeneration && token === operation && comparisonOwner === owner
    && compositionGeneration === owner.generation && selectedReferenceKey() === owner.key;
  try {
    audioContext ??= new AudioContext();
    const context = audioContext;
    await context.resume(); if (!current()) return;
    const samples = notes
      ? cropComparison(await runWorker<Float32Array>('render', { project: comparisonComposition(history.current, currentTrack().id, asset), wav: false }), window)
      : referenceSamples(asset, window);
    if (!current()) return;
    const buffer = context.createBuffer(1, samples.length, 22050); buffer.copyToChannel(new Float32Array(samples), 0);
    const playingSource = context.createBufferSource(); playingSource.buffer = buffer; playingSource.connect(context.destination);
    playingSource.onended = () => {
      playingSource.disconnect();
      if (source !== playingSource) return;
      source = null; playing = false; comparisonOwner = null; syncTransport(); updateReference();
    };
    source = playingSource; playingSource.start(); playing = true;
    referenceMessage = notes ? 'Playing applied notes at captured BPM, solo, for this exact window.' : 'Playing retained reference at original speed and retained level.';
  } catch (error) { if (current()) referenceMessage = error instanceof Error ? error.message : 'Comparison playback unavailable.'; }
  finally {
    if (current() && playbackJob?.token === token) { playbackJob = null; busy = null; if (!playing) comparisonOwner = null; render(); }
  }
}
referenceHost.innerHTML = `<p class="eyebrow">LISTEN BACK AND CORRECT</p><h2 id="reference-heading">Reference take</h2>
  <p id="reference-empty">This track has notes only, with no retained reference take. Successfully record, import audio or try the demo to keep a normalized listen-back copy.</p>
  <p id="reference-summary"></p><div id="reference-controls" hidden>
  <div class="reference-window"><label for="reference-start">Comparison start (seconds)<input id="reference-start" type="text" inputmode="decimal" /></label><label for="reference-end">Comparison end (seconds)<input id="reference-end" type="text" inputmode="decimal" /></label></div>
  <p id="reference-effective" class="small"></p><div class="button-row"><button id="play-reference">Play reference</button><button id="play-reference-notes">Play edited notes at capture tempo</button><button id="remove-reference">Remove reference</button></div>
  <p class="small">Reference audio ignores track mute and volume. Notes audition uses applied notes, current instrument/volume/velocity and captured BPM. No time stretching or device-delay correction; quantization/resampling is lossy.</p></div>
  <p id="reference-status" aria-live="polite"></p><div class="button-row"><button id="clear-history" hidden>Clear undo history</button><button id="retry-save" hidden>Retry save</button><button id="retry-load" hidden>Retry load</button><button id="replace-saved-copy" hidden>Replace saved copy</button><button id="cancel-project-read" hidden>Cancel project import</button></div>
  <p class="small">Save project file carries current notes and reference takes, not history or unapplied fields. Browser tabs do not merge edits. A changed saved copy pauses saving until you review it. Download a complete backup before clearing browser data.</p>`;
referenceHost.addEventListener('input', event => {
  if (startup) return;
  const input = event.target as HTMLInputElement;
  if (!['reference-start', 'reference-end'].includes(input.id)) return;
  const asset = selectedAsset(); if (!asset) return;
  newEditorIntent();
  const draft = referenceDraft(asset); if (input.id === 'reference-start') draft.start = input.value; else draft.end = input.value;
  if (comparisonOwner) stopPlayback(false);
  referenceMessage = ''; updateReference();
});
referenceHost.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button || button.disabled || startup) return;
  switch (button.id) {
    case 'play-reference': void playReference(false); break;
    case 'play-reference-notes': void playReference(true); break;
    case 'retry-save': manualSaveRequired = false; queueSave(); break;
    case 'retry-load': void loadComplete(); break;
    case 'replace-saved-copy': void replaceSavedCopy(); break;
    case 'cancel-project-read': projectFileEpoch++; projectFileReading = false; announce('Project import cancelled. Current audio, drafts, notes and reference are unchanged.'); updateReference(); break;
    case 'remove-reference': {
      const asset = selectedAsset(); if (!asset) break;
      const generation = compositionGeneration, intent = editorIntent;
      if (!window.confirm('Remove this track’s reference take while keeping its notes? Undo restores the reference.')) break;
      if (generation !== compositionGeneration || intent !== editorIntent || selectedAsset()?.id !== asset.id) break;
      const document = history.current; document.references = document.references.filter(item => item.trackId !== activeTrackId);
      commit(project, 'Reference removed; notes are unchanged.', true, document); break;
    }
    case 'clear-history': {
      const generation = compositionGeneration, intent = editorIntent;
      if (!window.confirm('Clear undo history? Current notes, reference takes and the saved copy stay unchanged, but earlier edits and takes cannot be restored. Download a complete project first.')) break;
      if (generation !== compositionGeneration || intent !== editorIntent || busy) break;
      history.clear(); projectFileEpoch++; projectFileReading = false; midiEpoch++; midiReading = false; midiReview = null;
      message = 'Undo history cleared. Current project and saved copy are unchanged.'; syncHistory(); updateMidiControls(); announce(message); updateReference(); break;
    }
  }
});
window.addEventListener('beforeunload', event => { if (saving || unsaved || scratchExists()) { event.preventDefault(); event.returnValue = ''; } });

// Every external input/action is a new dependent library intent, including MIDI
// review choices which do not increment compositionGeneration/editorIntent.
for (const type of ['pointerdown', 'pointerup', 'pointercancel'] as const) root.addEventListener(type, () => {
  queueMicrotask(() => libraryView?.sync());
}, true);
for (const type of ['input', 'change', 'click'] as const) root.addEventListener(type, event => {
  if (!libraryHost.contains(event.target as Node)) libraryView?.retire();
}, true);
libraryView = createLibraryView(libraryHost, {
  state: () => {
    const blocked = startup || !!pendingLoad || !!busy || capture !== null || nativeAudioPending || pendingMicrophoneStarts > 0 || replacing
      || projectFileReading || midiReading || roll.active;
    return { generation: compositionGeneration, intent: editorIntent, captureBlocked: blocked,
      openBlocked: blocked || saving || savePending !== null,
      scratch: scratchExists() || midiSource !== null || midiReview !== null || windowDrafts.size > 0 };
  },
  snapshot: () => history.snapshot(),
  open: bundle => {
    if (!commit(bundle.document.composition, 'Saved composition opened. Complete notes and reference takes restored. Undo restores the previous committed project.', false, bundle.document, bundle.assets)) return false;
    stopPlayback(false);
    fieldDrafts.clear(); noteDrafts.clear(); clearContinuation(); windowDrafts.clear(); referenceKey = '';
    activeTrackId = project.tracks[0].id; selectedNoteId = null; defaultSeedCount();
    cancelMidi(); render();
    return true;
  },
});

timingView = createTimingView(timingHost, {
  state: () => ({ composition: project, trackId: currentTrack().id, generation: compositionGeneration, intent: editorIntent, blocked: startup || !!busy, playing }),
  ready: () => {
    if (startup || busy) return false;
    if (scratchExists() || roll.active) { announce('Apply or discard all unapplied editor fields and continuation suggestions, and finish the piano roll gesture before reviewing or applying timing. Your drafts are kept.'); return false; }
    return true;
  },
  intent: newEditorIntent,
  publish: (next, text) => commit(next, text),
  audition: candidate => {
    void playSnapshot(candidate, 'Auditioning reviewed timing in the current mix. Your committed composition is unchanged.');
    const token = operation, generation = playbackGeneration;
    return () => {
      // A later ordinary/Solo playback owns different counters and stays live.
      if (token !== operation || generation !== playbackGeneration) return;
      const pending = playbackJob !== null;
      stopPlayback(false);
      // Let the current input event retain its raw draft before replacing app DOM.
      if (pending) queueMicrotask(() => render());
    };
  },
});

render();

void loadComplete(true);
