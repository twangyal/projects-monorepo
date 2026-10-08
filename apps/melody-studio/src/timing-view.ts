import { quantizeTrack, type TimingResult } from './timing.ts';
import type { Composition } from './types.ts';

interface TimingState { composition: Composition; trackId: string; generation: number; intent: number; blocked: boolean; playing: boolean }
interface TimingViewOptions {
  state(): TimingState;
  ready(): boolean;
  intent(): void;
  publish(composition: Composition, message: string): boolean;
  audition(composition: Composition): () => void;
}
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));

/** Session-only review; saved Composition contains only the applied note starts. */
export function createTimingView(host: HTMLElement, options: TimingViewOptions) {
  let review: { result: TimingResult; source: string; trackId: string; generation: number; intent: number } | null = null;
  let stopAudition: (() => void) | null = null;
  host.innerHTML = `<div class="timing-heading"><p class="eyebrow">EDIT MUSICAL TIMING</p><h2 id="timing-heading">Tighten this track’s timing.</h2><p class="small">Review onsets before applying. Durations, pitches, velocities and reference audio stay unchanged. Swing delays odd subdivisions within each two-grid pair. Ties choose the later onset; shifts beyond the song limit refuse the whole edit.</p></div>
    <div class="timing-controls"><div class="timing-control"><label for="timing-grid">Timing grid (beats)</label><select id="timing-grid"><option value="1">1 beat</option><option value=".5">½ beat</option><option value=".25" selected>¼ beat</option><option value=".125">⅛ beat</option></select></div><label for="timing-strength">Timing strength (%)<input id="timing-strength" type="text" inputmode="decimal" maxlength="30" value="100" /></label><label for="timing-swing">Timing swing (%)<input id="timing-swing" type="text" inputmode="decimal" maxlength="30" value="0" /></label></div>
    <div class="button-row"><button data-timing="review">Review timing</button><button data-timing="audition" disabled>Audition timing</button><button data-timing="apply" disabled>Apply timing</button><button class="quiet" data-timing="discard" disabled>Discard timing</button></div>
    <p id="timing-status" class="small" role="status" aria-live="polite">Choose a grid, strength 0–100%, and swing 0–50%. Review changes to the selected track.</p><div id="timing-preview"></div>`;
  const button = (action: string) => host.querySelector<HTMLButtonElement>(`[data-timing=${action}]`)!;
  const status = (text: string) => { host.querySelector('#timing-status')!.textContent = text; };
  const preview = host.querySelector<HTMLElement>('#timing-preview')!;
  function sync() {
    const state = options.state();
    button('review').disabled = state.blocked || !state.composition.tracks.find(track => track.id === state.trackId)?.notes.length;
    button('apply').disabled = state.blocked || !review;
    button('audition').disabled = state.blocked || state.playing || !review;
    button('discard').disabled = state.blocked && !stopAudition || !review;
  }
  function retire() {
    const stop = stopAudition; stopAudition = null; stop?.();
    if (review) { review = null; preview.replaceChildren(); status('The source or settings changed. Review timing again.'); }
    sync();
  }
  function percent(id: string, maximum: number) {
    const raw = host.querySelector<HTMLInputElement>(`#timing-${id}`)!.value;
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`Enter a nonempty finite ${id} between 0 and ${maximum}%. Your input is kept.`);
    return value / 100;
  }
  // Prevent an unsent field's change-on-blur from committing ahead of this guard.
  host.addEventListener('pointerdown', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-timing]');
    if (!target || target.disabled || target.dataset.timing === 'discard') return;
    event.preventDefault();
    if (!options.ready()) event.stopImmediatePropagation();
  }, true);
  host.addEventListener('input', () => { options.intent(); retire(); });
  host.addEventListener('change', () => { options.intent(); retire(); });
  host.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-timing]');
    if (!target || target.disabled || options.state().blocked && !(target.dataset.timing === 'discard' && stopAudition)) return;
    if (target.dataset.timing === 'discard') { retire(); status('Timing review discarded. Committed notes are unchanged.'); return; }
    if (!options.ready()) return;
    try {
      if (target.dataset.timing === 'review') {
        const settings = { grid: Number(host.querySelector<HTMLSelectElement>('#timing-grid')!.value), strength: percent('strength', 100), swing: percent('swing', 50) };
        options.intent();
        const state = options.state(), result = quantizeTrack(state.composition, state.trackId, settings);
        review = { result, source: JSON.stringify(state.composition), trackId: state.trackId, generation: state.generation, intent: state.intent };
        const track = result.composition.tracks.find(item => item.id === state.trackId)!;
        status(`${result.changes.length} of ${track.notes.length} note onsets change in ${track.name}. Review is not saved; Apply creates one Undo edit.`);
        preview.innerHTML = result.changes.length ? `<div class="timing-changes" role="region" aria-label="Reviewed note timing changes" tabindex="0"><table><caption>Displayed beats start at 1. Durations are unchanged.</caption><thead><tr><th scope="col">Note</th><th scope="col">Before beat</th><th scope="col">After beat</th></tr></thead><tbody>${result.changes.map(change => `<tr data-timing-note="${escape(change.id)}"><th scope="row">${track.notes.findIndex(note => note.id === change.id) + 1}</th><td>${change.before + 1}</td><td>${change.after + 1}</td></tr>`).join('')}</tbody></table></div>` : '';
        sync();
      } else if ((target.dataset.timing === 'apply' || target.dataset.timing === 'audition') && review) {
        const state = options.state(), accepted = review;
        if (state.generation !== accepted.generation || state.intent !== accepted.intent || state.trackId !== accepted.trackId || JSON.stringify(state.composition) !== accepted.source) { retire(); return; }
        if (target.dataset.timing === 'audition') {
          stopAudition?.(); stopAudition = options.audition(accepted.result.composition); sync(); return;
        }
        const text = accepted.result.changes.length ? 'Track timing applied. Undo restores the original onsets.' : 'Timing already matches; no composition edit was added.';
        if (options.publish(accepted.result.composition, text)) { retire(); status(text); }
      }
    } catch (error) { status(error instanceof Error ? error.message : 'Could not review timing.'); }
  });
  sync();
  return { retire, sync };
}
