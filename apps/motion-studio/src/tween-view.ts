import { MAX_DRAWING_CELS, MAX_JSON_BYTES, type DrawingLayer, type Project, type Stroke } from './model.ts';
import type { Assets } from './render.ts';
import { applyDrawingTween, buildDrawingTween, planTweenFrames, previewDrawingTween, type TweenProposal } from './tween.ts';
import { createTweenPreview, type TweenPreview } from './tween-preview.ts';

interface EditorState {
  project: Project; assets: Assets; layerId: string; frame: number;
  generation: number; operation: number; locked: boolean;
}
interface Hooks {
  state(): EditorState;
  admitDrafts(): boolean;
  pause(): void;
  apply(project: Project, firstFrame: number): boolean;
}

/** Scratch controls own their nodes; ordinary editor refreshes never rebuild them. */
export function createTweenWorkspace(host: HTMLElement, hooks: Hooks) {
  host.innerHTML = `<section id="tween-panel" role="region" aria-label="Drawing in-betweens" hidden>
    <h3>Drawing in-betweens</h3><p class="hint">Geometric interpolation of deliberately paired strokes, not learned animation. Review crossings, softened corners and paint-order changes before applying.</p>
    <div class="tween-endpoints"><label class="field">Starting drawing<select id="tween-start"></select></label><p id="tween-end-label"></p></div>
    <div id="tween-ending-strokes" aria-label="Ending drawing strokes"></div><div id="tween-pairs"></div>
    <button id="tween-pair-order">Pair in drawing order</button>
    <label class="field tween-count">Number of new drawings<input id="tween-count" type="text" inputmode="numeric" value="1"></label>
    <p id="tween-frames" class="hint"></p><button id="tween-review">Review in-betweens</button>
    <p id="tween-status" role="status" aria-live="polite"></p><p id="tween-usage"></p>
    <div id="tween-preview-controls" hidden><canvas id="tween-preview" width="640" height="360" aria-label="Reviewed in-between animation"></canvas>
    <label class="scrubber">Tween preview frame<output id="tween-preview-label"></output><input id="tween-preview-frame" type="range" step="1"></label>
    <button id="tween-preview-play">Play tween preview</button></div>
    <p class="hint">Preview holds each drawing until the next boundary. Original endpoint strokes stay exact; generated strokes use 64 arc-length samples. Existing session history trims older edits at 30 states / 20 MiB. Project, PNG and GIF downloads include committed work only.</p>
    <div class="tween-actions"><button id="tween-apply" class="primary" disabled>Apply in-betweens</button><button id="tween-discard">Discard in-betweens</button></div>
  </section>`;
  const node = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const panel = node('tween-panel'), start = node<HTMLSelectElement>('tween-start');
  const count = node<HTMLInputElement>('tween-count'), previewCanvas = node<HTMLCanvasElement>('tween-preview');
  const slider = node<HTMLInputElement>('tween-preview-frame'), play = node<HTMLButtonElement>('tween-preview-play');
  let ownerLayer = '', dirty = false, tweenIntent = 0;
  let shownProject: Project | null = null;
  let proposal: TweenProposal | null = null, preview: TweenPreview | null = null;
  let receipt: { generation: number; operation: number; layerId: string; frame: number; intent: number } | null = null;
  let previewPlaying = false;
  const status = (message: string, error = false) => {
    node('tween-status').textContent = message; node('tween-status').classList.toggle('error', error);
  };
  const chosen = (): DrawingLayer | undefined => {
    const item = hooks.state().project.layers.find(layer => layer.id === ownerLayer);
    return item?.kind === 'drawing' ? item : undefined;
  };
  function endpoints() {
    const drawing = chosen();
    const index = drawing?.cels.findIndex(cel => cel.frame === Number(start.value)) ?? -1;
    const first = drawing?.cels[index], last = drawing?.cels[index + 1];
    if (!drawing || !first || !last) throw new Error('Choose a starting drawing with a following endpoint.');
    return { drawing, first, last };
  }
  function retire(message = 'The editor changed. Review these choices again before Apply.') {
    tweenIntent++; preview?.dispose(); preview = null; proposal = null; receipt = null; previewPlaying = false;
    play.textContent = 'Play tween preview'; node('tween-preview-controls').hidden = true;
    node('tween-usage').textContent = ''; node<HTMLButtonElement>('tween-apply').disabled = true;
    if (!panel.hidden && dirty) status(message);
  }
  function frames() {
    const { drawing, first, last } = endpoints();
    const raw = count.value.trim();
    if (!/^\d+$/.test(raw)) throw new Error('Enter a whole number of new drawings; the raw value is kept.');
    const amount = Number(raw), maximum = Math.min(last.frame - first.frame - 1, MAX_DRAWING_CELS - drawing.cels.length);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > maximum) throw new Error(`Choose 1–${Math.max(0, maximum)} new drawings. Existing drawings and all project budgets count.`);
    return planTweenFrames(first.frame, last.frame, amount);
  }
  function showFrames() {
    try { node('tween-frames').textContent = `New drawing frames: ${frames().map(frame => frame + 1).join(', ')}.`; }
    catch (error) { node('tween-frames').textContent = message(error); }
  }
  function changed() { dirty = true; retire('Choices changed. Review in-betweens again; committed artwork is unchanged.'); showFrames(); }
  function message(error: unknown) { return error instanceof Error ? error.message : 'Could not review these drawing choices.'; }
  function describe(stroke: Stroke, index: number) {
    const first = stroke.points[0], last = stroke.points.at(-1)!;
    return `Stroke ${index + 1} · ${stroke.color} · width ${stroke.width} · start (${first.x}, ${first.y}) → end (${last.x}, ${last.y})`;
  }
  function thumbnail(stroke: Stroke, index: number, label: string): HTMLElement {
    const figure = document.createElement('figure'), canvas = document.createElement('canvas'), caption = document.createElement('figcaption');
    canvas.width = 180; canvas.height = 100; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${label}: ${describe(stroke, index)}`);
    caption.textContent = `${label}: ${describe(stroke, index)}`; figure.append(canvas, caption);
    const context = canvas.getContext('2d')!;
    const xs = stroke.points.map(point => point.x), ys = stroke.points.map(point => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min(140 / Math.max(1, maxX - minX), 60 / Math.max(1, maxY - minY));
    const point = (p: { x: number; y: number }) => ({ x: 90 + (p.x - (minX + maxX) / 2) * scale, y: 50 + (p.y - (minY + maxY) / 2) * scale });
    context.strokeStyle = stroke.color; context.lineWidth = Math.min(18, Math.max(2, stroke.width * scale)); context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath();
    for (const [i, p] of stroke.points.entries()) { const q = point(p); if (i) context.lineTo(q.x, q.y); else context.moveTo(q.x, q.y); }
    if (stroke.points.length === 1) { const q = point(stroke.points[0]); context.lineTo(q.x + .01, q.y); }
    context.stroke();
    for (const [label, p] of [['S', stroke.points[0]], ['E', stroke.points.at(-1)!]] as const) {
      const q = point(p); context.fillStyle = '#302a3d'; context.font = 'bold 12px sans-serif'; context.fillText(label, q.x + 5, q.y - (label === 'S' ? 7 : -15));
    }
    return figure;
  }
  function renderPairs(preserve = true) {
    const list = node('tween-pairs');
    if (!preserve) list.replaceChildren();
    node('tween-ending-strokes').replaceChildren();
    shownProject = hooks.state().project;
    try {
      const drawing = chosen()!;
      const oldStart = start.value;
      start.replaceChildren(); drawing.cels.forEach(cel => start.add(new Option(`Drawing at frame ${cel.frame + 1}`, String(cel.frame))));
      if (!drawing.cels.some(cel => String(cel.frame) === oldStart)) {
        const unavailable = new Option(`Drawing at frame ${Number(oldStart) + 1} — no longer present`, oldStart); unavailable.disabled = true; start.add(unavailable);
      }
      start.value = oldStart;
      const { first, last } = endpoints(); node('tween-end-label').textContent = `Ending drawing: frame ${last.frame + 1} (the next boundary).`;
      last.strokes.forEach((stroke, index) => node('tween-ending-strokes').append(thumbnail(stroke, index, 'Ending')));
      for (const row of list.querySelectorAll<HTMLElement>('[data-tween-stroke]')) if (Number(row.dataset.tweenStroke) >= first.strokes.length) row.remove();
      first.strokes.forEach((stroke, index) => {
        let row = list.querySelector<HTMLElement>(`[data-tween-stroke="${index}"]`);
        if (!row) {
          row = document.createElement('div'); row.className = 'tween-pair'; row.dataset.tweenStroke = String(index);
          const label = document.createElement('label'); label.className = 'field'; label.textContent = `Ending stroke for starting stroke ${index + 1}`;
          const select = document.createElement('select'); label.append(select);
          const reversal = document.createElement('label'); reversal.className = 'tween-reverse'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
          reversal.append(checkbox, document.createTextNode(`Reverse ending stroke for starting stroke ${index + 1}`));
          select.addEventListener('input', changed); checkbox.addEventListener('input', changed);
          row.append(thumbnail(stroke, index, 'Starting'), label, reversal); list.append(row);
        } else row.querySelector('figure')!.replaceWith(thumbnail(stroke, index, 'Starting'));
        // Keep native control identity, focus, explicit choice and reversal while indices survive.
        const select = row.querySelector('select')!, selected = select.value;
        select.replaceChildren(); select.add(new Option('Choose an ending stroke', ''));
        last.strokes.forEach((ending, i) => select.add(new Option(describe(ending, i), String(i))));
        if (selected !== '' && !last.strokes[Number(selected)]) {
          const unavailable = new Option(`Ending stroke ${Number(selected) + 1} — no longer present`, selected); unavailable.disabled = true; select.add(unavailable);
        }
        select.value = selected;
      });
      if (!first.strokes.length || first.strokes.length !== last.strokes.length || first.strokes.length > 8 || last.frame - first.frame < 2) {
        status('Endpoints need the same 1–8 strokes and at least one interior frame. Choose another starting drawing.', true);
      } else if (!dirty) status('Choose every pairing explicitly, then Review. Pairing is geometric, not a recognition result.');
    } catch (error) {
      for (const figure of list.querySelectorAll('figure')) { const caption = document.createElement('figcaption'); caption.textContent = 'Endpoint no longer available. Choose another starting drawing; existing raw choices are kept.'; figure.replaceChildren(caption); }
      node('tween-end-label').textContent = 'Ending drawing: unavailable'; status(message(error), true);
    }
    showFrames();
  }
  function update() {
    const state = hooks.state();
    if (!panel.hidden && chosen() && state.layerId === ownerLayer && shownProject !== state.project) renderPairs();
    const current = !!proposal && !!receipt && receipt.generation === state.generation && receipt.operation === state.operation
      && receipt.layerId === state.layerId && receipt.frame === state.frame && receipt.intent === tweenIntent;
    for (const control of host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')) control.disabled = state.locked;
    node<HTMLButtonElement>('tween-apply').disabled = state.locked || !current;
    slider.disabled = state.locked || !current; play.disabled = state.locked || !current;
    if (!panel.hidden && (!chosen() || state.layerId !== ownerLayer)) close();
  }
  function close() { retire(''); dirty = false; ownerLayer = ''; shownProject = null; panel.hidden = true; }
  function confirmLeave() {
    if (panel.hidden || !dirty) return true;
    const before = hooks.state(), intent = tweenIntent;
    if (!window.confirm('Discard unaccepted in-between choices and preview? Committed drawings are unchanged. Cancel keeps these controls.')) return false;
    const after = hooks.state();
    if (intent !== tweenIntent || before.generation !== after.generation || before.operation !== after.operation || before.layerId !== after.layerId || before.frame !== after.frame) { status('The editor changed during confirmation. Review this action again.', true); return false; }
    return true;
  }
  start.addEventListener('input', () => { changed(); renderPairs(); update(); });
  count.addEventListener('input', changed);
  node('tween-pair-order').addEventListener('click', () => {
    if (hooks.state().locked) return;
    for (const [index, select] of [...node('tween-pairs').querySelectorAll('select')].entries()) select.value = String(index);
    changed();
  });
  node('tween-review').addEventListener('click', () => {
    if (hooks.state().locked || !hooks.admitDrafts()) return;
    retire(''); dirty = true; hooks.pause();
    try {
      const state = hooks.state(), { first, last } = endpoints();
      const pairs = [...node('tween-pairs').querySelectorAll<HTMLElement>('[data-tween-stroke]')].map((row, index) => {
        const value = row.querySelector('select')!.value;
        if (value === '') throw new Error(`Choose an ending stroke for starting stroke ${index + 1}.`);
        return { startStroke: index, endStroke: Number(value), reverseEnd: row.querySelector<HTMLInputElement>('input')!.checked };
      });
      const reviewed = buildDrawingTween(state.project, { layerId: ownerLayer, startFrame: first.frame, endFrame: last.frame }, { pairs, frames: frames() });
      const candidate = previewDrawingTween(state.project, reviewed);
      proposal = reviewed; receipt = { generation: state.generation, operation: state.operation, layerId: state.layerId, frame: state.frame, intent: tweenIntent };
      const token = tweenIntent;
      slider.min = String(first.frame); slider.max = String(last.frame); slider.value = String(first.frame);
      preview = createTweenPreview(previewCanvas, candidate, state.assets, first.frame, last.frame, value => {
        if (token !== tweenIntent || !proposal) return;
        slider.value = String(value); node('tween-preview-label').textContent = `Frame ${value + 1}`;
        if (value === last.frame) { previewPlaying = false; play.textContent = 'Play tween preview'; }
      });
      node('tween-preview-controls').hidden = false;
      const usage = (value: TweenProposal['before']) => `${value.layerCels}/24 layer drawings; ${value.projectStrokes}/100 project strokes; ${value.projectPoints}/10,000 points; ${value.projectBytes.toLocaleString('en-US')}/${MAX_JSON_BYTES.toLocaleString('en-US')} UTF-8 bytes`;
      node('tween-usage').textContent = `Inserted frames: ${reviewed.choices.frames.map(frame => frame + 1).join(', ')}. Before: ${usage(reviewed.before)}. After: ${usage(reviewed.after)}.`;
      status('Reviewed candidate only; nothing is saved or added yet. Inspect its held-frame animation, then Apply once or Discard.'); update();
    } catch (error) { retire(''); status(message(error), true); update(); }
  });
  slider.addEventListener('input', () => { try { preview?.stop(); previewPlaying = false; play.textContent = 'Play tween preview'; preview?.showFrame(Number(slider.value)); } catch (error) { status(message(error), true); } });
  play.addEventListener('click', () => {
    if (!preview || play.disabled) return;
    if (previewPlaying) { preview.stop(); previewPlaying = false; play.textContent = 'Play tween preview'; }
    else { previewPlaying = true; play.textContent = 'Stop tween preview'; preview.play(); }
  });
  node('tween-apply').addEventListener('click', () => {
    update(); if (node<HTMLButtonElement>('tween-apply').disabled || !proposal || !hooks.admitDrafts()) return;
    try { const accepted = applyDrawingTween(hooks.state().project, proposal), first = proposal.choices.frames[0]; if (hooks.apply(accepted, first)) { close(); } }
    catch (error) { status(message(error), true); }
  });
  node('tween-discard').addEventListener('click', () => { if (!hooks.state().locked) close(); });
  return {
    retire, update, close, confirmLeave,
    get unsaved() { return !panel.hidden && dirty; },
    open() {
      const state = hooks.state(); if (state.locked || !hooks.admitDrafts()) return;
      const drawing = state.project.layers.find(layer => layer.id === state.layerId);
      if (!drawing || drawing.kind !== 'drawing') { status('This tool needs a vector drawing layer.', true); return; }
      if (!panel.hidden && ownerLayer === state.layerId) return;
      close(); ownerLayer = state.layerId; hooks.pause(); panel.hidden = false; count.value = '1';
      start.replaceChildren(); drawing.cels.forEach(cel => start.add(new Option(`Drawing at frame ${cel.frame + 1}`, String(cel.frame))));
      const active = drawing.cels.filter(cel => cel.frame <= state.frame).at(-1)!;
      start.value = String(drawing.cels.at(-1) === active ? drawing.cels[0].frame : active.frame);
      renderPairs(false); update(); start.focus({ preventScroll: true });
    },
  };
}
