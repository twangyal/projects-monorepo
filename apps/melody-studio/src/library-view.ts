import { CompositionLibrary, type LibraryEntry, type LibraryReceipt } from './composition-library.ts';
import type { ReferenceBundle } from './reference-types.ts';

interface WorkspaceState {
  generation: number;
  intent: number;
  captureBlocked: boolean;
  openBlocked: boolean;
  scratch: boolean;
}
interface LibraryCallbacks {
  state(): WorkspaceState;
  snapshot(): ReferenceBundle;
  open(bundle: ReferenceBundle): boolean;
}
type Action = 'refresh' | 'create' | 'update' | 'open' | 'download' | 'delete';
interface Operation {
  epoch: number;
  action: Action;
  generation: number;
  intent: number;
  label: string;
  selected: LibraryEntry | null;
  controller: AbortController;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
}
const mutation = (action: Action) => action === 'create' || action === 'update' || action === 'delete';

/** Stable controls own library intent only; the caller retains workspace/history authority. */
export function createLibraryView(host: HTMLElement, callbacks: LibraryCallbacks) {
  let store: CompositionLibrary | null = null;
  try { store = new CompositionLibrary(window.indexedDB); } catch { /* Independent library failure. */ }
  let entries: readonly LibraryEntry[] = [];
  let epoch = 0;
  let active: Operation | null = null;
  let departed = false;
  let terminal = false;
  let refreshRequired = false;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  const corrupt = new Set<LibraryReceipt>();
  const retiredCommits: string[] = [];
  host.innerHTML = `<p class="eyebrow">KEEP COMPLETE COPIES</p><h2 id="library-heading">Saved compositions</h2>
    <p class="small">Keep up to eight complete copies. Copies change only when you choose Save new copy or Update selected copy. Your current workspace autosaves separately.</p>
    <div class="library-fields"><label for="library-label">Saved-copy label<input id="library-label" type="text" aria-describedby="library-label-help" /></label>
    <label for="library-select">Saved composition<select id="library-select"><option value="">Choose a saved copy</option></select></label></div>
    <p id="library-label-help" class="small">Use 1–80 characters. Labels are separate from composition titles; duplicate labels are allowed.</p>
    <p id="library-details" class="small">No saved copy selected.</p>
    <div class="button-row"><button type="button" id="library-create">Save new copy</button><button type="button" id="library-update">Update selected copy</button><button type="button" id="library-open">Open selected copy</button><button type="button" id="library-refresh">Refresh copies</button></div>
    <div class="button-row"><button type="button" id="library-download">Download selected copy</button><button type="button" id="library-delete" class="danger">Delete selected copy</button><button type="button" id="library-cancel">Cancel library operation</button></div>
    <p id="library-status" role="status" aria-live="polite">${store ? 'Choose Refresh copies to list saved compositions.' : 'The saved composition library is unavailable in this browser. Your current workspace is unchanged.'}</p>`;
  const label = host.querySelector<HTMLInputElement>('#library-label')!;
  const select = host.querySelector<HTMLSelectElement>('#library-select')!;
  const status = host.querySelector<HTMLElement>('#library-status')!;
  const details = host.querySelector<HTMLElement>('#library-details')!;
  const button = (action: Action | 'cancel') => host.querySelector<HTMLButtonElement>(`#library-${action}`)!;
  const selected = () => entries.find(entry => entry.id === select.value) ?? null;
  function say(text: string) { status.textContent = text; }
  function sync() {
    const state = callbacks.state();
    const blocked = !store || terminal || departed || active !== null || !!store.nativePending;
    const entry = selected();
    button('refresh').disabled = blocked;
    button('create').disabled = blocked || refreshRequired || state.captureBlocked || entries.length >= 8;
    button('update').disabled = blocked || refreshRequired || !entry || state.captureBlocked;
    button('open').disabled = blocked || refreshRequired || !entry || state.openBlocked || !!entry && corrupt.has(entry.receipt);
    button('download').disabled = blocked || refreshRequired || !entry;
    button('delete').disabled = blocked || refreshRequired || !entry;
    button('cancel').disabled = !active;
    label.disabled = !store || terminal || departed;
    select.disabled = !store || terminal || departed;
    details.textContent = entry ? `Title: ${entry.title} · ${entry.tracks} tracks · ${entry.references} references · ${entry.bytes.toLocaleString()} bytes` : 'No saved copy selected.';
    // A logical abort can settle before a native terminal event. Keep the
    // controls guarded until that event, without treating rejection as rollback.
    if (store?.nativePending && !departed && !drainTimer) drainTimer = setTimeout(() => { drainTimer = null; sync(); }, 100);
  }
  function showEntries(next: readonly LibraryEntry[], preferred = select.value) {
    entries = next;
    select.replaceChildren(new Option('Choose a saved copy', ''));
    for (const entry of entries) select.add(new Option(entry.label, entry.id));
    select.value = entries.some(entry => entry.id === preferred) ? preferred : '';
    sync();
  }
  function retire(text = 'The editor changed. The library operation was retired; choose an action again.') {
    const owner = active;
    if (!owner) return;
    active = null; epoch++;
    clearTimeout(owner.timer);
    if (mutation(owner.action)) refreshRequired = true;
    owner.controller.abort();
    say(`${text}${mutation(owner.action) ? ' A captured mutation may already have committed. Refresh copies before another action; it will not be replayed.' : ''}`);
    sync();
  }
  function current(owner: Operation): boolean {
    if (active !== owner || owner.epoch !== epoch || departed || terminal || owner.controller.signal.aborted) return false;
    const state = callbacks.state();
    if (state.generation !== owner.generation || state.intent !== owner.intent || label.value !== owner.label || selected()?.receipt !== owner.selected?.receipt) {
      retire(); return false;
    }
    if (performance.now() >= owner.deadline) {
      retire('The library operation timed out after 10 seconds. Refresh copies before trying again.'); return false;
    }
    return true;
  }
  function finish(owner: Operation) {
    clearTimeout(owner.timer);
    if (active === owner) active = null;
    sync();
  }
  function capture(action: Action): Operation | null {
    sync();
    if (button(action).disabled || !store) return null;
    const state = callbacks.state();
    const owner = { epoch: ++epoch, action, generation: state.generation, intent: state.intent, label: label.value,
      selected: selected(), controller: new AbortController(), deadline: performance.now() + 10000,
      timer: setTimeout(() => retire('The library operation timed out after 10 seconds. Refresh copies before trying again.'), 10000) };
    active = owner; sync(); return owner;
  }
  async function run(action: Action) {
    const owner = capture(action);
    if (!owner || !store) return;
    const options = { signal: owner.controller.signal };
    try {
      // Snapshot before any await or confirmation; unapplied fields never enter it.
      const bundle = action === 'create' || action === 'update' ? callbacks.snapshot() : null;
      const entry = owner.selected;
      if (action === 'update' || action === 'delete') {
        if (!entry || !window.confirm(action === 'update'
          ? `Update saved copy “${entry.label}” (${entry.id}) with the current committed composition? Its stored notes and reference takes will be replaced. Unapplied editor fields, MIDI review and suggestions are excluded.`
          : `Delete saved copy “${entry.label}” (${entry.id})? This removes only this complete copy. Download it first to keep a portable backup.`)) {
          if (current(owner)) say('Library confirmation cancelled. Your workspace and saved copies are unchanged.');
          return;
        }
        if (!current(owner) || action === 'update' && callbacks.state().captureBlocked) return;
      }
      if (action === 'refresh') {
        say('Refreshing saved compositions…');
        const next = await store.list(options);
        if (!current(owner)) return;
        const lost = !!entry && !next.some(copy => copy.id === entry.id);
        refreshRequired = false;
        showEntries(next, entry?.id ?? '');
        const outcomes = retiredCommits.splice(0).join(' ');
        say(`Refreshed ${next.length} of 8 saved compositions.${lost ? ' The previously selected copy was removed; choose a copy deliberately.' : ''}${outcomes ? ` ${outcomes}` : ''}`);
      } else if (action === 'create' || action === 'update') {
        say(action === 'create' ? 'Saving a new complete copy of committed work…' : 'Updating the selected complete copy of committed work…');
        const saved = action === 'create' ? await store.create(owner.label, bundle!, options)
          : await store.update(entry!.receipt, owner.label, bundle!, options);
        if (!current(owner)) { retiredCommits.push(`The retired ${action === 'create' ? 'Save new copy' : 'Update selected copy'} committed its captured work; it did not save newer workspace edits.`); return; }
        showEntries([...entries.filter(copy => copy.id !== saved.id), saved], saved.id);
        say(`Saved complete copy “${saved.label}”. Only committed notes and reference takes were captured. Your current workspace autosaves separately.`);
      } else if (action === 'delete') {
        say('Deleting the selected saved composition…');
        await store.remove(entry!.receipt, options);
        if (!current(owner)) { retiredCommits.push('The retired deletion committed; Refresh reflects the current catalog.'); return; }
        showEntries(entries.filter(copy => copy.id !== entry!.id), '');
        say(`Deleted saved copy “${entry!.label}”. Your current workspace is unchanged.`);
      } else {
        say(action === 'open' ? 'Reviewing the selected complete copy before opening…' : 'Reading the exact stored backup for download…');
        const review = await store.review(entry!.receipt, options);
        if (!current(owner)) return;
        if (review.error) corrupt.add(entry!.receipt);
        if (action === 'download') {
          const url = URL.createObjectURL(review.backup);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${entry!.label.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 60) || 'composition'}.melody.json`;
          anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          say(`Downloaded the exact stored backup for “${entry!.label}”.${review.error ? ' This copy failed integrity or format verification; its exact damaged recovery bytes were kept.' : ''}`);
        } else {
          if (!review.bundle) { say(`Cannot open selected copy: integrity or format verification failed. ${review.error ?? 'This copy could not be decoded.'} Download preserves its exact stored backup; Update or Delete requires your confirmation.`); return; }
          if (callbacks.state().openBlocked) { say('Finish the current workspace operation before opening a saved composition.'); return; }
          const scratch = callbacks.state().scratch;
          if (!window.confirm(`Open saved copy “${entry!.label}” (${entry!.id}) and replace the current committed composition with ${entry!.tracks} tracks and ${entry!.references} reference takes? Undo restores the previous committed project.${scratch ? ' This also discards unapplied editor fields, MIDI source/review, comparison drafts and continuation suggestions; Undo does not restore discarded scratch.' : ''}`)) {
            if (current(owner)) say('Open cancelled. Your current composition, drafts and reviews are unchanged.');
            return;
          }
          if (!current(owner) || callbacks.state().openBlocked) return;
          // Deliberate admission changes workspace intent itself. Release library
          // ownership immediately before this synchronous complete-project seam.
          finish(owner);
          if (callbacks.open(review.bundle)) say(`Opened saved copy “${entry!.label}”. Undo restores the previous committed project. Current-workspace autosave follows its existing recovery policy.`);
          else say('The selected copy could not be admitted to the current project history. Your notes, audio, drafts and reviews are unchanged; see the workspace notice.');
        }
      }
    } catch (error) {
      if (current(owner)) {
        if (mutation(action)) refreshRequired = true;
        say(`${error instanceof Error ? error.message : 'The library operation failed.'}${mutation(action) ? ' Refresh copies before another action. No mutation will be replayed.' : ''} Your current workspace is unchanged.`);
      }
    } finally { finish(owner); }
  }
  label.addEventListener('input', () => { retire('The saved-copy label changed. The earlier library operation was retired.'); sync(); });
  select.addEventListener('change', () => { retire('The selected copy changed. The earlier library operation was retired.'); sync(); });
  host.addEventListener('click', event => {
    const node = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!node || node.disabled) return;
    if (node.id === 'library-cancel') { retire('Library operation cancelled. Your workspace is unchanged.'); return; }
    const action = node.id.slice('library-'.length) as Action;
    if (['refresh', 'create', 'update', 'open', 'download', 'delete'].includes(action)) void run(action);
  });
  window.addEventListener('pagehide', event => {
    departed = true;
    retire('Page departure retired the library operation. Refresh copies after returning.');
    refreshRequired = true;
    if (drainTimer) clearTimeout(drainTimer); drainTimer = null;
    if (!event.persisted) { terminal = true; void store?.close(); }
    sync();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted || terminal) return;
    departed = false;
    say('Returned to the saved composition library. Refresh copies explicitly; no previous mutation or Open will be replayed.'); sync();
  });
  sync();
  return { sync, retire };
}
