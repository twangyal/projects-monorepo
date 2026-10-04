import './style.css';
import { createComposition, createDemoComposition, createNote, createTrack, validateComposition, parseComposition, serializeComposition, compositionDurationBeats } from './model.ts';
import { createDemoMelody } from './audio.ts';
import { encodeMidi } from './midi.ts';
import { MelodyRecorder } from './recorder.ts';
import { loadProject, saveProject } from './storage.ts';
import { CompositionHistory } from './history.ts';
import { duplicateTrack, transposeTrack, repeatTrack } from './arrangement.ts';
import { selectEnding, suggestEnding, applyContinuation, auditionComposition, type ContinuationProposal, type SeedSelection } from './continuation.ts';
import type { Composition, Note, Track } from './types.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
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
    if (changed) { compositionGeneration++; clearContinuation(); }
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
  compositionGeneration++; clearContinuation();
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
      <section class="project-bar" aria-label="Project settings"><div class="project-title"><label for="project-title">Project title</label><input id="project-title" value="${escape(project.title)}" maxlength="80" ${disabled()} /></div><div class="tempo-field"><label for="tempo">Tempo (BPM)</label><input id="tempo" type="number" min="40" max="240" step="1" value="${project.tempo}" ${disabled()} /></div><div class="transport"><button class="primary" data-action="play" ${busy || !totalNotes || playing ? 'disabled' : ''} aria-label="Play composition"><span aria-hidden="true">▶</span> Play</button><button data-action="stop" ${!playing && !playbackJob ? 'disabled' : ''} aria-label="Stop playback">■ Stop</button></div><div class="history-controls"><button data-action="undo" title="Undo (Ctrl/Cmd+Z)" ${busy || !history.canUndo ? 'disabled' : ''}>Undo</button><button data-action="redo" title="Redo (Ctrl/Cmd+Shift+Z)" ${busy || !history.canRedo ? 'disabled' : ''}>Redo</button></div><span class="project-stats">${project.tracks.length} ${project.tracks.length === 1 ? 'track' : 'tracks'} · ${totalNotes} notes</span></section>
      <div id="notice" class="notice" role="status" aria-live="polite">${escape(message)}</div>
      <section class="capture-card" aria-labelledby="capture-heading"><div><p class="eyebrow">01 / CATCH AN IDEA</p><h2 id="capture-heading">Your next song starts with a hum.</h2><p>Sing one clear melody, then make it your own.<br />Record up to 20 seconds or bring in an audio file.</p></div><div class="capture-controls"><div class="button-row"><button class="record-button" data-action="record" ${disabled()}><span class="record-dot" aria-hidden="true"></span> Record melody</button><label class="file-button ${busy ? 'is-disabled' : ''}">Import audio<input id="audio-file" type="file" accept="audio/*" aria-label="Import audio file" ${disabled()} /></label></div><div class="button-row"><button class="quiet" data-action="demo" ${disabled()}>Try demo melody</button><span class="small">No microphone needed</span></div><div class="capture-progress" ${!busy ? 'hidden' : ''}><span id="capture-state">${busy === 'requesting' ? 'Waiting for microphone permission…' : busy === 'recording' ? 'Recording…' : busy === 'rendering' ? 'Rendering your composition…' : 'Finding the notes…'}</span><button data-action="finish-record" ${busy !== 'recording' ? 'hidden' : ''}>Finish recording</button><button data-action="cancel">Cancel</button></div></div></section>
      <section class="studio" aria-label="Composition editor"><aside class="tracks-panel"><div class="section-heading"><div><p class="eyebrow">02 / BUILD YOUR SOUND</p><h2>Tracks</h2></div><button class="icon-button" data-action="add-track" aria-label="Add track" ${busy || project.tracks.length >= 8 ? 'disabled' : ''}>+</button></div><div class="track-list">${project.tracks.map((item, index) => `<button class="track-card ${item.id === track.id ? 'is-selected' : ''}" data-track="${escape(item.id)}" aria-label="Select track: ${escape(item.name)}" aria-pressed="${item.id === track.id}" ${disabled()}><span class="track-icon" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span><strong>${escape(item.name)}</strong><small>${item.notes.length} notes · ${item.muted ? 'muted' : item.instrument === 'sine' ? 'Soft keys' : item.instrument === 'triangle' ? 'Warm flute' : 'Bright synth'}</small></span></button>`).join('')}</div><div class="track-settings"><label for="track-name">Track name</label><input id="track-name" value="${escape(track.name)}" maxlength="80" ${disabled()} /><label for="instrument">Instrument</label><select id="instrument" ${disabled()}><option value="sine" ${track.instrument === 'sine' ? 'selected' : ''}>Soft keys</option><option value="triangle" ${track.instrument === 'triangle' ? 'selected' : ''}>Warm flute</option><option value="sawtooth" ${track.instrument === 'sawtooth' ? 'selected' : ''}>Bright synth</option></select><label for="volume">Track volume <span>${Math.round(track.volume * 100)}%</span></label><input id="volume" type="range" min="0" max="1" step="0.05" value="${track.volume}" ${disabled()} /><label class="checkbox-label"><input id="muted" type="checkbox" ${track.muted ? 'checked' : ''} ${disabled()} /> Mute track</label><button class="quiet danger" data-action="delete-track" ${busy || project.tracks.length <= 1 ? 'disabled' : ''}>Delete track</button></div><div class="arrangement-tools"><p class="eyebrow">ARRANGE THIS TRACK</p><button data-action="duplicate-track" ${busy || project.tracks.length >= 8 ? 'disabled' : ''}>Duplicate track</button><div class="transpose-controls" role="group" aria-label="Transpose track"><button data-action="transpose:-12" aria-label="Transpose down an octave" ${busy || !track.notes.length ? 'disabled' : ''}>−12</button><button data-action="transpose:-1" aria-label="Transpose down a semitone" ${busy || !track.notes.length ? 'disabled' : ''}>−1</button><button data-action="transpose:1" aria-label="Transpose up a semitone" ${busy || !track.notes.length ? 'disabled' : ''}>+1</button><button data-action="transpose:12" aria-label="Transpose up an octave" ${busy || !track.notes.length ? 'disabled' : ''}>+12</button></div><button data-action="repeat-phrase" ${busy || !track.notes.length ? 'disabled' : ''}>Repeat phrase</button><p class="small">Shift pitch by semitones. Notes stay within C2–C7 and 128 beats.</p></div></aside>
      <div class="editor-panel"><div class="editor-heading"><div><h2>${escape(track.name)}</h2><p class="small">Select a note to edit its pitch and timing.</p></div><button data-action="add-note" ${busy || track.notes.length >= 256 ? 'disabled' : ''}><span aria-hidden="true">+</span> Add note</button></div><div class="piano-roll" aria-label="Piano roll"><div class="roll-inner" style="--beats:${beats};--rows:${rows};min-width:${Math.max(640, beats * 36)}px"><div class="beat-ruler">${Array.from({ length: beats }, (_, i) => `<span>${i + 1}</span>`).join('')}</div><div class="pitch-labels">${Array.from({ length: rows }, (_, i) => `<span>${noteName(top - i)}</span>`).join('')}</div><div class="roll-grid" style="height:${rows * 22}px">${track.notes.map(item => `<button class="note-event ${item.id === selectedNoteId ? 'is-selected' : ''} ${seedIds.has(item.id) ? 'is-seed' : ''}" data-note="${escape(item.id)}" aria-label="${noteName(item.pitch)}, beat ${item.start + 1}, duration ${item.duration}" aria-pressed="${item.id === selectedNoteId}" style="left:${item.start / beats * 100}%;width:${item.duration / beats * 100}%;top:${(top - item.pitch) * 22 + 2}px" ${disabled()}><span>${noteName(item.pitch)}</span></button>`).join('')}${proposedNotes.map((item, index) => `<span class="note-event proposal-note" data-proposal-index="${index}" role="img" aria-label="Suggested ${noteName(item.pitch)}, beat ${item.start + 1}, duration ${item.duration}; not saved" style="left:${item.start / beats * 100}%;width:${item.duration / beats * 100}%;top:${(top - item.pitch) * 22 + 2}px">${noteName(item.pitch)}</span>`).join('')}${!track.notes.length ? '<div class="empty-roll"><span aria-hidden="true">♫</span><strong>A little space for a big idea.</strong><p>Record, import, or add your first note.</p></div>' : ''}</div></div></div>
      <form id="note-form" class="note-editor"><div class="note-editor-title"><strong>${note ? `Edit ${noteName(note.pitch)}` : 'Note details'}</strong><span class="small">${note ? 'Timing is measured in beats.' : 'Choose a note in the piano roll.'}</span></div><fieldset ${!note || busy ? 'disabled' : ''}><legend class="sr-only">Selected note</legend><label>Pitch (MIDI)<input name="pitch" type="number" min="36" max="96" step="1" value="${escape(draft?.pitch ?? '60')}" /></label><label>Start beat<input name="start" type="number" min="1" max="128.75" step="any" value="${escape(draft?.start ?? '1')}" /></label><label>Duration (beats)<input name="duration" type="number" min="0.25" max="16" step="any" value="${escape(draft?.duration ?? '1')}" /></label><label>Velocity<input name="velocity" type="number" min="0" max="1" step="any" value="${escape(draft?.velocity ?? '0.8')}" /></label><button type="submit">Apply note</button><button type="button" class="quiet" data-action="discard-note-edits">Discard note edits</button><button type="button" class="quiet danger" data-action="delete-note">Delete note</button></fieldset></form>${continuationPanel(selection, seedError)}</div></section>
      <section class="save-panel" aria-labelledby="save-heading"><div><p class="eyebrow">03 / KEEP IT GOING</p><h2 id="save-heading">Take your idea with you.</h2><p id="save-status" class="small" aria-live="polite">${escape(saveMessage)}</p></div><div class="export-actions"><button data-action="save" ${disabled()}>Save project file</button><label class="file-button ${busy ? 'is-disabled' : ''}">Open project<input id="project-file" type="file" accept=".json,application/json" aria-label="Open project file" ${disabled()} /></label><button data-action="midi" ${busy || !totalNotes ? 'disabled' : ''}>Export MIDI</button><button data-action="wav" ${busy || !totalNotes ? 'disabled' : ''}>Export WAV</button></div></section>
      <footer><div class="button-row"><button class="quiet" data-action="example" ${disabled()}>Load example</button><button class="quiet" data-action="new" ${disabled()}>New project</button></div><p>A music sketchbook, built for first ideas. Single-voice pitch detection, editable by you.<br />Audio is processed locally and discarded after transcription. Export a project backup before clearing browser data.</p></footer>
    </main>`;
  if (focusSelector) app.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
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
  if (button.dataset.track && !busy) { clearContinuation(); activeTrackId = button.dataset.track; selectedNoteId = null; defaultSeedCount(); render(); return; }
  if (button.dataset.note && !busy) { selectedNoteId = button.dataset.note; render(); document.querySelector<HTMLInputElement>('[name=pitch]')?.focus(); return; }
  const action = button.dataset.action;
  if (busy && action !== 'cancel' && action !== 'finish-record' && action !== 'stop' && !(action === 'discard-continuation' && auditionOwner)) return;
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
});

app.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (busy) return;
  switch (input.id) {
    case 'continuation-length': continuationLength = input.value === '8' ? 8 : 4; clearContinuation(); render(); break;
    case 'project-title': if (commit({ ...project, title: input.value }, undefined, false)) input.value = project.title; break;
    case 'tempo': commit({ ...project, tempo: Number(input.value) }, undefined, false); break;
    case 'track-name': if (editTrack(track => { track.name = input.value; }, undefined, false)) input.value = currentTrack().name; break;
    case 'instrument': editTrack(track => { track.instrument = input.value as Track['instrument']; }, undefined, false); break;
    case 'volume': editTrack(track => { track.volume = Number(input.value); }, undefined, false); break;
    case 'muted': editTrack(track => { track.muted = input.checked; }, undefined, false); break;
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
  }
});

app.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || !selectedNoteId) return;
  const data = new FormData(event.target as HTMLFormElement);
  const editedId = selectedNoteId;
  const saved = editTrack(track => {
    const note = track.notes.find(item => item.id === editedId);
    if (note) Object.assign(note, { pitch: Number(data.get('pitch')), start: Number(data.get('start')) - 1, duration: Number(data.get('duration')), velocity: Number(data.get('velocity')) });
  }, 'Note updated.', false);
  if (saved) { noteDrafts.delete(editedId); render(); }
});

window.addEventListener('pagehide', () => { cancelCapture(); stopPlayback(false); void audioContext?.close(); audioContext = null; });
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
render();
