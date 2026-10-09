import './style.css';
import { playbackFrame } from './playback.ts';
import { createStrokeEditor, StrokeDrag, uniformCanvas } from './stroke-editor.ts';
import { hitStroke, translateStroke, type StrokeTarget } from './stroke-edit.ts';
import { WIDTH, HEIGHT, FPS, MAX_JSON_BYTES, MAX_DRAWING_CELS, createProject, createDemo, createDrawingLayer, validateProject, evaluatePose, evaluateDrawingCel, addBlankDrawingCel, duplicateDrawingCel, removeDrawingCel, replaceDrawingCelStrokes, timelineResizeLoss, upsertKeyframe, removeKeyframe, resizeTimeline, localPoint, type Project, type Layer, type Pose, type Easing, type Point, type Stroke } from './model.ts';
import { neighborDrawings, renderNeighborDrawings } from './onion-skin.ts';
import { duplicateDrawingLayer } from './layer-copy.ts';
import { History } from './history.ts';
import { createTweenWorkspace } from './tween-view.ts';
import { loadAssets, closeAssets, renderFrame, type Assets } from './render.ts';
import { importImage, validateProjectImages } from './images.ts';
import { exportGif } from './export.ts';
import { exportPngFrames } from './png-export.ts';
import { serializeRawRecord, type RawRecord } from './storage.ts';
import { ProjectLibrary, SavedProjectConflict, LibraryReadFailure, type LibraryHead, type LibraryCommit, type LoadedProject } from './library-storage.ts';
import { MAX_LIBRARY_HEAD_BYTES } from './library-model.ts';
import { createPrivateLinks } from './private-links.ts';
import { createLibraryView } from './library-view.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<a class="skip" href="#stage-section">Skip to canvas</a>
<header><a class="brand" href="#"><span aria-hidden="true">m<span>•</span></span><div><h1>Motion Studio</h1><p>Small drawings. Big personality.</p></div></a><div class="header-actions"><span id="save-status" role="status">Opening your local studio…</span><button id="undo" title="Undo (Ctrl/⌘ Z)">Undo</button><button id="redo" title="Redo (Ctrl/⌘ Shift Z)">Redo</button><button id="new-project">New project</button></div></header>
<main><div class="intro"><div><p class="eyebrow">A LITTLE MOTION GOES A LONG WAY</p><h2>Make something move.</h2><p>Draw a character, give it a few poses, and watch it find its rhythm.</p></div><button id="load-demo" class="quiet">Try the orbit demo</button></div>
<div id="message" role="status" aria-live="polite" hidden></div>
<section id="recovery-panel" class="panel" role="region" aria-label="Saved draft recovery" hidden><h3>Saved draft recovery</h3><p>Your saved browser record is protected. Current edits stay in memory; save a project file to keep them.</p><p id="recovery-detail" role="status" aria-live="polite"></p><div class="recovery-actions"><button id="recovery-download">Download preserved record</button><button id="recovery-retry">Retry saved draft</button><button id="replace-saved-project">Replace saved project</button></div><p>Preserved-record JSON keeps the read record exactly when it is safe to serialize. It may need repair before it can open. Save project file downloads your current editable work separately.</p></section>
<section id="project-library" class="panel" role="region" aria-label="Projects"></section>
<div class="studio">
<aside class="tools panel"><div class="panel-heading"><h3>Make your mark</h3><span>01</span></div><div class="tool-content">
<div class="segmented"><button id="draw-mode" aria-pressed="true">✎ Draw</button><button id="move-mode" aria-pressed="false">↔ Move</button><button id="edit-strokes-mode" aria-pressed="false">Edit strokes</button></div><div id="stroke-editor-host"></div>
<label class="field">Ink color<input id="ink" type="color" value="#563d75"></label><label class="field">Brush width <output id="brush-value">6 px</output><input id="brush" type="range" min="1" max="40" value="6"></label><p class="hint">Draw on the selected drawing layer. Move places a pose at the current frame.</p>
<div class="rule"></div><div class="section-label"><h3>Layers</h3><span id="layer-count"></span></div><div id="layers" aria-label="Artwork layers"></div><div class="layer-actions"><button id="duplicate-layer">Duplicate drawing layer</button><button id="add-layer">+ Drawing layer</button><label class="file-button">+ Import image<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Import artwork image"></label></div><div class="small-actions"><button id="layer-down">Lower</button><button id="layer-up">Raise</button><button id="delete-layer">Delete layer</button></div><p class="hint">Up to 8 layers. PNG, JPEG or still WebP, up to 4 MiB.</p>
<div class="rule"></div><label class="field">Project title<input id="project-title" maxlength="80"></label><label class="field">Stage color<input id="background" type="color"></label><button id="backup" class="full">Save project file ↓</button><label class="field">Project file action<select id="project-file-action"><option value="new">Import as new project</option><option value="replace">Replace current project</option></select></label><label class="file-button full subtle">Open project file<input id="project-file" type="file" accept="application/json,.json" aria-label="Open project file"></label>
</div></aside>
<section class="canvas-column" id="stage-section" aria-label="Animation stage"><div class="stage-bar"><div><strong id="stage-title">Your animation</strong><span id="demo-label">ORIGINAL DEMO</span></div><span>640 × 360 · 12 fps</span></div><div class="canvas-surround"><div class="stage-stack"><canvas id="stage" width="640" height="360" tabindex="0" aria-label="Drawing and animation canvas"></canvas><canvas id="onion-overlay" width="640" height="360" aria-hidden="true"></canvas><canvas id="stroke-overlay" width="640" height="360" aria-hidden="true"></canvas></div></div>
<div class="transport panel"><button id="play" class="primary">Play animation</button><button id="first-frame" title="Go to the first frame">Start</button><label class="loop"><input id="loop" type="checkbox" checked> Loop</label><span id="time" class="mono">0.00 s / 4.00 s</span></div>
<div class="timeline panel"><div class="timeline-top"><h3>Every pose tells a story</h3><label class="duration">Duration <select id="duration"><option value="12">1 second</option><option value="24">2 seconds</option><option value="48">4 seconds</option><option value="72">6 seconds</option><option value="96">8 seconds</option></select></label></div><label class="scrubber">Frame <output id="frame-label">1 / 48</output><input id="frame" type="range" min="0" max="47" value="0" aria-label="Timeline frame"></label><div class="timeline-labels"><span>START</span><span>END</span></div><section id="drawing-timeline" aria-label="Selected layer drawings"><h3>Drawings</h3><p id="drawing-status"></p><div id="drawing-cels"></div><div class="cel-actions"><button id="add-blank-cel" aria-describedby="drawing-action-hint">Blank drawing at this frame</button><button id="duplicate-cel" aria-describedby="drawing-action-hint">Duplicate held drawing at this frame</button><button id="delete-cel" aria-describedby="drawing-action-hint">Delete active drawing</button></div><p id="drawing-action-hint" class="hint"></p><label class="onion-control"><input id="onion-enabled" type="checkbox" aria-describedby="onion-status">Show neighboring drawings</label><p id="onion-status" class="hint"></p><button id="make-tween">Make drawing in-betweens</button><p id="tween-eligibility" class="hint"></p><div id="tween-workspace"></div></section><h3 class="key-heading">Pose keyframes</h3><div id="keys" aria-label="Selected layer keyframes"></div><p class="hint">Select a diamond to revisit a pose. The frames between poses are interpolated.</p></div>
<div class="export panel"><div><h3>Give your creation a little freedom.</h3><p>Animated GIF · 256 colors · loops forever. PNG frames · full color · exact 12 fps</p></div><div class="export-buttons"><button id="png">Save frame PNG</button><button id="gif" class="primary">Export animation ↓</button><button id="png-frames">Export PNG frames ZIP</button><button id="cancel-export" hidden>Cancel export</button></div><progress id="export-progress" max="1" value="0" hidden aria-label="Animation export progress"></progress></div>
</section>
<aside class="pose-panel panel"><div class="panel-heading"><h3>Strike a pose</h3><span>02</span></div><div class="tool-content"><label class="field">Layer name<input id="layer-name" maxlength="40"></label><p id="pose-state" class="pose-state">Frame 1 · saved pose</p><div class="pair"><label class="field">Position X<input id="pose-x" type="text" inputmode="decimal" min="-640" max="1280" step="1"></label><label class="field">Position Y<input id="pose-y" type="text" inputmode="decimal" min="-360" max="720" step="1"></label></div><label class="field">Scale<input id="pose-scale" type="text" inputmode="decimal" min="0.1" max="4" step="0.05"></label><label class="field">Rotation (degrees)<input id="pose-rotation" type="text" inputmode="decimal" min="-720" max="720" step="5"></label><label class="field">Opacity<input id="pose-opacity" type="text" inputmode="decimal" min="0" max="1" step="0.05"></label><label class="field">Motion to next pose<select id="easing"><option value="linear">Steady / linear</option><option value="ease">Ease in & out</option><option value="hold">Hold this pose</option></select></label><p id="pose-draft-status" role="status" hidden></p><button id="discard-pose-edits" class="full" hidden>Discard pose edits</button><button id="set-key" class="primary full">Set keyframe</button><button id="remove-key" class="text-button">Remove this keyframe</button><p class="hint">Changing pose values sets a key at this frame. The first key always stays. Drawing edits the active held drawing until its next boundary.</p><div class="note"><span aria-hidden="true">✦</span><strong>Start with two poses.</strong><p>Set a pose at the start. Scrub near the end, move your layer, then press play.</p></div></div></aside>
</div><section id="private-links" class="panel" role="region" aria-label="Private snapshot links"></section><footer><span>Local projects stay in this browser. Private sharing is optional and explicit.</span><span>Layer motion · no account required</span></footer></main>`;

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const canvas = el<HTMLCanvasElement>('stage'), ctx = canvas.getContext('2d')!;
let project = createDemo();
let history = new History(project);
let assets: Assets = new Map();
let selected = project.layers.at(-1)?.id || '';
let frame = 0, playing = false, mode: 'draw' | 'move' | 'edit' = 'draw';
let onionEnabled = false;
let animation = 0, playStarted = 0, playFrom = 0;
let busy = true, exporting = false, operation = 0, generation = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveRevision = 0;
let pendingKind: 'import' | 'history' | 'reset' | 'replacement' | 'library' | null = null;
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
const library = new ProjectLibrary();
let libraryHead: LibraryHead | null = null;
let libraryMode: 'library' | 'legacy' | 'empty' = 'empty';
let libraryAccepted = false, libraryPending = false, catalogRequest = 0, libraryTransition = 0;
type Lineage = { id: string | null; origin: 'library' | 'legacy' | 'empty' };
let lineage: Lineage = { id: null, origin: 'empty' };
let recoveryTarget: string | 'head' | 'legacy' = 'legacy';
let rawTarget: string | 'head' | 'legacy' = 'legacy';
let saveChain: Promise<void> = Promise.resolve();
const libraryView = createLibraryView(el('project-library'), id => void openLibraryProject(id), id => void deleteLibraryProject(id));
const downloadUrls = new Set<string>();
type Geometry = { width: number; height: number; dpr: number; left: number; top: number; canvasWidth: number; canvasHeight: number };
interface Gesture { pointer: number; base: Project; preview: Project; start: Point; pose: Pose; stroke?: Stroke; strokeTarget?: StrokeTarget; strokeDrag?: StrokeDrag; moved: boolean; layerId: string; frame: number; celFrame: number | null; generation: number; operation: number; geometry: Geometry }
let gesture: Gesture | null = null;
const tweens = createTweenWorkspace(el('tween-workspace'), {
  state: () => ({ project, assets, layerId: selected, frame, generation, operation, locked: busy || exporting || !!gesture || restorePending || retryPending }),
  admitDrafts, pause,
  apply(next, firstFrame) {
    if (busy || exporting || gesture || !admitDrafts()) return false;
    if (!commit(next)) return false;
    frame = firstFrame; renderTimeline(); poseFields(); controls(); draw();
    tell('In-between drawings applied as one edit. Undo restores the exact original drawings; older session history may be trimmed.');
    return true;
  },
});
el('make-tween').addEventListener('click', () => tweens.open());
const strokeEditor = createStrokeEditor(el('stroke-editor-host'), {
  state: () => ({ project, layerId: selected, frame, generation, operation, locked: busy || exporting || !!gesture, enabled: mode === 'edit' }),
  admitOtherDrafts: () => {
    if (!drafts.size) return true;
    tell('Apply or discard the other editor values before editing a retained stroke. Your raw fields are kept.', true); return false;
  },
  begin(keepSelection = false) { pause(); cancelGesture(); intent(keepSelection); },
  apply: commit,
  changed() { controls(); draw(); },
});
const onionContext = el<HTMLCanvasElement>('onion-overlay').getContext('2d')!;
const overlayContext = el<HTMLCanvasElement>('stroke-overlay').getContext('2d')!;
const privateLinks = createPrivateLinks(el('private-links'), {
  state: () => ({ generation, intent: operation, locked: busy || exporting || !!gesture || restorePending || retryPending || libraryPending, drafts: drafts.size > 0 || tweens.unsaved || strokeEditor.unsaved }),
  capture: () => {
    if (busy || exporting || gesture || restorePending || retryPending || libraryPending || !admitDrafts()) return null;
    if (tweens.unsaved) { tell('Apply or discard in-between scratch before publishing. The captured project excludes it.', true); return null; }
    pause(); return { project: validateProject(project), generation, intent: operation };
  },
});

function tell(text: string, error = false) { el('message').textContent = text; el('message').hidden = !text; el('message').classList.toggle('error', error); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'This operation could not be completed.'; }
function layer(): Layer | undefined { return project.layers.find(item => item.id === selected); }
function value(id: string, next: string) { const node = el<HTMLInputElement>(id); if (!drafts.has(id) && node.value !== next) node.value = next; }
function pause() { const wasPlaying = playing; playing = false; cancelAnimationFrame(animation); el('play').textContent = 'Play animation'; if (wasPlaying) { controls(); draw(); } }
function intent(keepStroke = false) { if (!keepStroke) strokeEditor.retire(); tweens.retire(); generation++; operation++; libraryTransition++; libraryPending = false; }
function draftControls() {
  const pending = drafts.size > 0;
  el('pose-draft-status').hidden = !pending;
  el('pose-draft-status').textContent = pending ? 'Unapplied editor values. Use Set keyframe to apply valid values, or discard edits before changing drawings, frames or projects. Downloads include committed work only.' : '';
  el('discard-pose-edits').hidden = !pending;
}
function admitDrafts(): boolean {
  if (!strokeEditor.admit()) return false;
  if (!drafts.size) return true;
  tell('Apply valid editor values or discard edits before changing drawings, frames or projects.', true);
  return false;
}
function markDraft(id: string) { cancelGesture(); intent(); pause(); drafts.set(id, el<HTMLInputElement>(id).value); draftControls(); updateLibrary(); }
function recoveryMessage(text: string) { recoveryDetail = text; el('recovery-detail').textContent = text; }
function updateSaveState() { el('save-status').textContent = restorePending ? 'Opening your local studio…' : recoveryBlocked ? 'Local save unavailable · memory only; saved record protected' : saveState === 'pending' ? 'Saving locally…' : saveState === 'failed' ? 'Local save unavailable · keep a project file' : initialDemo ? 'Original demo · saved after your first edit' : 'Saved in this browser'; }
function updateLibrary() {
  const locked = busy || exporting || !!gesture || restorePending || libraryPending;
  libraryView.update(libraryHead, lineage.id, locked);
  el<HTMLButtonElement>('refresh-project-library').disabled = locked;
  el<HTMLButtonElement>('download-legacy-project').disabled = locked;
  el<HTMLButtonElement>('duplicate-project').disabled = locked || !libraryAccepted || recoveryBlocked || (libraryHead?.entries.length ?? 0) >= 8;
  el<HTMLButtonElement>('save-project-as-new').disabled = locked || (libraryHead?.entries.length ?? 0) >= 8;
}
function knownCommit(result: LibraryCommit, snapshot: Project, owner: Lineage, request: number) {
  if (result.entry && !owner.id) { owner.id = result.entry.id; owner.origin = 'library'; }
  if (owner === lineage) {
    libraryHead = result.head; libraryMode = 'library'; initialDemo = false;
    if (request > completedReplacementReceipt) {
      completedReplacementReceipt = request;
      if (recoveryBlocked && result.entry) {
        recoveryTarget = result.entry.id; rawTarget = result.entry.id;
        rawRecord = { present: true, value: { schemaVersion: 1, id: result.entry.id, revision: result.entry.revision, project: snapshot } };
      }
    }
    updateLibrary();
  }
}
function queueActiveSave(snapshot: Project, revision: number, owner: Lineage): Promise<boolean> {
  const storage = library;
  let succeeded = false;
  const execute = async () => {
    if (owner === lineage && storage === library && recoveryBlocked) return;
    try {
      const result = owner.id ? await storage.save(owner.id, snapshot)
        : owner.origin === 'legacy' ? await storage.promoteLegacy(snapshot) : await storage.create(snapshot);
      knownCommit(result, snapshot, owner, revision);
      succeeded = true;
      if (owner === lineage && storage === library && revision === saveRevision && !recoveryBlocked) {
        saveState = 'saved'; updateSaveState(); libraryView.status(`Current project: ${project.title}. Edits save to this project.`);
      }
    } catch (error) {
      if (owner === lineage && storage === library) {
        recoveryBlocked = true; saveState = 'failed'; recoveryTarget = owner.id ?? 'legacy';
        const detail = error instanceof SavedProjectConflict ? 'Another tab changed this saved project. Your current artwork is kept. Reload the saved copy, download your work, or save it as a new project.' : errorMessage(error);
        recoveryMessage(detail); libraryView.status(detail); updateSaveState(); controls();
      }
    }
  };
  const result = saveChain.then(execute);
  saveChain = result.catch(() => {});
  return result.then(() => succeeded);
}
function scheduleSave() {
  clearTimeout(saveTimer);
  if (recoveryBlocked || !libraryAccepted) { saveState = 'failed'; updateSaveState(); return; }
  saveState = 'pending'; updateSaveState();
  const snapshot = validateProject(project), revision = ++saveRevision, owner = lineage;
  saveTimer = setTimeout(() => { saveTimer = undefined; void queueActiveSave(snapshot, revision, owner); }, 250);
}
async function flushActiveSave(): Promise<boolean> {
  clearTimeout(saveTimer); saveTimer = undefined;
  const owner = lineage, token = operation, revision = generation;
  await saveChain;
  if (owner !== lineage || token !== operation || revision !== generation) return false;
  if (recoveryBlocked || !libraryAccepted) return false;
  if (saveState === 'saved') return true;
  const succeeded = await queueActiveSave(validateProject(project), ++saveRevision, owner);
  return succeeded && owner === lineage && token === operation && revision === generation;
}
function draw() { const visible = gesture?.preview || project; renderFrame(ctx, visible, frame, assets); renderNeighborDrawings(onionContext, onionEnabled && !playing ? neighborDrawings(visible, selected, frame) : []); strokeEditor.overlay(overlayContext, visible); canvas.dataset.frame = String(frame); }
function controls() {
  privateLinks.update();
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
  el<HTMLButtonElement>('duplicate-layer').disabled = locked || !drawing || project.layers.length >= 8;
  const onionControl = el<HTMLInputElement>('onion-enabled');
  onionControl.disabled = locked || !drawing; onionControl.checked = onionEnabled;
  const guides = drawing && onionEnabled && !playing ? neighborDrawings(project, selected, frame) : [];
  el('onion-status').textContent = !drawing ? 'Select a drawing layer to compare neighboring exposures.' : !onionEnabled ? 'Compare the adjacent drawings in the current pose. Previous is teal; next is rose. Guides are excluded from saved artwork and exports.' : playing ? 'Neighboring drawing guides are paused during playback.' : guides.length ? guides.map(item => `${item.side === 'previous' ? 'Previous' : 'Next'}: ${item.strokes.length ? 'drawing' : 'blank drawing'} from frame ${item.frame + 1} (${item.side === 'previous' ? 'teal' : 'rose'})`).join('; ') + '. Guides use this frame’s pose and never enter exports.' : 'This drawing has no neighboring exposures.';
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
  el<HTMLButtonElement>('make-tween').disabled = locked || restorePending || retryPending || !drawing;
  el('tween-eligibility').textContent = drawing ? 'Pair adjacent nonblank drawings with the same 1–8 strokes. Review geometric in-betweens before committing.' : 'In-betweens need vector drawings; imported images animate through poses.';
  draftControls(); tweens.update(); strokeEditor.update(); updateLibrary();
  el<HTMLButtonElement>('edit-strokes-mode').disabled = locked || !drawing;
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
    button.addEventListener('click', () => { if (!admitDrafts() || busy || exporting || gesture || (item.id !== selected && !tweens.confirmLeave())) return; pause(); intent(); if (item.id !== selected) tweens.close(); selected = item.id; refresh(); }); list.append(button);
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
  pause(); tweens.retire(); const next = structuredClone(project);
  try { action(next); commit(next); } catch (error) { tell(errorMessage(error), true); refresh(); }
}
function changeLayer(action: (chosen: Layer) => Layer) {
  edit(next => { const index = next.layers.findIndex(item => item.id === selected); if (index < 0) throw new Error('Select a layer first.'); next.layers[index] = action(next.layers[index]); });
}
function seek(next: number) { if (busy || exporting || gesture || !admitDrafts()) { el<HTMLInputElement>('frame').value = String(frame); return; } pause(); intent(); frame = Math.max(0, Math.min(project.frameCount - 1, next)); renderTimeline(); poseFields(); controls(); draw(); }
function tick(now: number) {
  const next = playbackFrame(playFrom, now - playStarted);
  if (next >= project.frameCount && !el<HTMLInputElement>('loop').checked) { frame = project.frameCount - 1; pause(); }
  else frame = next % project.frameCount;
  renderTimeline(); poseFields(); controls(); draw();
  if (playing) animation = requestAnimationFrame(tick);
}
el('play').addEventListener('click', () => {
  if (busy || exporting || gesture || !admitDrafts()) return;
  if (playing) { pause(); return; }
  intent();
  playing = true; playFrom = frame === project.frameCount - 1 ? 0 : frame; playStarted = performance.now(); el('play').textContent = 'Pause animation'; controls(); draw(); animation = requestAnimationFrame(tick);
});
el('first-frame').addEventListener('click', () => seek(0));
el<HTMLInputElement>('frame').addEventListener('input', event => seek(Number((event.target as HTMLInputElement).value)));
el<HTMLSelectElement>('duration').addEventListener('change', event => {
  const input = event.target as HTMLSelectElement;
  if (busy || exporting || gesture || !admitDrafts()) { input.value = String(project.frameCount); return; }
  tweens.retire();
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

function selectMode(next: 'draw' | 'move' | 'edit') { pause(); intent(); mode = next; el('draw-mode').setAttribute('aria-pressed', String(mode === 'draw')); el('move-mode').setAttribute('aria-pressed', String(mode === 'move')); el('edit-strokes-mode').setAttribute('aria-pressed', String(mode === 'edit')); canvas.dataset.mode = mode; controls(); draw(); }
el('draw-mode').addEventListener('click', () => { if (admitDrafts()) selectMode('draw'); });
el('move-mode').addEventListener('click', () => { if (admitDrafts()) selectMode('move'); });
el('edit-strokes-mode').addEventListener('click', () => { if (admitDrafts() && layer()?.kind === 'drawing') selectMode('edit'); });
// Refuse before native focus/blur can auto-apply an unrelated pose field.
app.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  // Discard owns the raw fields before native blur can auto-commit a valid pose value.
  if ((event.target as HTMLElement).closest('#discard-pose-edits')) { event.preventDefault(); return; }
  if (!(event.target as HTMLElement).closest('#draw-mode,#move-mode,#edit-strokes-mode,#duplicate-layer,#onion-enabled,.onion-control')) return;
  if (!admitDrafts()) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
// A label's later default click can focus its input even after pointerdown cancellation.
app.addEventListener('click', event => {
  if ((event.target as HTMLElement).closest('.onion-control') && !admitDrafts()) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
el('onion-enabled').addEventListener('change', () => {
  const input = el<HTMLInputElement>('onion-enabled');
  if (busy || exporting || gesture || layer()?.kind !== 'drawing' || !admitDrafts()) { input.checked = onionEnabled; return; }
  onionEnabled = input.checked; controls(); draw();
});
el<HTMLInputElement>('ink').addEventListener('input', () => tweens.retire());
el<HTMLInputElement>('brush').addEventListener('input', event => { tweens.retire(); el('brush-value').textContent = `${(event.target as HTMLInputElement).value} px`; });
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
  if (event.button !== 0 || !event.isPrimary || busy || exporting || gesture) return;
  if (!admitDrafts()) { event.preventDefault(); return; }
  const chosen = layer();
  if (!chosen) { tell('Add a drawing layer or import artwork first.', true); return; }
  if ((mode === 'draw' || mode === 'edit') && chosen.kind !== 'drawing') { tell('Select a drawing layer to draw, or choose Move to position this image.', true); return; }
  const measured = geometry();
  if (mode === 'edit' && !uniformCanvas(measured.canvasWidth, measured.canvasHeight)) { event.preventDefault(); strokeEditor.status('Canvas proportions changed. Restore a uniform stage before dragging; the stroke list remains available.'); return; }
  pause(); intent(); canvas.focus({ preventScroll: true });
  const point = stagePoint(event), pose = evaluatePose(chosen, frame), preview = structuredClone(project);
  const celFrame = chosen.kind === 'drawing' ? evaluateDrawingCel(chosen, frame).frame : null;
  let retainedTarget: StrokeTarget | undefined;
  if (mode === 'edit' && chosen.kind === 'drawing') {
    if (pose.opacity === 0) { event.preventDefault(); strokeEditor.status('This layer is transparent. Select its retained strokes from the list.'); controls(); draw(); return; }
    const active = evaluateDrawingCel(chosen, frame);
    const index = hitStroke(active.strokes, localPoint(point, pose), 6 * WIDTH / measured.canvasWidth / pose.scale);
    if (index === null) { event.preventDefault(); strokeEditor.status('No retained stroke was hit. Choose a stroke from the list.'); controls(); draw(); return; }
    retainedTarget = { layerId: chosen.id, celFrame: active.frame, strokeIndex: index };
    strokeEditor.select(index, true);
  }
  let local: Point | null = null;
  if (mode === 'draw') {
    try {
      local = checkedPoint(point, pose);
      const counts = drawingCounts(project);
      if (counts.strokes >= 100 || counts.points >= 10000) throw new Error('This project has reached its drawing limit (100 strokes or 10,000 points). Delete a drawing layer or undo a stroke first.');
    } catch (error) { tell(errorMessage(error), true); return; }
  }
  gesture = { pointer: event.pointerId, base: project, preview, start: point, pose, moved: false, layerId: chosen.id, frame, celFrame, generation, operation, geometry: geometry() };
  if (retainedTarget) { gesture.strokeTarget = retainedTarget; gesture.strokeDrag = new StrokeDrag({ x: event.clientX, y: event.clientY }, pose, gesture.geometry.canvasWidth); }
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
  if (gesture.strokeTarget) {
    try { updateRetainedStroke(gesture, event); } catch (error) { cancelGesture(); strokeEditor.status(errorMessage(error)); return; }
  } else if (gesture.stroke) {
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
function updateRetainedStroke(active: Gesture, event: PointerEvent) {
  const update = active.strokeDrag!.update({ x: event.clientX, y: event.clientY });
  active.moved = update.moved;
  active.preview = update.moved ? translateStroke(active.base, active.strokeTarget!, update.delta) : active.base;
}
function endGesture(event: PointerEvent, cancelled: boolean) {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  if (cancelled || !ownsGesture(gesture)) { cancelGesture(); return; }
  if (gesture.strokeTarget) {
    try { updateRetainedStroke(gesture, event); } catch (error) { cancelGesture(); strokeEditor.status(errorMessage(error)); return; }
  }
  const completed = gesture; gesture = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (completed.stroke || completed.moved) {
    try {
      const chosen = completed.preview.layers.find(item => item.id === completed.layerId)!;
      const next = completed.stroke && chosen.kind === 'drawing' ? replaceDrawingCelStrokes(completed.base, completed.layerId, completed.celFrame!, chosen.cels.find(cel => cel.frame === completed.celFrame)!.strokes) : completed.preview;
      const changed = commit(next);
      if (completed.strokeTarget) { strokeEditor.rebind(completed.strokeTarget); strokeEditor.status(changed ? 'Stroke moved.' : 'Stroke position is unchanged. No new edit was made.'); controls(); draw(); }
      tell('');
    } catch (error) { tell(errorMessage(error), true); refresh(); }
  } else { controls(); draw(); }
}
canvas.addEventListener('pointerup', event => endGesture(event, false));
canvas.addEventListener('pointercancel', event => endGesture(event, true));
canvas.addEventListener('blur', () => { if (gesture?.strokeTarget) cancelGesture(); });
app.addEventListener('input', () => { if (gesture?.strokeTarget) cancelGesture(); }, true);
canvas.addEventListener('lostpointercapture', event => { if (gesture) endGesture(event as PointerEvent, true); });

function setPose() {
  const chosen = layer(); if (!chosen || busy || exporting || gesture || !strokeEditor.admit()) return;
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
  if (!strokeEditor.admit()) return;
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
el('add-layer').addEventListener('click', () => { if (busy || exporting || gesture || !admitDrafts() || !tweens.confirmLeave()) return; edit(next => { const added = createDrawingLayer(`Drawing ${next.layers.length + 1}`); next.layers.push(added); selected = added.id; selectMode('draw'); }); });
el('duplicate-layer').addEventListener('click', () => {
  if (busy || exporting || gesture || !admitDrafts()) return;
  try {
    const next = duplicateDrawingLayer(project, selected);
    const index = next.layers.findIndex(item => item.id === selected);
    const copiedId = next.layers[index + 1].id;
    if (!tweens.confirmLeave()) return;
    pause();
    if (commit(next)) { selected = copiedId; refresh(); tell('Drawing layer duplicated. All drawings and pose keys are independent.'); }
  } catch (error) { tell(errorMessage(error), true); }
});
el('delete-layer').addEventListener('click', () => { if (busy || exporting || gesture || !admitDrafts() || !tweens.confirmLeave()) return; edit(next => { next.layers = next.layers.filter(item => item.id !== selected); }); });
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
  const next = history.peek(direction);
  if (!next.layers.some(item => item.id === selected) && !tweens.confirmLeave()) return;
  pause(); intent(); const token = operation, revision = generation; busy = true; pendingKind = 'history'; controls();
  let prepared: Assets | null = null;
  try {
    if (!matchingAssets(next)) prepared = await loadAssets(next);
    if (token !== operation || revision !== generation || drafts.size || gesture) { if (prepared) closeAssets(prepared); return; }
    // Cursor movement and publication are synchronous and occur only after owned decode succeeds.
    const admitted = history[direction]();
    if (prepared) { tweens.retire(); closeAssets(assets); assets = prepared; }
    project = admitted; isDemo = false; initialDemo = false; refresh(); scheduleSave();
  } catch (error) { if (token === operation) tell(errorMessage(error), true); }
  finally { if (token === operation) { busy = false; pendingKind = null; controls(); } }
}
el('undo').addEventListener('click', () => void travel('undo'));
el('redo').addEventListener('click', () => void travel('redo'));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && gesture) { event.preventDefault(); cancelGesture(); return; }
  if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
  const strokeFocus = event.target === canvas || (event.target as HTMLElement).closest('#stroke-list button');
  if (mode === 'edit' && strokeFocus && !event.ctrlKey && !event.metaKey && !event.altKey && (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(event.key))) {
    event.preventDefault();
    if (event.repeat || busy || exporting || gesture || !admitDrafts()) return;
    const target = strokeEditor.target; if (!target) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { strokeEditor.remove(); return; }
    const chosen = layer(); if (!chosen) return;
    pause(); intent(true); strokeEditor.rebind(target);
    const pose = evaluatePose(chosen, frame), amount = event.shiftKey ? 10 : 1;
    const stageDelta = { x: event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, y: event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0 };
    const origin = localPoint({ x: 0, y: 0 }, pose), point = localPoint(stageDelta, pose);
    try { const changed = commit(translateStroke(project, target, { x: point.x - origin.x, y: point.y - origin.y })); strokeEditor.rebind(target); strokeEditor.status(changed ? 'Stroke moved.' : 'Stroke position is unchanged. No new edit was made.'); controls(); draw(); }
    catch (error) { strokeEditor.status(errorMessage(error)); }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void travel(event.shiftKey ? 'redo' : 'undo'); }
  if (event.code === 'Space' && event.target === canvas) { event.preventDefault(); el('play').click(); }
});

type PreparedProject = { project: Project; history: History; assets: Assets };
async function prepareProject(input: Project): Promise<PreparedProject> {
  const safe = validateProject(input), preparedHistory = new History(safe);
  await validateProjectImages(safe);
  const preparedAssets = await loadAssets(safe);
  return { project: preparedHistory.current, history: preparedHistory, assets: preparedAssets };
}
function publishProject(prepared: PreparedProject, id: string | null, origin: Lineage['origin'], demo = false) {
  privateLinks.clearSetup();
  pause(); tweens.close(); closeAssets(assets); assets = prepared.assets;
  history = prepared.history; project = prepared.project; lineage = { id, origin };
  selected = project.layers.at(-1)?.id || ''; frame = 0; isDemo = demo; initialDemo = false;
  drafts.clear(); generation++; recoveryBlocked = false; rawRecord = null; saveState = 'saved';
  refresh(); libraryView.status(id ? `Current project: ${project.title}. Edits save to this project.` : 'Your library is empty. The next edit saves this canvas as a new project.');
}
function libraryOwner() {
  const storage = library, owner = lineage, token = operation, revision = generation;
  return { storage, owner, token, revision,
    current: () => library === storage && lineage === owner && operation === token && generation === revision && !gesture && !drafts.size };
}
async function refreshCatalog(): Promise<boolean> {
  const storage = library, request = ++catalogRequest;
  try {
    const view = await storage.read();
    if (storage !== library || request !== catalogRequest) return false;
    const before = libraryHead?.entries.find(entry => entry.id === lineage.id);
    const after = view.head?.entries.find(entry => entry.id === lineage.id);
    storage.acceptRead(view.receipt); libraryAccepted = true; libraryHead = view.head; libraryMode = view.mode;
    if (lineage.id && (!after || before?.revision !== after.revision)) { recoveryBlocked = true; recoveryTarget = lineage.id; saveState = 'failed'; recoveryMessage('The saved copy changed in another tab. Current memory and editor values were kept; review before replacing or reload explicitly.'); updateSaveState(); controls(); }
    updateLibrary(); libraryView.status(`Projects refreshed (${libraryMode === 'legacy' ? 'original saved draft' : libraryMode === 'empty' ? 'empty library' : 'saved library'}). Current memory: ${project.title}. Editor values were kept.`);
    return true;
  } catch (error) {
    if (storage === library && request === catalogRequest) {
      libraryAccepted = false; recoveryBlocked = true; recoveryTarget = 'head'; saveState = 'failed';
      if (error instanceof LibraryReadFailure) { recoveryTarget = error.target; rawTarget = error.target; rawRecord = error.raw; }
      recoveryMessage(errorMessage(error)); libraryView.status(errorMessage(error)); updateSaveState(); controls();
    }
    return false;
  }
}
async function leaveWorkspace(): Promise<boolean> {
  if (busy || exporting || gesture || restorePending || libraryPending || !admitDrafts() || !tweens.confirmLeave()) return false;
  const owner = libraryOwner();
  if (await flushActiveSave()) return owner.current();
  if (!owner.current()) return false;
  if (!window.confirm('This current work is not saved. Leave it and clear its session Undo history? Download a project file first to keep your artwork. Cancel keeps this canvas.')) return false;
  return owner.current();
}
function libraryFailure(error: unknown, target?: string | 'legacy' | 'head') {
  const detail = error instanceof SavedProjectConflict ? 'Another tab changed the saved project or project list. Current artwork is kept. Refresh projects, reload the saved copy, or save memory as a new project.' : errorMessage(error);
  libraryView.status(detail); tell(detail, true);
  if (target !== undefined && (target === lineage.id || lineage.id === null)) { recoveryTarget = target; recoveryBlocked = true; saveState = 'failed'; recoveryMessage(detail); updateSaveState(); }
  controls();
}
async function openLibraryProject(id: string) {
  if (id === lineage.id && libraryHead?.activeId === id && !recoveryBlocked) return;
  if (!await leaveWorkspace()) return;
  pause(); intent(); const owner = libraryOwner(), transition = ++libraryTransition; libraryPending = true; updateLibrary();
  let prepared: PreparedProject | null = null;
  try {
    const loaded = await owner.storage.readProject(id);
    if (!owner.current()) return;
    prepared = await prepareProject(loaded.project);
    if (!owner.current()) return;
    busy = true; pendingKind = 'library'; controls();
    const result = await owner.storage.activate(loaded.receipt);
    if (!owner.current()) return;
    libraryHead = result.head; libraryMode = 'library'; libraryAccepted = true;
    publishProject(prepared, loaded.entry.id, 'library'); prepared = null;
    tell('Project opened. Undo starts fresh for this project.');
  } catch (error) { if (owner.current()) libraryFailure(error, id); }
  finally {
    if (prepared) closeAssets(prepared.assets);
    if (transition === libraryTransition) { libraryPending = false; if (owner.storage === library && owner.token === operation) { busy = false; pendingKind = null; } controls(); }
  }
}
async function createLibraryProject(next: Project, demo = false, saveMemory = false) {
  if (saveMemory) {
    if (busy || exporting || gesture || restorePending || libraryPending || !admitDrafts() || !tweens.confirmLeave()) return;
  } else if (!await leaveWorkspace()) return;
  pause(); intent(); const owner = libraryOwner(), transition = ++libraryTransition; libraryPending = true; updateLibrary();
  let prepared: PreparedProject | null = null;
  try {
    prepared = await prepareProject(next);
    if (!owner.current()) return;
    // Obtain only catalog authority; never silently replace current editor work.
    const view = await owner.storage.read();
    if (!owner.current()) { recoveryMessage('The editor changed during recovery. Newer work was kept; retry when ready.'); return; }
    owner.storage.acceptRead(view.receipt); libraryHead = view.head; libraryMode = view.mode; libraryAccepted = true;
    if (view.legacy) {
      const original = await prepareProject(view.legacy.project);
      try { if (!owner.current()) return; owner.storage.acceptProject(view.legacy.receipt); }
      finally { closeAssets(original.assets); }
    }
    busy = true; pendingKind = 'library'; controls();
    const result = await owner.storage.create(prepared.project);
    if (!owner.current()) return;
    libraryHead = result.head; libraryMode = 'library';
    publishProject(prepared, result.entry!.id, 'library', demo); prepared = null;
    tell(saveMemory ? 'Your committed memory work is saved as a separate project.' : demo ? 'Original orbit demo saved as a separate project.' : 'New project saved. Your other projects were kept.');
  } catch (error) { if (owner.current()) libraryFailure(error); }
  finally {
    if (prepared) closeAssets(prepared.assets);
    if (transition === libraryTransition) { libraryPending = false; if (owner.storage === library && owner.token === operation) { busy = false; pendingKind = null; } controls(); }
  }
}
async function duplicateLibraryProject() {
  if (!await leaveWorkspace()) return;
  pause(); intent(); const owner = libraryOwner(), transition = ++libraryTransition; libraryPending = true; updateLibrary();
  let prepared: PreparedProject | null = null;
  try {
    prepared = await prepareProject(project);
    if (!owner.current()) return;
    busy = true; pendingKind = 'library'; controls();
    const result = owner.owner.id ? await owner.storage.duplicate(owner.owner.id) : await owner.storage.create(prepared.project);
    if (!owner.current()) return;
    libraryHead = result.head; libraryMode = 'library';
    publishProject(prepared, result.entry!.id, 'library'); prepared = null;
    tell('Project duplicated. Both copies keep their own future edits; Undo starts fresh.');
  } catch (error) { if (owner.current()) libraryFailure(error); }
  finally {
    if (prepared) closeAssets(prepared.assets);
    if (transition === libraryTransition) { libraryPending = false; if (owner.storage === library && owner.token === operation) { busy = false; pendingKind = null; } controls(); }
  }
}
async function deleteLibraryProject(id: string) {
  if (!await leaveWorkspace()) return;
  pause(); intent(); const owner = libraryOwner(), transition = ++libraryTransition; libraryPending = true; updateLibrary();
  let prepared: PreparedProject | null = null;
  try {
    const view = await owner.storage.read();
    if (!owner.current()) { recoveryMessage('The editor changed during recovery. Newer work was kept; retry when ready.'); return; }
    owner.storage.acceptRead(view.receipt); libraryHead = view.head; updateLibrary();
    if (view.head?.activeId !== owner.owner.id) { libraryView.status('Another tab selected a different project. Open the project you want to keep before reviewing deletion again.'); return; }
    const review = await owner.storage.reviewDelete(id);
    if (!owner.current()) return;
    if (!window.confirm(`Delete saved project “${review.entry.title}”? This permanently removes this browser copy and cannot be undone. Download a project file first. Cancel keeps it.`)) return;
    if (!owner.current()) return;
    const changesCanvas = owner.owner.id === id;
    let next: LoadedProject | null = null;
    if (changesCanvas && review.nextId) {
      next = await owner.storage.readProject(review.nextId);
      if (!owner.current()) return;
      prepared = await prepareProject(next.project);
    } else if (changesCanvas) prepared = await prepareProject(createProject());
    if (!owner.current()) return;
    busy = true; pendingKind = 'library'; controls();
    const result = await owner.storage.delete(review.receipt, next?.receipt ?? null);
    if (!owner.current()) return;
    libraryHead = result.head; libraryMode = 'library';
    if (changesCanvas && prepared) { publishProject(prepared, result.entry?.id ?? result.head.activeId, result.head.activeId ? 'library' : 'empty'); prepared = null; }
    else { updateLibrary(); libraryView.status('Saved project deleted. Current editor and Undo history were kept.'); }
    tell(changesCanvas ? 'Saved project deleted. Its session history was cleared; the original legacy draft will not reappear.' : 'Saved project deleted. Current project was kept.');
  } catch (error) { if (owner.current()) libraryFailure(error); }
  finally {
    if (prepared) closeAssets(prepared.assets);
    if (transition === libraryTransition) { libraryPending = false; if (owner.storage === library && owner.token === operation) { busy = false; pendingKind = null; } controls(); }
  }
}
el('refresh-project-library').addEventListener('click', () => void refreshCatalog());
el('duplicate-project').addEventListener('click', () => void duplicateLibraryProject());
el('save-project-as-new').addEventListener('click', () => void createLibraryProject(validateProject(project), false, true));
el('download-legacy-project').addEventListener('click', async () => {
  const storage = library;
  try {
    const original = await storage.readRaw('legacy');
    if (storage !== library) return;
    if (!original.present) { libraryView.status('No original legacy draft is available. Current project files are downloaded with Save project file.'); return; }
    const json = serializeRawRecord(original.value, MAX_JSON_BYTES);
    download(new Blob([json], { type: 'application/json' }), '.original-legacy-draft.json', 'motion');
    libraryView.status('Original legacy draft downloaded. It is separate from saved library projects and current editable work.');
  } catch (error) { if (storage === library) libraryView.status(errorMessage(error)); }
});

async function replaceProject(next: Project, token: number, reset: boolean) {
  const safe = validateProject(next), preparedHistory = reset ? new History(safe) : null; await validateProjectImages(safe);
  if (token !== operation || drafts.size || gesture) return false;
  const prepared = await loadAssets(safe);
  if (token !== operation || drafts.size || gesture) { closeAssets(prepared); return false; }
  tweens.close(); closeAssets(assets); assets = prepared;
  if (preparedHistory) history = preparedHistory; else history.commit(safe);
  project = history.current; selected = project.layers.at(-1)?.id || ''; frame = 0; isDemo = false; initialDemo = false;
  generation++; refresh(); scheduleSave(); return true;
}
async function importFile(input: HTMLInputElement, kind: 'image' | 'project') {
  const file = input.files?.[0]; input.value = '';
  if (!file || exporting || gesture || (busy && pendingKind !== 'import') || !admitDrafts()) return;
  if (pendingKind === 'import' && (busy || libraryPending)) { intent(); busy = false; pendingKind = null; }
  const action = el<HTMLSelectElement>('project-file-action').value;
  if (kind === 'project' && action === 'new') {
    if (!await leaveWorkspace()) return;
  } else {
    if (!tweens.confirmLeave()) return;
    if (kind === 'project') {
      const before = libraryOwner();
      if (!window.confirm(recoveryBlocked ? 'Replace current in-memory artwork with this file? The protected saved copy is kept unchanged. Downloads and Undo will use the imported committed project.' : 'Replace the current project artwork with this file? Download a backup first. Other saved projects are kept; this project starts a fresh Undo history.')) return;
      if (!before.current()) return;
    }
  }
  pause(); intent(); const token = operation, revision = generation, owner = lineage, transition = ++libraryTransition; libraryPending = true; pendingKind = 'import'; controls();
  try {
    let next: Project;
    if (kind === 'image') { const added = await importImage(file); next = structuredClone(project); next.layers.push(added); }
    else { if (file.size > MAX_JSON_BYTES) throw new Error(`Choose a project file no larger than ${MAX_JSON_BYTES.toLocaleString('en-US')} bytes (6 MiB plus the legacy migration allowance).`); next = validateProject(JSON.parse(await file.text())); }
    if (token !== operation || revision !== generation || owner !== lineage) return;
    if (kind === 'project' && action === 'new') {
      // Reuse the already-consented transition without prompting or saving again.
      const prepared = await prepareProject(next);
      try {
        if (token !== operation || revision !== generation || owner !== lineage) return;
        busy = true; pendingKind = 'library'; controls();
        const result = await library.create(prepared.project);
        if (token !== operation || revision !== generation || owner !== lineage) return;
        libraryHead = result.head; libraryMode = 'library';
        publishProject(prepared, result.entry!.id, 'library');
        tell('Project file imported as a new editable project. Other saved projects were kept.');
        return;
      } finally { if (assets !== prepared.assets) closeAssets(prepared.assets); }
    }
    if (await replaceProject(next, token, kind === 'project')) { tell(kind === 'image' ? 'Artwork imported. Set a few poses to bring it to life.' : recoveryBlocked ? 'Project file opened in memory. The saved copy remains protected.' : 'Project opened. Your embedded artwork and poses are ready.'); if (kind === 'image') selectMode('move'); }
  } catch (error) { if (token === operation) tell(`${errorMessage(error)} Your current project is unchanged.`, true); }
  finally { if (transition === libraryTransition) { libraryPending = false; if (token === operation) { busy = false; pendingKind = null; } controls(); } }
}
el<HTMLInputElement>('image-file').addEventListener('change', event => void importFile(event.target as HTMLInputElement, 'image'));
el<HTMLInputElement>('project-file').addEventListener('change', event => void importFile(event.target as HTMLInputElement, 'project'));
async function fresh(demo: boolean) { await createLibraryProject(demo ? createDemo() : createProject(), demo); }
el('replace-saved-project').addEventListener('click', async () => {
  if (busy || exporting || gesture || !admitDrafts() || !recoveryBlocked || restorePending || retryPending) return;
  if (recoveryTarget === 'head') { recoveryMessage('The project list cannot be replaced here. Preserve its record and repair browser storage before retrying.'); return; }
  pause(); intent(); const owner = libraryOwner(), request = ++replacementRequest, saveRequest = ++saveRevision;
  const snapshot = validateProject(project); let target = recoveryTarget;
  busy = true; pendingKind = 'replacement'; clearTimeout(saveTimer); controls();
  try {
    if (rawRecord === null && target === 'legacy') {
      // Only an unknown startup/legacy target needs catalog discovery. A known
      // project remains the replacement target even if another tab selected it away.
      const view = await owner.storage.read();
      if (!owner.current()) return;
      libraryHead = view.head; libraryMode = view.mode; updateLibrary();
      target = view.head?.activeId ?? 'legacy';
    }
    const review = await owner.storage.reviewReplacement(target);
    if (!owner.current() || request !== replacementRequest) return;
    if (!window.confirm(`Replace saved project ${review.title ? `“${review.title}”` : '(unreadable saved copy)'} with current committed artwork? Download backups first. Unapplied fields and in-between choices are excluded. This overwrites this saved copy only.`)) return;
    if (!owner.current() || request !== replacementRequest) return;
    const result = await owner.storage.replace(snapshot, review.receipt);
    knownCommit(result, snapshot, owner.owner, saveRequest);
    if (request !== replacementRequest) return;
    if (owner.current()) {
      if (result.entry) lineage.id = result.entry.id;
      lineage.origin = 'library'; libraryHead = result.head; libraryMode = 'library'; libraryAccepted = true;
      recoveryBlocked = false; rawRecord = null; isDemo = false; initialDemo = false; saveState = 'saved';
      tell('Saved project explicitly replaced. Automatic saving is enabled.');
    } else if (recoveryBlocked) {
      saveState = 'failed'; recoveryMessage('The earlier captured project was saved. Newer memory work is not saved; download it or explicitly replace the saved project again.');
    }
  } catch (error) {
    if (request === replacementRequest && recoveryBlocked) { saveState = 'failed'; recoveryMessage(errorMessage(error)); if (owner.storage === library) tell(`${errorMessage(error)} Current memory is not saved; the saved copy remains protected.`, true); }
  } finally {
    if (request === replacementRequest) {
      if (owner.token === operation) { busy = false; pendingKind = null; }
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
  tweens.retire();
  download(new Blob([JSON.stringify(validateProject(project))], { type: 'application/json' }), '.motion.json');
  tell(`Editable project file downloaded. It includes every committed drawing and pose.${drafts.size || strokeEditor.unsaved ? ' Unapplied editor values are not included.' : ''}`);
});
el('png').addEventListener('click', () => {
  if (busy || exporting || gesture || !admitDrafts()) return;
  pause(); tweens.retire(); const snapshot = validateProject(project), capturedFrame = frame, token = operation, revision = generation, request = ++pngRequest;
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
el('gif').addEventListener('click', () => { void exportAnimation(false); });
el('png-frames').addEventListener('click', () => { void exportAnimation(true); });
async function exportAnimation(pngFrames: boolean) {
  if (busy || exporting || gesture || !admitDrafts()) return;
  pause(); tweens.retire(); const snapshot = validateProject(project), token = operation, revision = generation, controller = new AbortController();
  exporting = true; exported = controller; controls(); el<HTMLProgressElement>('export-progress').value = 0; tell('Rendering your animation locally…');
  try {
    const blob = await (pngFrames ? exportPngFrames : exportGif)(snapshot, progress => { if (exported === controller && token === operation) el<HTMLProgressElement>('export-progress').value = progress; }, controller.signal);
    if (exported !== controller || token !== operation || revision !== generation || controller.signal.aborted) return;
    download(blob, pngFrames ? '-frames.zip' : '.gif', snapshot.title); tell(pngFrames ? 'Your full-color PNG frames are ready. The manifest preserves all frames at exactly 12 fps.' : 'Your animated GIF is ready. Colors use a fixed 256-color palette.');
  } catch (error) { if (exported === controller && token === operation) tell(error instanceof Error && error.name === 'AbortError' ? 'Export cancelled. Your project is unchanged.' : errorMessage(error), !(error instanceof Error && error.name === 'AbortError')); }
  finally { if (exported === controller) { exporting = false; exported = null; controls(); } }
}
el('cancel-export').addEventListener('click', () => exported?.abort());
window.addEventListener('beforeunload', event => { if (saveState !== 'saved' || gesture || drafts.size || tweens.unsaved || strokeEditor.unsaved) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('blur', cancelGesture);
window.addEventListener('resize', cancelGesture);
window.addEventListener('scroll', cancelGesture, true);
const stageObserver = new ResizeObserver(cancelGesture); stageObserver.observe(canvas);
window.addEventListener('pagehide', event => {
  intent(); pause(); cancelGesture(); exported?.abort();
  for (const url of downloadUrls) URL.revokeObjectURL(url); downloadUrls.clear();
  clearTimeout(saveTimer); saveTimer = undefined; saveRevision++; libraryPending = false; catalogRequest++;
  if (!event.persisted) { library.close(); closeAssets(assets); }
  libraryAccepted = false; recoveryBlocked = true; saveState = 'failed';
  recoveryMessage('This page was suspended. Current memory and editor values are kept; retry the saved copy before saving.');
  if (!restorePending) { busy = false; pendingKind = null; }
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { libraryAccepted = false; recoveryBlocked = true; updateSaveState(); }
  controls(); draw();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); cancelGesture(); } });

// Retry reads and decoding deliberately leave current memory work editable.
// Every input/commit/import/history/reset invalidates the publication token.
async function restoreSaved(startup: boolean) {
  const owner = libraryOwner();
  const selectedTarget = recoveryTarget;
  let prepared: PreparedProject | null = null;
  let phase: 'catalog' | 'project' = 'catalog';
  try {
    const view = await owner.storage.read();
    phase = 'project';
    if (!owner.current()) { recoveryMessage('The editor changed during recovery. Newer work was kept; retry when ready.'); return; }
    libraryHead = view.head; libraryMode = view.mode; updateLibrary();
    let loaded: LoadedProject | null = null;
    let next: Project | null = null;
    if (view.mode === 'library') {
      const id = !startup && selectedTarget !== 'legacy' && selectedTarget !== 'head' && view.head!.entries.some(entry => entry.id === selectedTarget) ? selectedTarget : view.head!.activeId;
      if (id) { recoveryTarget = id; loaded = await owner.storage.readProject(id); next = loaded.project; }
      else next = createProject();
    } else if (view.legacy) { recoveryTarget = 'legacy'; next = view.legacy.project; }
    const raw = await owner.storage.readRaw(recoveryTarget);
    if (owner.storage === library && owner.owner === lineage) { rawRecord = raw; rawTarget = recoveryTarget; }
    if (!owner.current()) { recoveryMessage('The editor changed during recovery. Newer work was kept; retry when ready.'); return; }
    if (!startup && !window.confirm('Reload the saved project and replace current memory artwork and session Undo history? Download your current project file first. Cancel keeps current work.')) return;
    if (!owner.current()) return;
    if (next) prepared = await prepareProject(next);
    if (!owner.current()) { recoveryMessage('The editor changed during recovery. Newer work was kept; retry when ready.'); return; }
    owner.storage.acceptRead(view.receipt);
    if (loaded) {
      // Startup adoption never writes; an explicit retry can choose another entry.
      if (loaded.entry.id === view.head!.activeId) owner.storage.acceptProject(loaded.receipt);
      else {
        const result = await owner.storage.activate(loaded.receipt);
        if (!owner.current()) return;
        libraryHead = result.head;
      }
    } else if (view.legacy) owner.storage.acceptProject(view.legacy.receipt);
    libraryAccepted = true;
    if (prepared) {
      publishProject(prepared, loaded?.entry.id ?? null, loaded ? 'library' : view.mode === 'legacy' ? 'legacy' : 'empty'); prepared = null;
      tell(view.mode === 'legacy' ? 'Your saved local project is ready. The original draft is retained; the next edit saves it in Projects.' : 'Your saved local project is ready.');
    } else {
      lineage = { id: null, origin: 'empty' }; recoveryBlocked = false; rawRecord = null; saveState = 'saved';
      updateSaveState(); updateLibrary(); tell('No saved project was found. The original demo is kept until your first edit.');
    }
  } catch (error) {
    if (owner.storage === library && owner.token === operation) {
      saveState = 'failed'; recoveryBlocked = true; libraryAccepted = false;
      recoveryMessage(errorMessage(error)); tell(`${errorMessage(error)} Current work is kept in memory. Download a project file; replacing a saved copy requires review.`, true);
      if (error instanceof LibraryReadFailure) {
        recoveryTarget = error.target; rawTarget = error.target; rawRecord = error.raw;
        return;
      }
      try {
        let target = recoveryTarget;
        if (phase === 'catalog') {
          const head = await owner.storage.readRaw('head');
          target = 'head';
          if (!head.present) {
            // Review proves absent valid catalog/key membership; it writes nothing.
            await owner.storage.reviewReplacement('legacy'); target = 'legacy';
          }
        }
        const raw = await owner.storage.readRaw(target);
        if (owner.storage === library && owner.token === operation) { recoveryTarget = target; rawTarget = target; rawRecord = raw; }
      } catch { /* Unknown or unsafe library contents remain protected, never legacy fallback. */ }
    }
  } finally { if (prepared) closeAssets(prepared.assets); }
}

el('recovery-download').addEventListener('click', () => {
  try {
    if (!rawRecord) throw new Error('The saved record was not read. Its contents are unknown; raw download is unavailable. Retry when storage is accessible.');
    if (!rawRecord.present) throw new Error('No saved record is available for download.');
    const json = serializeRawRecord(rawRecord.value, rawTarget === 'head' ? MAX_LIBRARY_HEAD_BYTES : rawTarget === 'legacy' ? MAX_JSON_BYTES : MAX_JSON_BYTES + 256);
    download(new Blob([json], { type: 'application/json' }), '.preserved-record.json');
    recoveryMessage('Preserved record downloaded exactly as JSON. It is separate from the current project file and may require repair.');
  } catch (error) { recoveryMessage(errorMessage(error)); }
});
el('recovery-retry').addEventListener('click', async () => {
  if (busy || exporting || gesture || retryPending || !recoveryBlocked || !admitDrafts() || !tweens.confirmLeave()) return;
  pause(); intent(); retryPending = true; recoveryMessage('Reading the preserved saved draft…'); controls();
  try { await restoreSaved(false); }
  finally { retryPending = false; updateSaveState(); controls(); }
});
refresh(); selectMode('draw');
void restoreSaved(true).finally(() => {
  restorePending = false; busy = false;
  if (recoveryBlocked && !recoveryDetail) recoveryMessage('Saved record unavailable. Current work stays in memory.');
  updateSaveState(); controls();
});
