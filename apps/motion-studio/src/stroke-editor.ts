import { evaluateDrawingCel, evaluatePose, localPoint, type Point, type Pose, type Project, type Stroke } from './model.ts';
import { deleteStroke, setStrokeAppearance, type StrokeTarget } from './stroke-edit.ts';

/** Captures one rigid path displacement, never accumulated pointer deltas. */
export class StrokeDrag {
  readonly #start: Point; readonly #pose: Pose; readonly #scale: number;
  #moved = false;
  constructor(start: Point, pose: Pose, canvasCssWidth: number) {
    this.#start = { ...start }; this.#pose = { ...pose }; this.#scale = 640 / canvasCssWidth;
    if (![start.x, start.y, canvasCssWidth, pose.x, pose.y, pose.rotation, pose.scale].every(Number.isFinite) || canvasCssWidth <= 0 || pose.scale <= 0) throw new Error('The canvas geometry is unavailable. Try again after the layout settles.');
  }
  update(current: Point): { moved: boolean; delta: Point } {
    if (![current.x, current.y].every(Number.isFinite)) throw new Error('The pointer position is invalid. The stroke was kept.');
    if (Math.hypot(current.x - this.#start.x, current.y - this.#start.y) >= 3) this.#moved = true;
    if (!this.#moved) return { moved: false, delta: { x: 0, y: 0 } };
    // Translation cancels in this difference; rotation and uniform scale remain.
    const zero = localPoint({ x: 0, y: 0 }, this.#pose);
    const point = localPoint({ x: (current.x - this.#start.x) * this.#scale, y: (current.y - this.#start.y) * this.#scale }, this.#pose);
    return { moved: true, delta: { x: point.x - zero.x, y: point.y - zero.y } };
  }
}
export function uniformCanvas(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs(width / height - 640 / 360) <= 0.001;
}
interface State { project: Project; layerId: string; frame: number; generation: number; operation: number; locked: boolean; enabled: boolean }
interface Hooks { state(): State; admitOtherDrafts(): boolean; begin(keepSelection?: boolean): void; apply(project: Project): boolean; changed(): void }
interface Selection { target: StrokeTarget; project: Project; frame: number; generation: number; operation: number }
export function createStrokeEditor(host: HTMLElement, hooks: Hooks) {
  host.innerHTML = `<section id="stroke-editor" role="region" aria-label="Selected drawing strokes" hidden><h3>Selected drawing strokes</h3><p id="stroke-exposure" class="hint"></p><div id="stroke-list"></div><div id="stroke-appearance"><label class="field">Selected stroke color<input id="stroke-color" type="color" value="#563d75"></label><label class="field">Selected stroke width<input id="stroke-width" type="text" inputmode="decimal"></label><button id="stroke-apply">Apply stroke appearance</button><button id="stroke-discard">Discard stroke edits</button><button id="stroke-delete">Delete selected stroke</button></div><p id="stroke-status" aria-live="polite">Select a retained stroke in the list or on the canvas. Arrow keys move it in stage axes; Shift moves ten units.</p></section>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const color = get<HTMLInputElement>('stroke-color'), width = get<HTMLInputElement>('stroke-width');
  const rows = new Map<number, HTMLElement>(); let selection: Selection | null = null, dirty = false, invalid = false;
  function status(message: string) { get('stroke-status').textContent = message; }
  function chosen() { const state = hooks.state(), layer = state.project.layers.find(item => item.id === state.layerId); return layer?.kind === 'drawing' ? layer : null; }
  function currentStroke(): Stroke | null {
    if (!selection || invalid) return null;
    const state = hooks.state();
    if (selection.project !== state.project || selection.target.layerId !== state.layerId || selection.frame !== state.frame || selection.generation !== state.generation || selection.operation !== state.operation) return null;
    return chosen()?.cels.find(cel => cel.frame === selection!.target.celFrame)?.strokes[selection.target.strokeIndex] || null;
  }
  function bind(target: StrokeTarget, resetFields: boolean) {
    const state = hooks.state(); selection = { target: { ...target }, project: state.project, frame: state.frame, generation: state.generation, operation: state.operation }; invalid = false;
    const stroke = currentStroke(); if (!stroke) { selection = null; return; }
    if (resetFields) { color.value = stroke.color; width.value = String(stroke.width); dirty = false; }
  }
  function admit(): boolean {
    if (!dirty) return true;
    status('Apply or discard selected stroke edits before changing selection, frames, layers or projects. Raw values are kept.'); return false;
  }
  function select(index: number, alreadyAdmitted = false) {
    if (hooks.state().locked || (!alreadyAdmitted && (!hooks.admitOtherDrafts() || !admit()))) return;
    const drawing = chosen(); if (!drawing) return;
    const cel = evaluateDrawingCel(drawing, hooks.state().frame); if (!cel.strokes[index]) return;
    if (!alreadyAdmitted) hooks.begin();
    bind({ layerId: drawing.id, celFrame: cel.frame, strokeIndex: index }, true);
    status(`Stroke ${index + 1} selected. Editing changes this entire held drawing.`); update(); hooks.changed();
  }
  function retire() {
    if (dirty) { invalid = true; status('Newer editor intent retired this selection. Discard the retained raw stroke edits before selecting again.'); }
    else { selection = null; invalid = false; width.value = ''; }
  }
  function update() {
    const state = hooks.state(), drawing = chosen(); get('stroke-editor').hidden = !state.enabled;
    if (selection && (selection.project !== state.project || selection.frame !== state.frame || selection.target.layerId !== state.layerId)) retire();
    const cel = drawing ? evaluateDrawingCel(drawing, state.frame) : null;
    const end = drawing && cel ? (drawing.cels.find(item => item.frame > cel.frame)?.frame ?? state.project.frameCount) : 0;
    get('stroke-exposure').textContent = cel ? `Drawing from frame ${cel.frame + 1}, held through frame ${end}. These edits affect its whole exposure. List selection also reaches obscured or transparent paths.` : 'Select a drawing layer to edit retained strokes.';
    const list = get('stroke-list');
    for (const [index, row] of rows) if (!cel?.strokes[index]) { row.remove(); rows.delete(index); }
    for (const [index, stroke] of (cel?.strokes || []).entries()) {
      let row = rows.get(index);
      if (!row) {
        row = document.createElement('div'); const button = document.createElement('button'), detail = document.createElement('span');
        button.type = 'button'; button.textContent = `Stroke ${index + 1}`; button.dataset.strokeIndex = String(index); button.addEventListener('click', () => select(index));
        row.append(button, detail); rows.set(index, row); list.append(row);
      }
      const button = row.querySelector('button')!;
      button.disabled = state.locked; button.setAttribute('aria-pressed', String(!!currentStroke() && selection?.target.strokeIndex === index));
      row.querySelector('span')!.textContent = `${stroke.color} · ${stroke.width} px · ${stroke.points.length} ${stroke.points.length === 1 ? 'point' : 'points'}`;
    }
    if (!cel?.strokes.length) get('stroke-exposure').textContent += ' This drawing has no retained strokes.';
    const available = !!currentStroke(); color.disabled = state.locked || !available; width.disabled = state.locked || !available;
    get<HTMLButtonElement>('stroke-apply').disabled = state.locked || !available;
    get<HTMLButtonElement>('stroke-delete').disabled = state.locked || !available || dirty;
    get<HTMLButtonElement>('stroke-discard').disabled = state.locked || (!selection && !dirty);
  }
  function appearanceInput() {
    if (!selection) return;
    const target = { ...selection.target }; hooks.begin(true); bind(target, false); dirty = true;
    status('Unapplied stroke appearance. Apply valid values or discard; committed artwork is unchanged.'); update(); hooks.changed();
  }
  color.addEventListener('input', appearanceInput); width.addEventListener('input', appearanceInput);
  get('stroke-apply').addEventListener('click', () => {
    if (hooks.state().locked || !hooks.admitOtherDrafts() || !currentStroke() || !selection) return;
    const target = { ...selection.target }, raw = width.value;
    try {
      if (!raw.trim()) throw new Error('Enter a stroke width from 1 to 40. The raw value is kept.');
      const committed = currentStroke()!;
      // Native color inputs lowercase RGB. Keep the retained spelling when RGB is unchanged.
      const chosenColor = color.value === committed.color.toLowerCase() ? committed.color : color.value;
      const candidate = setStrokeAppearance(hooks.state().project, target, { color: chosenColor, width: Number(raw) });
      const changed = hooks.apply(candidate); bind(target, true); status(changed ? 'Stroke appearance applied.' : 'Stroke appearance is unchanged. No new edit was made.'); update(); hooks.changed();
    } catch (error) { status(error instanceof Error ? error.message : 'Could not apply this stroke appearance.'); }
  });
  get('stroke-discard').addEventListener('click', () => {
    if (hooks.state().locked) return;
    hooks.begin(true); dirty = false;
    if (selection && !invalid) bind(selection.target, true); else { selection = null; invalid = false; width.value = ''; }
    status('Raw stroke edits discarded. Committed artwork is unchanged.'); update(); hooks.changed();
  });
  function remove() {
    if (hooks.state().locked || !hooks.admitOtherDrafts() || !admit() || !selection || !currentStroke()) return;
    try { hooks.begin(true); bind(selection.target, false); const candidate = deleteStroke(hooks.state().project, selection.target); hooks.apply(candidate); dirty = false; selection = null; invalid = false; width.value = ''; status('Selected stroke deleted.'); update(); hooks.changed(); }
    catch (error) { status(error instanceof Error ? error.message : 'Could not delete this stroke.'); }
  }
  get('stroke-delete').addEventListener('click', remove);
  host.addEventListener('pointerdown', event => {
    if (!(event.target as HTMLElement).closest('#stroke-list button,#stroke-apply,#stroke-delete,#stroke-discard') || event.button !== 0) return;
    if (!hooks.admitOtherDrafts()) { event.preventDefault(); if (!(event.target as HTMLElement).closest('#stroke-discard')) event.stopImmediatePropagation(); return; }
    if ((event.target as HTMLElement).closest('#stroke-list button,#stroke-delete') && !admit()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  function overlay(context: CanvasRenderingContext2D, preview: Project) {
    context.clearRect(0, 0, 640, 360);
    if (!hooks.state().enabled || !selection || invalid) return;
    const drawing = preview.layers.find(item => item.id === selection!.target.layerId); if (!drawing || drawing.kind !== 'drawing') return;
    const stroke = drawing.cels.find(cel => cel.frame === selection!.target.celFrame)?.strokes[selection.target.strokeIndex]; if (!stroke) return;
    const pose = evaluatePose(drawing, hooks.state().frame);
    context.save(); context.translate(pose.x, pose.y); context.rotate(pose.rotation * Math.PI / 180); context.scale(pose.scale, pose.scale);
    const xs = stroke.points.map(point => point.x), ys = stroke.points.map(point => point.y), inset = stroke.width / 2 + 3 / pose.scale;
    context.strokeStyle = '#fff'; context.lineWidth = 3 / pose.scale;
    const box = [Math.min(...xs) - inset, Math.min(...ys) - inset, Math.max(...xs) - Math.min(...xs) + inset * 2, Math.max(...ys) - Math.min(...ys) + inset * 2] as const;
    context.strokeRect(...box); context.strokeStyle = '#a64812'; context.lineWidth = 1 / pose.scale; context.setLineDash([4 / pose.scale, 3 / pose.scale]); context.strokeRect(...box); context.restore();
  }
  return { update, select, admit, retire, overlay, remove, status,
    get unsaved() { return dirty; }, get target() { return currentStroke() && selection ? { ...selection.target } : null; },
    rebind(target: StrokeTarget) { bind(target, true); update(); },
  };
}
