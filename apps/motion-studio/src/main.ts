import './style.css';
import { WIDTH, HEIGHT, FPS, createProject, createDemo, createDrawingLayer, validateProject, evaluatePose, upsertKeyframe, removeKeyframe, resizeTimeline, localPoint, type Project, type Layer, type Pose, type Easing, type Point, type Stroke } from './model.ts';
import { History } from './history.ts';
import { loadAssets, closeAssets, renderFrame, type Assets } from './render.ts';
import { importImage, validateProjectImages } from './images.ts';
import { exportGif } from './export.ts';
import { loadProject, saveProject } from './storage.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<a class="skip" href="#stage-section">Skip to canvas</a>
<header><a class="brand" href="#"><span aria-hidden="true">m<span>•</span></span><div><h1>Motion Studio</h1><p>Small drawings. Big personality.</p></div></a><div class="header-actions"><span id="save-status" role="status">Opening your local studio…</span><button id="undo" title="Undo (Ctrl/⌘ Z)">Undo</button><button id="redo" title="Redo (Ctrl/⌘ Shift Z)">Redo</button><button id="new-project">New project</button><button id="replace-saved-project" hidden>Replace saved project</button></div></header>
<main><div class="intro"><div><p class="eyebrow">A LITTLE MOTION GOES A LONG WAY</p><h2>Make something move.</h2><p>Draw a character, give it a few poses, and watch it find its rhythm.</p></div><button id="load-demo" class="quiet">Try the orbit demo</button></div>
<div id="message" role="status" aria-live="polite" hidden></div>
<div class="studio">
<aside class="tools panel"><div class="panel-heading"><h3>Make your mark</h3><span>01</span></div><div class="tool-content">
<div class="segmented"><button id="draw-mode" aria-pressed="true">✎ Draw</button><button id="move-mode" aria-pressed="false">↔ Move</button></div>
<label class="field">Ink color<input id="ink" type="color" value="#563d75"></label><label class="field">Brush width <output id="brush-value">6 px</output><input id="brush" type="range" min="1" max="40" value="6"></label><p class="hint">Draw on the selected drawing layer. Move places a pose at the current frame.</p>
<div class="rule"></div><div class="section-label"><h3>Layers</h3><span id="layer-count"></span></div><div id="layers" aria-label="Artwork layers"></div><div class="layer-actions"><button id="add-layer">+ Drawing layer</button><label class="file-button">+ Import image<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Import artwork image"></label></div><div class="small-actions"><button id="layer-down">Lower</button><button id="layer-up">Raise</button><button id="delete-layer">Delete layer</button></div><p class="hint">Up to 8 layers. PNG, JPEG or still WebP, up to 4 MiB.</p>
<div class="rule"></div><label class="field">Project title<input id="project-title" maxlength="80"></label><label class="field">Stage color<input id="background" type="color"></label><button id="backup" class="full">Save project file ↓</button><label class="file-button full subtle">Open project file<input id="project-file" type="file" accept="application/json,.json" aria-label="Open project file"></label>
</div></aside>
<section class="canvas-column" id="stage-section" aria-label="Animation stage"><div class="stage-bar"><div><strong id="stage-title">Your animation</strong><span id="demo-label">ORIGINAL DEMO</span></div><span>640 × 360 · 12 fps</span></div><div class="canvas-surround"><canvas id="stage" width="640" height="360" tabindex="0" aria-label="Drawing and animation canvas"></canvas></div>
<div class="transport panel"><button id="play" class="primary">Play animation</button><button id="first-frame" title="Go to the first frame">Start</button><label class="loop"><input id="loop" type="checkbox" checked> Loop</label><span id="time" class="mono">0.00 s / 4.00 s</span></div>
<div class="timeline panel"><div class="timeline-top"><h3>Every pose tells a story</h3><label class="duration">Duration <select id="duration"><option value="12">1 second</option><option value="24">2 seconds</option><option value="48">4 seconds</option><option value="72">6 seconds</option><option value="96">8 seconds</option></select></label></div><label class="scrubber">Frame <output id="frame-label">1 / 48</output><input id="frame" type="range" min="0" max="47" value="0" aria-label="Timeline frame"></label><div class="timeline-labels"><span>START</span><span>END</span></div><div id="keys" aria-label="Selected layer keyframes"></div><p class="hint">Select a diamond to revisit a pose. The frames between poses are interpolated.</p></div>
<div class="export panel"><div><h3>Give your creation a little freedom.</h3><p>Animated GIF · 256 colors · loops forever</p></div><div class="export-buttons"><button id="png">Save frame PNG</button><button id="gif" class="primary">Export animation ↓</button><button id="cancel-export" hidden>Cancel export</button></div><progress id="export-progress" max="1" value="0" hidden aria-label="Animation export progress"></progress></div>
</section>
<aside class="pose-panel panel"><div class="panel-heading"><h3>Strike a pose</h3><span>02</span></div><div class="tool-content"><label class="field">Layer name<input id="layer-name" maxlength="40"></label><p id="pose-state" class="pose-state">Frame 1 · saved pose</p><div class="pair"><label class="field">Position X<input id="pose-x" type="number" min="-640" max="1280" step="1"></label><label class="field">Position Y<input id="pose-y" type="number" min="-360" max="720" step="1"></label></div><label class="field">Scale<input id="pose-scale" type="number" min="0.1" max="4" step="0.05"></label><label class="field">Rotation (degrees)<input id="pose-rotation" type="number" min="-720" max="720" step="5"></label><label class="field">Opacity<input id="pose-opacity" type="number" min="0" max="1" step="0.05"></label><label class="field">Motion to next pose<select id="easing"><option value="linear">Steady / linear</option><option value="ease">Ease in & out</option><option value="hold">Hold this pose</option></select></label><button id="set-key" class="primary full">Set keyframe</button><button id="remove-key" class="text-button">Remove this keyframe</button><p class="hint">Changing pose values sets a key at this frame. The first key always stays. Drawing changes the artwork in every frame.</p><div class="note"><span aria-hidden="true">✦</span><strong>Start with two poses.</strong><p>Set a pose at the start. Scrub near the end, move your layer, then press play.</p></div></div></aside>
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
let pendingKind: 'import' | 'history' | 'reset' | null = null;
let saveState: 'pending' | 'saved' | 'failed' = 'saved';
let exported: AbortController | null = null;
let isDemo = true;
let restorePending = true, recoveryBlocked = true;
interface Gesture { pointer: number; base: Project; preview: Project; start: Point; pose: Pose; stroke?: Stroke; moved: boolean }
let gesture: Gesture | null = null;

function tell(text: string, error = false) { el('message').textContent = text; el('message').hidden = !text; el('message').classList.toggle('error', error); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'This operation could not be completed.'; }
function layer(): Layer | undefined { return project.layers.find(item => item.id === selected); }
function value(id: string, next: string) { const node = el<HTMLInputElement>(id); if (node.value !== next) node.value = next; }
function pause() { playing = false; cancelAnimationFrame(animation); el('play').textContent = 'Play animation'; }
function intent() { generation++; operation++; }
function updateSaveState() { el('save-status').textContent = restorePending ? 'Opening your local studio…' : recoveryBlocked ? 'Local save unavailable · saved record protected; keep a project file' : saveState === 'pending' ? 'Saving locally…' : saveState === 'failed' ? 'Local save unavailable · keep a project file' : isDemo && generation === 0 ? 'Original demo · saved after your first edit' : 'Saved in this browser'; }
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
  el('replace-saved-project').hidden = restorePending || !recoveryBlocked;
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
  canvas.setAttribute('aria-disabled', String(locked));
  el('cancel-export').hidden = !exporting; el('export-progress').hidden = !exporting;
}
function poseFields() {
  const chosen = layer();
  if (!chosen) { el('pose-state').textContent = 'Add or select a layer to create a pose.'; return; }
  const pose = evaluatePose(chosen, frame), key = chosen.keys.find(item => item.frame === frame);
  for (const property of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) value(`pose-${property}`, String(Number(pose[property].toFixed(3))));
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
    button.addEventListener('click', () => { pause(); selected = item.id; refresh(); }); list.append(button);
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
}
function commit(next: Project): boolean {
  const safe = validateProject(next);
  if (!history.commit(safe)) { refresh(); return false; }
  intent(); isDemo = false; project = history.current; refresh(); scheduleSave(); return true;
}
function edit(action: (next: Project) => void) {
  if (busy || exporting || gesture) return;
  pause(); const next = structuredClone(project);
  try { action(next); commit(next); } catch (error) { tell(errorMessage(error), true); refresh(); }
}
function changeLayer(action: (chosen: Layer) => Layer) {
  edit(next => { const index = next.layers.findIndex(item => item.id === selected); if (index < 0) throw new Error('Select a layer first.'); next.layers[index] = action(next.layers[index]); });
}
function seek(next: number) { if (busy || exporting || gesture) return; pause(); frame = Math.max(0, Math.min(project.frameCount - 1, next)); renderTimeline(); poseFields(); controls(); draw(); }
function tick(now: number) {
  const next = playFrom + Math.floor((now - playStarted) * FPS / 1000);
  if (next >= project.frameCount && !el<HTMLInputElement>('loop').checked) { frame = project.frameCount - 1; pause(); }
  else frame = next % project.frameCount;
  renderTimeline(); poseFields(); controls(); draw();
  if (playing) animation = requestAnimationFrame(tick);
}
el('play').addEventListener('click', () => {
  if (playing) { pause(); return; }
  playing = true; playFrom = frame === project.frameCount - 1 ? 0 : frame; playStarted = performance.now(); el('play').textContent = 'Pause animation'; animation = requestAnimationFrame(tick);
});
el('first-frame').addEventListener('click', () => seek(0));
el<HTMLInputElement>('frame').addEventListener('input', event => seek(Number((event.target as HTMLInputElement).value)));
el<HTMLSelectElement>('duration').addEventListener('change', event => { try { pause(); commit(resizeTimeline(project, Number((event.target as HTMLSelectElement).value))); } catch (error) { tell(errorMessage(error), true); refresh(); } });

function selectMode(next: 'draw' | 'move') { mode = next; el('draw-mode').setAttribute('aria-pressed', String(mode === 'draw')); el('move-mode').setAttribute('aria-pressed', String(mode === 'move')); canvas.dataset.mode = mode; }
el('draw-mode').addEventListener('click', () => selectMode('draw'));
el('move-mode').addEventListener('click', () => selectMode('move'));
el<HTMLInputElement>('brush').addEventListener('input', event => { el('brush-value').textContent = `${(event.target as HTMLInputElement).value} px`; });
function stagePoint(event: PointerEvent): Point { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height }; }
function checkedPoint(point: Point, pose: Pose): Point {
  const local = localPoint(point, pose);
  if (Math.abs(local.x) > 1280 || Math.abs(local.y) > 1280) throw new Error('This point is outside the artwork bounds at this scale. Increase the layer scale or draw closer to its center.');
  return local;
}
function drawingCounts(target: Project) {
  let strokes = 0, points = 0;
  for (const item of target.layers) if (item.kind === 'drawing') for (const stroke of item.strokes) { strokes++; points += stroke.points.length; }
  return { strokes, points };
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || busy || exporting || gesture) return;
  const chosen = layer();
  if (!chosen) { tell('Add a drawing layer or import artwork first.', true); return; }
  if (mode === 'draw' && chosen.kind !== 'drawing') { tell('Select a drawing layer to draw, or choose Move to position this image.', true); return; }
  pause(); intent(); const point = stagePoint(event), pose = evaluatePose(chosen, frame), preview = structuredClone(project);
  let local: Point | null = null;
  if (mode === 'draw') {
    try {
      local = checkedPoint(point, pose);
      const counts = drawingCounts(project);
      if (counts.strokes >= 100 || counts.points >= 10000) throw new Error('This project has reached its drawing limit (100 strokes or 10,000 points). Delete a drawing layer or undo a stroke first.');
    } catch (error) { tell(errorMessage(error), true); return; }
  }
  gesture = { pointer: event.pointerId, base: project, preview, start: point, pose, moved: false };
  if (mode === 'draw') {
    const stroke: Stroke = { color: el<HTMLInputElement>('ink').value, width: Number(el<HTMLInputElement>('brush').value), points: [local!] };
    const target = preview.layers.find(item => item.id === selected)!;
    if (target.kind === 'drawing') target.strokes.push(stroke);
    gesture.stroke = stroke;
  }
  canvas.setPointerCapture(event.pointerId); controls(); draw(); event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const point = stagePoint(event); gesture.moved = true;
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
    const index = gesture.preview.layers.findIndex(item => item.id === selected);
    try { gesture.preview.layers[index] = upsertKeyframe(gesture.preview.layers[index], frame, pose); }
    catch (error) { tell(errorMessage(error), true); endGesture(event, true); return; }
  }
  draw();
});
function endGesture(event: PointerEvent, cancelled: boolean) {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const completed = gesture; gesture = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!cancelled && (completed.stroke || completed.moved)) {
    try { commit(completed.preview); tell(''); } catch (error) { tell(errorMessage(error), true); refresh(); }
  } else { controls(); draw(); }
}
canvas.addEventListener('pointerup', event => endGesture(event, false));
canvas.addEventListener('pointercancel', event => endGesture(event, true));
canvas.addEventListener('lostpointercapture', event => { if (gesture) endGesture(event as PointerEvent, true); });

function setPose() {
  const chosen = layer(); if (!chosen) return;
  const pose = Object.fromEntries(['x', 'y', 'scale', 'rotation', 'opacity'].map(property => [property, el<HTMLInputElement>(`pose-${property}`).value === '' ? NaN : Number(el<HTMLInputElement>(`pose-${property}`).value)])) as Pose;
  changeLayer(item => upsertKeyframe(item, frame, pose, el<HTMLSelectElement>('easing').value as Easing));
}
for (const property of ['x', 'y', 'scale', 'rotation', 'opacity']) {
  const input = el<HTMLInputElement>(`pose-${property}`);
  input.addEventListener('input', () => { intent(); pause(); });
  input.addEventListener('change', setPose);
}
el('set-key').addEventListener('click', setPose);
el('easing').addEventListener('change', setPose);
el('remove-key').addEventListener('click', () => changeLayer(item => removeKeyframe(item, frame)));
el<HTMLInputElement>('layer-name').addEventListener('input', event => { const name = (event.target as HTMLInputElement).value; if (name.trim()) changeLayer(item => ({ ...item, name })); else intent(); });
el<HTMLInputElement>('project-title').addEventListener('input', event => { const title = (event.target as HTMLInputElement).value; if (title.trim()) edit(next => { next.title = title; }); else intent(); });
for (const id of ['project-title', 'layer-name']) el<HTMLInputElement>(id).addEventListener('change', event => {
  if (!(event.target as HTMLInputElement).value.trim()) { tell('A name cannot be empty. The previous name is kept.', true); refresh(); }
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
  if (busy || exporting || gesture) return;
  pause(); intent(); const token = operation; busy = true; pendingKind = 'history'; controls();
  const next = history[direction](); let prepared: Assets | null = null;
  try {
    if (!matchingAssets(next)) prepared = await loadAssets(next);
    if (token !== operation) { if (prepared) closeAssets(prepared); history[direction === 'undo' ? 'redo' : 'undo'](); return; }
    if (prepared) { closeAssets(assets); assets = prepared; }
    project = next; isDemo = false; refresh(); scheduleSave();
  } catch (error) { history[direction === 'undo' ? 'redo' : 'undo'](); tell(errorMessage(error), true); }
  finally { if (token === operation) { busy = false; pendingKind = null; controls(); } }
}
el('undo').addEventListener('click', () => void travel('undo'));
el('redo').addEventListener('click', () => void travel('redo'));
window.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void travel(event.shiftKey ? 'redo' : 'undo'); }
  if (event.code === 'Space' && event.target === canvas) { event.preventDefault(); el('play').click(); }
});

async function replaceProject(next: Project, token: number, reset: boolean) {
  const safe = validateProject(next); await validateProjectImages(safe); const prepared = await loadAssets(safe);
  if (token !== operation) { closeAssets(prepared); return false; }
  closeAssets(assets); assets = prepared;
  if (reset) history.reset(safe); else history.commit(safe);
  project = history.current; selected = project.layers.at(-1)?.id || ''; frame = 0; isDemo = false;
  generation++; refresh(); scheduleSave(); return true;
}
async function importFile(input: HTMLInputElement, kind: 'image' | 'project') {
  const file = input.files?.[0]; input.value = ''; if (!file || exporting || (busy && pendingKind !== 'import')) return;
  pause(); intent(); const token = operation; busy = true; pendingKind = 'import'; controls();
  try {
    let next: Project;
    if (kind === 'image') { const added = await importImage(file); next = structuredClone(project); next.layers.push(added); }
    else { if (file.size > 6 * 1024 * 1024) throw new Error('Choose a project file no larger than 6 MiB.'); next = validateProject(JSON.parse(await file.text())); }
    if (token !== operation) return;
    if (await replaceProject(next, token, kind === 'project')) { tell(kind === 'image' ? 'Artwork imported. Set a few poses to bring it to life.' : 'Project opened. Your embedded artwork and poses are ready.'); if (kind === 'image') selectMode('move'); }
  } catch (error) { if (token === operation) tell(`${errorMessage(error)} Your current project is unchanged.`, true); }
  finally { if (token === operation) { busy = false; pendingKind = null; controls(); } }
}
el<HTMLInputElement>('image-file').addEventListener('change', event => void importFile(event.target as HTMLInputElement, 'image'));
el<HTMLInputElement>('project-file').addEventListener('change', event => void importFile(event.target as HTMLInputElement, 'project'));
async function fresh(demo: boolean) {
  if (busy || exporting || !window.confirm('Replace the current project? Save a project file first if you want to keep it.')) return;
  pause(); intent(); const token = operation; busy = true; pendingKind = 'reset'; controls();
  try { await replaceProject(demo ? createDemo() : createProject(), token, true); isDemo = demo; selectMode('draw'); tell(demo ? 'Original orbit demo loaded. Try moving a pose or drawing a new layer.' : 'A fresh canvas. Draw something, then add a pose near the end.'); }
  catch (error) { tell(errorMessage(error), true); }
  finally { busy = false; pendingKind = null; refresh(); }
}
el('replace-saved-project').addEventListener('click', async () => {
  if (busy || exporting || gesture || !recoveryBlocked || restorePending) return;
  if (!window.confirm('Replace the preserved browser record with the current project? Download your current project file first. This replaces the old saved artwork.')) return;
  pause(); busy = true; clearTimeout(saveTimer); saveRevision++; controls();
  const snapshot = structuredClone(project);
  try { await saveProject(snapshot); recoveryBlocked = false; isDemo = false; saveState = 'saved'; tell('Saved project explicitly replaced. Automatic saving is enabled.'); }
  catch (error) { saveState = 'failed'; tell(`${errorMessage(error)} The original browser record remains protected.`, true); }
  finally { busy = false; updateSaveState(); controls(); }
});
el('new-project').addEventListener('click', () => void fresh(false));
el('load-demo').addEventListener('click', () => void fresh(true));
function download(blob: Blob, suffix: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `${project.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'motion'}${suffix}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
el('backup').addEventListener('click', () => { download(new Blob([JSON.stringify(validateProject(project))], { type: 'application/json' }), '.motion.json'); tell('Editable project file downloaded. It includes the artwork and every pose.'); });
el('png').addEventListener('click', () => { pause(); draw(); canvas.toBlob(blob => { if (blob) download(blob, `-frame-${frame + 1}.png`); else tell('Could not create a PNG. Your artwork is still editable.', true); }); });
el('gif').addEventListener('click', async () => {
  if (busy || exporting || gesture) return;
  pause(); exporting = true; exported = new AbortController(); controls(); el<HTMLProgressElement>('export-progress').value = 0; tell('Rendering your animation locally…');
  try { const blob = await exportGif(project, progress => { el<HTMLProgressElement>('export-progress').value = progress; }, exported.signal); download(blob, '.gif'); tell('Your animated GIF is ready. Colors use a fixed 256-color palette.'); }
  catch (error) { tell(error instanceof Error && error.name === 'AbortError' ? 'Export cancelled. Your project is unchanged.' : errorMessage(error), !(error instanceof Error && error.name === 'AbortError')); }
  finally { exporting = false; exported = null; controls(); }
});
el('cancel-export').addEventListener('click', () => exported?.abort());
window.addEventListener('beforeunload', event => { if (saveState !== 'saved' || gesture) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { pause(); exported?.abort(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

refresh(); selectMode('draw');
const initialGeneration = generation;
void loadProject().then(async saved => {
  if (!saved) { recoveryBlocked = false; return; }
  // Editor mutations stay locked until model and all images restore atomically.
  await validateProjectImages(saved); const loaded = await loadAssets(saved);
  if (generation !== initialGeneration || gesture) { closeAssets(loaded); throw new Error('The editor changed during restore.'); }
  closeAssets(assets); assets = loaded; history.reset(saved); project = history.current; selected = project.layers.at(-1)?.id || ''; isDemo = false; recoveryBlocked = false; refresh(); tell('Your saved local project is ready.');
}).catch(error => { saveState = 'failed'; tell(`${errorMessage(error)} Existing browser data is protected. You can work in memory and download a project file; replacement requires explicit confirmation.`, true); })
  .finally(() => { restorePending = false; busy = false; updateSaveState(); controls(); });
