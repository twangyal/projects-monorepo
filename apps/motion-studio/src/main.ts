import './style.css';
import { WIDTH, HEIGHT, FPS, MAX_JSON_BYTES, MAX_DRAWING_CELS, createProject, createDemo, createDrawingLayer, validateProject, evaluatePose, evaluateDrawingCel, addBlankDrawingCel, duplicateDrawingCel, removeDrawingCel, replaceDrawingCelStrokes, timelineResizeLoss, upsertKeyframe, removeKeyframe, resizeTimeline, localPoint, type Project, type Layer, type Pose, type Easing, type Point, type Stroke } from './model.ts';
import { History } from './history.ts';
import { loadAssets, closeAssets, renderFrame, type Assets } from './render.ts';
import { importImage, validateProjectImages } from './images.ts';
import { exportGif } from './export.ts';
import { readRawRecord, decodeSavedRecord, serializeRawRecord, saveProject, type RawRecord } from './storage.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<a class="skip" href="#stage-section">Skip to canvas</a>
<header><a class="brand" href="#"><span aria-hidden="true">m<span>•</span></span><div><h1>Motion Studio</h1><p>Small drawings. Big personality.</p></div></a><div class="header-actions"><span id="save-status" role="status">Opening your local studio…</span><button id="undo" title="Undo (Ctrl/⌘ Z)">Undo</button><button id="redo" title="Redo (Ctrl/⌘ Shift Z)">Redo</button><button id="new-project">New project</button></div></header>
<main><div class="intro"><div><p class="eyebrow">A LITTLE MOTION GOES A LONG WAY</p><h2>Make something move.</h2><p>Draw a character, give it a few poses, and watch it find its rhythm.</p></div><button id="load-demo" class="quiet">Try the orbit demo</button></div>
<div id="message" role="status" aria-live="polite" hidden></div>
<section id="recovery-panel" class="panel" role="region" aria-label="Saved draft recovery" hidden><h3>Saved draft recovery</h3><p>Your saved browser record is protected. Current edits stay in memory; save a project file to keep them.</p><p id="recovery-detail" role="status" aria-live="polite"></p><div class="recovery-actions"><button id="recovery-download">Download preserved record</button><button id="recovery-retry">Retry saved draft</button><button id="replace-saved-project">Replace saved project</button></div><p>Preserved-record JSON keeps the read record exactly when it is safe to serialize. It may need repair before it can open. Save project file downloads your current editable work separately.</p></section>
<div class="studio">
<aside class="tools panel"><div class="panel-heading"><h3>Make your mark</h3><span>01</span></div><div class="tool-content">
<div class="segmented"><button id="draw-mode" aria-pressed="true">✎ Draw</button><button id="move-mode" aria-pressed="false">↔ Move</button></div>
<label class="field">Ink color<input id="ink" type="color" value="#563d75"></label><label class="field">Brush width <output id="brush-value">6 px</output><input id="brush" type="range" min="1" max="40" value="6"></label><p class="hint">Draw on the selected drawing layer. Move places a pose at the current frame.</p>
<div class="rule"></div><div class="section-label"><h3>Layers</h3><span id="layer-count"></span></div><div id="layers" aria-label="Artwork layers"></div><div class="layer-actions"><button id="add-layer">+ Drawing layer</button><label class="file-button">+ Import image<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Import artwork image"></label></div><div class="small-actions"><button id="layer-down">Lower</button><button id="layer-up">Raise</button><button id="delete-layer">Delete layer</button></div><p class="hint">Up to 8 layers. PNG, JPEG or still WebP, up to 4 MiB.</p>
<div class="rule"></div><label class="field">Project title<input id="project-title" maxlength="80"></label><label class="field">Stage color<input id="background" type="color"></label><button id="backup" class="full">Save project file ↓</button><label class="file-button full subtle">Open project file<input id="project-file" type="file" accept="application/json,.json" aria-label="Open project file"></label>
</div></aside>
<section class="canvas-column" id="stage-section" aria-label="Animation stage"><div class="stage-bar"><div><strong id="stage-title">Your animation</strong><span id="demo-label">ORIGINAL DEMO</span></div><span>640 × 360 · 12 fps</span></div><div class="canvas-surround"><canvas id="stage" width="640" height="360" tabindex="0" aria-label="Drawing and animation canvas"></canvas></div>
<div class="transport panel"><button id="play" class="primary">Play animation</button><button id="first-frame" title="Go to the first frame">Start</button><label class="loop"><input id="loop" type="checkbox" checked> Loop</label><span id="time" class="mono">0.00 s / 4.00 s</span></div>
<div class="timeline panel"><div class="timeline-top"><h3>Every pose tells a story</h3><label class="duration">Duration <select id="duration"><option value="12">1 second</option><option value="24">2 seconds</option><option value="48">4 seconds</option><option value="72">6 seconds</option><option value="96">8 seconds</option></select></label></div><label class="scrubber">Frame <output id="frame-label">1 / 48</output><input id="frame" type="range" min="0" max="47" value="0" aria-label="Timeline frame"></label><div class="timeline-labels"><span>START</span><span>END</span></div><section id="drawing-timeline" aria-label="Selected layer drawings"><h3>Drawings</h3><p id="drawing-status"></p><div id="drawing-cels"></div><div class="cel-actions"><button id="add-blank-cel" aria-describedby="drawing-action-hint">Blank drawing at this frame</button><button id="duplicate-cel" aria-describedby="drawing-action-hint">Duplicate held drawing at this frame</button><button id="delete-cel" aria-describedby="drawing-action-hint">Delete active drawing</button></div><p id="drawing-action-hint" class="hint"></p></section><h3 class="key-heading">Pose keyframes</h3><div id="keys" aria-label="Selected layer keyframes"></div><p class="hint">Select a diamond to revisit a pose. The frames between poses are interpolated.</p></div>
<div class="export panel"><div><h3>Give your creation a little freedom.</h3><p>Animated GIF · 256 colors · loops forever</p></div><div class="export-buttons"><button id="png">Save frame PNG</button><button id="gif" class="primary">Export animation ↓</button><button id="cancel-export" hidden>Cancel export</button></div><progress id="export-progress" max="1" value="0" hidden aria-label="Animation export progress"></progress></div>
</section>
<aside class="pose-panel panel"><div class="panel-heading"><h3>Strike a pose</h3><span>02</span></div><div class="tool-content"><label class="field">Layer name<input id="layer-name" maxlength="40"></label><p id="pose-state" class="pose-state">Frame 1 · saved pose</p><div class="pair"><label class="field">Position X<input id="pose-x" type="text" inputmode="decimal" min="-640" max="1280" step="1"></label><label class="field">Position Y<input id="pose-y" type="text" inputmode="decimal" min="-360" max="720" step="1"></label></div><label class="field">Scale<input id="pose-scale" type="text" inputmode="decimal" min="0.1" max="4" step="0.05"></label><label class="field">Rotation (degrees)<input id="pose-rotation" type="text" inputmode="decimal" min="-720" max="720" step="5"></label><label class="field">Opacity<input id="pose-opacity" type="text" inputmode="decimal" min="0" max="1" step="0.05"></label><label class="field">Motion to next pose<select id="easing"><option value="linear">Steady / linear</option><option value="ease">Ease in & out</option><option value="hold">Hold this pose</option></select></label><p id="pose-draft-status" role="status" hidden></p><button id="discard-pose-edits" class="full" hidden>Discard pose edits</button><button id="set-key" class="primary full">Set keyframe</button><button id="remove-key" class="text-button">Remove this keyframe</button><p class="hint">Changing pose values sets a key at this frame. The first key always stays. Drawing edits the active held drawing until its next boundary.</p><div class="note"><span aria-hidden="true">✦</span><strong>Start with two poses.</strong><p>Set a pose at the start. Scrub near the end, move your layer, then press play.</p></div></div></aside>
</div><footer><span>Made here. Saved here. Your artwork stays in this browser.</span><span>Layer motion · no account required</span></footer></main>`;

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const canvas = el<HTMLCanvasElement>('stage'), ctx = canvas.getContext('2d')!;
let project = createDemo();
const history = new History(project);
let assets: Assets = new Map();
let selected = project.layers.at(-1)?.id || '';
let frame = 0, playing = false, mode: 'draw' | 'move' = 'draw';
let animation = 0, playStarted = 0, playFrom = 0;
let busy = true, exporting = false, operation = 0, generation = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveRevision = 0;
let pendingKind: 'import' | 'history' | 'reset' | 'replacement' | null = null;
let saveState: 'pending' | 'saved' | 'failed' = 'saved';
let exported: AbortController | null = null;
let isDemo = true;
let initialDemo = true;
let restorePending = true, recoveryBlocked = true;
let rawRecord: RawRecord | null = null;
let retryPending = false;
let recoveryDetail = '';
const drafts = new Map<string, string>();
const poseProperties = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
let pngRequest = 0;
let replacementRequest = 0;
let completedReplacementReceipt = 0;
const downloadUrls = new Set<string>();
type Geometry = { width: number; height: number; dpr: number; left: number; top: number; canvasWidth: number; canvasHeight: number };
interface Gesture { pointer: number; base: Project; preview: Project; start: Point; pose: Pose; stroke?: Stroke; moved: boolean; layerId: string; frame: number; celFrame: number | null; generation: number; operation: number; geometry: Geometry }
let gesture: Gesture | null = null;

function tell(text: string, error = false) { el('message').textContent = text; el('message').hidden = !text; el('message').classList.toggle('error', error); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'This operation could not be completed.'; }
function layer(): Layer | undefined { return project.layers.find(item => item.id === selected); }
function value(id: string, next: string) { const node = el<HTMLInputElement>(id); if (!drafts.has(id) && node.value !== next) node.value = next; }
function pause() { playing = false; cancelAnimationFrame(animation); el('play').textContent = 'Play animation'; }
function intent() { generation++; operation++; }
function draftControls() {
  const pending = drafts.size > 0;
  el('pose-draft-status').hidden = !pending;
  el('pose-draft-status').textContent = pending ? 'Unapplied editor values. Use Set keyframe to apply valid values, or discard edits before changing drawings, frames or projects. Downloads include committed work only.' : '';
  el('discard-pose-edits').hidden = !pending;
}
function admitDrafts(): boolean {
  if (!drafts.size) return true;
  tell('Apply valid editor values or discard edits before changing drawings, frames or projects.', true);
  return false;
}
function markDraft(id: string) { intent(); pause(); drafts.set(id, el<HTMLInputElement>(id).value); draftControls(); }
function recoveryMessage(text: string) { recoveryDetail = text; el('recovery-detail').textContent = text; }
function updateSaveState() { el('save-status').textContent = restorePending ? 'Opening your local studio…' : recoveryBlocked ? 'Local save unavailable · memory only; saved record protected' : saveState === 'pending' ? 'Saving locally…' : saveState === 'failed' ? 'Local save unavailable · keep a project file' : initialDemo ? 'Original demo · saved after your first edit' : 'Saved in this browser'; }
function scheduleSave() {
  clearTimeout(saveTimer);
  if (recoveryBlocked) { saveState = 'failed'; updateSaveState(); tell('The saved browser record is protected. Work stays in this page; download a project file before explicitly replacing the saved project.', true); return; }
  saveState = 'pending'; updateSaveState();
  const snapshot = structuredClone(project), revision = ++saveRevision;
  saveTimer = setTimeout(() => {
    void saveProject(snapshot).then(() => { if (revision === saveRevision) { saveState = 'saved'; updateSaveState(); } }).catch(error => {
      if (revision === saveRevision) { saveState = 'failed'; updateSaveState(); tell(`${errorMessage(error)} Save a project file to keep your work.`, true); }
    });
  }, 250);
}
function draw() { renderFrame(ctx, gesture?.preview || project, frame, assets); canvas.dataset.frame = String(frame); }
function controls() {
  const locked = busy || exporting || !!gesture;
  el('recovery-panel').hidden = restorePending || !recoveryBlocked;
  for (const id of ['recovery-download', 'recovery-retry', 'replace-saved-project']) el<HTMLButtonElement>(id).disabled = locked || retryPending;
  for (const node of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('.studio input,.studio button,.studio select,header button,#load-demo')) node.disabled = locked;
  el<HTMLButtonElement>('cancel-export').disabled = false;
  el<HTMLButtonElement>('undo').disabled = locked || !history.canUndo;
  el<HTMLButtonElement>('redo').disabled = locked || !history.canRedo;
  el<HTMLButtonElement>('add-layer').disabled = locked || project.layers.length >= 8;
  el<HTMLInputElement>('image-file').disabled = exporting || (busy && pendingKind !== 'import') || !!gesture || project.layers.length >= 8;
  el<HTMLInputElement>('project-file').disabled = exporting || (busy && pendingKind !== 'import') || !!gesture;
  const chosen = layer(), index = project.layers.findIndex(item => item.id === selected);
  el<HTMLButtonElement>('layer-down').disabled = locked || index <= 0;
  el<HTMLButtonElement>('layer-up').disabled = locked || index < 0 || index >= project.layers.length - 1;
  for (const id of ['delete-layer', 'layer-name', 'set-key', 'pose-x', 'pose-y', 'pose-scale', 'pose-rotation', 'pose-opacity', 'easing']) el<HTMLInputElement>(id).disabled = locked || !chosen;
  el<HTMLButtonElement>('remove-key').disabled = locked || !chosen || frame === 0 || !chosen.keys.some(key => key.frame === frame);
  const drawing = chosen?.kind === 'drawing' ? chosen : null;
  const active = drawing ? evaluateDrawingCel(drawing, frame) : null;
  const occupied = drawing?.cels.some(cel => cel.frame === frame);
  for (const id of ['add-blank-cel', 'duplicate-cel']) {
    const button = el<HTMLButtonElement>(id);
    button.disabled = locked || !drawing;
    // Keep focus on the inserting action while its newly occupied boundary is unavailable.
    button.setAttribute('aria-disabled', String(locked || !drawing || !!occupied || drawing.cels.length >= MAX_DRAWING_CELS));
  }
  el<HTMLButtonElement>('delete-cel').disabled = locked || !active || active.frame === 0;
  el<HTMLButtonElement>('discard-pose-edits').disabled = locked;
  draftControls();
  canvas.setAttribute('aria-disabled', String(locked));
  el('cancel-export').hidden = !exporting; el('export-progress').hidden = !exporting;
}
function poseFields() {
  const chosen = layer();
  if (!chosen) { el('pose-state').textContent = 'Add or select a layer to create a pose.'; return; }
  const pose = evaluatePose(chosen, frame), key = chosen.keys.find(item => item.frame === frame);
  for (const property of poseProperties) value(`pose-${property}`, String(pose[property]));
  value('easing', key?.easing || chosen.keys.filter(item => item.frame <= frame).at(-1)?.easing || 'linear');
  value('layer-name', chosen.name); el('pose-state').textContent = `Frame ${frame + 1} · ${key ? 'keyframe' : 'between poses'}`;
}
function refresh() {
  if (!project.layers.some(item => item.id === selected)) selected = project.layers.at(-1)?.id || '';
  frame = Math.max(0, Math.min(project.frameCount - 1, frame));
  value('project-title', project.title); value('background', project.background);
  el('stage-title').textContent = project.title; el('demo-label').hidden = !isDemo;
  const duration = el<HTMLSelectElement>('duration');
  if (![...duration.options].some(option => Number(option.value) === project.frameCount)) duration.add(new Option(`${(project.frameCount / FPS).toFixed(2)} seconds`, String(project.frameCount)));
  duration.value = String(project.frameCount);
  el('layer-count').textContent = `${project.layers.length} / 8`;
  const list = el('layers'); list.replaceChildren();
  for (const item of [...project.layers].reverse()) {
    const button = document.createElement('button'); button.className = 'layer'; button.textContent = `${item.kind === 'drawing' ? '✎' : '▧'}  ${item.name}`;
    button.setAttribute('aria-pressed', String(item.id === selected)); button.dataset.layerId = item.id;
    button.addEventListener('click', () => { if (!admitDrafts() || busy || exporting || gesture) return; pause(); intent(); selected = item.id; refresh(); }); list.append(button);
  }
  renderTimeline(); poseFields(); controls(); draw(); updateSaveState();
}
function renderTimeline() {
  const slider = el<HTMLInputElement>('frame'); slider.max = String(project.frameCount - 1); slider.value = String(frame);
  el('frame-label').textContent = `${frame + 1} / ${project.frameCount}`;
  el('time').textContent = `${(frame / FPS).toFixed(2)} s / ${(project.frameCount / FPS).toFixed(2)} s`;
  const keys = el('keys'); keys.replaceChildren();
  for (const key of layer()?.keys || []) {
    const button = document.createElement('button'); button.className = 'key'; button.textContent = `◆ ${key.frame + 1}`;
    button.setAttribute('aria-label', `Keyframe at frame ${key.frame + 1}`); button.setAttribute('aria-pressed', String(key.frame === frame));
    button.addEventListener('click', () => seek(key.frame)); keys.append(button);
  }
  renderDrawings();
}
function renderDrawings() {
  const chosen = layer(), list = el('drawing-cels');
  const focused = document.activeElement instanceof HTMLButtonElement && list.contains(document.activeElement) ? document.activeElement.dataset.celFrame : undefined;
  list.replaceChildren();
  if (!chosen || chosen.kind !== 'drawing') {
    el('drawing-status').textContent = chosen ? 'Imported artwork stays the same; animate its pose.' : 'Select a drawing layer to edit held drawings.';
    el('drawing-action-hint').textContent = 'Drawing actions apply to drawing layers only.';
    return;
  }
  const active = evaluateDrawingCel(chosen, frame), index = chosen.cels.findIndex(cel => cel.frame === active.frame);
  const end = (chosen.cels[index + 1]?.frame ?? project.frameCount) - 1;
  el('drawing-status').textContent = `Editing drawing from frame ${active.frame + 1} · held through frame ${end + 1}. Current frame ${frame + 1}. A stroke changes this drawing at frames ${active.frame + 1}–${end + 1}.`;
  for (let i = 0; i < chosen.cels.length; i++) {
    const cel = chosen.cels[i], through = chosen.cels[i + 1]?.frame ?? project.frameCount;
    const button = document.createElement('button'); button.className = 'cel'; button.dataset.celFrame = String(cel.frame);
    button.textContent = `${cel.strokes.length ? 'Drawing' : 'Blank'} ${cel.frame + 1}–${through}`;
    button.setAttribute('aria-label', `Drawing from frame ${cel.frame + 1}, held through frame ${through}`);
    button.setAttribute('aria-pressed', String(cel.frame === active.frame));
    button.addEventListener('click', () => seek(cel.frame)); list.append(button);
  }
  const occupied = chosen.cels.some(cel => cel.frame === frame);
  const insertion = occupied ? 'A drawing already starts here; edit it or choose another frame.' : chosen.cels.length >= MAX_DRAWING_CELS ? 'This layer has reached its 24-drawing limit.' : 'Blank or duplicate starts a new held drawing at the current frame. Copies consume the project drawing budget.';
  el('drawing-action-hint').textContent = `${insertion} ${active.frame === 0 ? 'The first drawing cannot be deleted.' : `Delete removes the drawing from frame ${active.frame + 1}; the preceding drawing holds through frame ${end + 1}. Undo can restore it.`}`;
  if (focused !== undefined) [...list.querySelectorAll<HTMLButtonElement>('button')].find(button => button.dataset.celFrame === focused)?.focus({ preventScroll: true });
}
function commit(next: Project): boolean {
  const safe = validateProject(next);
  if (!history.commit(safe)) { refresh(); return false; }
  intent(); isDemo = false; initialDemo = false; project = history.current; refresh(); scheduleSave(); return true;
}
function edit(action: (next: Project) => void) {
  if (busy || exporting || gesture || !admitDrafts()) return;
  pause(); const next = structuredClone(project);
  try { action(next); commit(next); } catch (error) { tell(errorMessage(error), true); refresh(); }
}
function changeLayer(action: (chosen: Layer) => Layer) {
  edit(next => { const index = next.layers.findIndex(item => item.id === selected); if (index < 0) throw new Error('Select a layer first.'); next.layers[index] = action(next.layers[index]); });
}
function seek(next: number) { if (busy || exporting || gesture || !admitDrafts()) { el<HTMLInputElement>('frame').value = String(frame); return; } pause(); intent(); frame = Math.max(0, Math.min(project.frameCount - 1, next)); renderTimeline(); poseFields(); controls(); draw(); }
function tick(now: number) {
  const next = playFrom + Math.floor((now - playStarted) * FPS / 1000);
  if (next >= project.frameCount && !el<HTMLInputElement>('loop').checked) { frame = project.frameCount - 1; pause(); }
  else frame = next % project.frameCount;
  renderTimeline(); poseFields(); controls(); draw();
  if (playing) animation = requestAnimationFrame(tick);
}
el('play').addEventListener('click', () => {
  if (busy || exporting || gesture || !admitDrafts()) return;
  if (playing) { pause(); return; }
  intent();
  playing = true; playFrom = frame === project.frameCount - 1 ? 0 : frame; playStarted = performance.now(); el('play').textContent = 'Pause animation'; animation = requestAnimationFrame(tick);
});
el('first-frame').addEventListener('click', () => seek(0));
el<HTMLInputElement>('frame').addEventListener('input', event => seek(Number((event.target as HTMLInputElement).value)));
el<HTMLSelectElement>('duration').addEventListener('change', event => {
  const input = event.target as HTMLSelectElement;
  if (busy || exporting || gesture || !admitDrafts()) { input.value = String(project.frameCount); return; }
  const base = project, token = operation, revision = generation, selectedLayer = selected, selectedFrame = frame;
  try {
    const count = Number(input.value), loss = timelineResizeLoss(base, count);
    // Full endpoint/cap admission happens before asking to discard authored entries.
    const candidate = resizeTimeline(base, count, { discardLater: true });
    if (loss.removedCels.length || loss.removedKeys.length) {
      const describe = (entries: { layerId: string; frame: number }[]) => entries.map(entry => `${base.layers.find(item => item.id === entry.layerId)!.name}: frame ${entry.frame + 1}`).join(', ') || 'none';
      if (!window.confirm(`Shorten from ${base.frameCount} to ${count} frames? Remove ${loss.removedCels.length} drawings (${describe(loss.removedCels)}) and ${loss.removedKeys.length} pose keyframes (${describe(loss.removedKeys)}). Undo is available only in this session. Cancel keeps all artwork and poses.`)) { input.value = String(project.frameCount); return; }
    }
    if (project !== base || token !== operation || revision !== generation || selected !== selectedLayer || frame !== selectedFrame || gesture || drafts.size) { input.value = String(project.frameCount); tell('The editor changed. Duration was kept; review shortening again.', true); return; }
    pause(); commit(candidate);
  } catch (error) { input.value = String(project.frameCount); tell(errorMessage(error), true); }
});

function changeCel(kind: 'blank' | 'duplicate' | 'delete') {
  const action = el<HTMLButtonElement>(kind === 'blank' ? 'add-blank-cel' : kind === 'duplicate' ? 'duplicate-cel' : 'delete-cel');
  if (action.disabled || action.getAttribute('aria-disabled') === 'true') return;
  if (busy || exporting || gesture || !admitDrafts()) return;
  const chosen = layer(); if (!chosen || chosen.kind !== 'drawing') return;
  pause();
  try {
    const active = evaluateDrawingCel(chosen, frame);
    const next = kind === 'blank' ? addBlankDrawingCel(project, selected, frame) : kind === 'duplicate' ? duplicateDrawingCel(project, selected, frame) : removeDrawingCel(project, selected, active.frame);
    if (commit(next)) {
      tell(kind === 'delete' ? `Drawing from frame ${active.frame + 1} removed. The preceding drawing now holds here; Undo can restore it.` : kind === 'blank' ? `Blank drawing starts at frame ${frame + 1}.` : `Independent drawing copy starts at frame ${frame + 1}.`);
      if (kind === 'delete') {
        const held = evaluateDrawingCel(layer() as Extract<Layer, { kind: 'drawing' }>, frame);
        [...el('drawing-cels').querySelectorAll<HTMLButtonElement>('button')].find(button => Number(button.dataset.celFrame) === held.frame)?.focus({ preventScroll: true });
      }
    }
  } catch (error) { tell(errorMessage(error), true); controls(); }
}
el('add-blank-cel').addEventListener('click', () => changeCel('blank'));
el('duplicate-cel').addEventListener('click', () => changeCel('duplicate'));
el('delete-cel').addEventListener('click', () => changeCel('delete'));

function selectMode(next: 'draw' | 'move') { mode = next; el('draw-mode').setAttribute('aria-pressed', String(mode === 'draw')); el('move-mode').setAttribute('aria-pressed', String(mode === 'move')); canvas.dataset.mode = mode; }
el('draw-mode').addEventListener('click', () => { if (admitDrafts()) selectMode('draw'); });
el('move-mode').addEventListener('click', () => { if (admitDrafts()) selectMode('move'); });
el<HTMLInputElement>('brush').addEventListener('input', event => { el('brush-value').textContent = `${(event.target as HTMLInputElement).value} px`; });
function stagePoint(event: PointerEvent): Point { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height }; }
function checkedPoint(point: Point, pose: Pose): Point {
  const local = localPoint(point, pose);
  if (Math.abs(local.x) > 1280 || Math.abs(local.y) > 1280) throw new Error('This point is outside the artwork bounds at this scale. Increase the layer scale or draw closer to its center.');
  return local;
}
function drawingCounts(target: Project) {
  let strokes = 0, points = 0;
  for (const item of target.layers) if (item.kind === 'drawing') for (const cel of item.cels) for (const stroke of cel.strokes) { strokes++; points += stroke.points.length; }
  return { strokes, points };
}
function geometry(): Geometry {
  const rect = canvas.getBoundingClientRect();
  return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, left: rect.left, top: rect.top, canvasWidth: rect.width, canvasHeight: rect.height };
}
function ownsGesture(active: Gesture): boolean {
  const current = geometry();
  return active.generation === generation && active.operation === operation && active.layerId === selected && active.frame === frame &&
    (Object.keys(current) as (keyof Geometry)[]).every(key => current[key] === active.geometry[key]);
}
function cancelGesture() {
  if (!gesture) return;
  const cancelled = gesture; gesture = null;
  if (canvas.hasPointerCapture(cancelled.pointer)) canvas.releasePointerCapture(cancelled.pointer);
  controls(); draw();
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || busy || exporting || gesture || !admitDrafts()) return;
  const chosen = layer();
  if (!chosen) { tell('Add a drawing layer or import artwork first.', true); return; }
  if (mode === 'draw' && chosen.kind !== 'drawing') { tell('Select a drawing layer to draw, or choose Move to position this image.', true); return; }
  pause(); intent(); canvas.focus({ preventScroll: true });
  const point = stagePoint(event), pose = evaluatePose(chosen, frame), preview = structuredClone(project);
  const celFrame = chosen.kind === 'drawing' ? evaluateDrawingCel(chosen, frame).frame : null;
  let local: Point | null = null;
  if (mode === 'draw') {
    try {
      local = checkedPoint(point, pose);
      const counts = drawingCounts(project);
      if (counts.strokes >= 100 || counts.points >= 10000) throw new Error('This project has reached its drawing limit (100 strokes or 10,000 points). Delete a drawing layer or undo a stroke first.');
    } catch (error) { tell(errorMessage(error), true); return; }
  }
  gesture = { pointer: event.pointerId, base: project, preview, start: point, pose, moved: false, layerId: chosen.id, frame, celFrame, generation, operation, geometry: geometry() };
  if (mode === 'draw') {
    const stroke: Stroke = { color: el<HTMLInputElement>('ink').value, width: Number(el<HTMLInputElement>('brush').value), points: [local!] };
    const target = preview.layers.find(item => item.id === selected)!;
    if (target.kind === 'drawing') target.cels.find(cel => cel.frame === celFrame)!.strokes.push(stroke);
    gesture.stroke = stroke;
  }
  canvas.setPointerCapture(event.pointerId); controls(); draw(); event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  if (!ownsGesture(gesture)) { cancelGesture(); return; }
  const point = stagePoint(event);
  if (gesture.stroke) {
    try {
      const local = checkedPoint(point, gesture.pose), last = gesture.stroke.points.at(-1)!;
      if (Math.hypot(local.x - last.x, local.y - last.y) >= 1) {
        if (gesture.stroke.points.length >= 1000 || drawingCounts(gesture.preview).points >= 10000) throw new Error('This stroke would exceed the drawing point limit. Try a shorter stroke.');
        gesture.stroke.points.push(local);
      }
    } catch (error) { tell(errorMessage(error), true); endGesture(event, true); return; }
  } else {
    const pose = { ...gesture.pose, x: Math.max(-640, Math.min(1280, gesture.pose.x + point.x - gesture.start.x)), y: Math.max(-360, Math.min(720, gesture.pose.y + point.y - gesture.start.y)) };
    gesture.moved = pose.x !== gesture.pose.x || pose.y !== gesture.pose.y;
    const index = gesture.preview.layers.findIndex(item => item.id === gesture!.layerId);
    try { gesture.preview.layers[index] = upsertKeyframe(gesture.preview.layers[index], gesture.frame, pose); }
    catch (error) { tell(errorMessage(error), true); endGesture(event, true); return; }
  }
  draw();
});
function endGesture(event: PointerEvent, cancelled: boolean) {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  if (cancelled || !ownsGesture(gesture)) { cancelGesture(); return; }
  const completed = gesture; gesture = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (completed.stroke || completed.moved) {
    try {
      const chosen = completed.preview.layers.find(item => item.id === completed.layerId)!;
      const next = completed.stroke && chosen.kind === 'drawing' ? replaceDrawingCelStrokes(completed.base, completed.layerId, completed.celFrame!, chosen.cels.find(cel => cel.frame === completed.celFrame)!.strokes) : completed.preview;
      commit(next); tell('');
    } catch (error) { tell(errorMessage(error), true); refresh(); }
  } else { controls(); draw(); }
}
canvas.addEventListener('pointerup', event => endGesture(event, false));
canvas.addEventListener('pointercancel', event => endGesture(event, true));
canvas.addEventListener('lostpointercapture', event => { if (gesture) endGesture(event as PointerEvent, true); });

function setPose() {
  const chosen = layer(); if (!chosen || busy || exporting || gesture) return;
  const pose = Object.fromEntries(poseProperties.map(property => [property, el<HTMLInputElement>(`pose-${property}`).value.trim() === '' ? NaN : Number(el<HTMLInputElement>(`pose-${property}`).value)])) as Pose;
  try {
    const next = structuredClone(project), index = next.layers.findIndex(item => item.id === chosen.id);
    if (drafts.has('project-title')) next.title = el<HTMLInputElement>('project-title').value;
    if (drafts.has('layer-name')) next.layers[index].name = el<HTMLInputElement>('layer-name').value;
    next.layers[index] = upsertKeyframe(next.layers[index], frame, pose, el<HTMLSelectElement>('easing').value as Easing);
    // Admission precedes clearing raw fields. Invalid values remain exact and editable.
    const safe = validateProject(next);
    drafts.clear(); pause(); commit(safe); tell('');
  } catch (error) { tell(errorMessage(error), true); draftControls(); }
}
for (const property of poseProperties) {
  const input = el<HTMLInputElement>(`pose-${property}`);
  input.addEventListener('input', () => markDraft(`pose-${property}`));
  input.addEventListener('change', setPose);
}
el('set-key').addEventListener('click', setPose);
el('easing').addEventListener('change', () => { markDraft('easing'); setPose(); });
el('remove-key').addEventListener('click', () => changeLayer(item => removeKeyframe(item, frame)));
function editName(id: 'project-title' | 'layer-name') {
  if (busy || exporting || gesture) return;
  markDraft(id);
  const raw = el<HTMLInputElement>(id).value;
  if ([...drafts.keys()].some(key => key !== id)) { admitDrafts(); return; }
  try {
    const next = structuredClone(project);
    if (id === 'project-title') next.title = raw;
    else { const chosen = next.layers.find(item => item.id === selected); if (!chosen) return; chosen.name = raw; }
    const safe = validateProject(next); drafts.delete(id); commit(safe);
  } catch (error) { tell(errorMessage(error), true); draftControls(); }
}
el<HTMLInputElement>('layer-name').addEventListener('input', () => editName('layer-name'));
el<HTMLInputElement>('project-title').addEventListener('input', () => editName('project-title'));
for (const id of ['project-title', 'layer-name']) el<HTMLInputElement>(id).addEventListener('change', event => {
  if (!(event.target as HTMLInputElement).value.trim()) { tell('A name cannot be empty. Apply a valid name or discard edits; the committed name is kept.', true); }
});
el('discard-pose-edits').addEventListener('click', () => {
  if (busy || exporting || gesture) return;
  intent(); drafts.clear(); refresh(); tell('Unapplied editor values discarded. Committed artwork and poses are unchanged.');
});
el<HTMLInputElement>('background').addEventListener('input', event => edit(next => { next.background = (event.target as HTMLInputElement).value; }));
el('add-layer').addEventListener('click', () => edit(next => { const added = createDrawingLayer(`Drawing ${next.layers.length + 1}`); next.layers.push(added); selected = added.id; selectMode('draw'); }));
el('delete-layer').addEventListener('click', () => edit(next => { next.layers = next.layers.filter(item => item.id !== selected); }));
for (const [id, delta] of [['layer-down', -1], ['layer-up', 1]] as const) el(id).addEventListener('click', () => edit(next => {
  const index = next.layers.findIndex(item => item.id === selected), target = index + delta;
  if (index < 0 || target < 0 || target >= next.layers.length) return;
  [next.layers[index], next.layers[target]] = [next.layers[target], next.layers[index]];
}));

function matchingAssets(next: Project): boolean {
  const images = next.layers.filter(item => item.kind === 'image');
  return images.length === assets.size && images.every(item => assets.has(item.id) && project.layers.some(old => old.id === item.id && old.kind === 'image' && old.image.dataUrl === item.image.dataUrl));
}
async function travel(direction: 'undo' | 'redo') {
  if (busy || exporting || gesture || !admitDrafts()) return;
  if (direction === 'undo' ? !history.canUndo : !history.canRedo) return;
  pause(); intent(); const token = operation, revision = generation; busy = true; pendingKind = 'history'; controls();
  const next = history.peek(direction); let prepared: Assets | null = null;
  try {
    if (!matchingAssets(next)) prepared = await loadAssets(next);
    if (token !== operation || revision !== generation || drafts.size || gesture) { if (prepared) closeAssets(prepared); return; }
    // Cursor movement and publication are synchronous and occur only after owned decode succeeds.
    const admitted = history[direction]();
    if (prepared) { closeAssets(assets); assets = prepared; }
    project = admitted; isDemo = false; initialDemo = false; refresh(); scheduleSave();
  } catch (error) { if (token === operation) tell(errorMessage(error), true); }
  finally { if (token === operation) { busy = false; pendingKind = null; controls(); } }
}
el('undo').addEventListener('click', () => void travel('undo'));
el('redo').addEventListener('click', () => void travel('redo'));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && gesture) { event.preventDefault(); cancelGesture(); return; }
  if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void travel(event.shiftKey ? 'redo' : 'undo'); }
  if (event.code === 'Space' && event.target === canvas) { event.preventDefault(); el('play').click(); }
});

async function replaceProject(next: Project, token: number, reset: boolean) {
  const safe = validateProject(next); await validateProjectImages(safe);
  if (token !== operation || drafts.size || gesture) return false;
  const prepared = await loadAssets(safe);
  if (token !== operation || drafts.size || gesture) { closeAssets(prepared); return false; }
  closeAssets(assets); assets = prepared;
  if (reset) history.reset(safe); else history.commit(safe);
  project = history.current; selected = project.layers.at(-1)?.id || ''; frame = 0; isDemo = false; initialDemo = false;
  generation++; refresh(); scheduleSave(); return true;
}
async function importFile(input: HTMLInputElement, kind: 'image' | 'project') {
  const file = input.files?.[0]; input.value = ''; if (!file || exporting || gesture || (busy && pendingKind !== 'import') || !admitDrafts()) return;
  pause(); intent(); const token = operation; busy = true; pendingKind = 'import'; controls();
  try {
    let next: Project;
    if (kind === 'image') { const added = await importImage(file); next = structuredClone(project); next.layers.push(added); }
    else { if (file.size > MAX_JSON_BYTES) throw new Error(`Choose a project file no larger than ${MAX_JSON_BYTES.toLocaleString('en-US')} bytes (6 MiB plus the legacy migration allowance).`); next = validateProject(JSON.parse(await file.text())); }
    if (token !== operation) return;
    if (await replaceProject(next, token, kind === 'project')) { tell(kind === 'image' ? 'Artwork imported. Set a few poses to bring it to life.' : 'Project opened. Your embedded artwork and poses are ready.'); if (kind === 'image') selectMode('move'); }
  } catch (error) { if (token === operation) tell(`${errorMessage(error)} Your current project is unchanged.`, true); }
  finally { if (token === operation) { busy = false; pendingKind = null; controls(); } }
}
el<HTMLInputElement>('image-file').addEventListener('change', event => void importFile(event.target as HTMLInputElement, 'image'));
el<HTMLInputElement>('project-file').addEventListener('change', event => void importFile(event.target as HTMLInputElement, 'project'));
async function fresh(demo: boolean) {
  if (busy || exporting || gesture || !admitDrafts() || !window.confirm('Replace the current project? Save a project file first if you want to keep it.')) return;
  pause(); intent(); const token = operation; busy = true; pendingKind = 'reset'; controls();
  try { if (await replaceProject(demo ? createDemo() : createProject(), token, true)) { isDemo = demo; selectMode('draw'); tell(demo ? 'Original orbit demo loaded. Try moving a pose or drawing a new layer.' : 'A fresh canvas. Draw something, then add a pose near the end.'); } }
  catch (error) { if (token === operation) tell(errorMessage(error), true); }
  finally { if (token === operation) { busy = false; pendingKind = null; refresh(); } }
}
el('replace-saved-project').addEventListener('click', async () => {
  if (busy || exporting || gesture || !admitDrafts() || !recoveryBlocked || restorePending || retryPending) return;
  const reviewed = project, reviewedOperation = operation, reviewedGeneration = generation;
  if (!window.confirm('Replace the preserved browser record with the current project? Download your current project file first. This replaces the old saved artwork.')) return;
  if (reviewed !== project || reviewedOperation !== operation || reviewedGeneration !== generation || drafts.size || gesture) { tell('The editor changed. Review replacement again; the saved record is kept.', true); return; }
  pause(); intent(); const token = operation, revision = generation, request = ++replacementRequest;
  busy = true; pendingKind = 'replacement'; clearTimeout(saveTimer); saveRevision++; controls();
  const snapshot = validateProject(project);
  try {
    await saveProject(snapshot);
    // Serialized writes may commit A while a newer explicit B request is already queued.
    // Record actual durable success independently of who owns the current UI request.
    if (request > completedReplacementReceipt) {
      completedReplacementReceipt = request;
      if (recoveryBlocked) rawRecord = { present: true, value: snapshot };
    }
    if (request !== replacementRequest) return;
    if (token === operation && revision === generation && project === reviewed && !drafts.size && !gesture) {
      recoveryBlocked = false; rawRecord = null; isDemo = false; initialDemo = false; saveState = 'saved';
      tell('Saved project explicitly replaced. Automatic saving is enabled.');
    } else if (recoveryBlocked) {
      // The transaction really committed A, but a newer editor intent/work B owns this page.
      // Preserve the known durable receipt without implying B was saved or enabling autosave.
      saveState = 'failed';
      const detail = 'The earlier captured project was saved. Newer memory work is not saved; download it or explicitly replace the saved project again.';
      recoveryMessage(detail); if (!busy) tell(detail, true);
    }
  } catch (error) {
    if (request === replacementRequest && recoveryBlocked) {
      saveState = 'failed'; recoveryMessage(errorMessage(error));
      if (token === operation || !busy) tell(`${errorMessage(error)} The browser record remains protected; current memory work is not saved.`, true);
    }
  } finally {
    // A stale write cannot unlock a newer import/history/replacement operation.
    if (request === replacementRequest) {
      if (token === operation) { busy = false; pendingKind = null; }
      updateSaveState(); controls();
    }
  }
});
el('new-project').addEventListener('click', () => void fresh(false));
el('load-demo').addEventListener('click', () => void fresh(true));
function download(blob: Blob, suffix: string, title = project.title) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url;
  downloadUrls.add(url);
  anchor.download = `${title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'motion'}${suffix}`; anchor.click(); setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 10000);
}
el('backup').addEventListener('click', () => {
  if (busy || exporting || gesture) return;
  download(new Blob([JSON.stringify(validateProject(project))], { type: 'application/json' }), '.motion.json');
  tell(`Editable project file downloaded. It includes every committed drawing and pose.${drafts.size ? ' Unapplied editor values are not included.' : ''}`);
});
el('png').addEventListener('click', () => {
  if (busy || exporting || gesture || !admitDrafts()) return;
  pause(); const snapshot = validateProject(project), capturedFrame = frame, token = operation, revision = generation, request = ++pngRequest;
  const output = document.createElement('canvas'); output.width = WIDTH; output.height = HEIGHT;
  try {
    renderFrame(output.getContext('2d')!, snapshot, capturedFrame, assets);
    output.toBlob(blob => {
      if (request !== pngRequest || token !== operation || revision !== generation || gesture) return;
      if (blob) { download(blob, `-frame-${capturedFrame + 1}.png`, snapshot.title); tell('Committed frame PNG downloaded.'); }
      else tell('Could not create a PNG. Your artwork is still editable.', true);
    }, 'image/png');
  } catch (error) { tell(errorMessage(error), true); }
});
el('gif').addEventListener('click', async () => {
  if (busy || exporting || gesture || !admitDrafts()) return;
  pause(); const snapshot = validateProject(project), token = operation, revision = generation, controller = new AbortController();
  exporting = true; exported = controller; controls(); el<HTMLProgressElement>('export-progress').value = 0; tell('Rendering your animation locally…');
  try {
    const blob = await exportGif(snapshot, progress => { if (exported === controller && token === operation) el<HTMLProgressElement>('export-progress').value = progress; }, controller.signal);
    if (exported !== controller || token !== operation || revision !== generation || controller.signal.aborted) return;
    download(blob, '.gif', snapshot.title); tell('Your animated GIF is ready. Colors use a fixed 256-color palette.');
  } catch (error) { if (exported === controller && token === operation) tell(error instanceof Error && error.name === 'AbortError' ? 'Export cancelled. Your project is unchanged.' : errorMessage(error), !(error instanceof Error && error.name === 'AbortError')); }
  finally { if (exported === controller) { exporting = false; exported = null; controls(); } }
});
el('cancel-export').addEventListener('click', () => exported?.abort());
window.addEventListener('beforeunload', event => { if (saveState !== 'saved' || gesture || drafts.size) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('blur', cancelGesture);
window.addEventListener('resize', cancelGesture);
const stageObserver = new ResizeObserver(cancelGesture); stageObserver.observe(canvas);
window.addEventListener('pagehide', () => {
  intent(); pause(); cancelGesture(); exported?.abort();
  for (const url of downloadUrls) URL.revokeObjectURL(url); downloadUrls.clear();
  if (!restorePending) { busy = false; pendingKind = null; }
});
window.addEventListener('pageshow', () => { controls(); draw(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); cancelGesture(); } });

// Retry reads and decoding deliberately leave current memory work editable.
// Every input/commit/import/history/reset invalidates the publication token.
async function restoreSaved(startup: boolean) {
  const token = operation, revision = generation;
  const current = () => token === operation && revision === generation && !gesture && !drafts.size;
  try {
    const read = await readRawRecord(); rawRecord = read;
    if (!current()) { recoveryMessage('The editor changed during recovery. Newer work was kept; retry when ready.'); return; }
    if (!read.present) {
      recoveryBlocked = false; saveState = 'saved';
      if (!startup && generation > 0) scheduleSave();
      tell('No saved draft was found. Your current work is kept.'); return;
    }
    const saved = decodeSavedRecord(read.value);
    if (!startup && generation > 0 && !window.confirm('Restore the saved draft and replace current in-memory work? Save a project file first to keep current edits.')) {
      recoveryMessage('Restore cancelled. Current work and the preserved browser record were kept.'); return;
    }
    await validateProjectImages(saved);
    const loaded = await loadAssets(saved);
    if (!current()) { closeAssets(loaded); recoveryMessage('The editor changed during recovery. Newer work was kept; retry when ready.'); return; }
    pause(); closeAssets(assets); assets = loaded; history.reset(saved); project = history.current;
    selected = project.layers.at(-1)?.id || ''; frame = 0; isDemo = false; initialDemo = false;
    recoveryBlocked = false; rawRecord = null; saveState = 'saved'; refresh(); tell('Your saved local project is ready.');
  } catch (error) {
    if (!current()) { recoveryMessage('The editor changed during recovery. Newer work was kept; retry when ready.'); return; }
    saveState = 'failed'; recoveryMessage(errorMessage(error));
    tell(`${errorMessage(error)} Existing browser data is protected. You can work in memory and download a project file; replacement requires explicit confirmation.`, true);
  }
}
el('recovery-download').addEventListener('click', () => {
  try {
    if (!rawRecord) throw new Error('The saved record was not read. Its contents are unknown; raw download is unavailable. Retry when storage is accessible.');
    if (!rawRecord.present) throw new Error('No saved record is available for download.');
    const json = serializeRawRecord(rawRecord.value);
    download(new Blob([json], { type: 'application/json' }), '.preserved-record.json');
    recoveryMessage('Preserved record downloaded exactly as JSON. It is separate from the current project file and may require repair.');
  } catch (error) { recoveryMessage(errorMessage(error)); }
});
el('recovery-retry').addEventListener('click', async () => {
  if (busy || exporting || gesture || retryPending || !recoveryBlocked || !admitDrafts()) return;
  retryPending = true; recoveryMessage('Reading the preserved saved draft…'); controls();
  try { await restoreSaved(false); }
  finally { retryPending = false; updateSaveState(); controls(); }
});
refresh(); selectMode('draw');
void restoreSaved(true).finally(() => {
  restorePending = false; busy = false;
  if (recoveryBlocked && !recoveryDetail) recoveryMessage('Saved record unavailable. Current work stays in memory.');
  updateSaveState(); controls();
});
