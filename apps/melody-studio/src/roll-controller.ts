import { proposeRollEdit, type RollEdit, type RollSnap } from './roll-edit.ts';
import type { Composition, Note } from './types.ts';

interface RollState {
  composition: Composition; trackId: string; generation: number; intent: number;
  tool: 'move' | 'draw'; snap: RollSnap; blocked: boolean; drafts: boolean;
}
interface Options {
  state(): RollState;
  begin(): void;
  publish(next: Composition, noteId: string): boolean;
  status(text: string): void;
}
interface Gesture {
  id: number; capture: HTMLElement; grid: HTMLElement; rect: DOMRect;
  width: number; height: number; dpr: number; scrollX: number; scrollY: number;
  base: RollState; x: number; y: number; beats: number; top: number;
  kind: 'move' | 'resize' | 'add'; noteId: string; pitch: number; start: number;
  moved: boolean; candidate: Composition | null; error: string;
}
const roundAway = (value: number) => Math.sign(value) * Math.floor(Math.abs(value) + .5);

/** Owns only a transient gesture; the caller owns history, assets and rendering. */
export function createRollController(host: HTMLElement, options: Options) {
  let gesture: Gesture | null = null;
  let suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  const status = (text: string) => options.status(text);
  const clearOverlay = () => host.querySelector('.roll-preview')?.remove();
  function release(): Gesture | null {
    const held = gesture; gesture = null; clearOverlay();
    if (held) { try { held.capture.releasePointerCapture(held.id); } catch { /* Already released. */ } }
    return held;
  }
  function cancel(text = 'Piano roll edit cancelled. Committed notes are unchanged.'): void {
    if (!gesture) return;
    suppressClick ||= gesture.moved || gesture.kind === 'add';
    release(); status(text);
  }
  function owns(held: Gesture): boolean {
    const current = options.state(), rect = held.grid.getBoundingClientRect();
    return gesture === held && held.grid.isConnected && !current.blocked && !current.drafts
      && current.generation === held.base.generation && current.intent === held.base.intent
      && current.trackId === held.base.trackId && current.tool === held.base.tool && current.snap === held.base.snap
      && innerWidth === held.width && innerHeight === held.height && devicePixelRatio === held.dpr
      && scrollX === held.scrollX && scrollY === held.scrollY
      && rect.left === held.rect.left && rect.top === held.rect.top && rect.width === held.rect.width && rect.height === held.rect.height;
  }
  function preview(held: Gesture, x: number, y: number): void {
    if (!owns(held)) { cancel('The editor or piano roll geometry changed. Start this edit again.'); return; }
    const dx = x - held.x, dy = y - held.y;
    held.moved ||= Math.hypot(dx, dy) >= 3;
    clearOverlay(); held.candidate = null; held.error = '';
    if (!held.moved && held.kind !== 'add') return;
    const deltaBeats = held.moved ? dx / held.rect.width * held.beats : 0;
    let edit: RollEdit;
    if (held.kind === 'add') edit = { kind: 'add', id: held.noteId, pitch: held.pitch, start: held.start,
      duration: held.moved ? deltaBeats : 1, velocity: .8, snap: held.base.snap };
    else if (held.kind === 'resize') edit = { kind: 'resize', noteId: held.noteId, deltaBeats, snap: held.base.snap };
    else edit = { kind: 'move', noteId: held.noteId, deltaBeats, deltaPitch: roundAway(-dy / 22), snap: held.base.snap };
    try {
      held.candidate = proposeRollEdit(held.base.composition, held.base.trackId, edit);
      const note = held.candidate.tracks.find(track => track.id === held.base.trackId)!.notes.find(note => note.id === held.noteId)!;
      drawOverlay(held, note, false);
      status(`Preview only: pitch ${note.pitch}, beat ${note.start + 1}, duration ${note.duration}. Release to apply; Escape cancels.`);
    } catch (error) {
      held.error = error instanceof Error ? error.message : 'That piano roll edit is outside the note limits.';
      drawOverlay(held, { id: held.noteId, pitch: held.kind === 'move' ? held.pitch + roundAway(-dy / 22) : held.pitch,
        start: held.kind === 'move' ? held.start + deltaBeats : held.start,
        duration: held.kind === 'add' ? (held.moved ? deltaBeats : 1) : 1, velocity: .8 }, true);
      status(`${held.error} Release will keep the committed notes unchanged.`);
    }
  }
  function drawOverlay(held: Gesture, note: Note, invalid: boolean): void {
    const overlay = document.createElement('span');
    overlay.className = `note-event roll-preview${invalid ? ' is-invalid' : ''}`;
    overlay.dataset.kind = held.kind; overlay.setAttribute('aria-hidden', 'true');
    overlay.style.left = `${note.start / held.beats * 100}%`;
    overlay.style.width = `${Math.max(0, note.duration) / held.beats * 100}%`;
    overlay.style.top = `${(held.top - note.pitch) * 22 + 2}px`;
    overlay.textContent = invalid ? 'Invalid edit' : 'Preview';
    held.grid.append(overlay);
  }
  function down(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return;
    if (gesture) return;
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = null; suppressClick = false;
    const target = event.target as HTMLElement, grid = target.closest<HTMLElement>('.roll-grid');
    if (!grid || !host.contains(grid)) return;
    const button = target.closest<HTMLButtonElement>('[data-note]');
    let state = options.state();
    if (!button && state.tool !== 'draw') return;
    if (state.blocked || state.drafts) {
      event.preventDefault(); event.stopImmediatePropagation(); suppressClick = true;
      status(state.drafts ? 'Apply or discard your unapplied note, project or track fields before editing the piano roll.' : 'Wait for the current operation before editing the piano roll.');
      return;
    }
    options.begin(); state = options.state();
    const rect = grid.getBoundingClientRect(), beats = Number(grid.dataset.beats), top = Number(grid.dataset.top);
    if (!rect.width || !rect.height || !Number.isFinite(beats) || !Number.isFinite(top)) return;
    const note = button ? state.composition.tracks.find(track => track.id === state.trackId)!.notes.find(note => note.id === button.dataset.note) : null;
    if (button && !note) return;
    const capture = button ?? grid;
    const held: Gesture = { id: event.pointerId, capture, grid, rect, width: innerWidth, height: innerHeight,
      dpr: devicePixelRatio, scrollX, scrollY, base: { ...state, composition: structuredClone(state.composition) }, x: event.clientX, y: event.clientY,
      beats, top, kind: note ? (target.closest('[data-roll-resize]') ? 'resize' : 'move') : 'add',
      noteId: note?.id ?? crypto.randomUUID(), pitch: note?.pitch ?? top - Math.floor((event.clientY - rect.top) / 22),
      start: note?.start ?? (event.clientX - rect.left) / rect.width * beats, moved: false, candidate: null, error: '' };
    event.preventDefault(); event.stopImmediatePropagation();
    gesture = held;
    try { capture.setPointerCapture(event.pointerId); } catch { /* Window events still own cancellation. */ }
    capture.focus({ preventScroll: true });
    preview(held, event.clientX, event.clientY);
  }
  function up(event: PointerEvent): void {
    const held = gesture;
    if (!held) { if (suppressClick) clickTimer = setTimeout(() => { suppressClick = false; clickTimer = null; }, 0); return; }
    if (held.id !== event.pointerId) return;
    preview(held, event.clientX, event.clientY);
    if (gesture !== held) return;
    const current = owns(held), candidate = held.candidate;
    const changed = !!candidate && JSON.stringify(candidate) !== JSON.stringify(held.base.composition);
    suppressClick = held.moved || held.kind === 'add';
    release();
    if (suppressClick) clickTimer = setTimeout(() => { suppressClick = false; clickTimer = null; }, 0);
    if (!current) { status('The editor changed. Start this edit again.'); return; }
    if (!held.moved && held.kind !== 'add') return;
    event.preventDefault();
    if (!candidate) { status(held.error || 'Invalid piano roll edit. Committed notes are unchanged.'); return; }
    if (!changed) { status('No note change. History and suggestions are unchanged.'); return; }
    if (options.publish(candidate, held.noteId)) status('Piano roll edit applied. Undo restores the previous notes.');
  }
  function key(event: KeyboardEvent): void {
    if (event.key === 'Escape' && gesture) { event.preventDefault(); cancel(); return; }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-note]');
    if (!button || !host.contains(button) || event.altKey || event.ctrlKey || event.metaKey
      || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      || event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    let state = options.state();
    if (state.blocked || state.drafts) { status('Apply or discard your unapplied fields, or wait for the current operation, before editing the piano roll.'); return; }
    cancel(); options.begin(); state = options.state();
    const noteId = button.dataset.note!, increment = state.snap || .125;
    const edit: RollEdit = event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)
      ? { kind: 'resize', noteId, deltaBeats: event.key === 'ArrowLeft' ? -increment : increment, snap: state.snap }
      : { kind: 'move', noteId, deltaBeats: event.key === 'ArrowLeft' ? -increment : event.key === 'ArrowRight' ? increment : 0,
        deltaPitch: event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0, snap: state.snap };
    try { if (options.publish(proposeRollEdit(state.composition, state.trackId, edit), noteId)) status('Piano roll keyboard edit applied. Undo restores the previous notes.'); }
    catch (error) { status(error instanceof Error ? error.message : 'That edit is outside the note limits.'); }
  }
  host.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', event => { if (gesture?.id === event.pointerId) preview(gesture, event.clientX, event.clientY); }, true);
  window.addEventListener('pointerup', up, true);
  host.addEventListener('click', event => {
    if (suppressClick && event.detail > 0 && (event.target as HTMLElement).closest('.roll-grid')) {
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('pointercancel', event => { if (gesture?.id === event.pointerId) { cancel(); suppressClick = false; } }, true);
  window.addEventListener('lostpointercapture', event => { if (gesture?.id === event.pointerId) cancel(); }, true);
  host.addEventListener('keydown', key, true);
  window.addEventListener('scroll', () => cancel('Scrolling cancelled the piano roll edit.'), true);
  window.addEventListener('resize', () => cancel('Resizing cancelled the piano roll edit.'));
  window.addEventListener('blur', () => cancel());
  window.addEventListener('pagehide', () => { cancel(); suppressClick = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancel(); suppressClick = false; } });
  return { cancel, get active() { return gesture !== null; } };
}
