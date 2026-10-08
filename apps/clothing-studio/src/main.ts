import './style.css';
import {
  createProject, validateProject, parseProject, serializeProject, ProjectHistory,
  MAX_PROJECT_BYTES, MAX_STROKES, MAX_STROKE_POINTS, MAX_TOTAL_POINTS,
  type Project, type Point, type Stroke, type Placement,
} from './model.ts';
import { garmentSvg, previewSize, previewSvg, exportPng, exportGarmentSvg } from './graphics.ts';
import { importPhoto, validatePhoto } from './media.ts';
import { loadProject, saveProject } from './storage.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <a class="skip-link" href="#workspace">Skip to design workspace</a>
  <header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">✳</span><div><h1>Clothing Studio</h1><p>A little room for your next idea.</p></div></div>
    <div class="header-actions"><span class="local-badge">LOCAL & PRIVATE</span><button id="new-project" class="quiet">New concept</button><label class="button quiet file-button">Open backup<input id="project-file" type="file" accept=".json,application/json" aria-label="Import project backup"></label><button id="backup" class="dark">Export project backup</button><button id="replace-saved" class="quiet" hidden>Replace saved concept</button></div></header>
  <main id="workspace">
    <div class="workspace-heading"><div><p class="eyebrow">THE CONCEPT WORKSPACE</p><h2>Make something that feels like you.</h2><p>Shape a tee, add your mark, and see your idea in context.</p></div><div class="history-tools"><span id="save-state" role="status">Checking local save…</span><button id="undo" aria-label="Undo" title="Undo (Ctrl or ⌘ Z)">↶</button><button id="redo" aria-label="Redo" title="Redo (Ctrl or ⌘ Shift Z)">↷</button></div></div>
    <div id="message" role="status" aria-live="polite" hidden></div>
    <div class="workspace-grid">
      <aside class="controls panel" aria-label="Concept controls"><div class="panel-heading"><span class="step">01</span><h3>Your concept</h3></div>
        <label class="field">Concept name<input id="title" type="text" maxlength="80" autocomplete="off"></label>
        <div class="control-section"><p class="eyebrow">SILHOUETTE</p>
          <label class="slider-field" for="body-width">Body width <output id="body-width-value"></output></label><input id="body-width" type="range" min="160" max="260" step="1">
          <label class="slider-field" for="body-length">Body length <output id="body-length-value"></output></label><input id="body-length" type="range" min="180" max="300" step="1">
          <label class="slider-field" for="sleeve-length">Sleeve length <output id="sleeve-length-value"></output></label><input id="sleeve-length" type="range" min="25" max="65" step="1">
          <label class="field">Neckline<select id="neckline"><option value="round">Round neck</option><option value="v">V-neck</option></select></label>
        </div>
        <div class="control-section"><p class="eyebrow">COLOR & TEXTURE</p><div class="swatches" aria-label="Garment palette"><button data-color="#d89476" class="swatch clay" aria-label="Warm clay"></button><button data-color="#3f5468" class="swatch blue" aria-label="Ink blue"></button><button data-color="#9fae91" class="swatch sage" aria-label="Soft sage"></button><button data-color="#efe5d1" class="swatch oat" aria-label="Natural oat"></button><button data-color="#353737" class="swatch charcoal" aria-label="Charcoal"></button></div>
          <div class="color-row"><label for="garment-color">Custom garment color</label><input id="garment-color" type="color"></div>
          <label class="field">Fabric appearance<select id="pattern"><option value="plain">Plain</option><option value="stripe">Soft stripes</option><option value="weave">Crosshatch weave</option></select></label>
          <div class="color-row"><label for="pattern-color">Pattern color</label><input id="pattern-color" type="color"></div>
        </div>
        <label class="field note-field">Concept note<textarea id="note" rows="3" maxlength="2000" placeholder="A relaxed weekend tee, a small detail…"></textarea></label><p class="fine-print">Your note stays with the project. Textures are visual concepts, not fabric simulations.</p>
      </aside>
      <section class="design-panel panel" aria-labelledby="design-heading"><div class="panel-heading"><span class="step">02</span><h3 id="design-heading">Add your mark</h3><span class="small-tag">FRONT VIEW</span></div>
        <div class="drawing-tools"><div class="color-row"><label for="pen-color">Pen color</label><input id="pen-color" type="color" value="#f7ead7"></div><label class="pen-size">Pen size<input id="pen-size" type="number" min="1" max="20" value="6" step="1"></label><button id="clear-sketch" class="quiet">Clear sketch</button></div>
        <div class="sketch-paper"><div id="sketch-surface" role="img" aria-label="Garment sketch canvas" aria-describedby="sketch-help" tabindex="0"></div><span class="paper-label">YOUR BLANK CANVAS</span></div>
        <div class="canvas-caption"><p id="sketch-help">Draw with a mouse, pen, or touch. Your marks stay inside the garment.</p><span id="stroke-count">0 strokes</span></div><p class="fine-print">Reshaping the tee keeps marks in the same canvas position; marks outside the new outline are clipped.</p>
        <button id="garment-png" class="export-button">Export garment PNG <span aria-hidden="true">↓</span></button><p class="export-detail">Transparent background · ready for your moodboard</p>
        <button id="garment-svg" class="export-button">Export garment SVG <span aria-hidden="true">↓</span></button><p class="export-detail">Editable vector shapes · garment and sketch only</p>
      </section>
      <section class="preview-panel panel" aria-labelledby="preview-heading"><div class="panel-heading"><span class="step">03</span><h3 id="preview-heading">See it in context</h3></div>
        <div class="photo-toolbar"><label class="button quiet file-button">Choose a photo<input id="photo-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload body photo"></label><button id="sample" class="text-button">Use sample silhouette</button></div>
        <div class="preview-paper"><div id="preview-surface" role="group" aria-label="Photo overlay placement" aria-describedby="placement-help" tabindex="0"></div><span class="preview-tag">Approximate photo overlay</span></div>
        <div class="photo-meta"><span id="photo-name">Sample silhouette</span><span id="load-state" hidden>Opening image… <button id="cancel-load" class="text-button">Cancel import</button></span></div>
        <p id="placement-help" class="fine-print">Drag the overlay, or focus the preview and use arrow keys. Shift + arrow moves farther.</p>
        <div class="placement-controls"><label>Horizontal position (%)<input id="position-x" type="number" min="0" max="100" step="any"></label><label>Vertical position (%)<input id="position-y" type="number" min="0" max="100" step="any"></label><label>Overlay width (%)<input id="overlay-width" type="number" min="10" max="150" step="any"></label><label>Overlay height (%)<input id="overlay-height" type="number" min="10" max="150" step="any"></label><label>Rotation<input id="rotation" type="number" min="-180" max="180" step="any"></label><label>Opacity (%)<input id="opacity" type="number" min="10" max="100" step="any"></label></div>
        <button id="reset-placement" class="text-button reset-placement">Reset placement</button>
        <p class="approximation-note">A visual overlay for exploring ideas. It does not estimate measurements, fit, fabric drape, or how a garment wraps around the body.</p>
        <button id="preview-png" class="export-button">Export preview PNG <span aria-hidden="true">↓</span></button>
      </section>
    </div>
    <footer><span>Made for the first spark of an idea.</span><span>Photos and projects stay in this browser. Keep a backup for safekeeping.</span></footer>
  </main>`;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
const input = (id: string) => element<HTMLInputElement>(id);
let project = createProject();
const history = new ProjectHistory(project);
let editVersion = 0;
let loadGeneration = 0;
let loadBusy = false;
let exportBusy = false;
let unsaved = false;
let startupTouched = false;
let saveProtection: 'loading' | 'protected' | 'ready' = 'loading';
let replacingSaved = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saves = Promise.resolve();
let gesture: { type: 'sketch' | 'placement'; pointer: number; base: Project; start: Point; stroke?: Stroke } | null = null;

function message(text: string, error = false) {
  const node = element('message'); node.textContent = text; node.hidden = !text;
  node.classList.toggle('error', error);
}

function renderViews() {
  element('sketch-surface').innerHTML = garmentSvg(project);
  element('preview-surface').innerHTML = previewSvg(project);
  const dimensions = previewSize(project);
  element('preview-surface').style.width = `${Math.min(470, 600 * dimensions.width / dimensions.height)}px`;
  element('stroke-count').textContent = `${project.strokes.length} ${project.strokes.length === 1 ? 'stroke' : 'strokes'}`;
  element('photo-name').textContent = project.photo?.name || 'Sample silhouette';
}

function updateControls() {
  element('replace-saved').hidden = saveProtection !== 'protected';
  element<HTMLButtonElement>('replace-saved').disabled = replacingSaved || loadBusy || exportBusy || !!gesture;
  // Active text inputs can temporarily be empty, and retain native selection
  // and undo state while other asynchronous work updates the workspace.
  if (document.activeElement !== input('title') || !startupTouched) input('title').value = project.title;
  if (document.activeElement !== element('note') || !startupTouched) element<HTMLTextAreaElement>('note').value = project.note;
  for (const [id, key] of [['body-width', 'bodyWidth'], ['body-length', 'bodyLength'], ['sleeve-length', 'sleeveLength']] as const) {
    input(id).value = String(project.garment[key]);
    element(`${id}-value`).textContent = String(project.garment[key]);
  }
  for (const [id, key] of [['neckline', 'neckline'], ['pattern', 'pattern'], ['garment-color', 'color'], ['pattern-color', 'patternColor']] as const) input(id).value = project.garment[key];
  for (const [id, key, factor] of placementFields) input(id).value = String(Number((project.placement[key] * factor).toFixed(2)));
  for (const swatch of document.querySelectorAll<HTMLButtonElement>('[data-color]')) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === project.garment.color));
  element<HTMLButtonElement>('undo').disabled = !history.canUndo;
  element<HTMLButtonElement>('redo').disabled = !history.canRedo;
  element<HTMLButtonElement>('clear-sketch').disabled = project.strokes.length === 0;
}

function scheduleSave() {
  unsaved = true;
  clearTimeout(saveTimer);
  if (saveProtection !== 'ready') {
    element('save-state').textContent = saveProtection === 'loading' ? 'Checking local save… Current concept stays in memory' : 'Not saved locally · previous concept protected';
    if (saveProtection === 'protected') message('The previous saved concept is protected. Export your current project backup before explicitly replacing it.', true);
    return;
  }
  element('save-state').textContent = 'Saving…';
  // Async replacement completion may schedule a save while a new sketch or
  // placement gesture is active. Persist committed work, never its preview.
  const snapshot = history.current, version = editVersion;
  saveTimer = setTimeout(() => {
    saves = saves.then(() => saveProject(snapshot)).then(() => {
      if (version === editVersion) { unsaved = false; element('save-state').textContent = 'Locally saved'; }
    }).catch(() => {
      if (version === editVersion) {
        element('save-state').textContent = 'Not saved locally';
        message('Local saving is unavailable. Your active concept is intact; export a project backup to keep it.', true);
      }
    });
  }, 200);
}

function cancelGesture() {
  if (!gesture) return;
  gesture = null; project = history.current;
  renderViews(); updateControls();
}

function commit(next: Project) {
  retireLoad();
  try {
    if (!history.commit(next)) { project = history.current; updateControls(); return; }
    project = history.current;
    editVersion++;
    renderViews(); updateControls(); scheduleSave();
  } catch (error) {
    project = history.current; renderViews(); updateControls();
    message(error instanceof Error ? error.message : 'Could not apply that change.', true);
  }
}

function updateLoadControls() {
  element('load-state').hidden = !loadBusy;
  element<HTMLButtonElement>('replace-saved').disabled = replacingSaved || loadBusy || exportBusy || !!gesture;
}
function retireLoad() {
  loadGeneration++; loadBusy = false;
  // Retiring an import never syncs raw controls, redraws or touches a gesture.
  updateLoadControls();
}
function cancelLoad() { retireLoad(); }
function beginLoad() {
  retireLoad(); cancelGesture(); loadBusy = true; updateLoadControls();
  return loadGeneration;
}
function finishLoad(generation: number) {
  if (generation !== loadGeneration) return;
  loadBusy = false; updateLoadControls();
}
function adoptLoad(generation: number, transform: (current: Project) => Project, text: string) {
  if (generation !== loadGeneration) return;
  // Consume the admitted token before shared edit/commit retires old imports.
  retireLoad(); edit(transform); message(text);
}

function edit(transform: (current: Project) => Project) {
  startupTouched = true; retireLoad();
  cancelGesture(); commit(transform(project));
}
function editorInputIntent() { startupTouched = true; retireLoad(); }
app.addEventListener('input', editorInputIntent, true);
app.addEventListener('change', editorInputIntent, true);
for (const id of ['title', 'note']) input(id).addEventListener('input', () => {
  const value = input(id).value;
  edit(current => ({ ...current, [id]: id === 'title' && !value.trim() ? 'Untitled concept' : value }));
});
input('title').addEventListener('blur', () => { input('title').value = project.title; });
for (const [id, key] of [['body-width', 'bodyWidth'], ['body-length', 'bodyLength'], ['sleeve-length', 'sleeveLength']] as const) {
  input(id).addEventListener('input', () => {
    cancelGesture(); project = { ...history.current, garment: { ...history.current.garment, [key]: Number(input(id).value) } };
    element(`${id}-value`).textContent = input(id).value; renderViews();
  });
  input(id).addEventListener('change', () => commit(project));
}
for (const [id, key] of [['neckline', 'neckline'], ['pattern', 'pattern'], ['garment-color', 'color'], ['pattern-color', 'patternColor']] as const) {
  input(id).addEventListener('change', () => edit(current => ({ ...current, garment: { ...current.garment, [key]: input(id).value } })));
}
for (const swatch of document.querySelectorAll<HTMLButtonElement>('[data-color]')) swatch.addEventListener('click', () => edit(current => ({ ...current, garment: { ...current.garment, color: swatch.dataset.color! } })));

const placementFields: [string, keyof Placement, number][] = [
  ['position-x', 'x', 100], ['position-y', 'y', 100], ['overlay-width', 'width', 100],
  ['overlay-height', 'height', 100], ['rotation', 'rotation', 1], ['opacity', 'opacity', 100],
];
for (const [id, key, factor] of placementFields) input(id).addEventListener('change', () => {
  if (!input(id).value || !input(id).checkValidity()) { message('Choose a value within the displayed control limits.', true); updateControls(); return; }
  edit(current => ({ ...current, placement: { ...current.placement, [key]: Number(input(id).value) / factor } }));
});

element('new-project').addEventListener('click', () => { cancelLoad(); edit(() => createProject()); message('Started a new concept. Undo restores the previous one.'); });
element('sample').addEventListener('click', () => { cancelLoad(); edit(current => ({ ...current, photo: null })); });
element('reset-placement').addEventListener('click', () => edit(current => ({ ...current, placement: createProject().placement })));
element('clear-sketch').addEventListener('click', () => edit(current => ({ ...current, strokes: [] })));
element('cancel-load').addEventListener('click', () => { cancelLoad(); message('Import cancelled. Your current concept is unchanged.'); });

function travel(direction: 'undo' | 'redo') {
  cancelLoad(); cancelGesture();
  if (!(direction === 'undo' ? history.canUndo : history.canRedo)) return;
  project = history[direction](); editVersion++;
  renderViews(); updateControls(); scheduleSave(); message('');
}
element('undo').addEventListener('click', () => travel('undo'));
element('redo').addEventListener('click', () => travel('redo'));
document.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo'); }
});

function point(event: PointerEvent, surface: HTMLElement): Point {
  const bounds = surface.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
}
const sketch = element('sketch-surface'), preview = element('preview-surface');
sketch.addEventListener('pointerdown', event => {
  if (event.button !== 0 || gesture) return;
  if (project.strokes.length >= MAX_STROKES || project.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) >= MAX_TOTAL_POINTS) { message('Sketch limit reached. Clear some marks or start another concept.', true); return; }
  if (!input('pen-size').checkValidity() || !input('pen-size').value) { message('Pen size must be between 1 and 20.', true); return; }
  retireLoad();
  event.preventDefault(); sketch.focus({ preventScroll: true });
  startupTouched = true;
  const start = point(event, sketch);
  const stroke: Stroke = { id: crypto.randomUUID(), color: input('pen-color').value, width: Number(input('pen-size').value), points: [start] };
  gesture = { type: 'sketch', pointer: event.pointerId, base: history.current, start, stroke };
  sketch.setPointerCapture(event.pointerId);
  project = { ...gesture.base, strokes: [...gesture.base.strokes, stroke] }; renderViews();
});
sketch.addEventListener('pointermove', event => {
  if (gesture?.type !== 'sketch' || gesture.pointer !== event.pointerId) return;
  const stroke = gesture.stroke!;
  const total = gesture.base.strokes.reduce((sum, item) => sum + item.points.length, 0);
  if (stroke.points.length >= MAX_STROKE_POINTS || total + stroke.points.length >= MAX_TOTAL_POINTS) return;
  const next = point(event, sketch), previous = stroke.points.at(-1)!;
  if (Math.hypot(next.x - previous.x, next.y - previous.y) < .002) return;
  stroke.points.push(next); project = { ...gesture.base, strokes: [...gesture.base.strokes, stroke] }; renderViews();
});
preview.addEventListener('pointerdown', event => {
  if (event.button !== 0 || gesture) return;
  retireLoad();
  event.preventDefault(); preview.focus({ preventScroll: true });
  startupTouched = true;
  gesture = { type: 'placement', pointer: event.pointerId, base: history.current, start: point(event, preview) };
  preview.setPointerCapture(event.pointerId);
});
preview.addEventListener('pointermove', event => {
  if (gesture?.type !== 'placement' || gesture.pointer !== event.pointerId) return;
  const next = point(event, preview), original = gesture.base.placement;
  project = { ...gesture.base, placement: { ...original,
    x: Math.max(0, Math.min(1, original.x + next.x - gesture.start.x)),
    y: Math.max(0, Math.min(1, original.y + next.y - gesture.start.y)),
  } }; renderViews(); updateControls();
});
for (const surface of [sketch, preview]) {
  surface.addEventListener('pointerup', event => {
    if (gesture?.pointer !== event.pointerId) return;
    gesture = null; surface.releasePointerCapture(event.pointerId); commit(project);
  });
  surface.addEventListener('pointercancel', () => cancelGesture());
  surface.addEventListener('lostpointercapture', () => cancelGesture());
}
preview.addEventListener('keydown', event => {
  const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
  const direction = directions[event.key]; if (!direction) return;
  event.preventDefault(); const amount = event.shiftKey ? .05 : .01;
  edit(current => ({ ...current, placement: { ...current.placement,
    x: Math.max(0, Math.min(1, current.placement.x + direction.x * amount)),
    y: Math.max(0, Math.min(1, current.placement.y + direction.y * amount)),
  } }));
});

input('photo-file').addEventListener('change', async () => {
  const file = input('photo-file').files?.[0]; input('photo-file').value = ''; if (!file) return;
  const generation = beginLoad();
  try {
    const photo = await importPhoto(file);
    if (generation !== loadGeneration) return;
    adoptLoad(generation, current => ({ ...current, photo }), 'Photo opened locally. Drag the overlay to position your concept.');
  } catch (error) {
    if (generation === loadGeneration) message(`Could not open image: ${error instanceof Error ? error.message : 'Unsupported image.'}`, true);
  } finally { finishLoad(generation); }
});
input('project-file').addEventListener('change', async () => {
  const file = input('project-file').files?.[0]; input('project-file').value = ''; if (!file) return;
  const generation = beginLoad();
  try {
    if (file.size > MAX_PROJECT_BYTES) throw new Error('Project backup exceeds 6 MiB.');
    const text = await file.text(); if (generation !== loadGeneration) return;
    const restored = parseProject(text); await validatePhoto(restored.photo);
    if (generation !== loadGeneration) return;
    adoptLoad(generation, () => restored, 'Project backup restored. Undo returns to your previous concept.');
  } catch (error) {
    if (generation === loadGeneration) message(`Could not open project: ${error instanceof Error ? error.message : 'Invalid backup.'}`, true);
  } finally { finishLoad(generation); }
});

function download(blob: Blob, suffix: string, title = project.title) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  const name = title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 50) || 'clothing-concept';
  link.href = url; link.download = `${name}${suffix}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
element('backup').addEventListener('click', () => {
  cancelGesture();
  try { download(new Blob([serializeProject(project)], { type: 'application/json' }), '.json'); message('Project backup downloaded, including your local photo and sketch.'); }
  catch (error) { message(error instanceof Error ? error.message : 'Could not create backup.', true); }
});
element('garment-svg').addEventListener('click', () => {
  if (exportBusy) return;
  cancelGesture();
  try { download(exportGarmentSvg(project), '-garment.svg'); message('Garment SVG downloaded with editable vector shapes. Photos, placement and notes stay in the project backup.'); }
  catch (error) { message(`Could not export SVG: ${error instanceof Error ? error.message : 'Invalid garment.'}`, true); }
});
for (const [id, kind] of [['garment-png', 'garment'], ['preview-png', 'preview']] as const) element(id).addEventListener('click', async () => {
  if (exportBusy) return;
  cancelGesture(); exportBusy = true; updateControls();
  element<HTMLButtonElement>('garment-png').disabled = element<HTMLButtonElement>('preview-png').disabled = element<HTMLButtonElement>('garment-svg').disabled = true;
  try { const snapshot = validateProject(project); download(await exportPng(snapshot, kind), `-${kind}.png`, snapshot.title); message(`${kind === 'garment' ? 'Garment' : 'Preview'} PNG downloaded.`); }
  catch (error) { message(`Could not export PNG: ${error instanceof Error ? error.message : 'Image rendering failed.'}`, true); }
  finally { exportBusy = false; element<HTMLButtonElement>('garment-png').disabled = element<HTMLButtonElement>('preview-png').disabled = element<HTMLButtonElement>('garment-svg').disabled = false; updateControls(); }
});

element('replace-saved').addEventListener('click', async () => {
  if (saveProtection !== 'protected' || replacingSaved || loadBusy || exportBusy || gesture) return;
  if (!window.confirm('Replace the preserved browser concept with your current concept? Export your current project backup first. This replaces the old saved concept.')) return;
  const snapshot = validateProject(project), version = editVersion;
  replacingSaved = true; updateControls();
  const saving = saves.then(() => saveProject(snapshot)); saves = saving.catch(() => {});
  try {
    await saving; saveProtection = 'ready';
    if (version === editVersion) { unsaved = false; element('save-state').textContent = 'Locally saved'; }
    else scheduleSave();
    message('Saved concept explicitly replaced. Automatic saving is enabled.');
  } catch { unsaved = true; element('save-state').textContent = 'Not saved locally · previous concept protected'; message('Could not replace the saved concept. Previous browser data remains protected; export your current project backup.', true); }
  finally { replacingSaved = false; updateControls(); }
});

window.addEventListener('pagehide', retireLoad);
window.addEventListener('beforeunload', event => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } });
renderViews(); updateControls();
const startupVersion = editVersion, startupGeneration = loadGeneration;
void loadProject().then(saved => {
  if (!saved) { saveProtection = 'ready'; if (unsaved) scheduleSave(); else element('save-state').textContent = 'Ready for your first idea'; return; }
  if (startupTouched || editVersion !== startupVersion || loadGeneration !== startupGeneration || loadBusy) {
    protectSaved('Your active concept was kept. The previous saved concept is protected. Export your current project backup before explicitly replacing it.');
    return;
  }
  project = saved; history.reset(saved); saveProtection = 'ready'; renderViews(); updateControls(); element('save-state').textContent = 'Locally saved';
}).catch(() => {
  protectSaved('Could not restore the local project. Previous browser data remains protected. Work in memory and export your current project backup before explicitly replacing it.');
});
function protectSaved(text: string) {
  saveProtection = 'protected'; element('save-state').textContent = 'Not saved locally · previous concept protected'; updateControls(); message(text, true);
}
