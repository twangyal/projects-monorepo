import './style.css';
import { activeCue, draftCues, formatTime, validateCues, type Project } from './lyrics.ts';

interface Job { id: string; projectId: string; kind: 'separate' | 'export'; status: 'running' | 'complete' | 'failed' | 'cancelled'; stage: string; error?: string; resultUrl?: string }
interface Session { token: string; modelReady: boolean; maxDuration: number; maxProjects: number; activeJob?: Job | null }
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <a class="skip" href="#workspace">Skip to workspace</a>
  <header><div class="brand"><span aria-hidden="true">♫</span><div><h1>Karaoke Studio</h1><p>Your chorus. Your stage.</p></div></div><div class="session"><span class="dot"></span><span id="model-state">Connecting to local studio…</span><button id="refresh" class="quiet">Refresh projects</button></div></header>
  <main id="workspace"><div class="intro"><div><p class="eyebrow">FROM SONG CLIP TO SING-ALONG</p><h2>Give your favorite verse the spotlight.</h2><p>Separate the backing, cue your words, and take the stage.</p></div><span class="privacy">LOCAL PROCESSING<br><small>No account. No song uploads to a service.</small></span></div>
    <div id="message" role="status" aria-live="polite" hidden></div>
    <div id="job-panel" role="status" hidden><div class="job-copy"><span class="spinner" aria-hidden="true"></span><div><strong id="job-title"></strong><p id="job-stage"></p></div></div><button id="cancel-job">Cancel job</button></div>
    <div class="workspace-grid">
      <aside class="song-panel panel"><div class="panel-title"><span class="step">01</span><h3>Your song clip</h3></div>
        <label class="upload-zone"><span class="upload-icon" aria-hidden="true">↑</span><strong>Choose an audio clip</strong><span>WAV, MP3, FLAC or Ogg<br>1–30 seconds · up to 20 MiB</span><input id="audio-file" type="file" accept=".wav,.mp3,.flac,.ogg,audio/wav,audio/mpeg,audio/flac,audio/ogg" aria-label="Upload song clip" disabled></label>
        <p id="model-help" class="model-help" hidden>Install the local separation model first. From the app directory, run <code>python scripts/setup_model.py --help</code> and follow the README setup steps, then refresh.</p>
        <p class="fine">The model estimates vocals and backing locally. Listen for remaining vocals or altered instruments before exporting.</p>
        <div class="divider"></div><label class="field">Saved clips<select id="projects"><option value="">Choose a saved clip</option></select></label><p id="library-count" class="fine">Projects are saved in your local studio folder.</p>
        <div id="clip-details" hidden><label class="field">Clip title<input id="title" maxlength="100" type="text"></label><div class="clip-meta"><span id="duration">0:00</span><span>44.1 kHz · stereo</span></div><button id="backing-download" class="full">Download backing WAV <span aria-hidden="true">↓</span></button></div>
        <button id="delete-project" class="text-button full" disabled>Delete selected clip</button><div class="local-note"><strong>A small clip, a complete idea.</strong><p>Trim a favorite verse to 30 seconds before importing. This first version focuses on short, local karaoke clips.</p></div>
      </aside>
      <section class="stage-panel panel" aria-labelledby="stage-heading"><div class="panel-title"><span class="step">02</span><h3 id="stage-heading">Listen & preview</h3><span class="small-tag">LIVE LYRIC PREVIEW</span></div>
        <div class="stage-wrap"><canvas id="stage" width="1280" height="720" role="img" aria-label="Karaoke lyric preview"></canvas><p id="current-line" class="sr-only" aria-live="polite">Instrumental break</p></div>
        <div class="transport"><div class="track-picker" aria-label="Audition track"><button data-track="original" aria-pressed="false">Original</button><button data-track="vocals" aria-pressed="false">Vocals</button><button data-track="backing" aria-pressed="true">Backing</button></div><span id="clock">0:00.00 / 0:00.00</span></div>
        <audio id="audio" controls preload="metadata" aria-label="Clip playback"></audio><p class="fine playback-tip">Play the backing and use “Mark start” or “Mark end” to place a line at the current playback time.</p>
        <div class="export-row"><div><strong>Ready for a sing-along?</strong><p id="save-state">Choose a clip to begin.</p></div><button id="save" class="quiet" disabled>Save lyrics</button><button id="export-video" class="primary" disabled>Export karaoke MP4</button></div>
        <div class="secondary-exports"><button id="lyrics-download" class="text-button" disabled>Export timed lyrics</button><button id="video-download" class="text-button" hidden>Download MP4 again</button><span>1280 × 720 · 24 fps · estimated backing</span></div>
      </section>
      <section class="lyrics-panel panel" aria-labelledby="lyrics-heading"><div class="panel-title"><span class="step">03</span><h3 id="lyrics-heading">Make room for the words</h3><span class="small-tag">YOUR LYRICS, YOUR TIMING</span></div>
        <div class="lyric-intro"><label class="field">Paste lyrics, one line per cue<textarea id="lyric-draft" rows="4" maxlength="5000" placeholder="The opening line…&#10;And the next one…" disabled></textarea></label><div><button id="draft-timings" disabled>Create draft timings</button><button id="discard-draft" class="text-button" hidden>Discard pasted draft</button><p class="fine">Even spacing is a starting point. Listen and correct each line; lyrics are not recognized or aligned automatically.</p></div></div>
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

function message(text: string, error = false) {
  const node = element('message'); node.textContent = text; node.hidden = !text; node.classList.toggle('error', error);
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== 'GET' && session) headers.set('X-Karaoke-Token', session.token);
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `Local studio request failed (${response.status}).`);
  return value as T;
}
function json(method: string, body: unknown): RequestInit { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

function validateWorking(): string {
  if (!working) return '';
  try {
    if (!working.title.trim() || working.title.length > 100) throw new Error('Enter a clip title of 1–100 characters.');
    validateCues(working.cues, working.duration);
    return '';
  } catch (error) { return error instanceof Error ? error.message : 'Check the lyric timing.'; }
}
function controls() {
  const busy = currentJob !== null || loading || requestingJob, invalid = validateWorking();
  element<HTMLInputElement>('audio-file').disabled = !session?.modelReady || busy || saving;
  element<HTMLSelectElement>('projects').disabled = busy || saving;
  element<HTMLButtonElement>('save').disabled = !working || !dirty || draftDirty || !!invalid || busy || saving;
  element<HTMLButtonElement>('export-video').disabled = !working?.cues.length || dirty || draftDirty || !!invalid || busy || saving;
  element<HTMLButtonElement>('lyrics-download').disabled = !working?.cues.length || dirty || draftDirty || !!invalid || busy || saving;
  element<HTMLButtonElement>('backing-download').disabled = !working;
  element<HTMLButtonElement>('delete-project').disabled = !working || busy || saving;
  element<HTMLButtonElement>('draft-timings').disabled = !working || busy || saving;
  element<HTMLTextAreaElement>('lyric-draft').disabled = !working || busy || saving;
  element<HTMLInputElement>('title').disabled = busy || saving;
  element<HTMLButtonElement>('refresh').disabled = loading || saving || requestingJob;
  element<HTMLButtonElement>('discard-draft').disabled = busy || saving;
  element('discard-draft').hidden = !draftDirty;
  for (const control of element('cue-list').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = busy || saving;
  for (const control of document.querySelectorAll<HTMLButtonElement>('[data-track]')) control.disabled = !working;
  element('cue-validation').textContent = invalid;
  element('save-state').textContent = saving ? 'Saving lyrics…' : draftDirty ? 'Unsaved pasted words — create draft timings or discard the paste.' : working ? dirty ? 'Unsaved lyric edits — save before exporting.' : 'Saved in your local studio.' : 'Choose a clip to begin.';
  element('video-download').hidden = !videoUrl || dirty || draftDirty || busy;
}
function changed() { dirty = true; videoUrl = null; controls(); draw(); }

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
  context.fillStyle = '#14232f'; context.fillRect(0, 0, 1280, 720);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  drawBlock((working?.title || 'Your next sing-along starts here').replace(/\s+/g, ' ').trim(), 80, 32, 22, 100, '#f7f5ed');
  const time = audio.currentTime || 0, index = working ? activeCue(working.cues, time) : -1;
  const current = index >= 0 ? working!.cues[index].text : 'Instrumental break';
  const upcoming = working?.cues.find(cue => cue.start > time);
  drawBlock(current, 320, 44, 24, 300, index >= 0 ? '#e4b77d' : '#f7f5ed');
  if (upcoming) drawBlock(`Next: ${upcoming.text}`, 540, 26, 18, 80, '#9dafbb');
  context.font = '20px KaraokeSans'; context.fillStyle = '#9dafbb'; context.fillText('Karaoke Studio · Backing track', 640, 660);
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
  const position = audio.currentTime || 0, playing = !audio.paused;
  currentTrack = kind;
  audio.pause(); audio.src = `/api/projects/${working.id}/audio/${kind}`;
  audio.onloadedmetadata = () => {
    audio.currentTime = Math.min(position, working?.duration || 0);
    if (playing) void audio.play().catch(() => message('Press play to continue listening.'));
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-track]')) button.setAttribute('aria-pressed', String(button.dataset.track === kind));
  audio.load(); draw();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-track]')) button.addEventListener('click', () => track(button.dataset.track!));

function cueInput(label: string, value: string, type: string, onInput: (value: string) => void): HTMLLabelElement {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const control = document.createElement('input'); control.type = type; control.value = value;
  if (type === 'number') { control.min = '0'; control.max = String(working!.duration); control.step = 'any'; }
  else control.maxLength = 240;
  control.addEventListener('input', () => { onInput(control.value); changed(); });
  wrapper.append(control); return wrapper;
}
function renderCues() {
  const list = element('cue-list'); list.replaceChildren();
  if (!working?.cues.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Paste your words above, then create draft timings to begin.'; list.append(empty); return; }
  for (const [index, cue] of working.cues.entries()) {
    const row = document.createElement('div'); row.className = 'cue'; row.dataset.cue = String(index);
    const number = document.createElement('span'); number.className = 'cue-number'; number.textContent = String(index + 1).padStart(2, '0'); row.append(number);
    const text = cueInput(`Lyric line ${index + 1}`, cue.text, 'text', value => { cue.text = value; }); text.className = 'cue-text'; row.append(text);
    const start = cueInput(`Start line ${index + 1}`, String(Number(cue.start.toFixed(3))), 'number', value => { cue.start = value === '' ? NaN : Number(value); }); row.append(start);
    const end = cueInput(`End line ${index + 1}`, String(Number(cue.end.toFixed(3))), 'number', value => { cue.end = value === '' ? NaN : Number(value); }); row.append(end);
    const actions = document.createElement('div'); actions.className = 'cue-actions';
    for (const [label, action] of [
      ['Mark start', () => { cue.start = Math.round(audio.currentTime * 1000) / 1000; renderCues(); changed(); }],
      ['Mark end', () => { cue.end = Math.min(working!.duration, Math.round(audio.currentTime * 1000) / 1000); renderCues(); changed(); }],
      ['Play line', () => { if (Number.isFinite(cue.start)) { audio.currentTime = cue.start; void audio.play().catch(() => message('Press play in the audio controls.')); } }],
      ['Remove', () => { working!.cues.splice(index, 1); renderCues(); changed(); }],
    ] as const) {
      const button = document.createElement('button'); button.className = 'text-button'; button.textContent = label;
      button.setAttribute('aria-label', `${label} line ${index + 1}`); button.addEventListener('click', action); actions.append(button);
    }
    row.append(actions); list.append(row);
  }
  controls(); draw();
}

async function refreshProjects() {
  const result = await request<{ projects: Project[] }>('/api/projects'); projects = result.projects;
  const select = element<HTMLSelectElement>('projects'); select.replaceChildren(new Option('Choose a saved clip', ''));
  for (const project of projects) select.append(new Option(project.title, project.id));
  select.value = working?.id || '';
  element('library-count').textContent = `${projects.length} of ${session?.maxProjects || 20} local clip slots used.`;
}
async function openProject(id: string) {
  const generation = ++projectGeneration;
  loading = true; controls();
  try {
  const project = await request<Project>(`/api/projects/${encodeURIComponent(id)}`);
  if (generation !== projectGeneration) return;
  audio.pause(); audio.removeAttribute('src'); audio.load();
  working = structuredClone(project); dirty = false; draftDirty = false; videoUrl = null;
  element<HTMLInputElement>('title').value = project.title;
  element<HTMLSelectElement>('projects').value = project.id;
  element('duration').textContent = formatTime(project.duration);
  element('clip-details').hidden = false;
  element<HTMLTextAreaElement>('lyric-draft').value = project.cues.map(cue => cue.text).join('\n');
  history.replaceState(null, '', `?project=${project.id}`);
  renderCues(); controls(); track(currentTrack);
  } finally { if (generation === projectGeneration) { loading = false; controls(); } }
}
function mayLeave(): boolean { return !(dirty || draftDirty) || window.confirm('Discard unsaved lyric edits and open a different clip?'); }
element<HTMLSelectElement>('projects').addEventListener('change', async event => {
  const select = event.target as HTMLSelectElement;
  if (!select.value || !mayLeave()) { select.value = working?.id || ''; return; }
  try { await openProject(select.value); message(''); } catch (error) { message(String(error instanceof Error ? error.message : error), true); }
});
element<HTMLInputElement>('title').addEventListener('input', event => { if (working) { working.title = (event.target as HTMLInputElement).value; changed(); } });
element<HTMLTextAreaElement>('lyric-draft').addEventListener('input', event => {
  draftDirty = (event.target as HTMLTextAreaElement).value !== (working?.cues.map(cue => cue.text).join('\n') || ''); controls();
});
element('discard-draft').addEventListener('click', () => {
  element<HTMLTextAreaElement>('lyric-draft').value = working?.cues.map(cue => cue.text).join('\n') || '';
  draftDirty = false; controls();
});
element('draft-timings').addEventListener('click', () => {
  if (!working) return;
  try { working.cues = draftCues(element<HTMLTextAreaElement>('lyric-draft').value, working.duration); draftDirty = false; renderCues(); changed(); message('Draft timings are evenly spaced. Listen and adjust each line before saving.'); }
  catch (error) { message(error instanceof Error ? error.message : 'Could not create draft timings.', true); }
});
element('save').addEventListener('click', async () => {
  if (!working || saving || draftDirty || validateWorking()) return;
  saving = true; controls();
  try {
    working = await request<Project>(`/api/projects/${working.id}`, json('PUT', { title: working.title, cues: working.cues, revision: working.revision }));
    dirty = false; videoUrl = null; await refreshProjects(); renderCues(); message('Lyrics and timing saved locally.');
  } catch (error) { message(error instanceof Error ? error.message : 'Could not save. Your edits are still here.', true); }
  finally { saving = false; controls(); }
});

function download(url: string, suffix: string) {
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `${working?.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'karaoke'}${suffix}`; anchor.click();
}
element('backing-download').addEventListener('click', () => { if (working) download(`/api/projects/${working.id}/audio/backing`, '-backing.wav'); });
element('lyrics-download').addEventListener('click', () => { if (working && !dirty) download(`/api/projects/${working.id}/lyrics`, '.srt'); });
element('video-download').addEventListener('click', () => { if (videoUrl) download(videoUrl, '.mp4'); });
element('delete-project').addEventListener('click', async () => {
  if (!working || currentJob || saving || loading) return;
  if (!window.confirm(`Delete “${working.title}” and its audio, lyrics, and video from this local library? This cannot be undone.`)) return;
  saving = true; controls();
  try {
    await request(`/api/projects/${working.id}`, json('DELETE', {}));
    ++projectGeneration; audio.pause(); audio.removeAttribute('src'); audio.load();
    working = null; dirty = false; draftDirty = false; videoUrl = null;
    element('clip-details').hidden = true; element<HTMLInputElement>('title').value = '';
    element<HTMLTextAreaElement>('lyric-draft').value = ''; history.replaceState(null, '', location.pathname);
    renderCues(); draw(); await refreshProjects(); message('The selected clip was deleted. Other saved clips are unchanged.');
  } catch (error) { message(error instanceof Error ? error.message : 'Could not delete the selected clip.', true); }
  finally { saving = false; controls(); }
});

function showJob(job: Job | null) {
  currentJob = job; element('job-panel').hidden = !job;
  if (job) { element('job-title').textContent = job.kind === 'separate' ? 'Making space for your voice' : 'Preparing your karaoke video'; element('job-stage').textContent = job.stage; }
  controls();
}
async function pollJob(id: string) {
  let terminal = false;
  try {
    const { job } = await request<{ job: Job }>(`/api/jobs/${id}`);
    if (currentJob?.id !== id) return;
    if (job.status === 'running') { showJob(job); pollTimer = setTimeout(() => void pollJob(id), 600); return; }
    terminal = true;
    if (job.status === 'complete') {
      await refreshProjects();
      if (job.kind === 'separate') {
        if (followJobProject || (!(dirty || draftDirty) && !working)) {
          await openProject(job.projectId); message('Your stems are ready. Audition the estimates, then add and time your lyrics.');
        } else message('Your stems are ready in Saved clips. Your current lyric edits are still here.');
      } else if (job.resultUrl && working?.id === job.projectId) { videoUrl = job.resultUrl; download(videoUrl, '.mp4'); message('Karaoke MP4 ready. Your saved lyric timings are included.'); }
      else message('Karaoke MP4 ready. Open its saved clip to export or download it.');
    } else message(job.status === 'cancelled' ? 'Job cancelled. Completed clips are unchanged.' : job.error || 'The local media job failed.', job.status === 'failed');
    showJob(null);
  } catch (error) {
    if (currentJob?.id !== id) return;
    if (terminal) { showJob(null); message(`The job finished, but its project could not be loaded. Refresh projects to retry: ${error instanceof Error ? error.message : 'Connection lost.'}`, true); return; }
    message(`Cannot reach the job yet: ${error instanceof Error ? error.message : 'Connection lost.'} Retrying…`, true);
    pollTimer = setTimeout(() => void pollJob(id), 2000);
  }
}
function startPolling(job: Job, follow = true) { if (currentJob?.id !== job.id) followJobProject = follow; clearTimeout(pollTimer); showJob(job); void pollJob(job.id); }
element<HTMLInputElement>('audio-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file || currentJob || requestingJob || !mayLeave()) return;
  if (file.size < 1 || file.size > 20 * 1024 * 1024) { message('Choose a nonempty song clip no larger than 20 MiB.', true); return; }
  requestingJob = true; controls();
  try {
    const result = await request<{ job: Job }>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Name': encodeURIComponent(file.name) }, body: file });
    message(''); startPolling(result.job);
  } catch (error) { message(error instanceof Error ? error.message : 'Could not import this clip.', true); controls(); }
  finally { requestingJob = false; controls(); }
});
element('cancel-job').addEventListener('click', async () => {
  if (!currentJob) return;
  try { await request(`/api/jobs/${currentJob.id}/cancel`, json('POST', {})); if (currentJob) void pollJob(currentJob.id); }
  catch (error) { message(error instanceof Error ? error.message : 'Could not cancel this job.', true); }
});
element('export-video').addEventListener('click', async () => {
  if (!working || dirty || draftDirty || currentJob || requestingJob) return;
  requestingJob = true; controls();
  try { const { job } = await request<{ job: Job }>(`/api/projects/${working.id}/export`, json('POST', {})); message(''); startPolling(job); }
  catch (error) { message(error instanceof Error ? error.message : 'Could not export video.', true); }
  finally { requestingJob = false; controls(); }
});
async function refresh() {
  try {
    session = await request<Session>('/api/session');
    element('model-state').textContent = session.modelReady ? 'Local CPU model ready' : 'Local model setup needed';
    element('model-help').hidden = session.modelReady;
    await refreshProjects(); controls();
    if (session.activeJob) startPolling(session.activeJob, false);
    else if (!working) {
      const requested = new URL(location.href).searchParams.get('project');
      if (requested && projects.some(project => project.id === requested)) await openProject(requested);
    }
  } catch (error) { message(`Local studio unavailable: ${error instanceof Error ? error.message : 'Start the Python service, then refresh.'}`, true); }
}
element('refresh').addEventListener('click', () => void refresh());
window.addEventListener('beforeunload', event => { if (dirty || draftDirty) { event.preventDefault(); event.returnValue = ''; } });
controls(); draw(); void refresh();
