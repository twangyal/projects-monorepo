import {readReply,validateProject,validateSaveReply,UnconfirmedReplyError} from './project-admission.ts';
import './style.css';
import { activeCue, draftCues, formatTime, validateCues, validateTitle, MAX_UPLOAD_BYTES, type Project } from './lyrics.ts';
import { LyricHistory, type LyricDraft, type RawTiming } from './draft-history.ts';
import { MAX_SRT_BYTES, parseSrt } from './srt.ts';
import { TimingCapture } from './sequential-timing.ts';
import { mountTimeline } from './timeline.ts';
import { proposeBoundary, timingError } from './timing.ts';
import { splitCue, mergeCue } from './cue-edit.ts';
import { createPracticeRange, type PracticeMode } from './practice.ts';
import { PracticeController } from './practice-controller.ts';

interface Job { id: string; projectId: string; kind: 'separate' | 'export' | 'archive-export' | 'archive-import'; status: 'running' | 'complete' | 'failed' | 'cancelled'; stage: string; error?: string; resultUrl?: string }
interface Session { token: string; modelReady: boolean; maxDuration: number; maxUploadBytes: number; maxCues: number; maxLyricChars: number; maxProjects: number; maxArchiveBytes: number; activeJob?: Job | null }
interface ArchiveInfo { imported: boolean; processingSupplied: boolean; origin: 'local-library' | 'imported-declared'; sourceProjectId: string | null; sourceRevision: number | null; archiveSha256: string | null }
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <a class="skip" href="#workspace">Skip to workspace</a>
  <header><div class="brand"><span aria-hidden="true">♫</span><div><h1>Karaoke Studio</h1><p>Your chorus. Your stage.</p></div></div><div class="session"><span class="dot"></span><span id="model-state">Connecting to local studio…</span><button id="refresh" class="quiet">Refresh projects</button></div></header>
  <main id="workspace"><div class="intro"><div><p class="eyebrow">FROM SONG TO SING-ALONG</p><h2>Give your favorite song the spotlight.</h2><p>Separate the backing, cue your words, and take the stage.</p></div><span class="privacy">LOCAL PROCESSING<br><small>No account. No song uploads to a service.</small></span></div>
    <div id="message" role="status" aria-live="polite" hidden></div>
    <div id="job-panel" role="status" hidden><div class="job-copy"><span class="spinner" aria-hidden="true"></span><div><strong id="job-title"></strong><p id="job-stage"></p></div></div><button id="cancel-job">Cancel job</button></div>
    <div class="workspace-grid">
      <aside class="song-panel panel"><div class="panel-title"><span class="step">01</span><h3>Your song clip</h3></div>
        <label class="upload-zone"><span class="upload-icon" aria-hidden="true">↑</span><strong>Choose an audio clip</strong><span>WAV, MP3, FLAC or Ogg<br><span id="upload-limits">1–300 seconds · up to 64 MiB</span></span><input id="audio-file" type="file" accept=".wav,.mp3,.flac,.ogg,audio/wav,audio/mpeg,audio/flac,audio/ogg" aria-label="Upload song clip" disabled></label>
        <p id="model-help" class="model-help" hidden>Install the local separation model first. From the app directory, run <code>python scripts/setup_model.py --help</code> and follow the README setup steps, then refresh.</p>
        <p class="fine">The model estimates vocals and backing locally. Listen for remaining vocals or altered instruments before exporting.</p>
        <div class="divider"></div><label class="field">Saved clips<select id="projects"><option value="">Choose a saved clip</option></select></label><p id="library-count" class="fine">Projects are saved in your local studio folder.</p>
        <div id="clip-details" hidden><label class="field">Clip title<input id="title" type="text"></label><div class="clip-meta"><span id="duration">0:00</span><span>44.1 kHz · stereo</span></div><button id="backing-download" class="full">Download backing WAV <span aria-hidden="true">↓</span></button></div>
        <section class="archive-panel" aria-labelledby="archive-heading"><h4 id="archive-heading">Take your saved clip with you</h4>
        <p id="archive-status" class="fine" role="status">Choose a saved clip to back it up. Unsaved lyric edits are not included.</p>
        <div class="archive-actions"><button id="archive-backup" class="quiet" disabled>Back up saved clip</button><a id="archive-download" class="archive-download" download hidden>Download saved archive</a></div>
        <label class="field archive-import">Import project archive<input id="archive-file" type="file" accept=".karaoke.zip,.zip,application/zip" disabled></label>
        <p class="fine">A .karaoke.zip restores saved lyrics and all three audio tracks as a new clip. No model setup is needed. Archives contain private, unencrypted audio and lyrics.</p>
        <button id="archive-upload-cancel" class="text-button" hidden>Cancel archive upload</button>
        <button id="archive-recheck" class="text-button">Check restore status</button>
        <p id="archive-result" class="fine" role="status" hidden></p><button id="open-imported" class="quiet" hidden>Open imported clip</button></section>
        <button id="delete-project" class="text-button full" disabled>Delete selected clip</button><div class="local-note"><strong>Room for the complete song.</strong><p>Import complete songs up to 5 minutes. Local CPU separation and video export can take several minutes; cancellation remains available while processing.</p></div>
      </aside>
      <section class="stage-panel panel" aria-labelledby="stage-heading"><div class="panel-title"><span class="step">02</span><h3 id="stage-heading">Listen & preview</h3><span class="small-tag">LIVE LYRIC PREVIEW</span></div>
        <div class="stage-wrap"><canvas id="stage" width="1280" height="720" role="img" aria-label="Karaoke lyric preview"></canvas><p id="current-line" class="sr-only" aria-live="polite">Instrumental break</p></div>
        <div class="transport"><div class="track-picker" aria-label="Audition track"><button data-track="original" aria-pressed="false">Original</button><button data-track="vocals" aria-pressed="false">Vocals</button><button data-track="backing" aria-pressed="true">Backing</button></div><span id="clock">0:00.00 / 0:00.00</span></div>
        <audio id="audio" controls preload="metadata" aria-label="Clip playback"></audio><p class="fine playback-tip">Play the backing and use “Mark start” or “Mark end” to place a line at the current playback time.</p>
        <section class="practice-panel" aria-labelledby="practice-heading"><h4 id="practice-heading">Practice a lyric range</h4><p class="fine">Listen to the current Original, Vocals or Backing track at normal 1× speed. Existing lyric cues define the range; instrumental gaps stay included. Unsaved valid cues can be practiced. Unapplied pasted words are kept and are not included.</p><div class="practice-selection"><label class="field">First line<select id="practice-first" disabled></select></label><label class="field">Last line<select id="practice-last" disabled></select></label></div><p id="practice-range-summary" class="fine">Choose a clip with valid lyric cues.</p><div class="practice-actions"><button id="practice-once" disabled>Play once</button><button id="practice-repeat" disabled>Repeat range</button><button id="practice-pause" class="quiet" disabled>Pause practice</button><button id="practice-stop" class="quiet" disabled>Stop practice</button></div><p id="practice-status" class="fine" role="status" aria-live="polite">Choose a lyric range, then Play once or Repeat range. Nothing is saved.</p></section>
        <div class="export-row"><div><strong>Ready for a sing-along?</strong><p id="save-state">Choose a clip to begin.</p></div><button id="save" class="quiet" disabled>Save lyrics</button><button id="export-video" class="primary" disabled>Export karaoke MP4</button></div>
        <div class="secondary-exports"><button id="lyrics-download" class="text-button" disabled>Export timed lyrics</button><button id="video-download" class="text-button" hidden>Download MP4 again</button><span>1280 × 720 · 24 fps · estimated backing</span></div>
      </section>
      <section class="lyrics-panel panel" aria-labelledby="lyrics-heading"><div class="panel-title"><span class="step">03</span><h3 id="lyrics-heading">Make room for the words</h3><span class="small-tag">YOUR LYRICS, YOUR TIMING</span></div>
        <section id="timing-workbench" aria-label="Waveform timing workbench"></section>
        <section class="sequential-timing" aria-labelledby="timing-heading"><h4 id="timing-heading">Time lines while listening</h4><p class="fine">Time the existing lyric lines with this player. Unapplied pasted words are not included. Begin, play or resume the audio, then mark each line’s start and end. Leave instrumental gaps by waiting before the next start.</p><div class="timing-actions"><button id="timing-begin">Begin timing session</button><button id="timing-mark" hidden>Mark line start</button><button id="timing-end-final" hidden>End final line at clip end</button><button id="timing-cancel" class="text-button" hidden>Cancel timing session</button></div><p id="timing-status" class="fine" aria-live="polite">Choose a clip with lyric lines, load a track, then begin.</p><p id="timing-line"></p><section id="timing-review" aria-label="Review captured timings" hidden><h4>Review captured timings</h4><p id="timing-summary"></p><ol id="timing-review-list" aria-label="Captured lyric intervals"></ol><button id="timing-apply" class="quiet">Apply captured timings</button></section></section>
        <section class="srt-import" aria-label="Import timed lyrics"><label class="field">Import timed lyrics (SRT)<input id="srt-file" type="file" accept=".srt,application/x-subrip,text/plain" disabled></label><p class="fine">Up to 128 KiB UTF-8. Numbered SRT cues with millisecond times; multiline words are kept. Use plain text or &amp;lt; / &amp;gt; for angle brackets. Only &amp;amp;, &amp;lt; and &amp;gt; are decoded once.</p><p id="srt-status" class="fine" aria-live="polite"></p><section id="srt-review" aria-label="Review timed lyrics" hidden><h4>Review timed lyrics</h4><p id="srt-summary"></p><p class="fine">Replace only this clip’s lyric cues in memory. The title and pasted words stay unchanged. Undo restores your previous cues; use Save lyrics when ready.</p><ol id="srt-review-list" aria-label="Imported lyric cues"></ol><button id="srt-apply" class="quiet">Replace lyric cues</button></section><button id="srt-cancel" class="text-button" hidden>Cancel lyric import</button></section>
        <div class="lyric-intro"><label class="field">Paste lyrics, one line per cue<textarea id="lyric-draft" rows="4" placeholder="The opening line…&#10;And the next one…" disabled></textarea></label><div><button id="draft-timings" disabled>Create draft timings</button><button id="discard-draft" class="text-button" hidden>Discard pasted draft</button><p class="fine">Even spacing is a starting point. Listen and correct each line; lyrics are not recognized or aligned automatically.</p><p id="lyric-limits" class="fine">Up to 200 cues · 240 characters per cue · 20,000 lyric characters. Unicode characters count once; pasted whitespace also counts.</p></div></div>
        <div class="draft-history" role="group" aria-label="Lyric draft history"><button id="undo-lyrics" class="quiet" disabled>Undo lyric edit</button><button id="redo-lyrics" class="quiet" disabled>Redo lyric edit</button><span class="fine">Up to 30 edits until you save or open another clip.</span></div>
        <p id="cue-validation" role="status" class="validation"></p><div id="cue-list"><p class="empty">Your lyric lines will appear here after you create draft timings.</p></div>
      </section>
    </div><footer><span>Built for your next kitchen concert.</span><span>AI estimates stems. You supply and synchronize the lyrics.</span></footer>
  </main>`;

function element<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const audio = element<HTMLAudioElement>('audio');
const stage = element<HTMLCanvasElement>('stage');
const context = stage.getContext('2d')!;
let session: Session | null = null;
let projects: Project[] = [];
let working: Project | null = null;
let lyricHistory: LyricHistory | null = null;
let dirty = false;
let draftDirty = false;
let saving = false;
let loading = false;
let requestingJob = false;
let followJobProject = true;
let currentJob: Job | null = null;
let currentTrack = 'backing';
let videoUrl: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let animation = 0;
let projectGeneration = 0;
let loadedProjectGeneration = 0;
let editGeneration = 0;
let srtEpoch = 0;
interface SrtOwner { epoch: number; projectId: string; project: number; edit: number; deadline: number }
let srtOwner: SrtOwner | null = null;
let srtReview: { owner: SrtOwner; cues: Project['cues'] } | null = null;
let srtTimer: ReturnType<typeof setTimeout> | undefined;
let mediaGeneration = 0;
let archiveInfo: ArchiveInfo | null = null;
let archiveInfoState: 'none' | 'loading' | 'ready' | 'error' = 'none';
let archiveInfoEpoch = 0;
let archiveChecking = false;
let archiveOperation = 0;
let archiveUpload: AbortController | null = null;
let restoreUncertain = false;
let importedResult: { id: string; title: string } | null = null;
let completedImportId: string | null = null;
const archiveCaches = new Map<string, number>();
let pollEpoch = 0;
let pollInFlight: string | null = null;
let ownedJob = false;
let archiveJobRevision: number | null = null;
let practiceEpoch = 0;
let practiceProject = -1;
let practiceCount = -1;
const practice = new PracticeController(audio, () => practiceControls());
interface ArchiveFocus {
  node: HTMLInputElement | HTMLTextAreaElement;
  projectId: string;
  generation: number;
  start: number | null;
  end: number | null;
  direction: 'forward' | 'backward' | 'none' | null;
}
let archiveFocus: ArchiveFocus | null = null;
function rememberArchiveFocus() {
  const node = document.activeElement;
  if (!working || !(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
      || !(node.id === 'title' || node.id === 'lyric-draft' || element('cue-list').contains(node))) return;
  archiveFocus = { node, projectId: working.id, generation: loadedProjectGeneration,
    start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection };
}
function restoreArchiveFocus() {
  if (!archiveFocus || currentJob || requestingJob || loading || saving || archiveChecking) return;
  const saved = archiveFocus; archiveFocus = null;
  if (working?.id !== saved.projectId || loadedProjectGeneration !== saved.generation
      || !saved.node.isConnected || saved.node.disabled
      || (document.activeElement !== document.body && document.activeElement !== saved.node)) return;
  saved.node.focus({ preventScroll: true });
  if (saved.start !== null && saved.end !== null) saved.node.setSelectionRange(saved.start, saved.end, saved.direction ?? 'none');
}
// Disabling an editor can move focus to body. Restore only that involuntary
// loss; a user's later focus or pointer choice always wins.
document.addEventListener('focusin', event => {
  if (archiveFocus && event.target !== archiveFocus.node && event.target !== document.body) archiveFocus = null;
});
document.addEventListener('pointerdown', event => {
  if (archiveFocus && event.target !== archiveFocus.node) archiveFocus = null;
});
window.addEventListener('blur', () => { archiveFocus = null; });
const timeline = mountTimeline(element('timing-workbench'), {
  onSeek(time) { retirePractice('Seeking stopped practice. The selected range is kept.'); retireTiming('Seeking cancelled the timing session. Staged times were not applied.'); if (working) { audio.currentTime = time; draw(); } },
  onSelectCue(index) {
    for (const row of element('cue-list').querySelectorAll<HTMLElement>('[data-cue]')) row.classList.toggle('timing-selected', Number(row.dataset.cue) === index);
  },
  onGestureStart() {
    retirePractice('A timing gesture stopped practice.');
    if (!working || currentJob || loading || requestingJob || saving || archiveChecking || timingError(working.cues, working.duration)) return false;
    retireSrt('A timing gesture cancelled the lyric import review.');
    retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
    lyricHistory?.endGroup(); return true;
  },
  onCommitBoundary(change) {
    if (!working || currentJob || loading || requestingJob || saving || archiveChecking || change.projectId !== working.id || change.projectGeneration !== loadedProjectGeneration || change.editGeneration !== editGeneration) return false;
    const cue = working.cues[change.cueIndex];
    if (!cue || !Object.is(cue[change.boundary], change.before)) return false;
    proposeBoundary(working.cues, working.duration, change.cueIndex, change.boundary, change.after);
    if (Object.is(change.before, change.after)) return false;
    cue[change.boundary] = change.after;
    const input = element('cue-list').querySelector<HTMLInputElement>(`[data-cue="${change.cueIndex}"] input[data-boundary="${change.boundary}"]`);
    if (input) input.value = String(change.after);
    changed(null); return true;
  },
});
function updateTimeline() {
  timeline.setEditor(working ? { projectId: working.id, projectGeneration: loadedProjectGeneration, editGeneration, duration: working.duration, cues: working.cues, busy: !!currentJob || loading || requestingJob || saving || archiveChecking } : null);
}


function message(text: string, error = false) {
  const node = element('message'); node.textContent = text; node.hidden = !text; node.classList.toggle('error', error);
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== 'GET' && session) headers.set('X-Karaoke-Token', session.token);
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  const value = await readReply(response) as {error?:unknown};
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `Local studio request failed (${response.status}).`);
  return value as T;
}
function json(method: string, body: unknown): RequestInit { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

function validateWorking(): string {
  if (!working) return '';
  try {
    validateTitle(working.title);
    validateCues(working.cues, working.duration);
    if (session && (working.duration > session.maxDuration || working.cues.length > session.maxCues || working.cues.reduce((total, cue) => total + Array.from(cue.text).length, 0) > session.maxLyricChars)) throw new Error('This edit exceeds the connected studio’s song or lyric limits. Your draft is kept.');
    return '';
  } catch (error) { return error instanceof Error ? error.message : 'Check the lyric timing.'; }
}
function controls() {
  if (practice.active && timingBusy()) retirePractice('Other studio work stopped practice.');
  if (timingOwner && timingBusy()) retireTiming('Other studio work cancelled the timing session. Staged times were not applied.');
  const busy = currentJob !== null || loading || requestingJob || archiveChecking, invalid = validateWorking();
  element<HTMLInputElement>('audio-file').disabled = !session?.modelReady || busy || saving;
  element<HTMLSelectElement>('projects').disabled = busy || saving;
  element<HTMLButtonElement>('save').disabled = !working || !dirty || draftDirty || !!invalid || busy || saving || !!timingOwner;
  element<HTMLButtonElement>('export-video').disabled = !working?.cues.length || dirty || draftDirty || !!invalid || busy || saving || !!timingOwner;
  element<HTMLButtonElement>('lyrics-download').disabled = !working?.cues.length || dirty || draftDirty || !!invalid || busy || saving || !!timingOwner;
  element<HTMLButtonElement>('backing-download').disabled = !working;
  element<HTMLButtonElement>('delete-project').disabled = !working || busy || saving;
  element<HTMLButtonElement>('draft-timings').disabled = !working || busy || saving;
  element<HTMLTextAreaElement>('lyric-draft').disabled = !working || busy || saving;
  element<HTMLInputElement>('title').disabled = busy || saving;
  element<HTMLButtonElement>('refresh').disabled = loading || saving || requestingJob || archiveChecking;
  element<HTMLButtonElement>('discard-draft').disabled = busy || saving;
  element<HTMLButtonElement>('undo-lyrics').disabled = !working || !lyricHistory?.canUndo || busy || saving;
  element<HTMLButtonElement>('redo-lyrics').disabled = !working || !lyricHistory?.canRedo || busy || saving;
  element('discard-draft').hidden = !draftDirty;
  for (const control of element('cue-list').querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input,textarea,button')) control.disabled = busy || saving;
  for (const control of document.querySelectorAll<HTMLButtonElement>('[data-track]')) control.disabled = !working;
  element('cue-validation').textContent = invalid;
  element('save-state').textContent = saving ? 'Saving lyrics…' : draftDirty ? 'Unsaved pasted words — create draft timings or discard the paste.' : working ? dirty ? 'Unsaved lyric edits — save before exporting.' : 'Saved in your local studio.' : 'Choose a clip to begin.';
  element('video-download').hidden = !videoUrl || dirty || draftDirty || busy || !!timingOwner;
  srtControls(); timingControls(); practiceControls();
  updateTimeline();
  archiveControls();
  restoreArchiveFocus();
}
function draftSnapshot(): LyricDraft {
  return { title: working!.title, cues: working!.cues, pastedText: element<HTMLTextAreaElement>('lyric-draft').value, pastedDirty: draftDirty, rawTimings: captureTimingDrafts() };
}
function changed(group: string | null = null) {
  retirePractice('The lyric editor changed. Practice stopped.');
  if (!working) return;
  retireSrt('The lyric editor changed. Choose the SRT file again to review current work.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  timeline.cancelGesture(); editGeneration++;
  lyricHistory?.record(draftSnapshot(), group);
  dirty = lyricHistory?.dirty ?? true; videoUrl = null; controls(); draw();
}
function restoreDraft(direction: 'undo' | 'redo') {
  retirePractice('Undo or Redo stopped practice.');
  if (!working || !lyricHistory || currentJob || loading || requestingJob || saving || archiveChecking) return;
  retireSrt('Undo or Redo cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  timeline.cancelGesture(); editGeneration++;
  const rawTimings = captureTimingDrafts();
  const draft = lyricHistory[direction]();
  if (!draft) return;
  working.title = draft.title; working.cues = draft.cues;
  element<HTMLInputElement>('title').value = draft.title;
  element<HTMLTextAreaElement>('lyric-draft').value = draft.pastedText;
  draftDirty = draft.pastedDirty; dirty = lyricHistory.dirty; videoUrl = null;
  renderCues(draft.rawTimings ?? rawTimings); controls(); draw(); message(direction === 'undo' ? 'Lyric edit undone.' : 'Lyric edit restored.');
}
element('undo-lyrics').addEventListener('click', () => restoreDraft('undo'));
element('redo-lyrics').addEventListener('click', () => restoreDraft('redo'));
app.addEventListener('focusout', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) lyricHistory?.endGroup();
});

function wrap(text: string, size: number, maxWidth = 1000): string[] {
  context.font = `${size}px KaraokeSans`;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line); line = '';
      for (const character of word) {
        if (line && context.measureText(line + character).width > maxWidth) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}
function drawBlock(text: string, y: number, initialSize: number, minSize: number, maxHeight: number, color: string) {
  let size = initialSize, lines = wrap(text, size);
  while (size > minSize && lines.length * Math.ceil(size * 1.25) > maxHeight) lines = wrap(text, --size);
  const lineHeight = Math.ceil(size * 1.25);
  if (lines.length * lineHeight > maxHeight) lines = wrap(text.replace(/\s+/g, ' ').trim(), size);
  if (lines.length * lineHeight > maxHeight) {
    lines = lines.slice(0, Math.max(1, Math.floor(maxHeight / lineHeight)));
    while (lines.at(-1) && context.measureText(lines.at(-1)! + '…').width > 1000) lines[lines.length - 1] = lines.at(-1)!.slice(0, -1);
    lines[lines.length - 1] += '…';
  }
  context.font = `${size}px KaraokeSans`; context.fillStyle = color;
  for (const [index, line] of lines.entries()) context.fillText(line, 640, y + (index - (lines.length - 1) / 2) * lineHeight);
}
function draw() {
  timeline.setPlayback(audio.currentTime || 0);
  context.fillStyle = '#14232f'; context.fillRect(0, 0, 1280, 720);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  const invalid = validateWorking();
  if (invalid) {
    // Keep the complete invalid draft in its editor/history, but never send
    // unbounded input to native canvas layout, including during playback.
    drawBlock('Preview paused', 240, 44, 24, 100, '#e4b77d');
    drawBlock('Correct the title or lyric draft to resume.', 330, 28, 22, 100, '#f7f5ed');
    drawBlock(invalid, 430, 24, 18, 160, '#9dafbb');
    stage.dataset.activeCue = '-1';
    const paused = 'Preview paused — correct the title or lyric draft to resume.';
    if (element('current-line').textContent !== paused) element('current-line').textContent = paused;
    element('clock').textContent = `${formatTime(audio.currentTime || 0)} / ${formatTime(working?.duration || 0)}`;
    for (const row of element('cue-list').querySelectorAll<HTMLElement>('[data-cue]')) row.classList.remove('active');
    return;
  }
  drawBlock((working?.title || 'Your next sing-along starts here').replace(/\s+/g, ' ').trim(), 80, 32, 22, 100, '#f7f5ed');
  const time = audio.currentTime || 0, index = working ? activeCue(working.cues, time) : -1;
  const current = index >= 0 ? working!.cues[index].text : 'Instrumental break';
  const upcoming = working?.cues.find(cue => cue.start > time);
  drawBlock(current, 320, 44, 24, 300, index >= 0 ? '#e4b77d' : '#f7f5ed');
  if (upcoming) drawBlock(`Next: ${upcoming.text}`, 540, 26, 18, 80, '#9dafbb');
  context.font = '20px KaraokeSans'; context.fillStyle = '#9dafbb'; context.fillText(`Karaoke Studio · ${currentTrack[0].toUpperCase() + currentTrack.slice(1)} track`, 640, 660);
  stage.dataset.activeCue = String(index);
  if (element('current-line').textContent !== current) element('current-line').textContent = current;
  element('clock').textContent = `${formatTime(time)} / ${formatTime(working?.duration || 0)}`;
  for (const row of element('cue-list').querySelectorAll<HTMLElement>('[data-cue]')) row.classList.toggle('active', Number(row.dataset.cue) === index);
}
function animate() { draw(); if (!audio.paused && !audio.ended) animation = requestAnimationFrame(animate); }
audio.addEventListener('play', () => { cancelAnimationFrame(animation); animate(); });
for (const event of ['pause', 'ended', 'seeked', 'timeupdate', 'loadedmetadata']) audio.addEventListener(event, draw);
audio.addEventListener('error', () => { if (working) message('Could not play this local audio file. Refresh the project or check that the studio service is still running.', true); });
void document.fonts.ready.then(draw);

function track(kind: string) {
  if (!working) return;
  // Retire before capturing ordinary playback intent: switching away from a
  // practice session must never resume that retired session on another track.
  retirePractice('Changing track stopped practice. Choose Play once or Repeat range when ready.');
  retireTiming('Changing track cancelled the timing session. Staged times were not applied.'); timingWaiting = false;
  timeline.cancelGesture();
  const position = audio.currentTime || 0, playing = !audio.paused;
  const id = working.id, project = loadedProjectGeneration, owner = ++mediaGeneration;
  currentTrack = kind;
  audio.pause(); const url = `/api/projects/${id}/audio/${kind}`; audio.src = url;
  const expectedSource = new URL(url, location.href).href;
  audio.onloadedmetadata = () => {
    if (owner !== mediaGeneration || working?.id !== id || loadedProjectGeneration !== project || audio.src !== expectedSource || loading) return;
    audio.currentTime = Math.min(position, working.duration);
    if (playing) void audio.play().catch(() => { if (owner === mediaGeneration && working?.id === id) message('Press play to continue listening.'); });
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-track]')) button.setAttribute('aria-pressed', String(button.dataset.track === kind));
  audio.load(); draw();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-track]')) button.addEventListener('click', () => track(button.dataset.track!));

function retirePractice(text = 'Practice stopped. The playhead and lyric edits are kept.'): void {
  practiceEpoch++; practice.stop(text);
}
function selectedPracticeRange() {
  if (!working) throw new Error('Choose a clip with valid lyric cues.');
  const first = element<HTMLSelectElement>('practice-first').value, last = element<HTMLSelectElement>('practice-last').value;
  if (first === '' || last === '') throw new Error('Choose a valid first and last lyric line.');
  return createPracticeRange(working.cues, working.duration, Number(first), Number(last));
}
function practiceMediaReady(): boolean {
  if (!working || timingBusy() || timingOwner || validateWorking() || document.hidden) return false;
  const source = new URL(`/api/projects/${working.id}/audio/${currentTrack}`, location.href).href;
  return audio.src === source && audio.currentSrc === source && !audio.error && !audio.seeking
    && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Number.isFinite(audio.duration)
    && Math.abs(audio.duration - working.duration) <= 1 / 44100 && audio.playbackRate === 1 && !audio.loop;
}
function practiceControls(): void {
  const first = element<HTMLSelectElement>('practice-first'), last = element<HTMLSelectElement>('practice-last');
  const count = working?.cues.length ?? 0, newProject = practiceProject !== loadedProjectGeneration;
  if (newProject || practiceCount !== count) {
    const oldFirst = first.value, oldLast = last.value;
    for (const select of [first, last]) {
      select.replaceChildren();
      for (let index = 0; index < count; index++) select.append(new Option(`Line ${index + 1}`, String(index)));
    }
    const initialRange = newProject || practiceCount === 0;
    first.value = initialRange ? '0' : oldFirst; last.value = initialRange ? '0' : oldLast;
    practiceProject = loadedProjectGeneration; practiceCount = count;
  }
  const busy = timingBusy(); first.disabled = last.disabled = !working || !count || busy;
  let valid = false;
  try {
    const range = selectedPracticeRange();
    const gaps = working!.cues.slice(range.firstIndex + 1, range.lastIndex + 1)
      .map((cue, index) => ({ start: working!.cues[range.firstIndex + index].end, end: cue.start }))
      .filter(gap => gap.end > gap.start);
    element('practice-range-summary').textContent = `Lines ${range.firstIndex + 1}–${range.lastIndex + 1} · ${range.start} → ${range.end} seconds of the ${currentTrack} track. `
      + (gaps.length ? `Included instrumental gaps: ${gaps.map(gap => `${gap.start} → ${gap.end} seconds`).join('; ')}.` : 'No instrumental gaps between these selected lines.');
    valid = true;
  } catch (error) { element('practice-range-summary').textContent = error instanceof Error ? error.message : 'Choose a valid lyric range.'; }
  const ready = valid && practiceMediaReady();
  element<HTMLButtonElement>('practice-once').disabled = !ready;
  element<HTMLButtonElement>('practice-repeat').disabled = !ready;
  element<HTMLButtonElement>('practice-pause').disabled = !practice.active || busy;
  element('practice-pause').textContent = practice.paused ? 'Resume practice' : 'Pause practice';
  element<HTMLButtonElement>('practice-stop').disabled = !practice.active;
  element('practice-status').textContent = practice.status;
}
function startPractice(mode: PracticeMode, singleLine?: number): void {
  if (!practiceMediaReady() || !working) { practiceControls(); return; }
  if (singleLine !== undefined) {
    element<HTMLSelectElement>('practice-first').value = String(singleLine);
    element<HTMLSelectElement>('practice-last').value = String(singleLine);
  }
  try {
    const range = selectedPracticeRange();
    retirePractice();
    const epoch = practiceEpoch, id = working.id, project = loadedProjectGeneration, edit = editGeneration;
    const media = mediaGeneration, trackName = currentTrack, source = audio.src, duration = working.duration;
    timeline.cancelGesture();
    practice.start(range, mode, () => practiceEpoch === epoch && working?.id === id
      && loadedProjectGeneration === project && editGeneration === edit && mediaGeneration === media
      && currentTrack === trackName && working.duration === duration && audio.src === source && audio.currentSrc === source
      && Number.isFinite(audio.duration) && Math.abs(audio.duration - duration) <= 1 / 44100
      && !timingBusy() && !timingOwner);
  } catch { practiceControls(); }
}
for (const id of ['practice-first', 'practice-last']) element(id).addEventListener('change', () => {
  retirePractice('The selected range changed. Choose Play once or Repeat range when ready.'); practiceControls();
});
element('practice-once').addEventListener('click', () => startPractice('once'));
element('practice-repeat').addEventListener('click', () => startPractice('repeat'));
element('practice-pause').addEventListener('click', () => { if (practice.paused) practice.resume(); else practice.pause(); });
element('practice-stop').addEventListener('click', () => retirePractice());
for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'emptied', 'ratechange']) audio.addEventListener(event, practiceControls);

function cueInput(label: string, value: string, type: string, onInput: (value: string) => void): HTMLLabelElement {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const control = type === 'text' ? document.createElement('textarea') : document.createElement('input'); control.value = value;
  if (control instanceof HTMLTextAreaElement) control.rows = Math.max(1, Math.min(4, value.split('\n').length));
  else { control.type = type; if (type === 'number') { control.min = '0'; control.max = String(working!.duration); control.step = 'any'; } }
  control.addEventListener('input', () => { onInput(control.value); changed(label); });
  wrapper.append(control); return wrapper;
}
function captureTimingDrafts(): RawTiming[] {
  return working?.cues.map((cue, index) => {
    const row = element('cue-list').querySelector(`[data-cue="${index}"]`);
    return { start: cue.start, end: cue.end, startText: row?.querySelector<HTMLInputElement>('[data-boundary="start"]')?.value ?? '', endText: row?.querySelector<HTMLInputElement>('[data-boundary="end"]')?.value ?? '' };
  }) || [];
}
function srtAllowed(): boolean { return !!working && !currentJob && !loading && !requestingJob && !saving && !archiveChecking; }
function srtCurrent(owner: SrtOwner): boolean {
  return srtOwner === owner && srtEpoch === owner.epoch && working?.id === owner.projectId && loadedProjectGeneration === owner.project && editGeneration === owner.edit;
}
function srtControls() {
  const allowed = srtAllowed();
  element<HTMLInputElement>('srt-file').disabled = !allowed;
  element<HTMLButtonElement>('srt-apply').disabled = !allowed || !srtReview || !srtCurrent(srtReview.owner);
  element<HTMLButtonElement>('srt-cancel').hidden = !srtOwner;
}
function retireSrt(text: string) {
  if (!srtOwner && !srtReview) return;
  srtEpoch++; clearTimeout(srtTimer); srtTimer = undefined; srtOwner = null; srtReview = null;
  element('srt-review').hidden = true; element('srt-review-list').replaceChildren();
  element('srt-status').textContent = text; srtControls();
}
function srtTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000), whole = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
}
element<HTMLInputElement>('srt-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (file) retireTiming('Selecting timed lyrics cancelled the timing session. Staged times were not applied.');
  if (!file || !srtAllowed()) return;
  retireSrt('');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  if (file.size < 1 || file.size > MAX_SRT_BYTES) { element('srt-status').textContent = 'Choose a nonempty UTF-8 SRT file no larger than 128 KiB.'; return; }
  const owner: SrtOwner = { epoch: ++srtEpoch, projectId: working!.id, project: loadedProjectGeneration, edit: editGeneration, deadline: performance.now() + 10000 };
  const duration = working!.duration, title = working!.title, previousCount = working!.cues.length;
  srtOwner = owner; element('srt-status').textContent = 'Reading and validating all timed lyric cues. Current editor values are kept.'; srtControls();
  srtTimer = setTimeout(() => { if (srtCurrent(owner) && !srtReview) retireSrt('SRT reading took longer than 10 seconds. Current lyrics were kept; choose the file again to retry.'); }, 10000);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!srtCurrent(owner)) return;
    if (performance.now() >= owner.deadline) { retireSrt('SRT reading took longer than 10 seconds. Current lyrics were kept; choose the file again to retry.'); return; }
    const cues = parseSrt(bytes, duration);
    if (!srtCurrent(owner)) return;
    if (!srtAllowed()) { retireSrt('Other studio work cancelled the lyric import. Current lyrics were kept.'); return; }
    if (performance.now() >= owner.deadline) { retireSrt('SRT validation took longer than 10 seconds. Current lyrics were kept; choose the file again to retry.'); return; }
    clearTimeout(srtTimer); srtTimer = undefined;
    srtReview = { owner, cues };
    element('srt-summary').textContent = `${file.name} · ${cues.length} imported cues to replace ${previousCount} current cues for “${title}” (${formatTime(duration)}). First start ${srtTime(cues[0].start)}; last end ${srtTime(cues.at(-1)!.end)}.`;
    const list = element('srt-review-list'); list.replaceChildren();
    for (const [index, cue] of cues.entries()) {
      const row = document.createElement('li'); row.dataset.srtCue = String(index);
      const time = document.createElement('strong'); time.textContent = `${index + 1}. ${srtTime(cue.start)} --> ${srtTime(cue.end)}`;
      const text = document.createElement('pre'); text.textContent = cue.text; row.append(time, text); list.append(row);
    }
    if (performance.now() >= owner.deadline) { retireSrt('SRT review took longer than 10 seconds. Current lyrics were kept; choose the file again to retry.'); return; }
    element('srt-review').hidden = false; element('srt-status').textContent = 'All cues validated. Review every cue, then replace lyric cues when ready. Nothing has been saved.'; srtControls();
  } catch (error) {
    if (!srtCurrent(owner)) return;
    retireSrt(`${error instanceof Error ? error.message : 'The SRT file could not be read.'} Current lyrics and editor values were kept.`);
    retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  }
});
element('srt-cancel').addEventListener('click', () => retireSrt('Lyric import cancelled. Current lyrics and editor values were kept.'));
element('srt-apply').addEventListener('click', () => {
  retirePractice('Replacing lyric cues stopped practice.');
  const review = srtReview;
  if (!review || !srtCurrent(review.owner) || !srtAllowed() || !working || !lyricHistory) return;
  timeline.cancelGesture();
  // Keep the exact pre-application native spelling, including blank invalid times.
  lyricHistory.record(draftSnapshot()); lyricHistory.endGroup();
  const cues = structuredClone(review.cues);
  retireSrt('Lyric cues replaced in memory. The title and pasted words were kept; use Save lyrics when ready.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  working.cues = cues; renderCues(); changed();
  message(draftDirty ? 'Timed lyrics imported. Your unapplied pasted words are kept; create draft timings or discard that paste before saving.' : 'Timed lyrics imported as one edit. Review the timing and use Save lyrics when ready.');
});
function editCueStructure(index: number, kind: 'split' | 'merge'): void {
  retirePractice('Changing cue structure stopped practice.');
  if (!working || currentJob || loading || requestingJob || saving || archiveChecking) return;
  try {
    const raw = captureTimingDrafts(), current = working.cues[index];
    let next;
    if (kind === 'split') {
      const text = element('cue-list').querySelector<HTMLTextAreaElement>(`[data-cue="${index}"] textarea`);
      if (!text || text.selectionStart !== text.selectionEnd) throw new Error('Place a single text caret between the words to split; do not select a text range.');
      const time = Math.round(audio.currentTime * 1000) / 1000;
      next = splitCue(working.cues, index, text.selectionStart, time, working.duration);
      raw.splice(index, 1,
        { start: current.start, end: time, startText: raw[index].startText, endText: String(time) },
        { start: time, end: current.end, startText: String(time), endText: raw[index].endText });
    } else {
      next = mergeCue(working.cues, index, working.duration);
      raw.splice(index, 2, { start: current.start, end: working.cues[index + 1].end,
        startText: raw[index].startText, endText: raw[index + 1].endText });
    }
    retireSrt('Cue structure changed. The prior lyric import review was canceled.');
    retireTiming('Cue structure changed. Staged listening times were not applied.');
    working.cues = next; renderCues(raw); changed();
    const focus = element('cue-list').querySelector<HTMLTextAreaElement>(`[data-cue="${kind === 'split' ? index + 1 : index}"] textarea`);
    focus?.focus(); focus?.setSelectionRange(0, 0);
    message(kind === 'split' ? 'Line split at the caret and playhead. Both literal text halves were kept; Undo restores the original line.'
      : 'Lines merged with a newline, including any gap between them. Undo restores both original intervals.');
  } catch (error) { message(error instanceof Error ? error.message : 'Cue edit could not be applied. Current words and timings were kept.', true); }
}
function renderCues(rawTimings: RawTiming[] = []) {
  const list = element('cue-list'); list.replaceChildren();
  if (!working?.cues.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Paste your words above, then create draft timings to begin.'; list.append(empty); return; }
  for (const [index, cue] of working.cues.entries()) {
    const row = document.createElement('div'); row.className = 'cue'; row.dataset.cue = String(index);
    const number = document.createElement('span'); number.className = 'cue-number'; number.textContent = String(index + 1).padStart(2, '0'); row.append(number);
    const text = cueInput(`Lyric line ${index + 1}`, cue.text, 'text', value => { cue.text = value; }); text.className = 'cue-text'; row.append(text);
    const start = cueInput(`Start line ${index + 1}`, rawTimings[index] && Object.is(rawTimings[index].start, cue.start) ? rawTimings[index].startText : Number.isFinite(cue.start) ? String(cue.start) : '', 'number', value => { cue.start = value === '' ? NaN : Number(value); }); start.querySelector('input')!.dataset.boundary = 'start'; row.append(start);
    const end = cueInput(`End line ${index + 1}`, rawTimings[index] && Object.is(rawTimings[index].end, cue.end) ? rawTimings[index].endText : Number.isFinite(cue.end) ? String(cue.end) : '', 'number', value => { cue.end = value === '' ? NaN : Number(value); }); end.querySelector('input')!.dataset.boundary = 'end'; row.append(end);
    const actions = document.createElement('div'); actions.className = 'cue-actions';
    for (const [label, action] of [
      ['Select timing', () => timeline.selectCue(index)],
      ['Mark start', () => { cue.start = Math.round(audio.currentTime * 1000) / 1000; renderCues(); changed(); }],
      ['Mark end', () => { cue.end = Math.min(working!.duration, Math.round(audio.currentTime * 1000) / 1000); renderCues(); changed(); }],
      ['Play line', () => startPractice('once', index)],
      ['Remove', () => { working!.cues.splice(index, 1); renderCues(); changed(); }],
    ] as const) {
      const button = document.createElement('button'); button.className = 'text-button'; button.textContent = label;
      button.setAttribute('aria-label', `${label === 'Play line' ? 'Play' : label} line ${index + 1}`); button.addEventListener('click', () => { if (label !== 'Select timing') { retirePractice('A lyric action stopped practice.'); retireTiming('A lyric action cancelled the timing session. Staged times were not applied.'); } action(); }); actions.append(button);
    }
    const split = document.createElement('button'); split.className = 'text-button'; split.textContent = 'Split at caret and playhead';
    split.setAttribute('aria-label', `Split at caret and playhead line ${index + 1}`);
    split.title = 'Place a caret between words, seek inside this interval, then split into two cues.';
    split.addEventListener('click', () => editCueStructure(index, 'split')); actions.append(split);
    if (index + 1 < working.cues.length) {
      const merge = document.createElement('button'); merge.className = 'text-button'; merge.textContent = 'Merge with next';
      merge.setAttribute('aria-label', `Merge with next line ${index + 1}`);
      merge.title = 'Join literal text with a newline and include any instrumental gap between these lines.';
      merge.addEventListener('click', () => editCueStructure(index, 'merge')); actions.append(merge);
    }
    row.append(actions); list.append(row);
  }
  const hint = document.createElement('p'); hint.className = 'fine';
  hint.textContent = 'Split: place a caret between words and seek the playhead inside that line. Merge with next: joins words with a newline and includes any gap. Each action is one unsaved Undo/Redo edit.';
  list.append(hint);
  controls(); draw();
}

async function refreshProjects(isCurrent: () => boolean = () => true): Promise<boolean> {
  const result = await request<{ projects: Project[] }>('/api/projects');
  if (!isCurrent()) return false;
  if (!Array.isArray(result?.projects)) throw new Error('Invalid clip library response.');
  const admitted = result.projects.map(validateProject);
  projects = admitted;
  for (const id of archiveCaches.keys()) if (!projects.some(project => project.id === id)) archiveCaches.delete(id);
  const select = element<HTMLSelectElement>('projects'); select.replaceChildren(new Option('Choose a saved clip', ''));
  for (const project of projects) select.append(new Option(project.title, project.id));
  select.value = working?.id || '';
  element('library-count').textContent = `${projects.length} of ${session?.maxProjects || 20} local clip slots used.`;
  return true;
}
async function openProject(id: string) {
  retirePractice('Opening a clip stopped practice.');
  retireSrt('Opening a clip cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  timeline.stopWaveform(); timeline.cancelGesture(); editGeneration++; mediaGeneration++;
  const generation = ++projectGeneration;
  loading = true; controls();
  try {
  const project = validateProject(await request<unknown>(`/api/projects/${encodeURIComponent(id)}`));
  if (project.id !== id) throw new Error('The studio returned a different clip. Your current work is kept.');
  if (generation !== projectGeneration) return;
  audio.pause(); audio.removeAttribute('src'); audio.load();
  loadedProjectGeneration++; editGeneration++;
  working = structuredClone(project); dirty = false; draftDirty = false; videoUrl = null;
  archiveInfo = null; archiveInfoState = 'loading'; void loadArchiveInfo();
  element<HTMLInputElement>('title').value = project.title;
  element<HTMLSelectElement>('projects').value = project.id;
  element('duration').textContent = formatTime(project.duration);
  element('clip-details').hidden = false;
  element<HTMLTextAreaElement>('lyric-draft').value = project.cues.map(cue => cue.text).join('\n');
  history.replaceState(null, '', `?project=${project.id}`);
  renderCues(); lyricHistory = new LyricHistory(draftSnapshot()); controls(); track(currentTrack);
  } finally { if (generation === projectGeneration) { loading = false; controls(); } }
}
function mayLeave(): boolean { return !(dirty || draftDirty) || window.confirm('Discard unsaved lyric edits and open a different clip?'); }
element<HTMLSelectElement>('projects').addEventListener('change', async event => {
  retirePractice('Choosing a clip stopped practice.');
  retireSrt('Choosing a clip cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  const select = event.target as HTMLSelectElement;
  if (!select.value || !mayLeave()) { select.value = working?.id || ''; return; }
  try { await openProject(select.value); message(''); } catch (error) { message(String(error instanceof Error ? error.message : error), true); }
});
element<HTMLInputElement>('title').addEventListener('input', event => { if (working) { working.title = (event.target as HTMLInputElement).value; changed('title'); } });
element<HTMLTextAreaElement>('lyric-draft').addEventListener('input', event => {
  draftDirty = (event.target as HTMLTextAreaElement).value !== (working?.cues.map(cue => cue.text).join('\n') || ''); changed('paste');
});
element('discard-draft').addEventListener('click', () => {
  retirePractice('Discarding pasted words stopped practice.');
  retireTiming('Discarding pasted words cancelled the timing session. Staged times were not applied.');
  element<HTMLTextAreaElement>('lyric-draft').value = working?.cues.map(cue => cue.text).join('\n') || '';
  draftDirty = false; changed();
});
element('draft-timings').addEventListener('click', () => {
  retirePractice('Creating draft timings stopped practice.');
  retireTiming('Creating draft timings cancelled the timing session. Staged times were not applied.');
  if (!working) return;
  try { working.cues = draftCues(element<HTMLTextAreaElement>('lyric-draft').value, working.duration); draftDirty = false; renderCues(); changed(); message('Draft timings are evenly spaced. Listen and adjust each line before saving.'); }
  catch (error) { message(error instanceof Error ? error.message : 'Could not create draft timings.', true); }
});
element('save').addEventListener('click', async () => {
  retirePractice('Saving lyrics stopped practice.');
  timeline.cancelGesture();
  if (!working || saving || archiveChecking || timingOwner || draftDirty || validateWorking()) return;
  retireSrt('Saving lyrics cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  timeline.cancelGesture(); editGeneration++;
  saving = true; controls();
  try {
    const sent = structuredClone(working);
    const reply = await request<unknown>(`/api/projects/${sent.id}`, json('PUT', { title: sent.title, cues: sent.cues, revision: sent.revision }));
    const saved = validateSaveReply(reply, sent);
    working = saved;
    dirty = false; videoUrl = null;
    renderCues(); lyricHistory = new LyricHistory(draftSnapshot());
    await refreshProjects(); message('Lyrics and timing saved locally.');
  } catch (error) { message(error instanceof TypeError ? new UnconfirmedReplyError().message : error instanceof Error ? error.message : 'Could not save. Your edits are still here.', true); }
  finally { saving = false; controls(); }
});

function download(url: string, suffix: string) {
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `${working?.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'karaoke'}${suffix}`; anchor.click();
}
element('backing-download').addEventListener('click', () => { if (working) download(`/api/projects/${working.id}/audio/backing`, '-backing.wav'); });
element('lyrics-download').addEventListener('click', () => { if (working && !dirty && !timingOwner) download(`/api/projects/${working.id}/lyrics`, '.srt'); });
element('video-download').addEventListener('click', () => { if (videoUrl && !timingOwner) download(videoUrl, '.mp4'); });
element('delete-project').addEventListener('click', async () => {
  retirePractice('Deleting a clip stopped practice.');
  timeline.cancelGesture();
  if (!working || currentJob || saving || loading || archiveChecking) return;
  retireSrt('Deleting a clip cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  if (!window.confirm(`Delete “${working.title}” and its audio, lyrics, and video from this local library? This cannot be undone.`)) return;
  saving = true; controls();
  try {
    await request(`/api/projects/${working.id}`, json('DELETE', {}));
    timeline.stopWaveform(); timeline.cancelGesture(); editGeneration++; loadedProjectGeneration++; mediaGeneration++;
    ++projectGeneration; audio.pause(); audio.removeAttribute('src'); audio.load();
    working = null; lyricHistory = null; dirty = false; draftDirty = false; videoUrl = null;
    archiveInfoEpoch++; archiveInfo = null; archiveInfoState = 'none';
    element('clip-details').hidden = true; element<HTMLInputElement>('title').value = '';
    element<HTMLTextAreaElement>('lyric-draft').value = ''; history.replaceState(null, '', location.pathname);
    renderCues(); draw(); await refreshProjects(); message('The selected clip was deleted. Other saved clips are unchanged.');
  } catch (error) { message(error instanceof Error ? error.message : 'Could not delete the selected clip.', true); }
  finally { saving = false; controls(); }
});

function showJob(job: Job | null) {
  if (job) retirePractice('Studio media work stopped practice.');
  currentJob = job; element('job-panel').hidden = !job;
  if (job) {
    const titles: Record<Job['kind'], string> = { separate: 'Making space for your voice', export: 'Preparing your karaoke video', 'archive-export': 'Backing up your saved clip', 'archive-import': 'Restoring a project archive' };
    element('job-title').textContent = titles[job.kind];
    element('job-stage').textContent = job.stage + (ownedJob ? '' : ' — observed studio work; cancellation belongs to its starting page.');
  }
  element<HTMLButtonElement>('cancel-job').disabled = !ownedJob;
  controls();
}
function ownsPoll(id: string, epoch: number): boolean { return currentJob?.id === id && pollEpoch === epoch; }
async function pollJob(id: string, epoch = pollEpoch) {
  const key = `${epoch}:${id}`;
  if (!ownsPoll(id, epoch) || pollInFlight === key) return;
  pollInFlight = key;
  let terminal = false;
  try {
    const { job } = await request<{ job: Job }>(`/api/jobs/${id}`);
    if (!ownsPoll(id, epoch)) return;
    if (job.status === 'running') { showJob(job); pollTimer = setTimeout(() => void pollJob(id, epoch), 600); return; }
    terminal = true;
    if (job.status === 'complete') {
      if (job.kind === 'archive-import') completedImportId = job.projectId;
      if (!await refreshProjects(() => ownsPoll(id, epoch))) return;
      if (!ownsPoll(id, epoch)) return;
      if (job.kind === 'archive-import') {
        const restored = projects.find(project => project.id === job.projectId);
        if (!restored) throw new Error('The restored clip is not currently listed. Check restore status to refresh the library.');
        importedResult = { id: restored.id, title: restored.title }; completedImportId = null;
        restoreUncertain = false;
        message('Archive restored as a new saved clip. Your current editor is unchanged; use Open imported clip when ready.');
      } else if (job.kind === 'archive-export') {
        if (ownedJob && archiveJobRevision !== null) {
          archiveCaches.set(job.projectId, archiveJobRevision);
          message('Saved archive ready. Unsaved lyric edits are not included.');
        } else message('The studio finished its archive backup. Back up the saved clip here to prepare its download.');
      } else if (job.kind === 'separate') {
        if (ownedJob && (followJobProject || (!(dirty || draftDirty) && !working))) {
          await openProject(job.projectId);
          if (!ownsPoll(id, epoch)) return;
          message('Your stems are ready. Audition the estimates, then add and time your lyrics.');
        } else message('Your stems are ready in Saved clips. Your current lyric edits are still here.');
      } else if (ownedJob && job.resultUrl && working?.id === job.projectId) { videoUrl = job.resultUrl; download(videoUrl, '.mp4'); message('Karaoke MP4 ready. Your saved lyric timings are included.'); }
      else if (!ownedJob) message('The studio finished a karaoke MP4. Your editor is unchanged. Open its saved clip and export from this page to download the saved timings.');
      else message('Karaoke MP4 ready. Open its saved clip to export or download it.');
    } else message(job.status === 'cancelled' ? 'Job cancelled. Completed clips are unchanged.' : job.error || 'The local media job failed.', job.status === 'failed');
    if (ownsPoll(id, epoch)) showJob(null);
  } catch (error) {
    if (!ownsPoll(id, epoch)) return;
    if (terminal) { const result = currentJob?.kind === 'separate' ? 'project' : 'result'; showJob(null); message(`The job finished, but its ${result} could not be loaded. Check restore status or Refresh projects to retry: ${error instanceof Error ? error.message : 'Connection lost.'}`, true); return; }
    message(`Cannot reach the job yet: ${error instanceof Error ? error.message : 'Connection lost.'} Retrying…`, true);
    pollTimer = setTimeout(() => void pollJob(id, epoch), 2000);
  } finally { if (pollInFlight === key) pollInFlight = null; }
}
function startPolling(job: Job, follow = true, owned = true, savedRevision: number | null = null) {
  retirePractice('Studio media work stopped practice.');
  retireSrt('Studio media work cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  if (currentJob?.id === job.id) { void pollJob(job.id); return; }
  pollEpoch++; followJobProject = follow; ownedJob = owned; archiveJobRevision = savedRevision;
  clearTimeout(pollTimer); showJob(job); void pollJob(job.id, pollEpoch);
}
element<HTMLInputElement>('audio-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (file) retireTiming('Choosing audio cancelled the timing session. Staged times were not applied.');
  if (!file || currentJob || requestingJob || loading || saving || archiveChecking || !mayLeave()) return;
  retireSrt('Importing audio cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  const maxBytes = Math.min(MAX_UPLOAD_BYTES, session?.maxUploadBytes ?? MAX_UPLOAD_BYTES);
  if (file.size < 1 || file.size > maxBytes) { message(`Choose a nonempty song clip no larger than ${maxBytes / 1024 / 1024} MiB.`, true); return; }
  requestingJob = true; controls();
  try {
    const result = await request<{ job: Job }>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Name': encodeURIComponent(file.name) }, body: file });
    message(''); startPolling(result.job);
  } catch (error) { message(error instanceof Error ? error.message : 'Could not import this clip.', true); controls(); }
  finally { requestingJob = false; controls(); }
});
element('cancel-job').addEventListener('click', async () => {
  if (!currentJob || !ownedJob) return;
  const id = currentJob.id, epoch = pollEpoch;
  try { await request(`/api/jobs/${id}/cancel`, json('POST', {})); if (ownsPoll(id, epoch)) void pollJob(id, epoch); }
  catch (error) { if (ownsPoll(id, epoch)) message(error instanceof Error ? error.message : 'Could not cancel this job.', true); }
});
element('export-video').addEventListener('click', async () => {
  retirePractice('Exporting video stopped practice.');
  if (!working || timingOwner || dirty || draftDirty || currentJob || requestingJob || loading || saving || archiveChecking) return;
  retireSrt('Exporting video cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  requestingJob = true; controls();
  try { const { job } = await request<{ job: Job }>(`/api/projects/${working.id}/export`, json('POST', {})); message(''); startPolling(job); }
  catch (error) { message(error instanceof Error ? error.message : 'Could not export video.', true); }
  finally { requestingJob = false; controls(); }
});
function archiveControls() {
  const busy = !!currentJob || requestingJob || loading || saving || archiveChecking;
  element<HTMLButtonElement>('archive-backup').disabled = !working || archiveInfoState !== 'ready' || !session || busy;
  element<HTMLInputElement>('archive-file').disabled = !session || busy || restoreUncertain;
  element<HTMLButtonElement>('archive-upload-cancel').hidden = !archiveUpload;
  element<HTMLButtonElement>('archive-recheck').disabled = !session || requestingJob || loading || saving || archiveChecking;
  element<HTMLButtonElement>('open-imported').hidden = !importedResult;
  element<HTMLButtonElement>('open-imported').disabled = !importedResult || busy;
  const result = element('archive-result'); result.hidden = !importedResult;
  if (importedResult) result.textContent = `Restored “${importedResult.title}” as a new library clip. Imported audio and processing claims — unverified. Your current editor is unchanged.`;
  const anchor = element<HTMLAnchorElement>('archive-download');
  const ready = working && archiveCaches.get(working.id) === working.revision;
  anchor.hidden = !ready || busy;
  if (ready && working) anchor.href = `/api/projects/${working.id}/archive`;
  else anchor.removeAttribute('href');
  const provenance = !working ? 'Choose a saved clip to back it up.'
    : archiveInfoState === 'loading' ? 'Checking saved clip provenance…'
      : archiveInfoState !== 'ready' || !archiveInfo ? 'Provenance unavailable. Check restore status to retry; editing and ordinary exports remain available.'
        : (archiveInfo.imported ? 'Imported audio and processing claims — unverified.' : 'Stored in this local library — not independently authenticated.')
          + (archiveInfo.processingSupplied ? ' Processing metadata supplied; claims are not independently verified.' : ' Processing metadata not supplied.');
  element('archive-status').textContent = `${provenance} Unsaved lyric edits are not included.`;
}
async function loadArchiveInfo(): Promise<void> {
  if (!working) return;
  const id = working.id, generation = loadedProjectGeneration, epoch = ++archiveInfoEpoch;
  const current = () => working?.id === id && loadedProjectGeneration === generation && archiveInfoEpoch === epoch;
  archiveInfoState = 'loading'; archiveControls();
  try {
    const info = await request<ArchiveInfo>(`/api/projects/${id}/archive-info`);
    if (!current()) return;
    archiveInfo = info; archiveInfoState = 'ready';
  } catch {
    if (!current()) return;
    archiveInfo = null; archiveInfoState = 'error';
  } finally { if (current()) archiveControls(); }
}
function archiveBusy(): boolean { return !!currentJob || requestingJob || loading || saving || archiveChecking; }
element('archive-backup').addEventListener('click', async () => {
  retirePractice('Backing up the clip stopped practice.');
  if (!working || !session || archiveInfoState !== 'ready' || archiveBusy()) return;
  retireSrt('Backing up the clip cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  rememberArchiveFocus(); timeline.cancelGesture();
  const id = working.id, revision = working.revision, generation = loadedProjectGeneration, operation = ++archiveOperation;
  requestingJob = true; controls();
  try {
    const { job } = await request<{ job: Job }>(`/api/projects/${id}/archive`, json('POST', { revision }));
    if (operation !== archiveOperation) return;
    if (working?.id !== id || loadedProjectGeneration !== generation) {
      message('The saved backup was accepted. Check restore status to monitor it; the current editor is unchanged.');
      return;
    }
    message('Backing up the saved revision. Unsent lyrics and timing fields are kept here and are not included.');
    startPolling(job, false, true, revision);
  } catch (error) {
    if (operation === archiveOperation) message(`Could not start the saved backup: ${error instanceof Error ? error.message : 'Connection lost.'} Your editor is unchanged. Check restore status before trying again if the connection was interrupted.`, true);
  } finally { if (operation === archiveOperation) { requestingJob = false; controls(); } }
});
element<HTMLInputElement>('archive-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file || !session || archiveBusy() || restoreUncertain) return;
  retireSrt('Importing an archive cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  const limit = Math.min(160 * 1024 ** 2, session.maxArchiveBytes);
  if (!Number.isFinite(limit) || file.size < 1 || file.size > limit) { message('Choose a nonempty Karaoke project archive no larger than 160 MiB.', true); return; }
  rememberArchiveFocus(); timeline.cancelGesture();
  const operation = ++archiveOperation, controller = new AbortController();
  archiveUpload = controller; requestingJob = true; controls();
  message('Uploading the project archive. The current editor and saved clips will not be replaced.');
  try {
    const { job } = await request<{ job: Job }>('/api/archives', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file, signal: controller.signal });
    if (operation !== archiveOperation) return;
    restoreUncertain = false;
    message('Archive uploaded. Checking its contents before adding a new saved clip.');
    startPolling(job, false, true);
  } catch (error) {
    if (operation !== archiveOperation) return;
    // A lost/aborted response can hide a server-accepted job. Never repeat it automatically.
    restoreUncertain = controller.signal.aborted || error instanceof TypeError;
    message(restoreUncertain
      ? 'Archive upload interrupted. It may have reached the studio. Check restore status and Saved clips before importing again. Your current editor is unchanged.'
      : `Archive import was not accepted: ${error instanceof Error ? error.message : 'Unknown response.'} Your current editor is unchanged.`, true);
  } finally {
    if (operation === archiveOperation) { archiveUpload = null; requestingJob = false; controls(); }
  }
});
element('archive-upload-cancel').addEventListener('click', () => archiveUpload?.abort());
element('open-imported').addEventListener('click', async () => {
  retirePractice('Opening an imported clip stopped practice.');
  if (!importedResult || archiveBusy()) return;
  retireSrt('Opening an imported clip cancelled the lyric import review.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  if (!mayLeave()) return;
  const id = importedResult.id;
  try { await openProject(id); message('Opened the restored clip. Imported audio and processing claims remain unverified.'); }
  catch (error) { message(error instanceof Error ? error.message : 'Could not open the restored clip. Your previous editor is still here.', true); }
});
element('archive-recheck').addEventListener('click', async () => {
  retirePractice('Checking studio jobs stopped practice.');
  retireTiming('Checking studio jobs cancelled the timing session. Staged times were not applied.');
  if (!session || requestingJob || loading || saving || archiveChecking) return;
  rememberArchiveFocus();
  const operation = ++archiveOperation, generation = projectGeneration;
  const current = () => archiveOperation === operation && projectGeneration === generation;
  archiveChecking = true; controls();
  try {
    const state = await request<Session>('/api/session');
    if (!current()) return;
    session = state;
    if (!await refreshProjects(current)) return;
    if (!current()) return;
    await loadArchiveInfo();
    if (!current()) return;
    if (completedImportId) {
      const restored = projects.find(project => project.id === completedImportId);
      if (restored) { importedResult = { id: restored.id, title: restored.title }; completedImportId = null; }
    }
    restoreUncertain = false;
    if (state.activeJob) {
      if (!currentJob) startPolling(state.activeJob, false, false);
      else if (currentJob.id === state.activeJob.id) void pollJob(currentJob.id);
      message('The studio has active work. Its progress is shown without taking ownership or repeating an import. Your editor is unchanged.');
    } else message('Saved clips refreshed. No active studio job was reported. Check the library for any completed restore; no upload was repeated.');
  } catch (error) { if (current()) message(`Could not check restore status: ${error instanceof Error ? error.message : 'Connection lost.'} Your editor is unchanged.`, true); }
  finally { if (archiveOperation === operation) { archiveChecking = false; controls(); } }
});

async function refresh() {
  retirePractice('Refreshing clips stopped practice.');
  try {
    session = await request<Session>('/api/session');
    element('upload-limits').textContent = `1–${session.maxDuration} seconds · up to ${session.maxUploadBytes / 1024 / 1024} MiB`;
    element('lyric-limits').textContent = `Up to ${session.maxCues} cues · 240 characters per cue · ${session.maxLyricChars.toLocaleString('en-US')} lyric characters. Unicode characters count once; pasted whitespace also counts.`;
    element('model-state').textContent = session.modelReady ? 'Local CPU model ready' : 'Local model setup needed';
    element('model-help').hidden = session.modelReady;
    await refreshProjects(); controls();
    if (session.activeJob && (!currentJob || currentJob.id === session.activeJob.id)) startPolling(session.activeJob, false, false);
    else if (!working) {
      const requested = new URL(location.href).searchParams.get('project');
      if (requested && projects.some(project => project.id === requested)) await openProject(requested);
    }
  } catch (error) { message(`Local studio unavailable: ${error instanceof Error ? error.message : 'Start the Python service, then refresh.'}`, true); }
}
interface TimingOwner {
  epoch: number; projectId: string; project: number; edit: number; media: number;
  track: string; source: string; duration: number; floor: number; capture: TimingCapture;
}
let timingEpoch = 0;
let timingOwner: TimingOwner | null = null;
let timingWaiting = false;
const timingHeldKeys = new Set<string>(), timingBlockedKeys = new Set<string>();
function timingBusy(): boolean { return !!currentJob || loading || requestingJob || saving || archiveChecking; }
function timingIdentity(owner: TimingOwner): boolean {
  return timingOwner === owner && timingEpoch === owner.epoch && working?.id === owner.projectId
    && loadedProjectGeneration === owner.project && editGeneration === owner.edit && mediaGeneration === owner.media
    && currentTrack === owner.track && working.duration === owner.duration;
}
function timingPositionValid(owner: TimingOwner): boolean {
  const time = audio.currentTime;
  return Number.isFinite(time) && time >= 0 && (time <= owner.duration
    || audio.ended && time === audio.duration && Math.abs(audio.duration - owner.duration) <= 1 / 44100);
}
function timingMediaError(owner: TimingOwner, availability = true, position = true): string {
  if (!timingIdentity(owner)) return 'The clip, track or editor changed.';
  if (document.hidden) return 'The page became hidden.';
  if (audio.src !== owner.source || audio.currentSrc !== owner.source) return 'The playback source changed or is not loaded.';
  if (audio.error) return 'The audio could not be played.';
  if (availability && audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return 'Wait for loaded audio, then continue listening.';
  if (!Number.isFinite(audio.duration) || Math.abs(audio.duration - owner.duration) > 1 / 44100) return 'The loaded audio duration does not match this clip.';
  if (audio.seeking) return 'Seeking cancelled these staged timings.';
  if (audio.loop || audio.playbackRate !== 1) return 'Use normal 1× playback without looping, then begin again.';
  const validTime = timingPositionValid(owner);
  if (position && !validTime) return 'The playback position is unavailable or outside this clip.';
  if (validTime && audio.currentTime < owner.floor) return 'Playback moved backward. Position the player, then begin again.';
  return '';
}
function timingText(id: string, text: string): void { if (element(id).textContent !== text) element(id).textContent = text; }
function blockTimingKeys(): void { for (const key of timingHeldKeys) timingBlockedKeys.add(key); timingHeldKeys.clear(); }
function retireTiming(text = 'Timing session cancelled. Staged times were not applied.'): void {
  if (!timingOwner) return;
  blockTimingKeys(); timingOwner.capture.cancel(); timingOwner = null; timingEpoch++;
  element('timing-review').hidden = true; element('timing-review-list').replaceChildren();
  timingText('timing-line', ''); timingText('timing-status', text); controls();
}
function timingControls(): void {
  const owner = timingOwner, state = owner?.capture.state, busy = timingBusy();
  element<HTMLButtonElement>('timing-begin').disabled = !working || !lyricHistory || busy || !!owner;
  element<HTMLButtonElement>('timing-cancel').disabled = !owner; element('timing-cancel').hidden = !owner;
  const mark = element<HTMLButtonElement>('timing-mark');
  mark.hidden = !state || state.phase === 'review';
  mark.disabled = !owner || busy || !!timingMediaError(owner) || audio.paused || audio.ended || timingWaiting;
  if (state) timingText('timing-mark', state.phase === 'end' ? 'Mark line end' : 'Mark line start');
  const final = !!owner && state?.phase === 'end' && state.lineIndex === state.texts.length - 1 && audio.ended && !timingMediaError(owner);
  element('timing-end-final').hidden = !final; element<HTMLButtonElement>('timing-end-final').disabled = !final || busy;
  element<HTMLButtonElement>('timing-apply').disabled = !owner || state?.phase !== 'review' || busy || !!timingMediaError(owner);
  if (!owner || !state || state.phase === 'review') return;
  timingText('timing-line', `Line ${state.lineIndex + 1} of ${state.texts.length}\n${state.texts[state.lineIndex]}`);
  let text: string;
  if (audio.ended) text = final ? 'Playback ended with the final line open. Choose End final line at clip end deliberately, or Cancel.' : `Playback ended with ${state.texts.length - state.completed.length} lines unfinished. Nothing was applied. Cancel and begin again after positioning the player.`;
  else if (timingWaiting) text = 'Waiting for audio. Resume listening when playback is ready; no boundary is marked automatically.';
  else if (audio.paused) text = 'Paused. Resume playback to continue; your pending start and completed lines are kept.';
  else text = `Listening · ${state.completed.length}/${state.texts.length} lines completed. ${state.phase === 'start' ? 'Mark the next line’s start when you hear it.' : 'Mark this line’s end; leave gaps by waiting before the next start.'}`;
  timingText('timing-status', text);
}
function observeTiming(): void {
  const owner = timingOwner; if (!owner) { timingControls(); return; }
  const error = timingMediaError(owner, false, false);
  if (error) { retireTiming(`${error} Staged times were not applied; begin a new session when ready.`); return; }
  if (timingPositionValid(owner)) owner.floor = audio.currentTime;
  timingControls();
}
function reviewTiming(owner: TimingOwner): void {
  const cues = owner.capture.review(), list = element('timing-review-list'); list.replaceChildren();
  for (const [index, cue] of cues.entries()) {
    const row = document.createElement('li'); row.dataset.timingCue = String(index);
    const times = document.createElement('strong'); times.textContent = `${index + 1}. ${cue.start} → ${cue.end} seconds · gap before ${cue.start - (index ? cues[index - 1].end : 0)} seconds`;
    const text = document.createElement('pre'); text.textContent = cue.text; row.append(times, text); list.append(row);
  }
  timingText('timing-summary', `${cues.length} captured intervals for ${working!.cues.length} current lines. First start ${cues[0].start}s; final end ${cues.at(-1)!.end}s. Title and pasted words stay unchanged; Apply changes cues once, then Save lyrics separately.`);
  timingText('timing-line', 'All supplied lines are timed. Review every interval and instrumental gap.');
  element('timing-review').hidden = false; blockTimingKeys(); audio.pause();
  timingText('timing-status', 'Complete timing review — not applied or saved. Review all lines, then Apply captured timings or Cancel.');
  timingControls();
}
function markTiming(final = false): void {
  const owner = timingOwner; if (!owner || timingBusy()) return;
  const fatal = timingMediaError(owner, false, false);
  if (fatal) { retireTiming(`${fatal} Staged times were not applied.`); return; }
  const error = timingMediaError(owner);
  if (error) { timingControls(); timingText('timing-status', `${error} Your pending start and completed lines are kept.`); return; }
  const state = owner.capture.state;
  if (final) {
    if (!audio.ended || state.phase !== 'end' || state.lineIndex !== state.texts.length - 1) return;
  } else if (audio.paused || audio.ended || timingWaiting) { timingControls(); return; }
  const time = final ? owner.duration : audio.currentTime; owner.floor = audio.currentTime;
  try {
    if (state.phase === 'start') owner.capture.markStart(time);
    else if (state.phase === 'end') owner.capture.markEnd(time);
    else return;
    if (owner.capture.state.phase === 'review') reviewTiming(owner); else timingControls();
  } catch (error) { timingControls(); timingText('timing-status', `${error instanceof Error ? error.message : 'This boundary is not valid.'} Your pending start and completed lines are kept.`); }
}
for (const id of ['timing-begin', 'timing-apply', 'timing-cancel']) element(id).addEventListener('pointerdown', event => {
  if (event.isPrimary && event.button === 0) event.preventDefault();
});
element('timing-begin').addEventListener('click', () => {
  retirePractice('Beginning a timing session stopped practice.');
  if (!working || !lyricHistory || timingBusy() || timingOwner) return;
  const source = new URL(`/api/projects/${working.id}/audio/${currentTrack}`, location.href).href;
  const owner: TimingOwner = { epoch: ++timingEpoch, projectId: working.id, project: loadedProjectGeneration, edit: editGeneration,
    media: mediaGeneration, track: currentTrack, source, duration: working.duration, floor: audio.currentTime, capture: null! };
  // Build only transient state; invalid old numeric cue fields are independent.
  try { owner.capture = new TimingCapture(working.cues, working.duration); }
  catch (error) { timingText('timing-status', `${error instanceof Error ? error.message : 'Supply valid lyric lines first.'} Current editor values are kept.`); return; }
  timingOwner = owner;
  const error = timingMediaError(owner);
  if (error || audio.ended || audio.currentTime >= owner.duration) {
    timingOwner = null; owner.capture.cancel(); timingText('timing-status', `${error || 'Position the player before clip end.'} Play or load Original, Vocals or Backing, then begin. Current editor values are kept.`); timingControls(); return;
  }
  timeline.cancelGesture(); retireSrt('Beginning timing cancelled the SRT review. Current lyrics are unchanged.');
  timingText('timing-summary', ''); element('timing-review').hidden = true;
  timingText('timing-status', 'Timing only the existing lyric lines. Unapplied pasted words are kept and are not included.');
  controls(); if (!element<HTMLButtonElement>('timing-mark').disabled) element('timing-mark').focus({ preventScroll: true });
});
app.addEventListener('input', event => {
  const node = event.target;
  if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
      && (node.id === 'title' || node.id === 'lyric-draft' || element('cue-list').contains(node))) {
    retirePractice('The lyric editor changed. Practice stopped.');
    retireTiming('The lyric editor changed. Staged times were not applied.');
  }
}, true);
app.addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement && ['srt-file', 'audio-file', 'archive-file'].includes(event.target.id))
    retirePractice('Choosing a file stopped practice.');
}, true);
element('timing-mark').addEventListener('click', () => markTiming());
element('timing-end-final').addEventListener('click', () => markTiming(true));
element('timing-cancel').addEventListener('click', () => retireTiming());
const timingKey = (event: KeyboardEvent): string | null => event.key === 'Enter' ? 'Enter' : event.key === ' ' ? 'Space' : null;
element('timing-mark').addEventListener('keydown', event => {
  const key = timingKey(event); if (!key) return;
  event.preventDefault();
  if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    || timingHeldKeys.has(key) || timingBlockedKeys.has(key)) return;
  timingHeldKeys.add(key); markTiming();
});
element('timing-mark').addEventListener('keyup', event => { if (timingKey(event)) event.preventDefault(); });
element('timing-mark').addEventListener('blur', blockTimingKeys);
window.addEventListener('keyup', event => { const key = timingKey(event); if (key) { timingHeldKeys.delete(key); timingBlockedKeys.delete(key); } });
window.addEventListener('blur', blockTimingKeys);
element('timing-apply').addEventListener('click', () => {
  const owner = timingOwner; if (!owner || owner.capture.state.phase !== 'review' || timingBusy() || !working || !lyricHistory) return;
  try {
    const cues = owner.capture.review(); validateCues(cues, owner.duration);
    if (session && (owner.duration > session.maxDuration || cues.length > session.maxCues || cues.reduce((sum, cue) => sum + Array.from(cue.text).length, 0) > session.maxLyricChars)) throw Error('The captured lyrics exceed the connected studio’s limits.');
    const same = cues.length === working.cues.length && cues.every((cue, index) => cue.text === working!.cues[index].text && Object.is(cue.start, working!.cues[index].start) && Object.is(cue.end, working!.cues[index].end));
    const before = draftSnapshot();
    const error = timingMediaError(owner); // Native state may change before queued events.
    if (error) {
      if (timingMediaError(owner, false, false)) retireTiming(`${error} Captured timings were not applied.`);
      else { timingControls(); timingText('timing-status', `${error} The complete review is kept; captured timings were not applied.`); }
      return;
    }
    owner.floor = audio.currentTime;
    if (same) { retireTiming('The captured timings already match. No edit or save was made; exact editor values and Redo are kept.'); return; }
    lyricHistory.record(before); lyricHistory.endGroup();
    retireTiming('Captured timings applied in memory. Title and pasted words were kept; Save lyrics when ready.');
    working.cues = cues; renderCues(); changed();
    message(draftDirty ? 'Captured timings applied as one edit. Your unapplied pasted words are kept; resolve that paste before saving.' : 'Captured timings applied as one edit. Review them, then use Save lyrics.');
  } catch (error) { timingText('timing-status', `${error instanceof Error ? error.message : 'Could not apply these timings.'} Current lyrics and editor values are kept.`); }
});
for (const event of ['timeupdate', 'pause', 'play', 'playing', 'canplay', 'ended']) audio.addEventListener(event, observeTiming);
audio.addEventListener('waiting', () => { timingWaiting = true; observeTiming(); });
audio.addEventListener('playing', () => { timingWaiting = false; observeTiming(); });
for (const event of ['seeking', 'emptied', 'error', 'ratechange', 'loadedmetadata']) audio.addEventListener(event, () => retireTiming('Playback changed. Staged times were not applied; position the player and begin again.'));
document.addEventListener('visibilitychange', () => { if (document.hidden) { blockTimingKeys(); retireTiming('The page became hidden. Staged times were not applied.'); } });

element('refresh').addEventListener('click', () => { retireTiming('Refreshing clips cancelled the timing session. Staged times were not applied.'); void refresh(); });
window.addEventListener('beforeunload', event => { if (dirty || draftDirty || requestingJob || (currentJob && ownedJob)) { event.preventDefault(); event.returnValue = ''; } });
controls(); draw(); void refresh();

window.addEventListener('pagehide', event => {
  retireSrt('The page was suspended. Choose the SRT file again to review it.');
  retireTiming('Other editor or studio work cancelled the timing session. Staged times were not applied.');
  archiveFocus = null;
  mediaGeneration++; audio.pause();
  if (event.persisted) timeline.stopWaveform(); else timeline.destroy();
});
window.addEventListener('pageshow', event => { if (event.persisted) { controls(); draw(); } });
