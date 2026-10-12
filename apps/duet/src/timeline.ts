// The shared listening timeline: Spotify connections, automatic entries and curation.
// Entries are derived by the service; this view words them using the participants' names.

export type Role = 'host' | 'guest';
interface TrackRef { id: string; title: string; artists: string; album: string; url: string }
interface Person { firstAt: number; lastAt: number; plays: number }
interface BaseEntry { key: string; at: number; hidden: boolean; caption: string }
export type Entry =
  | BaseEntry & { kind: 'both'; track: TrackRef; people: Record<Role, Person>; withinThirtyMinutes: boolean }
  | BaseEntry & { kind: 'new'; track: TrackRef; role: Role; plays: number }
  | BaseEntry & { kind: 'favorite'; track: TrackRef; role: Role }
  | BaseEntry & { kind: 'manual'; id: string; role: Role; date: string; title: string; song: string; note: string };
interface Connection { displayName: string; connectedAt: number; syncedAt: number | null; error: string | null }
export interface ListeningState {
  configured: boolean; redirectUri: string | null; connections: Record<Role, Connection | null>;
  authFailures: Partial<Record<Role, string>>; entries: Entry[]; hiddenCount: number; truncated: boolean;
}
type Api = <T>(path: string, method?: string, body?: unknown) => Promise<{ value: T }>;
interface Context { api: Api; roomId: string; myRole: Role; names: () => Record<Role, string> }

const ROLES: Role[] = ['host', 'guest'];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, max = 2000) => typeof value === 'string' && value.length <= max;
const isTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function validTrack(value: unknown) {
  return isRecord(value) && isText(value.id, 64) && isText(value.title, 200) && isText(value.artists, 300) &&
    isText(value.album, 200) && typeof value.url === 'string' && /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+$/.test(value.url);
}

// Replies are checked before rendering so a malformed service reply cannot inject links or crash the view.
export function validateListening(value: unknown): ListeningState {
  const fail = () => { throw new Error('The listening timeline reply was not understood. Refresh and try again.'); };
  if (!isRecord(value) || typeof value.configured !== 'boolean' || !Array.isArray(value.entries) || !isRecord(value.connections) ||
    !isRecord(value.authFailures) || typeof value.hiddenCount !== 'number' || typeof value.truncated !== 'boolean' ||
    !(value.redirectUri === null || isText(value.redirectUri, 300))) fail();
  const state = value as unknown as ListeningState;
  for (const role of ROLES) {
    const connection = state.connections[role] as unknown;
    if (connection !== null && !(isRecord(connection) && isText(connection.displayName, 100) && isTime(connection.connectedAt) &&
      (connection.syncedAt === null || isTime(connection.syncedAt)) && (connection.error === null || isText(connection.error, 300)))) fail();
    const failure = state.authFailures[role] as unknown;
    if (failure !== undefined && !isText(failure, 300)) fail();
  }
  for (const entry of state.entries as unknown[]) {
    if (!isRecord(entry) || !isText(entry.key, 120) || !isTime(entry.at) || typeof entry.hidden !== 'boolean' || !isText(entry.caption, 200)) fail();
    const item = entry as Record<string, unknown>;
    if (item.kind === 'both') {
      if (!validTrack(item.track) || !isRecord(item.people) || typeof item.withinThirtyMinutes !== 'boolean') fail();
      for (const role of ROLES) {
        const person = (item.people as Record<string, unknown>)[role];
        if (!isRecord(person) || !isTime(person.firstAt) || !isTime(person.lastAt) || typeof person.plays !== 'number') fail();
      }
    } else if (item.kind === 'new' || item.kind === 'favorite') {
      if (!validTrack(item.track) || !ROLES.includes(item.role as Role) || (item.kind === 'new' && typeof item.plays !== 'number')) fail();
    } else if (item.kind === 'manual') {
      if (!/^[a-f0-9]{32}$/.test(String(item.id)) || !ROLES.includes(item.role as Role) || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date)) ||
        !isText(item.title, 120) || !isText(item.song, 120) || !isText(item.note, 1000)) fail();
    } else fail();
  }
  return state;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element;
}
function button(label: string, onClick: () => void, className = 'quiet') {
  const element = node('button', label, className); element.type = 'button'; element.addEventListener('click', onClick); return element;
}
const dateKey = (entry: Entry) => entry.kind === 'manual' ? entry.date : localDate(entry.at);
function localDate(ms: number) {
  const date = new Date(ms); const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const dayLabel = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
const timeLabel = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const song = (track: TrackRef) => `“${track.title}”${track.artists ? ` by ${track.artists}` : ''}`;
const times = (count: number) => count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`;

// Plain-language wording for each kind, kept separate so it can be tested.
export function describe(entry: Entry, names: Record<Role, string>): { title: string; detail: string } {
  switch (entry.kind) {
    case 'both': {
      const [host, guest] = [entry.people.host, entry.people.guest];
      return {
        title: `You both played ${song(entry.track)}`,
        detail: `${names.host}: ${times(host.plays)}, first ${timeLabel(host.firstAt)}. ${names.guest}: ${times(guest.plays)}, first ${timeLabel(guest.firstAt)}.` +
          (entry.withinThirtyMinutes ? ' Some plays were within 30 minutes of each other.' : ' Played separately; not necessarily together.'),
      };
    }
    case 'new': return { title: `${names[entry.role]} heard ${song(entry.track)} for the first time`, detail: `First seen ${timeLabel(entry.at)} · played ${times(entry.plays)} so far.` };
    case 'favorite': return { title: `${names[entry.role]} added ${song(entry.track)} to Liked Songs`, detail: timeLabel(entry.at) };
    case 'manual': return { title: entry.title, detail: [entry.song && `Song: ${entry.song}`, entry.note, `Written by ${names[entry.role]}`].filter(Boolean).join(' · ') };
  }
}

export function createTimeline(container: HTMLElement, notify: (message: string, error?: boolean) => void) {
  let context: Context | null = null, state: ListeningState | null = null, session = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let showHidden = false, busy = false, editing: string | null = null;

  const path = (suffix = '') => `/api/rooms/${context!.roomId}/listening${suffix}`;

  async function load() {
    clearTimeout(timer);
    if (!context) return;
    const current = session;
    try {
      const reply = await context.api<unknown>(path(showHidden ? '/hidden' : ''));
      if (current !== session) return;
      state = validateListening(reply.value); render();
    } catch (error) {
      if (current !== session) return;
      status(error instanceof Error ? error.message : 'The listening timeline could not be loaded.', true);
    } finally {
      // New listening arrives through the service's periodic sync; refresh the view regularly.
      if (current === session && context) timer = setTimeout(() => void load(), 30000);
    }
  }

  async function mutate(suffix: string, method: string, body: unknown, done = '') {
    if (!context || busy) return false;
    const current = session; busy = true; render();
    try {
      const reply = await context.api<unknown>(path(suffix), method, body);
      if (current !== session) return false;
      state = validateListening(reply.value);
      if (showHidden) await load();
      if (done) notify(done);
      return true;
    } catch (error) {
      if (current === session) notify(error instanceof Error ? error.message : 'The timeline could not be updated.', true);
      return false;
    } finally {
      if (current === session) { busy = false; render(); }
    }
  }

  function status(message: string, error = false) {
    const line = container.querySelector('#listening-status');
    if (line) { line.textContent = message; line.classList.toggle('error', error); }
  }

  async function connect() {
    if (!context || busy) return;
    busy = true; render();
    try {
      const reply = await context.api<{ authorizeUrl: string }>(path('/connect'), 'POST', {});
      const target = new URL(reply.value.authorizeUrl);
      if (!/^https?:$/.test(target.protocol) || target.pathname !== '/authorize') throw new Error('The Spotify sign-in link was not valid.');
      location.assign(target.toString());
    } catch (error) {
      busy = false; render(); notify(error instanceof Error ? error.message : 'Spotify could not be reached.', true);
    }
  }

  function renderConnections(names: Record<Role, string>) {
    const box = node('div', '', 'listening-connections');
    if (!state!.configured) {
      box.append(node('p', 'Spotify is not set up on this Duet service, so the automatic timeline is off. You can still write timeline entries yourself.', 'fine'));
      return box;
    }
    for (const role of ROLES) {
      const connection = state!.connections[role], mine = role === context!.myRole;
      const row = node('div', '', 'connection-row');
      const label = node('p');
      if (connection) {
        label.textContent = `${names[role]} · connected as ${connection.displayName}` +
          (connection.syncedAt ? ` · checked ${timeLabel(connection.syncedAt)}` : ' · first check pending');
        row.append(label);
        if (connection.error) row.append(node('p', connection.error, 'fine error'));
        if (mine) row.append(button('Disconnect my Spotify', () => {
          if (window.confirm('Disconnect your Spotify? Duet deletes your access and your imported listening. Written entries stay.')) void mutate('/connection', 'DELETE', {}, 'Spotify disconnected. Your imported listening was deleted.');
        }));
      } else {
        label.textContent = mine ? 'Your Spotify is not connected.' : `${names[role]} has not connected Spotify yet.`;
        row.append(label);
        const failure = state!.authFailures[role];
        if (failure) row.append(node('p', failure, 'fine error'));
        if (mine) row.append(button('Connect my Spotify', () => void connect(), 'primary'));
      }
      box.append(row);
    }
    const details = node('details', '', 'fine');
    details.append(node('summary', 'What Duet reads and how entries appear'),
      node('p', 'After you connect, Duet checks your recently played songs and Liked Songs about every ten minutes and adds entries automatically: songs you have both played (each person’s own plays — Duet does not assume you listened together), songs it sees someone play for the first time since connecting, and songs added to Liked Songs. Your history before connecting is a starting point and is not labeled new. Hidden entries stay hidden. Disconnecting deletes your access and imported listening; nothing is shared outside this room.'));
    if (state!.redirectUri) details.append(node('p', `Operator setup: the Spotify app’s redirect URI must be ${state!.redirectUri}`));
    box.append(details);
    if (ROLES.some(role => state!.connections[role])) box.append(button('Check Spotify now', () => void mutate('/sync', 'POST', {}, 'Checked Spotify.')));
    return box;
  }

  function entryActions(entry: Entry, item: HTMLElement) {
    const actions = node('div', '', 'entry-actions');
    if (entry.kind !== 'manual') {
      const link = node('a', 'Open in Spotify'); link.href = entry.track.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      actions.append(link);
    }
    actions.append(button(entry.hidden ? 'Restore' : 'Hide', () => void mutate(`/entries/${entry.key}`, 'PUT', { hidden: !entry.hidden, caption: entry.caption },
      entry.hidden ? 'Entry restored.' : 'Entry hidden. Later checks will not bring it back.')));
    actions.append(button(entry.caption ? 'Edit caption' : 'Add caption', () => {
      editing = editing === entry.key ? null : entry.key;
      regions?.entries.querySelector('.caption-form')?.remove();
      render();
    }));
    if (entry.kind === 'manual' && entry.role === context!.myRole) {
      actions.append(button('Delete', () => { if (window.confirm('Delete this written entry?')) void mutate(`/manual/${entry.id}`, 'DELETE', {}, 'Entry deleted.'); }));
    }
    item.append(actions);
    if (editing === entry.key) {
      const form = node('form', '', 'caption-form');
      const input = node('input'); input.maxLength = 200; input.value = entry.caption; input.setAttribute('aria-label', 'Caption');
      form.append(input, node('button', 'Save caption'));
      form.addEventListener('submit', event => {
        event.preventDefault(); editing = null; form.remove();
        void mutate(`/entries/${entry.key}`, 'PUT', { hidden: entry.hidden, caption: input.value }, 'Caption saved.');
      });
      item.append(form);
    }
  }

  function renderEntry(entry: Entry, names: Record<Role, string>) {
    const item = node('li', '', `timeline-entry kind-${entry.kind}${entry.hidden ? ' is-hidden' : ''}`);
    const words = describe(entry, names);
    item.append(node('strong', words.title), node('p', words.detail, 'fine'));
    if (entry.caption) item.append(node('p', entry.caption, 'caption'));
    entryActions(entry, item);
    return item;
  }

  function renderEntries(names: Record<Role, string>) {
    const list = node('div', '', 'timeline-days');
    if (!state!.entries.length) {
      list.append(node('p', state!.configured ? 'Nothing yet. Entries appear here as you both listen.' : 'No entries yet. Write the first one below.', 'fine'));
      return list;
    }
    const days = new Map<string, Entry[]>();
    for (const entry of state!.entries) days.set(dateKey(entry), [...(days.get(dateKey(entry)) ?? []), entry]);
    for (const [day, entries] of days) {
      const section = node('section', '', 'timeline-day');
      section.append(node('h4', dayLabel(day)));
      const items = node('ul');
      // Several first-time songs by one person on one day collapse into a single group.
      for (const role of ROLES) {
        const fresh = entries.filter(entry => entry.kind === 'new' && entry.role === role);
        if (fresh.length > 2) {
          const group = node('li', '', 'timeline-entry kind-group');
          const details = node('details');
          details.append(node('summary', `${names[role]} heard ${fresh.length} songs for the first time`));
          const inner = node('ul'); for (const entry of fresh) inner.append(renderEntry(entry, names));
          details.append(inner); group.append(details); items.append(group);
        }
      }
      for (const entry of entries) {
        const grouped = entry.kind === 'new' && entries.filter(other => other.kind === 'new' && other.role === entry.role).length > 2;
        if (!grouped) items.append(renderEntry(entry, names));
      }
      section.append(items); list.append(section);
    }
    if (state!.truncated) list.append(node('p', 'Showing the 300 most recent entries.', 'fine'));
    return list;
  }

  function renderManualForm() {
    const form = node('form', '', 'manual-form');
    form.id = 'timeline-manual';
    const field = (label: string, input: HTMLInputElement | HTMLTextAreaElement) => { const wrap = node('label', label); wrap.append(input); return wrap; };
    const date = node('input'); date.type = 'date'; date.required = true; date.min = '1900-01-01'; date.max = '2100-12-31'; date.value = localDate(Date.now());
    const title = node('input'); title.required = true; title.maxLength = 120; title.placeholder = 'Our first concert';
    const songName = node('input'); songName.maxLength = 120; songName.placeholder = 'Optional';
    const note = node('textarea'); note.maxLength = 1000; note.rows = 2; note.placeholder = 'Optional';
    form.append(node('h4', 'Write an entry'), field('Date', date), field('What happened', title), field('Song', songName), field('Note', note), node('button', 'Add to our timeline'));
    form.addEventListener('submit', event => {
      event.preventDefault();
      void mutate('/manual', 'POST', { date: date.value, title: title.value, song: songName.value, note: note.value }, 'Entry added.')
        .then(added => { if (added) { title.value = ''; songName.value = ''; note.value = ''; } });
    });
    return form;
  }

  // Stable regions: the written-entry form is built once so refreshes never discard a draft.
  let regions: { connections: HTMLElement; status: HTMLElement; toolbar: HTMLElement; entries: HTMLElement; form: HTMLFormElement } | null = null;

  function build() {
    container.querySelector('.timeline-body')?.remove();
    const body = node('div', '', 'timeline-body');
    const status = node('p', '', 'fine'); status.id = 'listening-status'; status.setAttribute('role', 'status');
    regions = { connections: node('div'), status, toolbar: node('div', '', 'timeline-toolbar'), entries: node('div'), form: renderManualForm() };
    body.append(regions.connections, regions.status, regions.toolbar, regions.entries, regions.form);
    container.append(body);
  }

  function render() {
    if (!context || !state || !regions) return;
    const names = context.names();
    regions.connections.replaceChildren(renderConnections(names));
    regions.toolbar.replaceChildren();
    if (state.hiddenCount || showHidden) {
      regions.toolbar.append(button(showHidden ? 'Hide removed entries' : `Show hidden (${state.hiddenCount})`, () => { showHidden = !showHidden; void load(); }));
    }
    // An open caption editor keeps its entry list until it is saved or closed.
    if (!editing || !regions.entries.querySelector('.caption-form')) regions.entries.replaceChildren(renderEntries(names));
    for (const control of container.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('.timeline-body button, .timeline-body input, .timeline-body textarea')) control.disabled = busy;
  }

  return {
    open(next: Context) { session++; context = next; state = null; showHidden = false; editing = null; busy = false; build(); void load(); },
    close() { session++; clearTimeout(timer); context = null; state = null; regions = null; container.querySelector('.timeline-body')?.remove(); },
  };
}
