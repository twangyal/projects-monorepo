import './style.css';
import { AudioSync, clockOffset, estimatedPosition, type Playback, type Track } from './sync.ts';

type Role = 'host' | 'guest';
interface Job { id: string; roomId: string; trackId: string; uploadedBy: Role; status: 'running' | 'complete' | 'failed' | 'cancelled'; stage: string; error?: string }
interface Memory { id: string; trackId: string; trackTitle: string; date: string; text: string; author: Role; createdAt: number }
interface Blend { trackId: string; category: string; reason: string }
interface Room { id: string; title: string; createdAt: number; profiles: { host: { name: string }; guest: { name: string } | null }; myRole: Role; serverTime: number; tracks: Track[]; ratings: Record<string, { host: number; guest: number }>; blend: Blend[]; playlist: string[]; playlistRevision: number; playback: Playback; memories: Memory[]; activeJob?: Job | null }
interface Credentials { roomId: string; token: string }
interface Created extends Credentials { inviteToken?: string; room: Room }
interface Transport { mode: 'https-lan' | 'http-loopback'; origin: string; setupRequired: boolean }
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<a class="skip" href="#room-main">Skip to your room</a><header><a class="brand" href="/"><span class="logo" aria-hidden="true">d.</span><div><h1>duet</h1><p>A little more us.</p></div></a><div class="header-note"><span class="status-dot"></span><span id="connection">Your songs. Your space.</span></div></header>
<main><div id="notice" role="status" aria-live="polite" hidden></div><div class="transport-info"><p id="transport-status" aria-live="polite">Checking this service’s connection mode…</p><button id="retry-transport-status" class="text-button" hidden>Check connection mode</button></div>
<section id="welcome" class="welcome"><div class="welcome-copy"><p class="eyebrow">TWO PEOPLE. ONE SOUNDTRACK.</p><h2>Meet somewhere<br>in the music.</h2><p>Bring your favorite songs. Find the ones you both love.<br>Keep a little piece of the moments they belong to.</p><div class="record-art" aria-hidden="true"><div class="disc"><div>duet</div></div><span>A SIDE<br>YOU & ME</span></div></div><div class="welcome-form panel"><div id="create-view"><p class="eyebrow">MAKE ROOM FOR YOUR SONGS</p><h3>Start a room for two.</h3><form id="create-form"><label>Your name<input id="host-name" required maxlength="40" autocomplete="given-name" placeholder="Alex"></label><label>Room name<input id="room-title" required maxlength="80" value="Our little soundtrack"></label><label id="setup-key-field" hidden>Operator setup key<input id="setup-key" type="password" maxlength="64" autocomplete="off" spellcheck="false"><span class="fine">Only the service operator’s key can create rooms at this HTTPS address. It does not grant a participant’s seat.</span></label><button class="primary full" type="submit">Create our room</button></form><p class="fine">No accounts or streaming subscription. You supply the audio files. Processing and room data stay on this local service.</p></div><div id="join-view" hidden><p class="eyebrow">THERE'S A PLACE FOR YOU</p><h3>Join your partner's room.</h3><form id="join-form"><label>Your name<input id="guest-name" required maxlength="40" autocomplete="given-name" placeholder="Sam"></label><button class="primary full" type="submit">Join the room</button></form><p class="fine">This invitation reserves the second seat. Review the room together before sharing your own access link.</p></div><div id="access-view" hidden><h3>Open your saved seat.</h3><p class="fine">This private access link grants one participant's role in the room.</p><button id="restore-access" class="primary full">Use this access link</button></div><div id="saved-rooms"></div></div></section>
<section id="room-view" hidden><div class="room-intro"><div><p class="eyebrow">THE SOUNDTRACK WE'RE MAKING</p><h2 id="room-heading"></h2><div id="participants" class="participants"></div></div><div class="room-actions"><button id="invite" class="quiet">Invite your partner</button><button id="access-link" class="quiet">My private access link</button><button id="room-export" class="quiet">Export room notes</button><button id="leave-room" class="text-button">Back to rooms</button></div></div>
<div id="link-panel" class="link-panel panel" hidden><strong id="link-heading"></strong><p id="link-help" class="fine"></p><div><input id="share-link" readonly aria-label="Room link"><button id="copy-link">Copy link</button><button id="close-link" class="text-button">Close</button></div></div>
<div class="room-grid" id="room-main"><section class="library panel"><div class="section-heading"><div><span class="section-no">01</span><h3>What we bring</h3></div><span id="track-count" class="small-tag">0 / 12 SONGS</span></div><div class="library-body"><p class="section-description">Your favorites, their favorites, and the space in between.</p><form id="upload-form" class="upload-form"><label class="file-zone"><strong>Choose a song to share</strong><span id="audio-file-name">WAV, MP3, FLAC or Ogg · 1–300 seconds · 25 MiB</span><input id="audio-file" type="file" accept=".wav,.mp3,.flac,.ogg,audio/wav,audio/mpeg,audio/flac,audio/ogg" aria-label="Choose song file"></label><div class="pair"><label>Song title<input id="track-title" required maxlength="80" placeholder="A song that feels like you"></label><label>Artist <span class="optional">optional</span><input id="track-artist" maxlength="80" placeholder="Artist name"></label></div><button id="upload" type="submit">Add to our library</button></form><div id="upload-job" class="upload-job" hidden><span id="job-stage"></span><button id="cancel-job">Cancel upload</button></div><div id="library-list"></div></div></section>
<section class="mix panel"><div class="section-heading"><div><span class="section-no">02</span><h3>Somewhere in the middle</h3></div><span class="small-tag">OUR MIX</span></div><div class="mix-body"><p class="section-description">A blend of what you've each told us you like.</p><button id="build-mix" class="primary full">Build our mix</button><p id="blend-help" class="fine"></p><div id="playlist"></div><details class="blend-details"><summary>How the blend is ranked</summary><div id="blend-reasons"></div><p class="fine">This ranking uses your submitted ratings, not musical similarity or a streaming profile.</p></details></div></section>
<section class="memories panel"><div class="section-heading"><div><span class="section-no">03</span><h3>Songs with a story</h3></div><span id="memory-count" class="small-tag">OUR MEMORIES</span></div><div class="memory-body"><div class="memory-intro"><div><h4>Some songs take you right back.</h4><p>Give a moment a place in your soundtrack.</p></div><form id="memory-form"><div class="pair"><label>A song from our library<select id="memory-track" required></select></label><label>The date<input id="memory-date" type="date" min="1900-01-01" max="2100-12-31" required></label></div><label>The memory<textarea id="memory-text" maxlength="500" rows="3" required placeholder="The long way home. The windows down. This song."></textarea></label><button id="add-memory" type="submit">Keep this memory</button></form></div><div id="memory-list"></div></div></section></div>
<section class="player panel" aria-label="Shared music player"><div class="now-playing"><span class="mini-record" aria-hidden="true"></span><div><strong id="playing-title">Choose a song</strong><p id="playing-artist">Your shared soundtrack starts here.</p></div></div><div class="shared-controls"><div class="play-buttons"><button id="previous" aria-label="Previous song">Previous</button><button id="play" class="primary">Play together</button><button id="next" aria-label="Next song">Next</button></div><div class="seek"><span id="position">0:00</span><input id="seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Shared playback position"><span id="duration">0:00</span></div></div><div class="local-audio"><button id="enable-audio">Enable audio on this device</button><p id="audio-status" role="status">Each person enables their own audio.</p><label>Volume <input id="volume" type="range" min="0" max="1" step="0.05" value="0.8"></label></div><audio id="audio" preload="auto"></audio></section><div class="room-footer"><p>Shared controls affect both seats. Audio enablement and volume are only for this device.</p><button id="delete-room" class="text-button">Delete this room</button></div></section>
<footer><span>A room for the two of you.</span><span>Local audio library · no external music service</span></footer></main>`;

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const audio = el<HTMLAudioElement>('audio'); audio.volume = .8;
const sync = new AudioSync(audio, status => { el('audio-status').textContent = status; });
let credentials: Credentials | null = null, room: Room | null = null;
let invite: { roomId: string; token: string } | null = null, incomingAccess: Credentials | null = null;
let generation = 0, offset = 0, latestServerTime = 0, contentSignature = '', busy = false;
let transport: Transport | null = null, transportEpoch = 0, transportLoading = false;
let identityRequest = 0, pendingIdentity: number | null = null;
let polling: ReturnType<typeof setTimeout> | undefined, job: Job | null = null;
let file: File | null = null, seeking: Playback | null = null, connected = true, requestOrder = 0, appliedOrder = 0;
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const storageKey = 'duet-participants-v1';
function notify(message: string, error = false) { el('notice').textContent = message; el('notice').hidden = !message; el('notice').classList.toggle('error', error); }
function message(error: unknown) { return error instanceof Error ? error.message : 'The local music room request failed.'; }
function time(seconds: number) { const value = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
function savedCredentials(): Record<string, { token: string; title: string }> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([id, item]) => /^[a-f0-9]{32}$/.test(id) && item && typeof item === 'object' && /^[a-f0-9]{64}$/.test(item.token) && typeof item.title === 'string'));
  } catch { return {}; }
}
function saveCredentials(auth: Credentials, title: string) {
  try { const saved = savedCredentials(); saved[auth.roomId] = { token: auth.token, title }; localStorage.setItem(storageKey, JSON.stringify(saved)); }
  catch { notify('This browser cannot remember your seat. Keep your private access link before closing the page.', true); }
}
async function api<T>(path: string, method = 'GET', body?: unknown, raw?: { file: File; title: string; artist: string }, auth = credentials, setupKey?: string): Promise<{ value: T; start: number; end: number }> {
  const headers = new Headers();
  if (setupKey !== undefined) {
    if (path !== '/api/rooms' || method !== 'POST') throw new Error('The operator setup key is only for creating a room.');
    headers.set('X-Duet-Setup-Key', setupKey);
  }
  if (auth) headers.set('Authorization', `Bearer ${auth.token}`);
  if (raw) { headers.set('Content-Type', 'application/octet-stream'); headers.set('X-Track-Title', encodeURIComponent(raw.title)); headers.set('X-Track-Artist', encodeURIComponent(raw.artist)); }
  else if (method !== 'GET') headers.set('Content-Type', 'application/json');
  const start = Date.now();
  const response = await fetch(path, { method, headers, body: raw ? raw.file : method === 'GET' ? undefined : JSON.stringify(body ?? {}), cache: 'no-store' });
  const value = await response.json().catch(() => ({})); const end = Date.now();
  if (!response.ok) throw new ApiError(typeof value.error === 'string' ? value.error : `Request failed (${response.status}).`, response.status);
  return { value: value as T, start, end };
}
function roomPath(suffix = '') { if (!credentials) throw new Error('Open your room first.'); return `/api/rooms/${credentials.roomId}${suffix}`; }
function localLink(fragment: string) { const url = new URL(location.href); url.search = `?room=${credentials!.roomId}`; url.hash = fragment; return url.toString(); }
function showLink(url: string, heading: string, help: string) { el<HTMLInputElement>('share-link').value = url; el('link-heading').textContent = heading; el('link-help').textContent = help; el('link-panel').hidden = false; }
function controls() {
  for (const form of ['create-form', 'join-form', 'upload-form', 'memory-form']) for (const input of el(form).querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('input,button,select,textarea')) input.disabled = busy;
  el<HTMLFormElement>('create-form').querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = busy || !transport;
  el<HTMLButtonElement>('retry-transport-status').disabled = transportLoading;
  const creating = !el('create-view').hidden && !el('welcome').hidden;
  const needsSetup = creating && transport?.setupRequired === true;
  el('setup-key-field').hidden = !needsSetup;
  el<HTMLInputElement>('setup-key').required = needsSetup;
  if (!creating) el<HTMLInputElement>('setup-key').value = '';
  el<HTMLButtonElement>('upload').disabled = busy || !file || !!job || !room || room.tracks.length >= 12;
  el<HTMLInputElement>('audio-file').disabled = busy || !!job || !room || room.tracks.length >= 12;
  el<HTMLButtonElement>('build-mix').disabled = busy || !room?.tracks.length;
  el<HTMLButtonElement>('add-memory').disabled = busy || !room?.tracks.length || room.memories.length >= 100;
  el<HTMLButtonElement>('invite').disabled = busy || room?.myRole !== 'host' || !!room.profiles.guest;
  el('invite').hidden = room?.myRole !== 'host' || !!room.profiles.guest;
  el('delete-room').hidden = room?.myRole !== 'host';
  el<HTMLButtonElement>('delete-room').disabled = busy || !!job;
  for (const id of ['access-link', 'room-export', 'previous', 'next', 'play']) el<HTMLButtonElement>(id).disabled = busy || !room || (['previous', 'next', 'play'].includes(id) && !room.tracks.length);
  el<HTMLButtonElement>('cancel-job').disabled = busy || !job || (job.uploadedBy !== room?.myRole && room?.myRole !== 'host');
  for (const button of document.querySelectorAll<HTMLButtonElement>('#library-list button,#playlist button,#memory-list button')) button.disabled = busy || button.dataset.boundary === 'true';
}
async function loadTransportStatus() {
  const owner = ++transportEpoch; transport = null; transportLoading = true; controls();
  el('transport-status').textContent = 'Checking this service’s connection mode…';
  el('retry-transport-status').hidden = true;
  try {
    const result = await api<{ transport?: unknown }>('/api/status', 'GET', undefined, undefined, null);
    if (owner !== transportEpoch) return;
    const value = result.value.transport;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Connection mode unavailable.');
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(',') !== 'mode,origin,setupRequired' || typeof candidate.origin !== 'string' || candidate.origin.length > 300) throw new Error('Connection mode unavailable.');
    const origin = new URL(candidate.origin);
    if (candidate.mode === 'https-lan'
      ? candidate.setupRequired !== true || origin.protocol !== 'https:' || origin.origin !== candidate.origin || candidate.origin !== location.origin
      : candidate.mode !== 'http-loopback' || candidate.setupRequired !== false || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(candidate.origin)) throw new Error('Connection mode unavailable.');
    transport = { mode: candidate.mode as Transport['mode'], origin: candidate.origin, setupRequired: candidate.setupRequired as boolean };
    el('transport-status').textContent = transport.mode === 'https-lan'
      ? `HTTPS music room service: ${transport.origin}. Your partner’s device must reach this address and trust its certificate. Room creation requires the operator setup key; joining and saved seats use their own private links.`
      : `HTTP loopback service: ${transport.origin}. This address is for this computer. No operator setup key is needed to create a room.`;
  } catch {
    if (owner !== transportEpoch) return;
    el('transport-status').textContent = 'Could not check this service’s connection mode. Check that the service is running and the browser trusts its certificate, then check again. Room creation is paused; invitations and saved access links remain available.';
    el('retry-transport-status').hidden = false;
  } finally { if (owner === transportEpoch) { transportLoading = false; controls(); } }
}
el('retry-transport-status').addEventListener('click', () => void loadTransportStatus());
function accept(snapshot: Room, start: number, end: number, order: number) {
  if (snapshot.id !== credentials?.roomId || snapshot.serverTime < latestServerTime || (snapshot.serverTime === latestServerTime && order < appliedOrder)) return;
  latestServerTime = snapshot.serverTime; appliedOrder = order; room = snapshot; offset = clockOffset(snapshot.serverTime, start, end); connected = true;
  el('connection').textContent = 'Connected to your shared room'; el('connection').classList.remove('offline');
  el('welcome').hidden = true; el('room-view').hidden = false; el('room-heading').textContent = room.title;
  const signature = JSON.stringify([room.title, room.profiles, room.tracks, room.ratings, room.blend, room.playlist, room.memories, room.myRole]);
  if (signature !== contentSignature) { contentSignature = signature; renderContent(); }
  if (snapshot.activeJob) job = snapshot.activeJob;
  sync.apply(snapshot, id => `/api/rooms/${snapshot.id}/tracks/${id}/audio`, offset);
  renderJob(); renderPlayer(); controls();
}
async function poll() {
  clearTimeout(polling); if (!credentials) return;
  const current = generation, order = ++requestOrder;
  try {
    const result = await api<Room>(roomPath());
    if (current !== generation) return;
    accept(result.value, result.start, result.end, order);
    if (job) {
      const previous = job;
      let result;
      try { result = await api<{ job: Job }>(roomPath(`/jobs/${previous.id}`)); }
      catch (error) {
        if (current !== generation) return;
        if (error instanceof ApiError && error.status === 404) { job = null; renderJob(); controls(); notify('That upload is no longer active. Check your library before uploading again.', true); return; }
        throw error;
      }
      if (current !== generation || job?.id !== previous.id) return;
      job = result.value.job.status === 'running' ? result.value.job : null;
      if (!job) notify(result.value.job.status === 'complete' ? 'Your song is ready in the shared library.' : result.value.job.status === 'cancelled' ? 'Upload cancelled. Completed songs are unchanged.' : result.value.job.error || 'This upload could not be completed.', result.value.job.status === 'failed');
      renderJob(); controls();
    }
  } catch (error) {
    if (current !== generation) return;
    connected = false; el('connection').textContent = 'Connection paused · retrying'; el('connection').classList.add('offline');
    el('audio-status').textContent = `Waiting for the room: ${message(error)}`;
  } finally { if (current === generation && credentials) polling = setTimeout(() => void poll(), 1000); }
}
async function open(auth: Credentials, identityOwner?: number) {
  if (pendingIdentity !== null && pendingIdentity !== identityOwner) { pendingIdentity = null; identityRequest++; busy = false; }
  el<HTMLInputElement>('setup-key').value = '';
  generation++; clearTimeout(polling); sync.disable(); credentials = auth; room = null; job = null; latestServerTime = 0; appliedOrder = 0; contentSignature = ''; el('link-panel').hidden = true; el<HTMLInputElement>('share-link').value = ''; el('room-view').hidden = true; el('welcome').hidden = false;
  const current = generation, order = ++requestOrder;
  const result = await api<Room>(roomPath('/access'), 'POST', {}, undefined, auth);
  if (current !== generation) return;
  saveCredentials(auth, result.value.title); history.replaceState(null, '', `?room=${auth.roomId}`); accept(result.value, result.start, result.end, order); void poll();
}
async function mutate(suffix: string, method: string, body: unknown) {
  if (busy || !credentials) return false;
  busy = true; controls(); const current = generation, order = ++requestOrder;
  try {
    const result = await api<Room>(roomPath(suffix), method, body);
    if (current === generation) { accept(result.value, result.start, result.end, order); notify(''); return true; }
  } catch (error) { if (current === generation) { notify(`${message(error)} Your input is still available.`, true); void poll(); } }
  finally { if (current === generation) { busy = false; controls(); } }
  return false;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; }
function action(label: string, callback: () => void, className = '') { const button = node('button', label, className); button.type = 'button'; button.addEventListener('click', callback); return button; }
function roleName(role: Role) { return room?.profiles[role]?.name || 'Your partner'; }
function renderContent() {
  if (!room) return;
  const participants = el('participants'); participants.replaceChildren();
  for (const role of ['host', 'guest'] as const) { const badge = node('span', room.profiles[role]?.name || 'Waiting for your partner', `participant ${role}`); if (role === room.myRole) badge.append(node('small', 'YOU')); participants.append(badge); }
  el('track-count').textContent = `${room.tracks.length} / 12 SONGS`;
  const list = el('library-list'); list.replaceChildren();
  if (!room.tracks.length) list.append(node('p', 'An empty sleeve, waiting for your first song.', 'empty'));
  for (const track of room.tracks) {
    const row = node('article', '', 'track'); row.dataset.trackId = track.id;
    const artwork = node('span', track.title.slice(0, 1).toUpperCase(), 'track-art'); row.append(artwork);
    const copy = node('div', '', 'track-copy'); copy.append(node('h4', track.title), node('p', `${track.artist || 'Your own audio'} · ${time(track.duration)} · brought by ${roleName(track.uploadedBy)}`));
    const ratings = room.ratings[track.id] || { host: 0, guest: 0 };
    copy.append(node('p', `${roleName('host')}: ${ratingName(ratings.host)} · ${roleName('guest')}: ${ratingName(ratings.guest)}`, 'rating-summary'));
    const buttons = node('div', '', 'track-buttons');
    for (const [label, rating] of [['Like', 1], ['Neutral', 0], ['Pass', -1]] as const) {
      const button = action(label, () => void mutate(`/ratings/${track.id}`, 'PUT', { rating }));
      button.setAttribute('aria-label', `${label} ${track.title}`); button.setAttribute('aria-pressed', String(ratings[room.myRole] === rating)); buttons.append(button);
    }
    buttons.append(action('Listen', () => void playTrack(track.id), 'listen-button'));
    if (room.myRole === 'host' || room.myRole === track.uploadedBy) buttons.append(action('Remove', () => {
      if (window.confirm(`Remove “${track.title}” from this room? Its audio and ratings will be deleted; dated memories keep the song title.`)) void mutate(`/tracks/${track.id}`, 'DELETE', {});
    }, 'text-button'));
    copy.append(buttons); row.append(copy); list.append(row);
  }
  el('blend-help').textContent = room.profiles.guest ? 'Mutual likes lead. Unrated songs leave room to explore. You can change the order below.' : 'Invite your partner for both perspectives. Current ranking uses your ratings and leaves their seat unrated.';
  const playlist = el('playlist'); playlist.replaceChildren();
  if (!room.playlist.length) playlist.append(node('p', 'Rate a few songs, then build your first mix.', 'empty'));
  room.playlist.forEach((id, index) => {
    const track = room!.tracks.find(item => item.id === id); if (!track) return;
    const row = node('div', '', 'mix-track'); row.dataset.mixTrackId = id;
    row.append(node('span', String(index + 1).padStart(2, '0'), 'mix-number'));
    const copy = node('div'); copy.append(action(track.title, () => void playTrack(id), 'song-link'), node('p', room!.blend.find(item => item.trackId === id)?.reason || 'Added to your shared mix')); row.append(copy);
    const arrows = node('div', '', 'order-buttons');
    for (const [label, delta] of [['Up', -1], ['Down', 1]] as const) { const button = action(label, () => {
      const ids = [...room!.playlist], target = index + delta; if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]]; void mutate('/playlist', 'PUT', { trackIds: ids, revision: room!.playlistRevision });
    }); button.setAttribute('aria-label', `${label} ${track.title}`); button.dataset.boundary = String(index + delta < 0 || index + delta >= room!.playlist.length); button.disabled = button.dataset.boundary === 'true'; arrows.append(button); }
    row.append(arrows); playlist.append(row);
  });
  const reasons = el('blend-reasons'); reasons.replaceChildren();
  for (const item of room.blend) { const track = room.tracks.find(track => track.id === item.trackId); if (track) reasons.append(node('p', `${track.title}: ${item.reason}`)); }
  const picker = el<HTMLSelectElement>('memory-track'), previous = picker.value; picker.replaceChildren(new Option('Choose a song', ''));
  for (const track of room.tracks) picker.append(new Option(track.title, track.id)); picker.value = room.tracks.some(track => track.id === previous) ? previous : '';
  el('memory-count').textContent = `${room.memories.length} / 100 MOMENTS`;
  const memories = el('memory-list'); memories.replaceChildren();
  if (!room.memories.length) memories.append(node('p', 'The songs are here. The stories are yours to add.', 'empty'));
  for (const memory of [...room.memories].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
    const card = node('article', '', 'memory-card'); card.append(node('time', memory.date), node('h4', memory.trackTitle), node('p', memory.text), node('small', `Saved by ${roleName(memory.author)}`));
    if (room.tracks.some(track => track.id === memory.trackId)) card.append(action('Play this song', () => void playTrack(memory.trackId), 'text-button')); else card.append(node('small', 'Audio removed; this memory is kept.'));
    if (memory.author === room.myRole) card.append(action('Delete memory', () => { if (window.confirm('Delete this saved memory?')) void mutate(`/memories/${memory.id}`, 'DELETE', {}); }, 'text-button'));
    memories.append(card);
  }
}
function ratingName(value: number) { return value === 1 ? 'likes it' : value === -1 ? 'passes' : 'unrated'; }
function renderJob() { el('upload-job').hidden = !job; if (job) el('job-stage').textContent = job.stage; }
function renderPlayer() {
  if (!room) return;
  const track = room.tracks.find(item => item.id === room!.playback.trackId);
  el('playing-title').textContent = track?.title || 'Choose a song'; el('playing-artist').textContent = track?.artist || (track ? 'From your shared library' : 'Your shared soundtrack starts here.');
  el('play').textContent = room.playback.playing ? 'Pause together' : 'Play together';
  const position = estimatedPosition(room, Date.now() + offset);
  if (!seeking) el<HTMLInputElement>('seek').value = String(position);
  if (!seeking) el<HTMLInputElement>('seek').max = String(track?.duration || 1); el<HTMLInputElement>('seek').disabled = busy || !track;
  el('position').textContent = time(seeking ? Number(el<HTMLInputElement>('seek').value) : position); el('duration').textContent = time(track?.duration || 0);
  el('enable-audio').textContent = sync.enabled ? 'Audio enabled on this device' : 'Enable audio on this device';
  for (const row of document.querySelectorAll<HTMLElement>('[data-mix-track-id]')) row.classList.toggle('playing', row.dataset.mixTrackId === track?.id);
}
async function playTrack(id: string) { if (!room) return; void sync.enable().catch(error => notify(message(error), true)); await mutate('/playback', 'PUT', { trackId: id, playing: true, position: 0, revision: room.playback.revision }); }
el('play').addEventListener('click', () => {
  if (!room) return; const trackId = room.playback.trackId || room.playlist[0] || room.tracks[0]?.id; if (!trackId) return;
  void sync.enable().catch(error => notify(message(error), true));
  const position = room.playback.trackId ? estimatedPosition(room, Date.now() + offset) : 0, duration = room.tracks.find(track => track.id === trackId)?.duration || 0;
  void mutate('/playback', 'PUT', { trackId, playing: !room.playback.playing, position: !room.playback.playing && position >= duration ? 0 : position, revision: room.playback.revision });
});
for (const [id, delta] of [['previous', -1], ['next', 1]] as const) el(id).addEventListener('click', () => {
  if (!room) return; const tracks = room.playlist.length ? room.playlist : room.tracks.map(track => track.id), index = tracks.indexOf(room.playback.trackId || ''), next = tracks[Math.max(0, Math.min(tracks.length - 1, index + delta))]; if (next) void playTrack(next);
});
el<HTMLInputElement>('seek').addEventListener('input', () => { if (!seeking && room) seeking = { ...room.playback }; renderPlayer(); });
el<HTMLInputElement>('seek').addEventListener('change', () => {
  const position = Number(el<HTMLInputElement>('seek').value), intent = seeking; seeking = null;
  if (!intent?.trackId || !room) return;
  if (room.playback.trackId !== intent.trackId || room.playback.revision !== intent.revision) { notify('Playback changed while you were seeking. Try again on the current song.', true); renderPlayer(); return; }
  void mutate('/playback', 'PUT', { ...intent, position });
});
el('enable-audio').addEventListener('click', () => void sync.enable().then(renderPlayer).catch(error => notify(message(error), true)));
el<HTMLInputElement>('volume').addEventListener('input', event => { audio.volume = Number((event.target as HTMLInputElement).value); });
el('build-mix').addEventListener('click', () => { if (room) void mutate('/blend', 'POST', { revision: room.playlistRevision }); });

async function submitIdentity(kind: 'create' | 'join') {
  if (busy) return;
  let setupKey: string | undefined;
  if (kind === 'create') {
    if (!transport) { notify('Check the connection mode before creating a room.', true); return; }
    if (transport.setupRequired) {
      setupKey = el<HTMLInputElement>('setup-key').value;
      if (!/^[a-f0-9]{64}$/.test(setupKey)) { notify('Enter the operator’s 64-character lowercase hexadecimal setup key. It is only for creating a room.', true); return; }
    }
  }
  const current = generation, request = ++identityRequest;
  pendingIdentity = request; busy = true; controls();
  try {
    // The one dispatch owns this value; no retry, seat request or persisted field uses it.
    if (kind === 'create') el<HTMLInputElement>('setup-key').value = '';
    const result = kind === 'create'
      ? await api<Created>('/api/rooms', 'POST', { title: el<HTMLInputElement>('room-title').value, name: el<HTMLInputElement>('host-name').value }, undefined, null, setupKey)
      : await api<Created>(`/api/rooms/${invite!.roomId}/join`, 'POST', { inviteToken: invite!.token, name: el<HTMLInputElement>('guest-name').value }, undefined, null);
    const auth = { roomId: result.value.roomId, token: result.value.token }; saveCredentials(auth, result.value.room.title);
    if (current !== generation || pendingIdentity !== request) return;
    renderSaved(); await open(auth, request);
    if (generation !== current + 1 || pendingIdentity !== request || credentials?.roomId !== auth.roomId || credentials.token !== auth.token || room?.id !== auth.roomId) return;
    if (result.value.inviteToken) showLink(localLink(`invite=${result.value.inviteToken}`), 'A place for your partner', 'Send this invitation to the person sharing your room. It can claim the second seat once.');
    else notify('You are both in. Bring a song and find your overlap.');
    invite = null; incomingAccess = null;
  } catch (error) {
    if (pendingIdentity === request) notify(error instanceof TypeError
      ? 'The response was interrupted. The room or seat may have been created. Check your saved rooms and keep any received private access link before trying again; nothing was repeated automatically.'
      : `${message(error)}${kind === 'create' && transport?.setupRequired ? ' Re-enter the operator setup key for another deliberate attempt.' : ''}`, true);
  } finally { if (pendingIdentity === request) { pendingIdentity = null; busy = false; controls(); } }
}
el('create-form').addEventListener('submit', event => { event.preventDefault(); void submitIdentity('create'); });
el('join-form').addEventListener('submit', event => { event.preventDefault(); if (invite) void submitIdentity('join'); });
el('restore-access').addEventListener('click', () => { if (incomingAccess) void open(incomingAccess).catch(error => notify(message(error), true)); });
el('invite').addEventListener('click', async () => {
  const current = generation;
  try { const { value } = await api<{ inviteToken: string }>(roomPath('/invite'), 'POST', {}); if (current === generation) showLink(localLink(`invite=${value.inviteToken}`), 'A fresh invitation for your partner', 'This one-use invitation replaces any earlier unclaimed invitation.'); }
  catch (error) { if (current === generation) notify(message(error), true); }
});
el('access-link').addEventListener('click', () => { if (credentials) showLink(localLink(`access=${credentials.token}`), 'Your private seat', 'Keep this link for your own recovery. Anyone with it can act as you. Share the partner invitation instead.'); });
el('copy-link').addEventListener('click', async () => {
  const input = el<HTMLInputElement>('share-link');
  try { await navigator.clipboard.writeText(input.value); notify('Link copied.'); }
  catch { input.focus(); input.select(); notify('The link is selected. Copy it using your browser or keyboard.'); }
});
el('close-link').addEventListener('click', () => { el('link-panel').hidden = true; el<HTMLInputElement>('share-link').value = ''; });
el<HTMLInputElement>('audio-file').addEventListener('change', event => {
  file = (event.target as HTMLInputElement).files?.[0] || null;
  if (file && (file.size < 1 || file.size > 25 * 1024 * 1024)) { file = null; (event.target as HTMLInputElement).value = ''; notify('Choose a nonempty audio file no larger than 25 MiB.', true); }
  el('audio-file-name').textContent = file?.name || 'WAV, MP3, FLAC or Ogg · 1–300 seconds · 25 MiB';
  if (file) el<HTMLInputElement>('track-title').value = file.name.replace(/\.[^.]+$/, '').slice(0, 80); controls();
});
el('upload-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!file || busy || !credentials) return;
  busy = true; controls(); const current = generation;
  try {
    const result = await api<{ job: Job }>(roomPath('/tracks'), 'POST', undefined, { file, title: el<HTMLInputElement>('track-title').value, artist: el<HTMLInputElement>('track-artist').value });
    if (current !== generation) return;
    job = result.value.job; file = null; el<HTMLInputElement>('audio-file').value = ''; el('audio-file-name').textContent = 'WAV, MP3, FLAC or Ogg · 1–300 seconds · 25 MiB'; el<HTMLInputElement>('track-title').value = ''; el<HTMLInputElement>('track-artist').value = ''; notify('Your audio is being prepared locally.'); renderJob(); void poll();
  } catch (error) { if (current === generation) notify(message(error), true); }
  finally { if (current === generation) { busy = false; controls(); } }
});
el('cancel-job').addEventListener('click', async () => { if (!job) return; try { await api(roomPath(`/jobs/${job.id}/cancel`), 'POST', {}); void poll(); } catch (error) { notify(message(error), true); } });
el('memory-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!room || busy) return; const text = el<HTMLTextAreaElement>('memory-text').value;
  const saved = await mutate('/memories', 'POST', { trackId: el<HTMLSelectElement>('memory-track').value, date: el<HTMLInputElement>('memory-date').value, text });
  if (saved && el<HTMLTextAreaElement>('memory-text').value === text) { el<HTMLTextAreaElement>('memory-text').value = ''; notify('A little moment, kept with its song.'); }
});
el('room-export').addEventListener('click', async () => {
  try { const { value } = await api<unknown>(roomPath('/export')); const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'duet-room-notes.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); notify('Room notes exported without access credentials. Keep a server data-directory backup to preserve the audio.'); }
  catch (error) { notify(message(error), true); }
});
function hasDraft() { return !!file || !!el<HTMLTextAreaElement>('memory-text').value.trim(); }
function home() {
  el<HTMLInputElement>('setup-key').value = '';
  pendingIdentity = null; identityRequest++;
  generation++; clearTimeout(polling); sync.disable(); credentials = null; room = null; job = null; busy = false; seeking = null; contentSignature = ''; file = null;
  el<HTMLFormElement>('upload-form').reset(); el<HTMLTextAreaElement>('memory-text').value = ''; el('audio-file-name').textContent = 'WAV, MP3, FLAC or Ogg · 1–300 seconds · 25 MiB'; el<HTMLInputElement>('share-link').value = ''; el('link-panel').hidden = true;
  el('welcome').hidden = false; el('room-view').hidden = true; el('create-view').hidden = false; el('join-view').hidden = true; el('access-view').hidden = true; el('connection').textContent = 'Your songs. Your space.'; el('connection').classList.remove('offline'); history.replaceState(null, '', location.pathname); renderSaved(); controls();
}
el('leave-room').addEventListener('click', () => { if (!hasDraft() || window.confirm('Leave this room and discard your unsaved song selection or memory draft?')) home(); });
el('delete-room').addEventListener('click', async () => {
  if (!credentials || !window.confirm('Delete this room, its audio, ratings and memories for both people? This cannot be undone.')) return;
  const id = credentials.roomId;
  try { await api(roomPath(), 'DELETE', {}); try { const saved = savedCredentials(); delete saved[id]; localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* The server deletion remains valid if local storage is blocked. */ } home(); notify('The selected room was deleted. Other rooms are unchanged.'); }
  catch (error) { notify(message(error), true); }
});
function renderSaved() {
  const saved = el('saved-rooms'); saved.replaceChildren(); const entries = Object.entries(savedCredentials());
  if (entries.length) { saved.append(node('h4', 'Your saved rooms')); for (const [id, item] of entries) saved.append(action(item.title, () => void open({ roomId: id, token: item.token }).catch(error => notify(message(error), true)), 'saved-room')); }
}
const today = new Date(); el<HTMLInputElement>('memory-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
function readLocation() {
  const url = new URL(location.href), roomId = url.searchParams.get('room'), fragment = new URLSearchParams(url.hash.slice(1));
  const inviteToken = fragment.get('invite'), accessToken = fragment.get('access');
  history.replaceState(null, '', `${location.pathname}${url.search}`);
  if (!roomId || !/^[a-f0-9]{32}$/.test(roomId)) return;
  if ((inviteToken && /^[a-f0-9]{64}$/.test(inviteToken)) || (accessToken && /^[a-f0-9]{64}$/.test(accessToken))) {
    if (hasDraft() && !window.confirm('Open this link and discard your unsaved draft?')) { history.replaceState(null, '', credentials ? `?room=${credentials.roomId}` : location.pathname); return; }
    home(); notify(''); history.replaceState(null, '', `${location.pathname}${url.search}`); invite = null; incomingAccess = null; el('create-view').hidden = true;
    if (inviteToken && /^[a-f0-9]{64}$/.test(inviteToken)) { invite = { roomId, token: inviteToken }; el('join-view').hidden = false; }
    else { incomingAccess = { roomId, token: accessToken! }; el('access-view').hidden = false; }
  } else {
    const saved = savedCredentials()[roomId];
    if (saved) void open({ roomId, token: saved.token }).catch(error => notify(`${message(error)} You can retry from your saved rooms.`, true));
    else notify('This room needs your private access link or a partner invitation.', true);
  }
}
readLocation(); window.addEventListener('hashchange', readLocation);
renderSaved(); controls();
void loadTransportStatus();
setInterval(() => { if (room) { renderPlayer(); if (!connected) el('connection').textContent = 'Connection paused · retrying'; } }, 250);
window.addEventListener('pagehide', () => {
  el<HTMLInputElement>('setup-key').value = ''; transportEpoch++; transport = null; transportLoading = false;
  if (pendingIdentity !== null) { pendingIdentity = null; identityRequest++; busy = false; }
  generation++; clearTimeout(polling); sync.disable();
});
window.addEventListener('pageshow', event => { if (event.persisted) { controls(); void loadTransportStatus(); if (credentials) void poll(); } });
window.addEventListener('beforeunload', event => { if (hasDraft()) { event.preventDefault(); event.returnValue = ''; } });
