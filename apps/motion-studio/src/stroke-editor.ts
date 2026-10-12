import { evaluateDrawingCel, evaluatePose, localPoint, type Point, type Pose, type Project, type Stroke } from './model.ts';
import { deleteStroke, duplicateStroke, reorderStroke, mirrorStroke, transformStroke, setStrokeAppearance, setStrokePoint, insertStrokeMidpoint, deleteStrokePoint, type StrokeTarget } from './stroke-edit.ts';

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
  host.innerHTML = `<section id="stroke-editor" role="region" aria-label="Selected drawing strokes" hidden><h3>Selected drawing strokes</h3><p id="stroke-exposure" class="hint"></p><div id="stroke-list"></div><div id="stroke-appearance"><label class="field">Selected stroke color<input id="stroke-color" type="color" value="#563d75"></label><label class="field">Selected stroke width<input id="stroke-width" type="text" inputmode="decimal"></label><button id="stroke-apply">Apply stroke appearance</button><button id="stroke-discard">Discard stroke edits</button><button id="stroke-duplicate">Duplicate selected stroke</button><button id="stroke-mirror-x">Mirror stroke horizontally</button><button id="stroke-mirror-y">Mirror stroke vertically</button><button id="stroke-grow">Grow stroke ×2</button><button id="stroke-shrink">Shrink stroke ×0.5</button><button id="stroke-rotate-cw">Rotate stroke clockwise 90°</button><button id="stroke-rotate-ccw">Rotate stroke counterclockwise 90°</button><button id="stroke-forward">Bring stroke forward</button><button id="stroke-backward">Send stroke backward</button><button id="stroke-delete">Delete selected stroke</button></div><fieldset id="stroke-points"><legend>Reshape a stroke point</legend><label class="field">Selected point<select id="stroke-point"></select></label><label class="field">Point local X<input id="stroke-point-x" type="text" inputmode="decimal"></label><label class="field">Point local Y<input id="stroke-point-y" type="text" inputmode="decimal"></label><button id="stroke-point-apply">Apply stroke point</button><button id="stroke-point-insert">Insert midpoint after point</button><button id="stroke-point-delete">Delete selected point</button><p class="hint">Coordinates belong to the drawing before layer poses. Each axis accepts −1280 to 1280. The ring marks the committed selected point. Discard stroke edits restores raw fields.</p></fieldset><p id="stroke-status" aria-live="polite">Select a retained stroke in the list or on the canvas. Arrow keys move it in stage axes; Shift moves ten units.</p></section>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const color = get<HTMLInputElement>('stroke-color'), width = get<HTMLInputElement>('stroke-width');
  const pointSelect = get<HTMLSelectElement>('stroke-point'), pointX = get<HTMLInputElement>('stroke-point-x'), pointY = get<HTMLInputElement>('stroke-point-y');
  const rows = new Map<number, HTMLElement>(); let selection: Selection | null = null, dirty = false, invalid = false, pointIndex = 0;
  let draftKind: 'appearance' | 'point' | null = null;
  function pointFields(stroke: Stroke) {
    pointIndex = Math.min(pointIndex, stroke.points.length - 1);
    pointSelect.replaceChildren(...stroke.points.map((_, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `Point ${index + 1}`; return option; }));
    pointSelect.value = String(pointIndex); pointX.value = String(stroke.points[pointIndex].x); pointY.value = String(stroke.points[pointIndex].y);
  }
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
    if (resetFields) { color.value = stroke.color; width.value = String(stroke.width); dirty = false; draftKind = null; pointFields(stroke); }
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
    pointIndex = 0;
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
    const available = !!currentStroke(); color.disabled = state.locked || !available || draftKind === 'point'; width.disabled = color.disabled;
    pointSelect.disabled = state.locked || !available || dirty;
    pointX.disabled = state.locked || !available || draftKind === 'appearance'; pointY.disabled = pointX.disabled;
    get<HTMLButtonElement>('stroke-point-apply').disabled = pointX.disabled;
    const stroke = currentStroke();
    get<HTMLButtonElement>('stroke-point-insert').disabled = state.locked || !stroke || dirty || pointIndex >= stroke.points.length - 1;
    get<HTMLButtonElement>('stroke-point-delete').disabled = state.locked || !stroke || dirty || stroke.points.length === 1;
    get<HTMLButtonElement>('stroke-apply').disabled = state.locked || !available || draftKind === 'point';
    for (const id of ['stroke-forward', 'stroke-backward', 'stroke-delete', 'stroke-duplicate', 'stroke-mirror-x', 'stroke-mirror-y', 'stroke-grow', 'stroke-shrink', 'stroke-rotate-cw', 'stroke-rotate-ccw']) get<HTMLButtonElement>(id).disabled = state.locked || !available || dirty;
    get<HTMLButtonElement>('stroke-discard').disabled = state.locked || (!selection && !dirty);
  }
  function appearanceInput() {
    if (!selection || draftKind === 'point') return;
    const target = { ...selection.target }; hooks.begin(true); bind(target, false); dirty = true; draftKind = 'appearance';
    status('Unapplied stroke appearance. Apply valid values or discard; committed artwork is unchanged.'); update(); hooks.changed();
  }
  color.addEventListener('input', appearanceInput); width.addEventListener('input', appearanceInput);
  get('stroke-apply').addEventListener('click', () => {
    if (hooks.state().locked || draftKind === 'point' || !hooks.admitOtherDrafts() || !currentStroke() || !selection) return;
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
    hooks.begin(true); dirty = false; draftKind = null;
    if (selection && !invalid) bind(selection.target, true); else { selection = null; invalid = false; width.value = ''; }
    status('Raw stroke edits discarded. Committed artwork is unchanged.'); update(); hooks.changed();
  });
  pointSelect.addEventListener('change', () => {
    if (hooks.state().locked || !hooks.admitOtherDrafts() || !admit()) { pointSelect.value = String(pointIndex); return; }
    const stroke = currentStroke(), index = Number(pointSelect.value);
    if (!stroke || !Number.isInteger(index) || index < 0 || index >= stroke.points.length) { pointSelect.value = String(pointIndex); return; }
    pointIndex = index; pointFields(stroke); status(`Point ${index + 1} selected in local drawing coordinates.`); hooks.changed();
  });
  function pointInput() {
    if (!selection || draftKind === 'appearance') return;
    const target = { ...selection.target }; hooks.begin(true); bind(target, false); dirty = true; draftKind = 'point';
    status('Unapplied stroke point. Apply valid coordinates or discard; committed artwork is unchanged.'); update(); hooks.changed();
  }
  pointX.addEventListener('input', pointInput); pointY.addEventListener('input', pointInput);
  get('stroke-point-apply').addEventListener('click', () => {
    if (hooks.state().locked || draftKind === 'appearance' || !hooks.admitOtherDrafts() || !currentStroke() || !selection) return;
    const target = { ...selection.target };
    try {
      if (!pointX.value.trim() || !pointY.value.trim()) throw new Error('Enter both local point coordinates. Raw values are kept.');
      const candidate = setStrokePoint(hooks.state().project, target, pointIndex, { x: Number(pointX.value), y: Number(pointY.value) });
      const changed = hooks.apply(candidate); bind(target, true);
      status(changed ? `Point ${pointIndex + 1} applied throughout this held drawing.` : 'Stroke point is unchanged. No new edit was made.'); update(); hooks.changed();
    } catch (error) { status(error instanceof Error ? error.message : 'Could not apply this stroke point.'); }
  });
  function topology(action: 'insert' | 'delete') {
    if (hooks.state().locked || !hooks.admitOtherDrafts() || !admit() || !selection || !currentStroke()) return;
    const target = { ...selection.target };
    try {
      const candidate = action === 'insert' ? insertStrokeMidpoint(hooks.state().project, target, pointIndex) : deleteStrokePoint(hooks.state().project, target, pointIndex);
      hooks.begin(true); bind(target, false);
      const changed = hooks.apply(candidate);
      if (changed && action === 'insert') pointIndex++;
      bind(target, true); status(action === 'insert' ? 'Midpoint inserted and selected. Edit its local coordinates to reshape the segment.' : 'Point deleted. Other points and brush appearance were kept.'); update(); hooks.changed();
    } catch (error) { status(error instanceof Error ? error.message : 'Could not change this stroke topology.'); }
  }
  get('stroke-point-insert').addEventListener('click', () => topology('insert'));
  get('stroke-point-delete').addEventListener('click', () => topology('delete'));
  function remove() {
    if (hooks.state().locked || !hooks.admitOtherDrafts() || !admit() || !selection || !currentStroke()) return;
    try { hooks.begin(true); bind(selection.target, false); const candidate = deleteStroke(hooks.state().project, selection.target); hooks.apply(candidate); dirty = false; selection = null; invalid = false; width.value = ''; status('Selected stroke deleted.'); update(); hooks.changed(); }
    catch (error) { status(error instanceof Error ? error.message : 'Could not delete this stroke.'); }
  }
  function reuse(action: 'forward' | 'backward' | 'duplicate' | 'horizontal' | 'vertical' | 'grow' | 'shrink' | 'clockwise' | 'counterclockwise') {
    if (hooks.state().locked || !hooks.admitOtherDrafts() || !admit() || !selection || !currentStroke()) return;
    const target = { ...selection.target };
    try {
      hooks.begin(true); bind(target, false);
      const candidate = action === 'forward' || action === 'backward' ? reorderStroke(hooks.state().project, target, action) : action === 'duplicate' ? duplicateStroke(hooks.state().project, target) : action === 'horizontal' || action === 'vertical' ? mirrorStroke(hooks.state().project, target, action) : transformStroke(hooks.state().project, target, action);
      const changed = hooks.apply(candidate);
      bind(changed && ['duplicate','forward','backward'].includes(action) ? { ...target, strokeIndex: target.strokeIndex + (action === 'backward' ? -1 : 1) } : target, true);
      status(changed ? action === 'forward' || action === 'backward' ? `Stroke moved ${action} in this drawing's paint order.` : action === 'duplicate' ? 'Independent stroke copy selected. Move it to reuse this shape.' : action === 'horizontal' || action === 'vertical' ? `Stroke mirrored ${action === 'horizontal' ? 'horizontally' : 'vertically'} in local drawing coordinates.` : 'Stroke transformed around its local bounds center. Brush width and layer poses are unchanged.' : 'Stroke geometry is unchanged. No new edit was made.');
      update(); hooks.changed();
    } catch (error) { status(error instanceof Error ? error.message : 'Could not reuse this stroke.'); update(); hooks.changed(); }
  }
  get('stroke-forward').addEventListener('click', () => reuse('forward'));
  get('stroke-backward').addEventListener('click', () => reuse('backward'));
  get('stroke-duplicate').addEventListener('click', () => reuse('duplicate'));
  get('stroke-mirror-x').addEventListener('click', () => reuse('horizontal'));
  get('stroke-mirror-y').addEventListener('click', () => reuse('vertical'));
  get('stroke-grow').addEventListener('click', () => reuse('grow'));
  get('stroke-shrink').addEventListener('click', () => reuse('shrink'));
  get('stroke-rotate-cw').addEventListener('click', () => reuse('clockwise'));
  get('stroke-rotate-ccw').addEventListener('click', () => reuse('counterclockwise'));
  get('stroke-delete').addEventListener('click', remove);
  // Label default clicks can still focus their control after pointerdown cancellation.
  // Guard the full point-entry surface before either focus path can blur a pose draft.
  for (const name of ['pointerdown', 'click'] as const) host.addEventListener(name, event => {
    if (name === 'pointerdown' && (event as PointerEvent).button !== 0) return;
    const element = event.target as HTMLElement;
    if (!element.closest('#stroke-points label,#stroke-points input,#stroke-points select,#stroke-point-apply')) return;
    if (!hooks.admitOtherDrafts() || (element.closest('#stroke-points label:has(select),#stroke-point') && !admit())) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  host.addEventListener('pointerdown', event => {
    if (!(event.target as HTMLElement).closest('#stroke-list button,#stroke-apply,#stroke-delete,#stroke-discard,#stroke-duplicate,#stroke-mirror-x,#stroke-mirror-y,#stroke-grow,#stroke-shrink,#stroke-rotate-cw,#stroke-rotate-ccw,#stroke-forward,#stroke-backward,#stroke-point-apply,#stroke-point,#stroke-point-insert,#stroke-point-delete') || event.button !== 0) return;
    if (!hooks.admitOtherDrafts()) { event.preventDefault(); if (!(event.target as HTMLElement).closest('#stroke-discard')) event.stopImmediatePropagation(); return; }
    if ((event.target as HTMLElement).closest('#stroke-list button,#stroke-delete,#stroke-duplicate,#stroke-mirror-x,#stroke-mirror-y,#stroke-grow,#stroke-shrink,#stroke-rotate-cw,#stroke-rotate-ccw,#stroke-forward,#stroke-backward,#stroke-point,#stroke-point-insert,#stroke-point-delete') && !admit()) { event.preventDefault(); event.stopImmediatePropagation(); }
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
    context.strokeRect(...box); context.strokeStyle = '#a64812'; context.lineWidth = 1 / pose.scale; context.setLineDash([4 / pose.scale, 3 / pose.scale]); context.strokeRect(...box);
    const vertex = stroke.points[pointIndex];
    if (vertex) { context.setLineDash([]); context.beginPath(); context.arc(vertex.x, vertex.y, 6 / pose.scale, 0, Math.PI * 2); context.strokeStyle = '#fff'; context.lineWidth = 3 / pose.scale; context.stroke(); context.strokeStyle = '#a64812'; context.lineWidth = 1 / pose.scale; context.stroke(); }
    context.restore();
  }
  return { update, select, admit, retire, overlay, remove, status,
    get unsaved() { return dirty; }, get target() { return currentStroke() && selection ? { ...selection.target } : null; },
    rebind(target: StrokeTarget) { bind(target, true); update(); },
  };
}
