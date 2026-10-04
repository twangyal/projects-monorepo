import './style.css';
import { createComposition, createDemoComposition, createNote, createTrack, validateComposition, parseComposition, serializeComposition, compositionDurationBeats } from './model.ts';
import { createDemoMelody } from './audio.ts';
import { encodeMidi } from './midi.ts';
import { MelodyRecorder } from './recorder.ts';
import { loadProject, saveProject } from './storage.ts';
import { CompositionHistory } from './history.ts';
import { duplicateTrack, transposeTrack, repeatTrack } from './arrangement.ts';
import { selectEnding, suggestEnding, applyContinuation, auditionComposition, type ContinuationProposal, type SeedSelection } from './continuation.ts';
import { parseMidi, MIDI_IMPORT_LIMITS, type MidiPreview, type MidiName } from './midi-import.ts';
import { buildMidiReview, applyMidiImport, type MidiImportReview, type MidiImportChoices } from './midi-review.ts';
import type { Composition, Note, Track } from './types.ts';

const root = document.querySelector<HTMLDivElement>('#app')!;
const app = document.createElement('div');
const midiHost = document.createElement('section');
midiHost.id = 'midi-import'; midiHost.setAttribute('aria-labelledby', 'midi-heading');
root.append(app, midiHost);
let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* Recovery is shown in the interface. */ }
const saved = loadProject(storage);
let project = saved.project ?? createComposition();
const history = new CompositionHistory(project);
let activeTrackId = project.tracks[0].id;
let selectedNoteId: string | null = null;
let message = saved.error ?? 'Start with a melody. Your audio stays on this device.';
let saveMessage = saved.project ? 'Restored from this browser' : 'Save locally as you compose';
let busy: 'requesting' | 'recording' | 'processing' | 'rendering' | null = null;
let operation = 0;
let worker: Worker | null = null;
let rejectWorker: ((reason: Error) => void) | null = null;
let recordingTimer: ReturnType<typeof setInterval> | null = null;
let recordedAt = 0;
const recorder = new MelodyRecorder();
let audioContext: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let playbackGeneration = 0;
let playing = false;
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
const trackFields = new Set(['track-name', 'instrument', 'volume', 'muted']);
let editorIntent = 0;
let midiEpoch = 0;
let midiReading = false;
let midiSource: MidiPreview | null = null;
let midiReview: MidiImportReview | null = null;
let reviewedIntent = -1, reviewedGeneration = -1, reviewedEpoch = -1;
function fieldKey(id: string): string { return projectFields.has(id) ? id : `${activeTrackId}:${id}`; }
function fieldValue(id: string, value: string | number | boolean): string | boolean { return fieldDrafts.get(fieldKey(id)) ?? (typeof value === 'boolean' ? value : String(value)); }
function numericDraft(value: string, label: string): number {
  if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`Enter a nonempty finite number for ${label}. Your draft is kept.`);
  return Number(value);
}
function scratchExists(): boolean { return fieldDrafts.size > 0 || noteDrafts.size > 0 || proposal !== null; }
function newEditorIntent() {
  editorIntent++;
  const hadImport = midiReading || midiSource !== null || midiReview !== null;
  midiReading = false; midiReview = null;
  const ack = midiHost.querySelector<HTMLInputElement>('#midi-discard-ack'); if (ack) ack.checked = false;
  if (hadImport) midiStatus('The editor changed. Review this phrase again. If a file was still loading, choose it again.');
  updateMidiControls();
}
function commitField(id: string, action: () => boolean) {
  const key = fieldKey(id), raw = fieldDrafts.get(key);
  if (!action()) return;
  if (fieldDrafts.get(key) === raw) fieldDrafts.delete(key);
  const track = currentTrack();
  const values: Record<string, string | number | boolean> = { 'project-title': project.title, tempo: project.tempo, 'track-name': track.name, instrument: track.instrument, volume: track.volume, muted: track.muted };
  const node = app.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  if (node instanceof HTMLInputElement && node.type === 'checkbox') node.checked = Boolean(values[id]);
  else if (node) node.value = String(values[id]);
  updateMidiControls();
}

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const noteName = (pitch: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
const currentTrack = (): Track => project.tracks.find(track => track.id === activeTrackId) ?? project.tracks[0];
const disabled = () => busy ? 'disabled' : '';

function announce(text: string) {
  message = text;
  document.querySelector('#notice')!.textContent = message;
}

function commit(next: Composition, text?: string, redraw = true) {
  try {
    const validated = validateComposition(next);
    const changed = history.commit(validated);
    const hadProposal = proposal !== null;
    const newTrack = !project.tracks.some(track => track.id === activeTrackId);
    if (changed) { compositionGeneration++; newEditorIntent(); clearContinuation(); }
    stopPlayback(false);
    project = validated;
    if (newTrack) defaultSeedCount();
    pruneNoteDrafts();
    saveMessage = saveProject(storage, project) ?? 'Saved in this browser';
    if (text) message = text;
    if (redraw || changed && hadProposal) render();
    else {
      document.querySelector('#save-status')!.textContent = saveMessage;
      document.querySelector('#notice')!.textContent = message;
      refreshTrackLabels();
      syncHistory();
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
  project = next;
  pruneNoteDrafts();
  if (!project.tracks.some(track => track.id === activeTrackId)) activeTrackId = project.tracks[0].id;
  if (!currentTrack().notes.some(note => note.id === selectedNoteId)) selectedNoteId = null;
  saveMessage = saveProject(storage, project) ?? 'Saved in this browser';
  message = direction === 'undo' ? 'Undid the last change.' : 'Restored the next change.';
  render();
}

function arrange(action: string) {
  try {
    let next: Composition;
    if (action === 'duplicate-track') {
      next = duplicateTrack(project, currentTrack().id);
      activeTrackId = next.tracks[project.tracks.findIndex(track => track.id === currentTrack().id) + 1].id;
      selectedNoteId = null;
    } else if (action === 'repeat-phrase') next = repeatTrack(project, currentTrack().id);
    else next = transposeTrack(project, currentTrack().id, Number(action.slice('transpose:'.length)));
    commit(next, action === 'duplicate-track' ? 'Track duplicated. Try changing its instrument or pitch.' : action === 'repeat-phrase' ? 'Phrase repeated. Undo restores its original length.' : 'Track transposed. Undo restores the original pitches.');
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
  const bottom = Math.min(60, ...pitches) - 2;
  const top = Math.max(72, ...pitches) + 2;
  const rows = top - bottom + 1;
  app.innerHTML = `
    <header class="site-header"><div class="brand"><span class="brand-mark" aria-hidden="true">m<span>♪</span></span><div><p class="eyebrow">FROM A HUM TO SOMETHING MORE</p><h1>Melody Studio</h1></div></div><span class="privacy-badge"><span aria-hidden="true">●</span> Made here. Stays here.</span></header>
    <main id="workspace">
      <section class="project-bar" aria-label="Project settings"><div class="project-title"><label for="project-title">Project title</label><input id="project-title" value="${escape(String(fieldValue('project-title', project.title)))}" maxlength="80" ${disabled()} /></div><div class="tempo-field"><label for="tempo">Tempo (BPM)</label><input id="tempo" type="number" min="40" max="240" step="any" value="${escape(String(fieldValue('tempo', project.tempo)))}" ${disabled()} /></div><div class="transport"><button class="primary" data-action="play" ${busy || !totalNotes || playing ? 'disabled' : ''} aria-label="Play composition"><span aria-hidden="true">▶</span> Play</button><button data-action="stop" ${!playing && !playbackJob ? 'disabled' : ''} aria-label="Stop playback">■ Stop</button></div><div class="history-controls"><button data-action="undo" title="Undo (Ctrl/Cmd+Z)" ${busy || !history.canUndo ? 'disabled' : ''}>Undo</button><button data-action="redo" title="Redo (Ctrl/Cmd+Shift+Z)" ${busy || !history.canRedo ? 'disabled' : ''}>Redo</button></div><span class="project-stats">${project.tracks.length} ${project.tracks.length === 1 ? 'track' : 'tracks'} · ${totalNotes} notes</span></section>
      <div id="notice" class="notice" role="status" aria-live="polite">${escape(message)}</div>
      <section class="capture-card" aria-labelledby="capture-heading"><div><p class="eyebrow">01 / CATCH AN IDEA</p><h2 id="capture-heading">Your next song starts with a hum.</h2><p>Sing one clear melody, then make it your own.<br />Record up to 20 seconds or bring in an audio file.</p></div><div class="capture-controls"><div class="button-row"><button class="record-button" data-action="record" ${disabled()}><span class="record-dot" aria-hidden="true"></span> Record melody</button><label class="file-button ${busy ? 'is-disabled' : ''}">Import audio<input id="audio-file" type="file" accept="audio/*" aria-label="Import audio file" ${disabled()} /></label></div><div class="button-row"><button class="quiet" data-action="demo" ${disabled()}>Try demo melody</button><span class="small">No microphone needed</span></div><div class="capture-progress" ${!busy ? 'hidden' : ''}><span id="capture-state">${busy === 'requesting' ? 'Waiting for microphone permission…' : busy === 'recording' ? 'Recording…' : busy === 'rendering' ? 'Rendering your composition…' : 'Finding the notes…'}</span><button data-action="finish-record" ${busy !== 'recording' ? 'hidden' : ''}>Finish recording</button><button data-action="cancel">Cancel</button></div></div></section>
      <section class="studio" aria-label="Composition editor"><aside class="tracks-panel"><div class="section-heading"><div><p class="eyebrow">02 / BUILD YOUR SOUND</p><h2>Tracks</h2></div><button class="icon-button" data-action="add-track" aria-label="Add track" ${busy || project.tracks.length >= 8 ? 'disabled' : ''}>+</button></div><div class="track-list">${project.tracks.map((item, index) => `<button class="track-card ${item.id === track.id ? 'is-selected' : ''}" data-track="${escape(item.id)}" aria-label="Select track: ${escape(item.name)}" aria-pressed="${item.id === track.id}" ${disabled()}><span class="track-icon" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span><strong>${escape(item.name)}</strong><small>${item.notes.length} notes · ${item.muted ? 'muted' : item.instrument === 'sine' ? 'Soft keys' : item.instrument === 'triangle' ? 'Warm flute' : 'Bright synth'}</small></span></button>`).join('')}</div><div class="track-settings"><label for="track-name">Track name</label><input id="track-name" value="${escape(String(fieldValue('track-name', track.name)))}" maxlength="80" ${disabled()} /><label for="instrument">Instrument</label><select id="instrument" ${disabled()}><option value="sine" ${fieldValue('instrument', track.instrument) === 'sine' ? 'selected' : ''}>Soft keys</option><option value="triangle" ${fieldValue('instrument', track.instrument) === 'triangle' ? 'selected' : ''}>Warm flute</option><option value="sawtooth" ${fieldValue('instrument', track.instrument) === 'sawtooth' ? 'selected' : ''}>Bright synth</option></select><label for="volume">Track volume <span>${Math.round(track.volume * 100)}%</span></label><input id="volume" type="range" min="0" max="1" step="0.05" value="${escape(String(fieldValue('volume', track.volume)))}" ${disabled()} /><label class="checkbox-label"><input id="muted" type="checkbox" ${fieldValue('muted', track.muted) ? 'checked' : ''} ${disabled()} /> Mute track</label><button class="quiet danger" data-action="delete-track" ${busy || project.tracks.length <= 1 ? 'disabled' : ''}>Delete track</button></div><div class="arrangement-tools"><p class="eyebrow">ARRANGE THIS TRACK</p><button data-action="duplicate-track" ${busy || project.tracks.length >= 8 ? 'disabled' : ''}>Duplicate track</button><div class="transpose-controls" role="group" aria-label="Transpose track"><button data-action="transpose:-12" aria-label="Transpose down an octave" ${busy || !track.notes.length ? 'disabled' : ''}>−12</button><button data-action="transpose:-1" aria-label="Transpose down a semitone" ${busy || !track.notes.length ? 'disabled' : ''}>−1</button><button data-action="transpose:1" aria-label="Transpose up a semitone" ${busy || !track.notes.length ? 'disabled' : ''}>+1</button><button data-action="transpose:12" aria-label="Transpose up an octave" ${busy || !track.notes.length ? 'disabled' : ''}>+12</button></div><button data-action="repeat-phrase" ${busy || !track.notes.length ? 'disabled' : ''}>Repeat phrase</button><p class="small">Shift pitch by semitones. Notes stay within C2–C7 and 128 beats.</p></div></aside>
      <div class="editor-panel"><div class="editor-heading"><div><h2>${escape(track.name)}</h2><p class="small">Select a note to edit its pitch and timing.</p></div><button data-action="add-note" ${busy || track.notes.length >= 256 ? 'disabled' : ''}><span aria-hidden="true">+</span> Add note</button></div><div class="piano-roll" aria-label="Piano roll"><div class="roll-inner" style="--beats:${beats};--rows:${rows};min-width:${Math.max(640, beats * 36)}px"><div class="beat-ruler">${Array.from({ length: beats }, (_, i) => `<span>${i + 1}</span>`).join('')}</div><div class="pitch-labels">${Array.from({ length: rows }, (_, i) => `<span>${noteName(top - i)}</span>`).join('')}</div><div class="roll-grid" style="height:${rows * 22}px">${track.notes.map(item => `<button class="note-event ${item.id === selectedNoteId ? 'is-selected' : ''} ${seedIds.has(item.id) ? 'is-seed' : ''}" data-note="${escape(item.id)}" aria-label="${noteName(item.pitch)}, beat ${item.start + 1}, duration ${item.duration}" aria-pressed="${item.id === selectedNoteId}" style="left:${item.start / beats * 100}%;width:${item.duration / beats * 100}%;top:${(top - item.pitch) * 22 + 2}px" ${disabled()}><span>${noteName(item.pitch)}</span></button>`).join('')}${proposedNotes.map((item, index) => `<span class="note-event proposal-note" data-proposal-index="${index}" role="img" aria-label="Suggested ${noteName(item.pitch)}, beat ${item.start + 1}, duration ${item.duration}; not saved" style="left:${item.start / beats * 100}%;width:${item.duration / beats * 100}%;top:${(top - item.pitch) * 22 + 2}px">${noteName(item.pitch)}</span>`).join('')}${!track.notes.length ? '<div class="empty-roll"><span aria-hidden="true">♫</span><strong>A little space for a big idea.</strong><p>Record, import, or add your first note.</p></div>' : ''}</div></div></div>
      <form id="note-form" class="note-editor"><div class="note-editor-title"><strong>${note ? `Edit ${noteName(note.pitch)}` : 'Note details'}</strong><span class="small">${note ? 'Timing is measured in beats.' : 'Choose a note in the piano roll.'}</span></div><fieldset ${!note || busy ? 'disabled' : ''}><legend class="sr-only">Selected note</legend><label>Pitch (MIDI)<input name="pitch" type="number" min="36" max="96" step="1" value="${escape(draft?.pitch ?? '60')}" /></label><label>Start beat<input name="start" type="number" min="1" max="128.75" step="any" value="${escape(draft?.start ?? '1')}" /></label><label>Duration (beats)<input name="duration" type="number" min="0.25" max="16" step="any" value="${escape(draft?.duration ?? '1')}" /></label><label>Velocity<input name="velocity" type="number" min="0" max="1" step="any" value="${escape(draft?.velocity ?? '0.8')}" /></label><button type="submit">Apply note</button><button type="button" class="quiet" data-action="discard-note-edits">Discard note edits</button><button type="button" class="quiet danger" data-action="delete-note">Delete note</button></fieldset></form>${continuationPanel(selection, seedError)}</div></section>
      <section class="save-panel" aria-labelledby="save-heading"><div><p class="eyebrow">03 / KEEP IT GOING</p><h2 id="save-heading">Take your idea with you.</h2><p id="save-status" class="small" aria-live="polite">${escape(saveMessage)}</p></div><div class="export-actions"><button data-action="save" ${disabled()}>Save project file</button><label class="file-button ${busy ? 'is-disabled' : ''}">Open project<input id="project-file" type="file" accept=".json,application/json" aria-label="Open project file" ${disabled()} /></label><button data-action="midi" ${busy || !totalNotes ? 'disabled' : ''}>Export MIDI</button><button data-action="wav" ${busy || !totalNotes ? 'disabled' : ''}>Export WAV</button></div></section>
      <footer><div class="button-row"><button class="quiet" data-action="example" ${disabled()}>Load example</button><button class="quiet" data-action="new" ${disabled()}>New project</button></div><p>A music sketchbook, built for first ideas. Single-voice pitch detection, editable by you.<br />Audio is processed locally and discarded after transcription. Export a project backup before clearing browser data.</p></footer>
    </main>`;
  if (focusSelector) {
    const replacement = app.querySelector<HTMLElement>(focusSelector);
    replacement?.focus({ preventScroll: true });
    if (replacement instanceof HTMLInputElement && inputSelection?.start !== null && inputSelection?.start !== undefined && inputSelection.end !== null) replacement.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? 'none');
  }
  updateMidiControls();
}

function confirmReplace() {
  return !currentTrack().notes.length || window.confirm('Replace the notes in this track with a new melody? Save a project file first if you want to keep them.');
}

function clearRecordingTimer() {
  if (recordingTimer) clearInterval(recordingTimer);
  recordingTimer = null;
}

function cancelCapture() {
  const playbackWasActive = playbackJob !== null || playing;
  stopPlayback(false);
  operation++;
  recorder.cancel();
  clearRecordingTimer();
  worker?.terminate();
  worker = null;
  rejectWorker?.(new Error('Cancelled'));
  rejectWorker = null;
  busy = null;
  message = playbackWasActive ? 'Playback cancelled. Your notes are unchanged.' : 'Capture cancelled. Your notes are unchanged.';
  render();
}

function runWorker<Result>(kind: 'transcribe' | 'render', payload: unknown, transfer: Transferable[] = []): Promise<Result> {
  return new Promise((resolve, reject) => {
    const pending = kind === 'render'
      ? new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    worker = pending;
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Processing took too long. Try fewer notes or a shorter melody.')), 30000);
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

async function applyAudio(samples: Float32Array, sampleRate: number, token: number, targetId: string) {
  if (token !== operation) return;
  if (samples.length / sampleRate > 20.1) throw new Error('Choose a melody no longer than 20 seconds.');
  busy = 'processing';
  clearRecordingTimer();
  render();
  const notes = await runWorker<Note[]>('transcribe', { samples, sampleRate, tempo: project.tempo }, [samples.buffer]);
  if (token !== operation) return;
  if (!notes.length) throw new Error('No clear notes found. Try a louder, single-voice melody in a quiet room.');
  const next = structuredClone(project);
  const target = next.tracks.find(track => track.id === targetId);
  if (!target) return;
  target.notes = notes;
  selectedNoteId = notes[0].id;
  busy = null;
  commit(next, `Detected ${notes.length} notes. Listen back and adjust any pitch or timing below.`);
}

async function processBlob(blob: Blob, token: number, targetId: string) {
  if (token !== operation) return;
  busy = 'processing';
  clearRecordingTimer();
  render();
  let context: AudioContext | null = null;
  try {
    if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('Choose an audio file smaller than 10 MiB.');
    context = new AudioContext();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 20.1) throw new Error('Choose a melody no longer than 20 seconds.');
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] += data[i] / decoded.numberOfChannels;
    }
    await applyAudio(samples, decoded.sampleRate, token, targetId);
  } catch (error) {
    if (token === operation) announce(error instanceof Error ? error.message : 'Could not read this audio. Try a WAV file.');
  } finally {
    if (context) await context.close().catch(() => {});
    if (token === operation) { busy = null; render(); }
  }
}

async function startRecording() {
  if (!confirmReplace()) return;
  clearContinuation();
  stopPlayback(false);
  const token = ++operation;
  const targetId = currentTrack().id;
  busy = 'requesting';
  message = 'Microphone access is used only while you record. You can cancel at any time.';
  render();
  try {
    await recorder.start(blob => { void processBlob(blob, token, targetId); }, error => {
      if (token !== operation) return;
      clearRecordingTimer();
      busy = null;
      message = `Recording failed: ${error.message}`;
      render();
    });
    if (token !== operation) return;
    busy = 'recording';
    recordedAt = Date.now();
    render();
    recordingTimer = setInterval(() => {
      const label = document.querySelector('#capture-state');
      if (label) label.textContent = `Recording ${Math.min(20, Math.floor((Date.now() - recordedAt) / 1000))} / 20 seconds…`;
    }, 250);
  } catch (error) {
    if (token === operation) {
      busy = null;
      message = `Microphone unavailable: ${error instanceof Error ? error.message : 'Check permission and try again.'}`;
      render();
    }
  }
}

async function finishRecording() {
  const token = operation;
  const targetId = currentTrack().id;
  busy = 'processing';
  clearRecordingTimer();
  render();
  try {
    const blob = await recorder.stop();
    if (blob) await processBlob(blob, token, targetId);
    else if (token === operation) { busy = null; render(); }
  } catch (error) {
    if (token === operation) { busy = null; message = `Recording failed: ${String(error)}`; render(); }
  }
}

function stopPlayback(redraw = true) {
  playbackGeneration++;
  if (playbackJob) {
    operation++; worker?.terminate(); worker = null;
    rejectWorker?.(new Error('Playback cancelled')); rejectWorker = null;
    playbackJob = null; busy = null;
  }
  auditionOwner = null;
  if (source) { source.onended = null; try { source.stop(); } catch { /* Already stopped. */ } source.disconnect(); }
  source = null;
  playing = false;
  syncTransport();
  if (redraw) render();
}

function syncTransport() {
  const playButton = app.querySelector<HTMLButtonElement>('[data-action=play]');
  const stopButton = app.querySelector<HTMLButtonElement>('[data-action=stop]');
  if (playButton) playButton.disabled = !!busy || playing || !project.tracks.some(track => track.notes.length);
  if (stopButton) stopButton.disabled = !playing && !playbackJob;
}

async function playSnapshot(snapshot: Composition, label: string, owner: ContinuationProposal | null = null) {
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
    const samples = await runWorker<Float32Array>('render', { project: snapshot, wav: false });
    if (!current()) return;
    const buffer = audioContext.createBuffer(1, samples.length, 22050);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const playingSource = audioContext.createBufferSource();
    playingSource.buffer = buffer; playingSource.connect(audioContext.destination);
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

async function exportWav() {
  stopPlayback(false);
  const token = ++operation;
  busy = 'rendering';
  message = 'Rendering WAV…';
  render();
  try {
    const bytes = await runWorker<Uint8Array>('render', { project, wav: true });
    if (token !== operation) return;
    download(new Uint8Array(bytes), '.wav', 'audio/wav');
    message = 'WAV exported with the current instruments and mix.';
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

app.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button || button.disabled) return;
  if (button.dataset.track && !busy) { newEditorIntent(); clearContinuation(); activeTrackId = button.dataset.track; selectedNoteId = null; defaultSeedCount(); render(); return; }
  if (button.dataset.note && !busy) { newEditorIntent(); selectedNoteId = button.dataset.note; render(); document.querySelector<HTMLInputElement>('[name=pitch]')?.focus(); return; }
  const action = button.dataset.action;
  if (busy && action !== 'cancel' && action !== 'finish-record' && action !== 'stop' && !(action === 'discard-continuation' && auditionOwner)) return;
  if (action && !['save', 'midi', 'wav', 'play', 'stop', 'cancel', 'finish-record', 'audition-continuation'].includes(action)) newEditorIntent();
  switch (action) {
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
    case 'stop': message = 'Playback stopped.'; stopPlayback(); break;
    case 'record': void startRecording(); break;
    case 'finish-record': void finishRecording(); break;
    case 'cancel': cancelCapture(); break;
    case 'demo': {
      if (!confirmReplace()) break;
      clearContinuation();
      stopPlayback(false);
      const token = ++operation;
      void applyAudio(createDemoMelody(), 22050, token, currentTrack().id).catch(error => {
        if (token === operation) { busy = null; message = String(error.message); render(); }
      });
      break;
    }
    case 'add-track': {
      const next = structuredClone(project);
      const track = createTrack(`Track ${project.tracks.length + 1}`);
      next.tracks.push(track);
      activeTrackId = track.id;
      selectedNoteId = null;
      commit(next, 'Track added. Record a melody or add notes.');
      break;
    }
    case 'delete-track': {
      if (!window.confirm(`Delete ${currentTrack().name} and its notes?`)) break;
      const next = structuredClone(project);
      next.tracks = next.tracks.filter(track => track.id !== activeTrackId);
      activeTrackId = next.tracks[0].id;
      selectedNoteId = null;
      commit(next, 'Track deleted.');
      break;
    }
    case 'add-note': {
      const end = Math.max(0, ...currentTrack().notes.map(note => note.start + note.duration));
      if (end + 1 > 128) { announce('This track has reached 128 beats. Move or shorten a note before adding more.'); break; }
      const note = createNote(60, end);
      selectedNoteId = note.id;
      editTrack(track => track.notes.push(note), 'Note added. Adjust its pitch and timing below.');
      break;
    }
    case 'delete-note': editTrack(track => { track.notes = track.notes.filter(note => note.id !== selectedNoteId); }, 'Note deleted.'); selectedNoteId = null; break;
    case 'save': download(serializeComposition(project), '.melody.json', 'application/json'); announce('Project file saved. Keep it as a portable backup.'); break;
    case 'midi': download(new Uint8Array(encodeMidi(project)), '.mid', 'audio/midi'); announce('MIDI exported. Instruments may sound different in another music app.'); break;
    case 'wav': void exportWav(); break;
    case 'example':
    case 'new': {
      if (project.tracks.some(track => track.notes.length) && !window.confirm('Replace this composition? Save a project file first to keep a backup.')) break;
      const next = action === 'example' ? createDemoComposition() : createComposition();
      activeTrackId = next.tracks[0].id;
      selectedNoteId = null;
      commit(next, action === 'example' ? 'Example loaded. Press Play, then try changing an instrument.' : 'A fresh start. Capture your next idea.');
      break;
    }
  }
});

app.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (projectFields.has(input.id) || trackFields.has(input.id) || input.closest('#note-form') || ['continuation-count', 'continuation-length'].includes(input.id)) newEditorIntent();
  if (projectFields.has(input.id) || trackFields.has(input.id)) {
    const raw = input.type === 'checkbox' ? input.checked : input.value;
    const track = currentTrack();
    const values: Record<string, string | boolean> = { 'project-title': project.title, tempo: String(project.tempo), 'track-name': track.name, instrument: track.instrument, volume: String(track.volume), muted: track.muted };
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
  if (busy) return;
  if (projectFields.has(input.id) || trackFields.has(input.id) || ['continuation-length', 'audio-file', 'project-file'].includes(input.id)) newEditorIntent();
  try { switch (input.id) {
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
      clearContinuation();
      stopPlayback(false);
      void processBlob(file, ++operation, currentTrack().id);
      break;
    }
    case 'project-file': {
      const file = input.files?.[0];
      input.value = '';
      if (!file) break;
      clearContinuation(); stopPlayback(false);
      const token = ++operation;
      busy = 'processing';
      render();
      void (async () => {
        try {
          if (file.size > 1024 * 1024) throw new Error('Project files must be at most 1 MiB.');
          const next = parseComposition(await file.text());
          if (token !== operation) return;
          if (project.tracks.some(track => track.notes.length) && !window.confirm('Open this project and replace the current composition?')) return;
          activeTrackId = next.tracks[0].id;
          selectedNoteId = null;
          busy = null;
          commit(next, 'Project opened.');
        } catch (error) { if (token === operation) message = `Could not open project: ${error instanceof Error ? error.message : 'Invalid file.'}`; }
        finally { if (token === operation) { busy = null; render(); } }
      })();
      break;
    }
  } } catch (error) { announce(error instanceof Error ? error.message : 'That edit is not valid. Your draft is kept.'); }
});

app.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || !selectedNoteId) return;
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

window.addEventListener('pagehide', () => { cancelMidi(); cancelCapture(); stopPlayback(false); void audioContext?.close(); audioContext = null; });
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || busy) return;
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
  const end = Math.min(128, Math.max(1, Math.ceil(source.lastTick / source.ppqn)));
  midiHost.querySelector<HTMLElement>('#midi-choices')!.innerHTML = `
    <p class="small">Format ${source.format} · ${source.ppqn} ticks per beat · ${source.rawTrackCount} raw tracks · ${source.eventCount} events · ${source.noteOnCount} source note attacks</p>
    <p class="small">Tempo: ${source.tempo} BPM (${source.tempoExplicit ? 'supplied constant tempo' : 'default 120 BPM'}). Beats are quarter-note positions, not bars.</p>
    <p class="small">${escape(describeMidiName(source.title, 'Imported MIDI'))}</p>
    ${source.title.status === 'needs-choice' && source.title.value !== null ? `<details><summary>Original source title text</summary><pre>${escape(source.title.value)}</pre></details>` : ''}
    <label for="midi-title">Imported project title<input id="midi-title" value="${escape(source.title.status === 'usable' ? source.title.value! : 'Imported MIDI')}" /></label>
    <div class="midi-window"><label for="midi-start">Source start beat<input id="midi-start" type="text" inputmode="numeric" value="1" /></label><label for="midi-end">Source end beat (exclusive)<input id="midi-end" type="text" inputmode="numeric" value="${end + 1}" /></label></div>
    <p class="small">Whole-beat boundaries only, at most 128 beats. Source end limit: ${Math.max(1, Math.ceil(source.lastTick / source.ppqn)) + 1}. The selected source start becomes destination beat 1. Crossing notes are rejected, never clipped.</p>
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
  if (!file || busy) return;
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
  if (busy || midiReading || !midiSource) return;
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
  const current = () => !busy && !midiReading && review !== null && review === midiReview && reviewedEpoch === midiEpoch
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
    if (!commit(next, 'MIDI phrase imported. Undo restores the previous committed composition.')) return;
    fieldDrafts.clear(); noteDrafts.clear(); clearContinuation(); activeTrackId = project.tracks[0].id; selectedNoteId = null; defaultSeedCount();
    cancelMidi(); midiStatus('MIDI phrase replaced the composition. Review limits still apply: local instrument approximations, omitted metadata and trailing silence, and 480-tick MIDI re-export rounding.');
    render(); app.querySelector<HTMLInputElement>('#project-title')?.focus();
  } catch (error) { midiStatus(error instanceof Error ? error.message : 'Could not apply this review. Your editor is unchanged.'); }
});

render();
