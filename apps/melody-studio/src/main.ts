import './style.css';
import { createComposition, createDemoComposition, createNote, createTrack, validateComposition, parseComposition, serializeComposition, compositionDurationBeats } from './model.ts';
import { createDemoMelody } from './audio.ts';
import { encodeMidi } from './midi.ts';
import { MelodyRecorder } from './recorder.ts';
import { loadProject, saveProject } from './storage.ts';
import { CompositionHistory } from './history.ts';
import { duplicateTrack, transposeTrack, repeatTrack } from './arrangement.ts';
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
    history.commit(validated);
    stopPlayback(false);
    project = validated;
    saveMessage = saveProject(storage, project) ?? 'Saved in this browser';
    if (text) message = text;
    if (redraw) render();
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
  stopPlayback(false);
  project = next;
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
  const totalNotes = project.tracks.reduce((count, item) => count + item.notes.length, 0);
  const beats = Math.max(8, Math.ceil(compositionDurationBeats(project) / 4) * 4);
  const pitches = track.notes.map(item => item.pitch);
  const bottom = Math.min(60, ...pitches) - 2;
  const top = Math.max(72, ...pitches) + 2;
  const rows = top - bottom + 1;
  app.innerHTML = `
    <header class="site-header"><div class="brand"><span class="brand-mark" aria-hidden="true">m<span>♪</span></span><div><p class="eyebrow">FROM A HUM TO SOMETHING MORE</p><h1>Melody Studio</h1></div></div><span class="privacy-badge"><span aria-hidden="true">●</span> Made here. Stays here.</span></header>
    <main id="workspace">
      <section class="project-bar" aria-label="Project settings"><div class="project-title"><label for="project-title">Project title</label><input id="project-title" value="${escape(project.title)}" maxlength="80" ${disabled()} /></div><div class="tempo-field"><label for="tempo">Tempo (BPM)</label><input id="tempo" type="number" min="40" max="240" step="1" value="${project.tempo}" ${disabled()} /></div><div class="transport"><button class="primary" data-action="play" ${busy || !totalNotes || playing ? 'disabled' : ''} aria-label="Play composition"><span aria-hidden="true">▶</span> Play</button><button data-action="stop" ${!playing ? 'disabled' : ''} aria-label="Stop playback">■ Stop</button></div><div class="history-controls"><button data-action="undo" title="Undo (Ctrl/Cmd+Z)" ${busy || !history.canUndo ? 'disabled' : ''}>Undo</button><button data-action="redo" title="Redo (Ctrl/Cmd+Shift+Z)" ${busy || !history.canRedo ? 'disabled' : ''}>Redo</button></div><span class="project-stats">${project.tracks.length} ${project.tracks.length === 1 ? 'track' : 'tracks'} · ${totalNotes} notes</span></section>
      <div id="notice" class="notice" role="status" aria-live="polite">${escape(message)}</div>
      <section class="capture-card" aria-labelledby="capture-heading"><div><p class="eyebrow">01 / CATCH AN IDEA</p><h2 id="capture-heading">Your next song starts with a hum.</h2><p>Sing one clear melody, then make it your own.<br />Record up to 20 seconds or bring in an audio file.</p></div><div class="capture-controls"><div class="button-row"><button class="record-button" data-action="record" ${disabled()}><span class="record-dot" aria-hidden="true"></span> Record melody</button><label class="file-button ${busy ? 'is-disabled' : ''}">Import audio<input id="audio-file" type="file" accept="audio/*" aria-label="Import audio file" ${disabled()} /></label></div><div class="button-row"><button class="quiet" data-action="demo" ${disabled()}>Try demo melody</button><span class="small">No microphone needed</span></div><div class="capture-progress" ${!busy ? 'hidden' : ''}><span id="capture-state">${busy === 'requesting' ? 'Waiting for microphone permission…' : busy === 'recording' ? 'Recording…' : busy === 'rendering' ? 'Rendering your composition…' : 'Finding the notes…'}</span><button data-action="finish-record" ${busy !== 'recording' ? 'hidden' : ''}>Finish recording</button><button data-action="cancel">Cancel</button></div></div></section>
      <section class="studio" aria-label="Composition editor"><aside class="tracks-panel"><div class="section-heading"><div><p class="eyebrow">02 / BUILD YOUR SOUND</p><h2>Tracks</h2></div><button class="icon-button" data-action="add-track" aria-label="Add track" ${busy || project.tracks.length >= 8 ? 'disabled' : ''}>+</button></div><div class="track-list">${project.tracks.map((item, index) => `<button class="track-card ${item.id === track.id ? 'is-selected' : ''}" data-track="${escape(item.id)}" aria-label="Select track: ${escape(item.name)}" aria-pressed="${item.id === track.id}" ${disabled()}><span class="track-icon" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span><strong>${escape(item.name)}</strong><small>${item.notes.length} notes · ${item.muted ? 'muted' : item.instrument === 'sine' ? 'Soft keys' : item.instrument === 'triangle' ? 'Warm flute' : 'Bright synth'}</small></span></button>`).join('')}</div><div class="track-settings"><label for="track-name">Track name</label><input id="track-name" value="${escape(track.name)}" maxlength="80" ${disabled()} /><label for="instrument">Instrument</label><select id="instrument" ${disabled()}><option value="sine" ${track.instrument === 'sine' ? 'selected' : ''}>Soft keys</option><option value="triangle" ${track.instrument === 'triangle' ? 'selected' : ''}>Warm flute</option><option value="sawtooth" ${track.instrument === 'sawtooth' ? 'selected' : ''}>Bright synth</option></select><label for="volume">Track volume <span>${Math.round(track.volume * 100)}%</span></label><input id="volume" type="range" min="0" max="1" step="0.05" value="${track.volume}" ${disabled()} /><label class="checkbox-label"><input id="muted" type="checkbox" ${track.muted ? 'checked' : ''} ${disabled()} /> Mute track</label><button class="quiet danger" data-action="delete-track" ${busy || project.tracks.length <= 1 ? 'disabled' : ''}>Delete track</button></div><div class="arrangement-tools"><p class="eyebrow">ARRANGE THIS TRACK</p><button data-action="duplicate-track" ${busy || project.tracks.length >= 8 ? 'disabled' : ''}>Duplicate track</button><div class="transpose-controls" role="group" aria-label="Transpose track"><button data-action="transpose:-12" aria-label="Transpose down an octave" ${busy || !track.notes.length ? 'disabled' : ''}>−12</button><button data-action="transpose:-1" aria-label="Transpose down a semitone" ${busy || !track.notes.length ? 'disabled' : ''}>−1</button><button data-action="transpose:1" aria-label="Transpose up a semitone" ${busy || !track.notes.length ? 'disabled' : ''}>+1</button><button data-action="transpose:12" aria-label="Transpose up an octave" ${busy || !track.notes.length ? 'disabled' : ''}>+12</button></div><button data-action="repeat-phrase" ${busy || !track.notes.length ? 'disabled' : ''}>Repeat phrase</button><p class="small">Shift pitch by semitones. Notes stay within C2–C7 and 128 beats.</p></div></aside>
      <div class="editor-panel"><div class="editor-heading"><div><h2>${escape(track.name)}</h2><p class="small">Select a note to edit its pitch and timing.</p></div><button data-action="add-note" ${busy || track.notes.length >= 256 ? 'disabled' : ''}><span aria-hidden="true">+</span> Add note</button></div><div class="piano-roll" aria-label="Piano roll"><div class="roll-inner" style="--beats:${beats};--rows:${rows};min-width:${Math.max(640, beats * 36)}px"><div class="beat-ruler">${Array.from({ length: beats }, (_, i) => `<span>${i + 1}</span>`).join('')}</div><div class="pitch-labels">${Array.from({ length: rows }, (_, i) => `<span>${noteName(top - i)}</span>`).join('')}</div><div class="roll-grid" style="height:${rows * 22}px">${track.notes.map(item => `<button class="note-event ${item.id === selectedNoteId ? 'is-selected' : ''}" data-note="${escape(item.id)}" aria-label="${noteName(item.pitch)}, beat ${item.start + 1}, duration ${item.duration}" aria-pressed="${item.id === selectedNoteId}" style="left:${item.start / beats * 100}%;width:${item.duration / beats * 100}%;top:${(top - item.pitch) * 22 + 2}px" ${disabled()}><span>${noteName(item.pitch)}</span></button>`).join('')}${!track.notes.length ? '<div class="empty-roll"><span aria-hidden="true">♫</span><strong>A little space for a big idea.</strong><p>Record, import, or add your first note.</p></div>' : ''}</div></div></div>
      <form id="note-form" class="note-editor"><div class="note-editor-title"><strong>${note ? `Edit ${noteName(note.pitch)}` : 'Note details'}</strong><span class="small">${note ? 'Timing is measured in beats.' : 'Choose a note in the piano roll.'}</span></div><fieldset ${!note || busy ? 'disabled' : ''}><legend class="sr-only">Selected note</legend><label>Pitch (MIDI)<input name="pitch" type="number" min="36" max="96" step="1" value="${note?.pitch ?? 60}" /></label><label>Start beat<input name="start" type="number" min="1" max="128.75" step="any" value="${(note?.start ?? 0) + 1}" /></label><label>Duration (beats)<input name="duration" type="number" min="0.25" max="16" step="any" value="${note?.duration ?? 1}" /></label><label>Velocity<input name="velocity" type="number" min="0" max="1" step="any" value="${note?.velocity ?? 0.8}" /></label><button type="submit">Apply note</button><button type="button" class="quiet danger" data-action="delete-note">Delete note</button></fieldset></form></div></section>
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
  operation++;
  recorder.cancel();
  clearRecordingTimer();
  worker?.terminate();
  worker = null;
  rejectWorker?.(new Error('Cancelled'));
  rejectWorker = null;
  busy = null;
  message = 'Capture cancelled. Your notes are unchanged.';
  render();
}

function runWorker<Result>(kind: 'transcribe' | 'render', payload: unknown, transfer: Transferable[] = []): Promise<Result> {
  return new Promise((resolve, reject) => {
    const pending = kind === 'render'
      ? new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    worker = pending;
    const timeout = setTimeout(() => finish(new Error('Processing took too long. Try fewer notes or a shorter melody.')), 30000);
    function finish(error?: Error, result?: Result) {
      clearTimeout(timeout);
      pending.terminate();
      if (worker === pending) worker = null;
      rejectWorker = null;
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
  if (stopButton) stopButton.disabled = !playing;
}

async function play() {
  stopPlayback(false);
  const generation = playbackGeneration;
  const token = ++operation;
  busy = 'rendering';
  message = 'Rendering your composition…';
  render();
  try {
    audioContext ??= new AudioContext();
    await audioContext.resume();
    if (generation !== playbackGeneration || token !== operation) return;
    const samples = await runWorker<Float32Array>('render', { project, wav: false });
    if (generation !== playbackGeneration || token !== operation) return;
    const buffer = audioContext.createBuffer(1, samples.length, 22050);
    buffer.copyToChannel(new Float32Array(samples), 0);
    source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => { source?.disconnect(); source = null; playing = false; syncTransport(); };
    source.start();
    playing = true;
    busy = null;
    message = 'Playing your composition.';
    render();
  } catch (error) {
    if (token === operation) { busy = null; message = `Playback unavailable: ${error instanceof Error ? error.message : 'Try again.'}`; render(); }
  }
}

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
  if (button.dataset.track && !busy) { activeTrackId = button.dataset.track; selectedNoteId = null; render(); return; }
  if (button.dataset.note && !busy) { selectedNoteId = button.dataset.note; render(); document.querySelector<HTMLInputElement>('[name=pitch]')?.focus(); return; }
  const action = button.dataset.action;
  if (busy && action !== 'cancel' && action !== 'finish-record' && action !== 'stop') return;
  switch (action) {
    case 'undo': restoreHistory('undo'); break;
    case 'redo': restoreHistory('redo'); break;
    case 'duplicate-track':
    case 'repeat-phrase':
    case 'transpose:-12':
    case 'transpose:-1':
    case 'transpose:1':
    case 'transpose:12': arrange(action); break;
    case 'play': void play(); break;
    case 'stop': stopPlayback(); break;
    case 'record': void startRecording(); break;
    case 'finish-record': void finishRecording(); break;
    case 'cancel': cancelCapture(); break;
    case 'demo': {
      if (!confirmReplace()) break;
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

app.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (busy) return;
  switch (input.id) {
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
      stopPlayback(false);
      void processBlob(file, ++operation, currentTrack().id);
      break;
    }
    case 'project-file': {
      const file = input.files?.[0];
      input.value = '';
      if (!file) break;
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
  editTrack(track => {
    const note = track.notes.find(item => item.id === selectedNoteId);
    if (note) Object.assign(note, { pitch: Number(data.get('pitch')), start: Number(data.get('start')) - 1, duration: Number(data.get('duration')), velocity: Number(data.get('velocity')) });
  }, 'Note updated.');
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
