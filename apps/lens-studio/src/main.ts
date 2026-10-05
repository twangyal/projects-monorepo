import './style.css';
import { createProject, decodeMask, fillMask, paintMask, parseProject, resetProjection, serializeProject, updateSettings, validateProject } from './model.ts';
import { History } from './history.ts';
import { decodePhoto, normalizePhoto, validateProjectImages } from './images.ts';
import { renderProject, exportPng } from './jobs.ts';
import { presentFrame } from './render.ts';
import { openProjectStore, SavedCopyConflict, SavedCopyProtected, type ProjectStore, type LoadedProject } from './storage.ts';
import { createDemoProject } from './demo.ts';
import { LIMITS } from './types.ts';
import type { Plane, Point, Project, Raster, Rendered, Settings } from './types.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node;
}
function button(text: string, action: () => void, cls = ''): HTMLButtonElement {
  const node = el('button', text, cls); node.type = 'button'; node.addEventListener('click', () => { retireIntent(); action(); }); return node;
}
function panel(title: string, hint = ''): HTMLElement {
  const node = el('section', '', 'panel'); node.append(el('h2', title)); if (hint) node.append(el('p', hint, 'hint')); return node;
}
function field(parent: HTMLElement, name: string, label: string, type = 'text'): HTMLInputElement {
  const wrapper = el('label', label, 'field'); const node = el('input'); node.name = name; node.id = name; node.type = type; wrapper.append(node); parent.append(wrapper); return node;
}
const app = document.querySelector<HTMLDivElement>('#app'); if (!app) throw new Error('Missing editor root.');
const header = el('header', '', 'site-header'); header.append(el('span', 'Lens Studio', 'brand'), el('span', 'A study in framing & perspective', 'brand-note'));
const main = el('main'); app.append(header, main);
const message = el('p', '', 'message'); message.id = 'message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.hidden = true; main.append(message);
function announce(text: string, error = false): void { message.textContent = text; message.hidden = !text; message.classList.toggle('error', error); }
const introduction = el('div', '', 'introduction'); introduction.append(el('p', 'LOCAL PHOTO LAB', 'eyebrow'), el('h1', 'Change the framing. Understand the limits.'), el('p', 'Declare your photo’s focal length and explore a different field of view. For an experimental camera-distance study, assign the depth planes yourself.')); main.append(introduction);
const imports = el('div', '', 'import-bar');
const photoInput = field(imports, 'photo-import', 'Import photo', 'file'); photoInput.accept = 'image/png,image/jpeg,image/webp';
const projectInput = field(imports, 'project-import', 'Import project', 'file'); projectInput.accept = '.json,application/json';
const demoButton = button('Try authored demo', () => { void stageDemo(); }); const cancelButton = button('Cancel operation', cancelOperation); cancelButton.id = 'cancel-operation'; cancelButton.hidden = true; imports.append(demoButton, cancelButton); main.append(imports);
const empty = panel('Start with one photo', 'PNG, JPEG or static WebP, up to 8 MiB. Photos stay in this browser. You can also try the original three-plane illustration.');
empty.append(el('p', 'No photo has been loaded. The demo is authored geometry, not estimated depth.', 'empty')); main.append(empty);
const workspace = el('div', '', 'workspace'); workspace.hidden = true; main.append(workspace);
const toolbar = el('div', '', 'toolbar'); const undoButton = button('Undo', undo); const redoButton = button('Redo', redo); const resetButton = button('Reset projection', () => { if (project) commit(resetProjection(project)); }); const pngButton = button('Export PNG', () => { void downloadPng(); }, 'primary'); const jsonButton = button('Download project', downloadProject); const renderButton = button('Render preview', () => { if (!exportLocked) queuePreview(); }); toolbar.append(undoButton, redoButton, resetButton, renderButton, pngButton, jsonButton); workspace.append(toolbar);
const titleForm = el('form', '', 'title-form'); titleForm.id = 'title-form'; const titleInput = field(titleForm, 'project-title', 'Study title'); titleInput.maxLength = 160; titleInput.required = true;
const saveTitle = button('Save title', () => {}); saveTitle.type = 'submit'; titleForm.append(saveTitle); titleForm.addEventListener('submit', (e) => { e.preventDefault(); if (!project || exportLocked) return; try { commit(validateProject({ ...project, title: titleInput.value.trim() })); titleDirty = false; refreshControls(); } catch { announce('Use a study title with 1–80 characters.', true); } }); titleInput.addEventListener('input', () => { titleDirty = true; invalidateStage(); }); workspace.append(titleForm);
const layout = el('div', '', 'editor-layout'); const controls = el('aside', '', 'controls'); const comparison = el('section', '', 'comparison'); layout.append(controls, comparison); workspace.append(layout);
const settingsPanel = panel('Projection', 'Source and target must use the same sensor or equivalent focal-length basis. No camera metadata is assumed.');
const modes = el('fieldset', '', 'mode-options'); modes.append(el('legend', 'Camera mode'));
function modeRadio(name: string, value: Settings['mode']): HTMLInputElement {
  const label = el('label', '', 'radio-option'); const input = el('input'); input.type = 'radio'; input.name = 'mode'; input.value = value; label.append(input, el('span', name)); modes.append(label); input.addEventListener('change', () => { if (!project || exportLocked || !input.checked) return; if (value === 'perspective' && !ackInput.checked) { announce('Acknowledge the manual-plane approximation before choosing perspective.', true); syncModes(); return; } try { commit(updateSettings(project, { mode: value })); } catch { announce('These settings would move the virtual camera through a depth plane. Apply safe focal lengths and depths first.', true); syncModes(); } }); return input;
}
const fixedRadio = modeRadio('Fixed camera', 'fixed'); const perspectiveRadio = modeRadio('Manual perspective', 'perspective');
const ackLabel = el('label', '', 'checkbox'); const ackInput = el('input'); ackInput.type = 'checkbox'; ackInput.id = 'manual-depth-ack'; ackLabel.append(ackInput, el('span', 'I understand this is manual geometry, not inferred depth')); ackInput.addEventListener('change', syncModes); settingsPanel.append(modes, ackLabel);
const settingsForm = el('form'); settingsForm.id = 'settings-form'; const numeric = new Map<keyof Omit<Settings, 'mode'>, HTMLInputElement>(); const numericDirty = new Set<string>();
for (const [name, label, min, max, step] of [
  ['sourceFocal', 'Source focal length', 10, 300, 0.01], ['targetFocal', 'Target focal length', 10, 300, 0.01],
  ['shiftX', 'Shift X', -0.5, 0.5, 0.0001], ['shiftY', 'Shift Y', -0.5, 0.5, 0.0001],
  ['near', 'Near distance', 0.1, 0.95, 0.001], ['far', 'Far distance', 1.05, 10, 0.001],
] as const) {
  const input = field(settingsForm, name, label, 'number'); input.min = String(min); input.max = String(max); input.step = String(step); input.required = true; numeric.set(name, input); input.addEventListener('input', () => { numericDirty.add(name); invalidateStage(); settingsError.hidden = true; });
}
const settingsError = el('p', '', 'field-error'); settingsError.id = 'settings-error'; settingsError.setAttribute('role', 'status'); settingsError.hidden = true;
const applyButton = button('Apply settings', () => {}, 'primary'); applyButton.type = 'submit'; settingsForm.append(settingsError, applyButton);
settingsForm.addEventListener('submit', (e) => { e.preventDefault(); if (!project || exportLocked) return; const patch: Partial<Settings> = {}; for (const [name, input] of numeric) patch[name] = input.value.trim() === '' ? NaN : Number(input.value); try { const next = updateSettings(project, patch); commit(next); numericDirty.clear(); syncNumeric(); settingsError.hidden = true; } catch { settingsError.textContent = 'Keep focal lengths between 10 and 300 mm (2 decimals), target/source ratio 0.25–4, shifts −0.5–0.5 (4 decimals), near 0.1–0.95 and far 1.05–10 (3 decimals). In perspective, near + ratio − 1 must be at least 0.05. Your typed numeric values are kept and have not been applied.'; settingsError.hidden = false; } }); settingsForm.noValidate = true; settingsPanel.append(settingsForm); controls.append(settingsPanel);
const paintPanel = panel('Authored depth', 'Paint only on the original view. Every source pixel belongs to one flat plane. Subject distance stays at 1.');
const paintControls = el('fieldset'); paintControls.id = 'paint-controls'; paintControls.append(el('legend', 'Assign source pixels'));
for (const [plane, label] of [[0, 'Paint near'], [1, 'Paint subject'], [2, 'Paint far']] as const) { const wrap = el('label', '', `radio-option plane-${plane}`); const n = el('input'); n.type = 'radio'; n.name = 'plane'; n.value = String(plane); n.checked = plane === 1; n.addEventListener('change', () => { if (n.checked) selectedPlane = plane; }); wrap.append(n, el('span', label)); paintControls.append(wrap); }
const brushInput = field(paintControls, 'brushRadius', 'Brush size', 'number'); brushInput.value = '24'; brushInput.min = '1'; brushInput.max = '100'; brushInput.step = '1';
const fillButton = button('Fill plane', () => { if (project && !exportLocked) { try { commit(fillMask(project, selectedPlane)); } catch { announce('Could not assign this depth plane.', true); } } }); paintControls.append(fillButton);
const overlayLabel = el('label', '', 'checkbox'); const overlayInput = el('input'); overlayInput.type = 'checkbox'; overlayInput.checked = false; overlayLabel.append(overlayInput, el('span', 'Show depth overlay')); overlayInput.addEventListener('change', drawSource); paintPanel.append(paintControls, overlayLabel, el('p', 'Manual depth is your assignment, not inferred scene depth.', 'hint'), el('p', 'Near / subject / far are camera-parallel planes. An all-subject mask leaves perspective unchanged apart from framing shift.', 'hint')); controls.append(paintPanel);
const comparisonHeader = el('div', '', 'comparison-heading'); const comparisonTitle = el('h2', 'Source & result'); const projectionSummary = el('p', '', 'hint'); projectionSummary.id = 'projection-summary'; comparisonHeader.append(comparisonTitle, projectionSummary); comparison.append(comparisonHeader);
const frames = el('div', '', 'frames'); const sourceFigure = el('figure'); const resultFigure = el('figure'); const sourceCaption = el('figcaption', 'Original · paint depth here'); const resultCaption = el('figcaption', 'Projected result');
const sourceCanvas = el('canvas'); sourceCanvas.id = 'source-canvas'; sourceCanvas.setAttribute('aria-label', 'Original photo; paint depth assignments here'); sourceCanvas.tabIndex = 0;
const resultCanvas = el('canvas'); resultCanvas.id = 'result-canvas'; resultCanvas.setAttribute('aria-label', 'Projected result with transparent unknown regions');
const sourceSurface = el('div', '', 'canvas-surface'); const resultSurface = el('div', '', 'canvas-surface'); sourceSurface.append(sourceCanvas); resultSurface.append(resultCanvas); sourceFigure.append(sourceCaption, sourceSurface); resultFigure.append(resultCaption, resultSurface); frames.append(sourceFigure, resultFigure); comparison.append(frames);
const missing = el('p', '', 'coverage'); missing.id = 'missing-coverage'; const renderStatus = el('p', '', 'hint'); renderStatus.id = 'render-status'; const saveStatus = el('p', 'Checking local saved study…', 'save-status'); saveStatus.id = 'save-status'; saveStatus.setAttribute('role', 'status'); const retryButton = button('Retry saving', retrySaving); retryButton.id = 'retry-save'; retryButton.hidden = true;
const reloadButton = button('Reload saved study', () => { void reloadSavedStudy(); }); reloadButton.id = 'retry-load';
const replaceButton = button('Replace saved copy', () => { void replaceSavedStudy(); }); replaceButton.id = 'replace-saved-copy';
const storagePanel = el('section', '', 'storage-controls'); storagePanel.setAttribute('aria-label', 'Saved study and recovery');
const drainStatus = el('p', 'Waiting for a previous photo or storage operation to finish before recovery. Keep editing and download your current project; reload this app if cleanup does not finish.', 'hint'); drainStatus.id = 'storage-drain-status'; drainStatus.hidden = true;
storagePanel.append(saveStatus, drainStatus, retryButton, reloadButton, replaceButton); main.append(storagePanel);
comparison.append(missing, renderStatus, el('p', 'Original transparency is retained; uncovered regions stay transparent. No content was generated.', 'notice'), el('p', 'This is a declared pinhole projection study. It does not recover hidden detail, infer depth, add optical blur or calibrate a real camera.', 'hint'));
main.append(el('footer', 'Local by design · one photo · no account · download a project backup for recovery outside this browser.'));

let frameGeneration = -1; let sourceDrawPending = false; let previewBusy = false;
let project: Project | null = null; let history: History | null = null; let source: Raster | null = null; let frame: Rendered | null = null;
let generation = 0; let operationSequence = 0; let operation: { id: number; kind: 'stage' | 'export'; controller: AbortController } | null = null;
let previewSequence = 0; let previewController: AbortController | null = null; let previewTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined; let savedGeneration = -1; let saveFailed = false; let restoreFailed = false; let exportLocked = false; let titleDirty = false; let selectedPlane: Plane = 1;
let gesture: { pointer: number; points: Point[]; plane: Plane; radius: number; project: Project; generation: number } | null = null;

interface StorageOwner { controller: AbortController; intent: number; generation: number; lifetime: number; cancelled: boolean }
let editorIntent = 0, lifetime = 0;
let terminal = false, initialPending = true;
let initialOwner: StorageOwner | null = null, recoveryOwner: StorageOwner | null = null;
let store: ProjectStore | null = null, storageReady = false, protectedStorage = false;
let saving = false, manualSave = false;
let pendingSave: { project: Project; generation: number } | null = null;
let storageDrainPending: { target: ProjectStore } | null = null;
const downloadUrls = new Set<string>();
function refreshStorageControls(): void {
  const blocked = initialPending || saving || recoveryOwner !== null || storageDrainPending !== null;
  drainStatus.hidden = storageDrainPending === null;
  retryButton.hidden = !saveFailed || protectedStorage || !storageReady;
  retryButton.disabled = blocked || exportLocked;
  reloadButton.disabled = blocked || exportLocked;
  replaceButton.disabled = blocked || exportLocked || !project || !!gesture || operation !== null;
}
function storageMessage(text: string): void { saveStatus.textContent = text; refreshStorageControls(); }
function protectStorage(text: string): void {
  protectedStorage = true; storageReady = false; restoreFailed = true; saveFailed = false; manualSave = false;
  clearTimeout(saveTimer); pendingSave = null; savedGeneration = Math.min(savedGeneration, generation - 1);
  storageMessage(`${text} Current work stays in memory. Download project for a backup, then reload or review Replace saved copy.`);
}
function retireStore(target: ProjectStore): void {
  if (store === target) store = null;
  storageReady = false;
  if (storageDrainPending?.target === target) return;
  const drain = { target }; storageDrainPending = drain; refreshStorageControls();
  void target.close().then(() => {
    if (storageDrainPending !== drain) return;
    storageDrainPending = null; refreshStorageControls();
  }).catch(() => {
    if (storageDrainPending === drain) storageMessage('Storage cleanup could not be confirmed. Keep this page open and Download project; reload the app before trying storage recovery.');
  });
}
function ownerCurrent(owner: StorageOwner): boolean {
  return !owner.controller.signal.aborted && owner.intent === editorIntent && owner.generation === generation
    && owner.lifetime === lifetime && !terminal;
}
function newOwner(): StorageOwner {
  return { controller: new AbortController(), intent: editorIntent, generation, lifetime, cancelled: false };
}
function retireIntent(): void {
  editorIntent++;
  initialOwner?.controller.abort(); recoveryOwner?.controller.abort();
  invalidateStage();
}
app.addEventListener('input', retireIntent, true);
app.addEventListener('change', retireIntent, true);
app.addEventListener('submit', retireIntent, true);
function syncModes(): void { fixedRadio.checked = project?.settings.mode !== 'perspective'; perspectiveRadio.checked = project?.settings.mode === 'perspective'; perspectiveRadio.disabled = exportLocked || !ackInput.checked; }
function syncNumeric(force = false): void { if (!project) return; for (const [name, input] of numeric) if (force || !numericDirty.has(name)) input.value = String(project.settings[name]); }
function refreshControls(): void {
  workspace.hidden = !project; empty.hidden = !!project; syncModes(); syncNumeric(); if (project && !titleDirty) titleInput.value = project.title;
  undoButton.disabled = exportLocked || !!gesture || !history?.canUndo; redoButton.disabled = exportLocked || !!gesture || !history?.canRedo;
  for (const n of [photoInput, projectInput, demoButton, resetButton, renderButton, pngButton, jsonButton, titleInput, saveTitle, fixedRadio, ackInput, fillButton, brushInput, overlayInput, applyButton, ...numeric.values()]) n.disabled = exportLocked;
  perspectiveRadio.disabled = exportLocked || !ackInput.checked; for (const n of paintControls.querySelectorAll<HTMLInputElement>('input[type=radio]')) n.disabled = exportLocked;
  cancelButton.hidden = !operation && !previewBusy && !initialPending && !recoveryOwner; refreshStorageControls();
  if (project) { const s = project.settings; projectionSummary.textContent = `${s.mode === 'fixed' ? 'Fixed camera' : 'Manual perspective'} · declared ${s.sourceFocal} → ${s.targetFocal} mm · ratio ${(s.targetFocal / s.sourceFocal).toFixed(4)} · near ${s.near} / subject 1 / far ${s.far} · ${project.photo.width} × ${project.photo.height}`; }
}
function invalidateStage(): void {
  if (operation?.kind !== 'stage') return;
  operation.controller.abort(); operation = null; announce('Pending load canceled. Current study was kept.');
  // Capture-phase input runs before its dirty marker. Never sync fields here.
  refreshStorageControls(); cancelButton.hidden = !previewBusy && !initialPending && !recoveryOwner;
}
function commit(next: Project): void {
  if (!project || !history || exportLocked) return; retireIntent(); if (gesture) cancelGesture(); try { if (!history.commit(next)) return; } catch { announce('That edit could not be applied. Current work was kept.', true); return; }
  invalidateStage(); project = history.current; generation += 1; saveStatus.textContent = 'Unsaved changes · saving locally…'; refreshControls(); drawSource(); queuePreview(); queueSave();
}
function undo(): void { if (exportLocked || gesture) return; retireIntent(); if (!history?.canUndo) return; invalidateStage(); project = history.undo(); generation += 1; refreshControls(); drawSource(); queuePreview(); queueSave(); }
function redo(): void { if (exportLocked || gesture) return; retireIntent(); if (!history?.canRedo) return; invalidateStage(); project = history.redo(); generation += 1; refreshControls(); drawSource(); queuePreview(); queueSave(); }
function publish(next: Project, raster: Raster, restored = false, nextHistory = new History(next)): void { if (gesture) cancelGesture();
  project = next; source = raster; history = nextHistory; generation += 1; frame = null; frameGeneration = -1; numericDirty.clear(); titleDirty = false; settingsError.hidden = true; ackInput.checked = next.settings.mode === 'perspective';
  sourceCanvas.width = next.photo.width; sourceCanvas.height = next.photo.height; resultCanvas.width = next.photo.width; resultCanvas.height = next.photo.height; missing.textContent = 'Missing coverage: waiting for result'; savedGeneration = restored ? generation : -1;
  if (restored) storageMessage('Saved locally · restored this study'); refreshControls(); drawSource(); queuePreview(); if (!restored) queueSave();
}
function drawSource(): void {
  if (!source || !project) return; const ctx = sourceCanvas.getContext('2d'); if (!ctx) return; presentFrame(ctx, source);
  if (overlayInput.checked) { const mask = decodeMask(project.depth); const colors = [[219, 113, 77], [105, 159, 144], [118, 132, 200]]; const rgba = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i += 1) { const c = colors[mask[i]!]!; rgba.set([c[0]!, c[1]!, c[2]!, 65], i * 4); }
  const overlay = document.createElement('canvas'); overlay.width = source.width; overlay.height = source.height; overlay.getContext('2d')!.putImageData(new ImageData(rgba, source.width, source.height), 0, 0); ctx.drawImage(overlay, 0, 0); }
  if (gesture) {
    const colors = ['#db714d', '#699f90', '#7684c8']; ctx.save(); ctx.strokeStyle = colors[gesture.plane]!; ctx.fillStyle = colors[gesture.plane]!; ctx.globalAlpha = 0.5; ctx.lineWidth = gesture.radius * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const first = gesture.points[0]!; ctx.beginPath(); ctx.arc(first.x, first.y, gesture.radius, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(first.x, first.y); for (const point of gesture.points.slice(1)) ctx.lineTo(point.x, point.y); ctx.stroke(); ctx.restore();
  }
}
function scheduleSourceDraw(): void { if (sourceDrawPending) return; sourceDrawPending = true; requestAnimationFrame(() => { sourceDrawPending = false; drawSource(); }); }
function queuePreview(): void {
  clearTimeout(previewTimer); previewController?.abort(); if (!project || exportLocked) return; const captured = project; const epoch = generation; const seq = ++previewSequence; previewBusy = true; refreshControls(); renderStatus.textContent = frame ? 'Rendering current projection… Previous result is shown until ready.' : 'Rendering projection…';
  previewTimer = setTimeout(() => { void (async () => { const controller = new AbortController(); previewController = controller; try { const next = await renderProject(captured, controller.signal); if (controller.signal.aborted || epoch !== generation || seq !== previewSequence || exportLocked) return; frame = next; frameGeneration = epoch; const ctx = resultCanvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable'); presentFrame(ctx, next); missing.textContent = `Missing coverage: ${(next.missingFraction * 100).toFixed(2)}% (sampled geometric coverage)`; renderStatus.textContent = 'Projection ready · transparent regions remain unknown'; } catch (error) { if (!controller.signal.aborted && epoch === generation && seq === previewSequence && !exportLocked) { renderStatus.textContent = 'Projection failed · previous result kept'; announce(error instanceof Error && error.name === 'AbortError' ? 'Rendering was canceled; your edits were kept.' : 'Could not render this projection. Use current desktop Chromium with image decoding, Canvas and workers; your study was kept.', true); } } finally { if (seq === previewSequence) { previewBusy = false; refreshControls(); } } })(); }, 100);
}
function queueSave(): void {
  clearTimeout(saveTimer); savedGeneration = Math.min(savedGeneration, generation - 1);
  if (protectedStorage || !storageReady || manualSave) {
    storageMessage(manualSave ? 'Not saved · newer work needs explicit Retry saving. Unapplied fields are excluded.'
      : 'Not saved · saved copy protected. Download project, reload, or review Replace saved copy.');
    return;
  }
  storageMessage('Unsaved changes · saving locally…'); saveTimer = setTimeout(persist, 180);
}
function persist(): void {
  if (!project || !history || !store || !storageReady || protectedStorage || manualSave) return;
  pendingSave = { project: history.current, generation }; pumpSave();
}
function pumpSave(): void {
  if (saving || recoveryOwner || !pendingSave || !store || !storageReady || protectedStorage || manualSave) return;
  const captured = pendingSave, target = store, ownedLifetime = lifetime; pendingSave = null;
  saving = true; saveFailed = false; storageMessage('Saving locally…');
  void target.save(captured.project).then(() => {
    if (ownedLifetime !== lifetime || protectedStorage) return;
    if (captured.generation === generation && !pendingSave) {
      savedGeneration = generation; saveFailed = false; storageMessage('Saved locally · browser storage');
    }
  }).catch(error => {
    clearTimeout(saveTimer); pendingSave = null;
    if (error instanceof SavedCopyConflict) protectStorage(error.message);
    else if (error instanceof SavedCopyProtected || ownedLifetime !== lifetime || protectedStorage) {
      protectStorage(error instanceof Error ? error.message : 'Saving could not be confirmed.');
      if (error instanceof SavedCopyProtected) retireStore(target);
    } else {
      saveFailed = true; manualSave = true;
      storageMessage('Not saved · the transaction rolled back. Current work stays in this page. Download project or Retry saving.');
    }
  }).finally(() => { saving = false; refreshStorageControls(); pumpSave(); });
}
function retrySaving(): void {
  if (exportLocked || !project || !saveFailed || protectedStorage || !storageReady || initialPending || saving || recoveryOwner || storageDrainPending) return;
  clearTimeout(saveTimer); manualSave = false; saveFailed = false; persist();
}
function abortError(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError'; }
function replaceAllowed(): boolean { return (!project && !restoreFailed) || confirm('Replace this in-memory study with the selected photo or project? Current edits, unapplied fields and undo history will be replaced only after the new study loads successfully. A protected saved copy is not replaced by this action. Download a backup first if needed.'); }
async function stage(task: (signal: AbortSignal) => Promise<Project>, description: string): Promise<void> {
  retireIntent(); const admittedIntent = editorIntent, admittedLifetime = lifetime;
  if (exportLocked || !replaceAllowed() || admittedIntent !== editorIntent || admittedLifetime !== lifetime || terminal) return; if (gesture) cancelGesture(); operation?.controller.abort(); const op = { id: ++operationSequence, kind: 'stage' as const, controller: new AbortController() }; operation = op; const epoch = generation, intent = editorIntent, ownedLifetime = lifetime; refreshControls(); announce(description);
  try { const next = await task(op.controller.signal); const raster = await decodePhoto(next.photo, op.controller.signal); if (op.controller.signal.aborted || operation !== op || epoch !== generation || intent !== editorIntent || ownedLifetime !== lifetime) return; if (next.settings.mode === 'perspective' && !confirm('This project uses manual depth planes. They are authored assignments, not inferred scene depth or calibrated geometry. Open this manual perspective study?')) { announce('Import canceled. Your existing study was kept.'); return; } if (op.controller.signal.aborted || operation !== op || epoch !== generation || intent !== editorIntent || ownedLifetime !== lifetime) return; operation = null; publish(next, raster); announce('Study loaded. Photos and depth assignments stay local.'); }
  catch (error) { if (operation === op && !op.controller.signal.aborted) announce(abortError(error) ? 'Loading canceled. Current work was kept.' : 'Could not load this input. Use a valid bounded photo or Lens Studio project. Current work and saved data were kept.', true); }
  finally { if (operation === op) operation = null; refreshControls(); }
}
async function stageDemo(): Promise<void> { await stage((signal) => createDemoProject(signal), 'Building the original authored three-plane demo…'); }
photoInput.addEventListener('change', () => { const file = photoInput.files?.[0]; photoInput.value = ''; if (file) void stage(async (signal) => createProject(await normalizePhoto(file, signal)), 'Loading and normalizing the photo…'); });
projectInput.addEventListener('change', () => { const file = projectInput.files?.[0]; projectInput.value = ''; if (file) void stage(async (signal) => { if (file.size > LIMITS.projectBytes || !file.size) throw new Error('Project too large'); const text = await file.text(); if (signal.aborted) throw new DOMException('Canceled', 'AbortError'); const next = parseProject(text); await validateProjectImages(next, signal); return next; }, 'Validating project and photo…'); });
function cancelOperation(): void {
  if (initialOwner) initialOwner.cancelled = true;
  if (recoveryOwner) recoveryOwner.cancelled = true;
  if (initialPending || recoveryOwner) { initialOwner?.controller.abort(); recoveryOwner?.controller.abort(); protectStorage('Saved-study operation canceled. Current work was kept.'); refreshStorageControls(); return; }
  const op = operation; if (!op) { if (!previewBusy) return; clearTimeout(previewTimer); previewController?.abort(); previewSequence += 1; previewBusy = false; renderStatus.textContent = 'Preview canceled · previous result kept'; refreshControls(); announce('Preview canceled. Your study was kept. Choose Render preview to resume.'); return; } op.controller.abort(); operation = null; exportLocked = false; if (op.kind === 'export') renderStatus.textContent = frameGeneration === generation ? 'Projection ready · export canceled' : 'Waiting for current preview'; refreshControls(); announce('Operation canceled. Your study and previous result were kept.'); if (project && frameGeneration !== generation) queuePreview();
}
function download(blob: Blob, filename: string): void { const url = URL.createObjectURL(blob); downloadUrls.add(url); const a = el('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000); }
function downloadProject(): void { if (!project || exportLocked) return; try { download(new Blob([serializeProject(project)], { type: 'application/json' }), 'lens-studio-project.json'); announce('Project backup downloaded, including the normalized photo and your authored mask.'); } catch { announce('Could not create this backup. Current work was kept.', true); } }
async function downloadPng(): Promise<void> {
  if (!project || exportLocked) return; retireIntent(); if (gesture) cancelGesture(); invalidateStage(); clearTimeout(previewTimer); previewController?.abort(); previewSequence += 1; previewBusy = false; const captured = project; const epoch = generation; const op = { id: ++operationSequence, kind: 'export' as const, controller: new AbortController() }; operation = op; exportLocked = true; refreshControls(); renderStatus.textContent = 'Exporting exact projection pixels…';
  try { const blob = await exportPng(captured, op.controller.signal); if (operation !== op || op.controller.signal.aborted || epoch !== generation) return; download(blob, 'lens-studio-projection.png'); announce('PNG exported. Checkerboard and depth overlays are not included.'); }
  catch (error) { if (operation === op && !op.controller.signal.aborted) announce(abortError(error) ? 'Export canceled. Current work was kept.' : 'PNG export failed. Current work and previous result were kept.', true); }
  finally { if (operation === op) { operation = null; exportLocked = false; refreshControls(); renderStatus.textContent = frame ? 'Projection ready' : 'Waiting for preview'; if (frameGeneration !== generation) queuePreview(); } }
}
function sourcePoint(event: PointerEvent): Point { const bounds = sourceCanvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(sourceCanvas.width, (event.clientX - bounds.left) / bounds.width * sourceCanvas.width)), y: Math.max(0, Math.min(sourceCanvas.height, (event.clientY - bounds.top) / bounds.height * sourceCanvas.height)) }; }
sourceCanvas.addEventListener('pointerdown', (e) => { if (!project || exportLocked || gesture || !e.isPrimary || e.button !== 0) return; retireIntent(); const radius = Number(brushInput.value); if (!Number.isInteger(radius) || radius < 1 || radius > 100) { announce('Brush size must be a whole number from 1 to 100 source pixels.', true); return; } invalidateStage(); gesture = { pointer: e.pointerId, points: [sourcePoint(e)], plane: selectedPlane, radius, project, generation }; sourceCanvas.setPointerCapture(e.pointerId); refreshControls(); drawSource(); });
sourceCanvas.addEventListener('pointermove', (e) => { if (!gesture || gesture.pointer !== e.pointerId) return; if (gesture.points.length >= LIMITS.brushPoints) { announce('This stroke is too long. Use a shorter stroke; the unfinished gesture was discarded.', true); cancelGesture(); return; } gesture.points.push(sourcePoint(e)); scheduleSourceDraw(); });
sourceCanvas.addEventListener('pointerup', (e) => { if (!gesture || gesture.pointer !== e.pointerId) return; const captured = gesture; gesture = null; if (sourceCanvas.hasPointerCapture(e.pointerId)) sourceCanvas.releasePointerCapture(e.pointerId); if (captured.generation !== generation) { announce('Unfinished stroke discarded because the study changed. Your newer edits were kept.'); refreshControls(); drawSource(); return; } try { commit(paintMask(captured.project, captured.plane, captured.radius, [...captured.points, sourcePoint(e)])); } catch { announce('Stroke could not be applied. Use a shorter stroke; your mask was kept.', true); } refreshControls(); drawSource(); });
function cancelGesture(): void { const captured = gesture; gesture = null; if (captured && sourceCanvas.hasPointerCapture(captured.pointer)) sourceCanvas.releasePointerCapture(captured.pointer); refreshControls(); drawSource(); }
sourceCanvas.addEventListener('pointercancel', cancelGesture); sourceCanvas.addEventListener('lostpointercapture', () => { if (gesture) cancelGesture(); });
window.addEventListener('keydown', (e) => { const target = e.target; if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); });
window.addEventListener('beforeunload', (e) => { if (operation || gesture || numericDirty.size || titleDirty || project && savedGeneration !== generation) { e.preventDefault(); e.returnValue = ''; } });
async function prepareLoad(target: ProjectStore, owner: StorageOwner): Promise<{ loaded: LoadedProject; history: History | null } | null> {
  try {
    const loaded = await target.load({ signal: owner.controller.signal });
    if (!ownerCurrent(owner)) return null;
    if ((loaded.project === null) !== (loaded.raster === null)) throw new SavedCopyProtected('Saved photo admission was incomplete. Current work was kept.');
    const preparedHistory = loaded.project ? new History(loaded.project) : null;
    if (!ownerCurrent(owner)) return null;
    return { loaded, history: preparedHistory };
  } catch (error) {
    if (error instanceof SavedCopyProtected || abortError(error)) retireStore(target);
    throw error;
  }
}
function acceptPrepared(target: ProjectStore, loaded: LoadedProject, preparedHistory: History | null): void {
  target.acceptLoad(loaded.receipt);
  protectedStorage = false; storageReady = true; restoreFailed = false; manualSave = false; saveFailed = false;
  clearTimeout(saveTimer); pendingSave = null;
  selectedPlane = 1; brushInput.value = '24'; overlayInput.checked = false;
  for (const input of paintControls.querySelectorAll<HTMLInputElement>('input[type=radio]')) input.checked = input.value === '1';
  if (loaded.project && loaded.raster && preparedHistory) publish(loaded.project, loaded.raster, true, preparedHistory);
  else {
    if (gesture) cancelGesture();
    project = null; source = null; history = null; frame = null; frameGeneration = -1;
    generation++; savedGeneration = generation; numericDirty.clear(); titleDirty = false; settingsError.hidden = true;
    titleInput.value = ''; for (const input of numeric.values()) input.value = ''; ackInput.checked = false;
    sourceCanvas.width = sourceCanvas.height = resultCanvas.width = resultCanvas.height = 0;
    refreshControls(); storageMessage('Local storage ready · import a photo or study');
  }
}
async function freshStore(owner: StorageOwner): Promise<ProjectStore | null> {
  if (storageDrainPending) return null;
  if (!store) {
    const opened = await openProjectStore();
    if (!ownerCurrent(owner)) { retireStore(opened); return null; }
    store = opened;
  }
  return store;
}
function stopTransientWork(): void {
  operation?.controller.abort(); operation = null; exportLocked = false;
  clearTimeout(previewTimer); previewController?.abort(); previewSequence++; previewBusy = false;
}
async function reloadSavedStudy(): Promise<void> {
  if (initialPending || saving || recoveryOwner || storageDrainPending || exportLocked) return;
  const intent = editorIntent, ownedLifetime = lifetime;
  if (!confirm('Reload the saved study? This discards this page’s unsaved study, unapplied fields, unfinished stroke and session Undo/Redo history. Download project first to keep your current work.')) return;
  if (intent !== editorIntent || ownedLifetime !== lifetime || initialPending || saving || recoveryOwner || storageDrainPending) return;
  stopTransientWork(); if (gesture) cancelGesture();
  const owner = newOwner(); recoveryOwner = owner;
  protectStorage('Reading the saved study and its actual photo…'); refreshControls();
  let reported = false;
  try {
    const target = await freshStore(owner); if (!target || !ownerCurrent(owner)) return;
    const prepared = await prepareLoad(target, owner); if (!prepared || !ownerCurrent(owner)) return;
    acceptPrepared(target, prepared.loaded, prepared.history); reported = true;
    announce('Saved study loaded after complete validation. Local fields and session history were reset.');
  } catch (error) {
    protectStorage(abortError(error) ? 'Saved-study load canceled. Current work was kept.'
      : error instanceof Error ? error.message : 'Saved study could not be loaded.'); reported = true;
  } finally {
    if (recoveryOwner === owner) {
      recoveryOwner = null;
      if (!reported) protectStorage('Newer work was kept; the saved study was not adopted.');
      refreshStorageControls(); cancelButton.hidden = !operation && !previewBusy;
    }
  }
}
async function replaceSavedStudy(): Promise<void> {
  if (!project || !history || initialPending || saving || recoveryOwner || storageDrainPending || exportLocked || gesture || operation) return;
  clearTimeout(saveTimer); pendingSave = null;
  const captured = history.current, owner = newOwner(); recoveryOwner = owner;
  protectStorage('Reviewing the saved copy before replacement…'); refreshStorageControls(); cancelButton.hidden = false;
  let reported = false;
  try {
    const target = await freshStore(owner); if (!target || !ownerCurrent(owner)) return;
    const review = await target.reviewReplacement(); if (!ownerCurrent(owner)) return;
    const summary = review.summary;
    const saved = !summary.present ? 'There is no saved study.' : summary.readable
      ? `Saved study “${summary.title}”: ${summary.width} × ${summary.height}, ${summary.mode === 'perspective' ? 'manual perspective' : 'fixed camera'}.`
      : 'The saved study is unreadable.';
    if (!confirm(`${saved} Replace it with this page’s complete committed study, including its photo, authored mask and applied settings? Unapplied fields and unfinished strokes are excluded and stay local. This cannot be undone in the saved copy; download a backup first.`)) return;
    if (!ownerCurrent(owner)) return;
    storageMessage('Replacing the reviewed saved copy…');
    await target.replace(captured, review.receipt);
    if (owner.lifetime !== lifetime || recoveryOwner !== owner || owner.cancelled) return;
    protectedStorage = false; storageReady = true; restoreFailed = false;
    if (!ownerCurrent(owner)) {
      manualSave = true; saveFailed = true;
      storageMessage('The reviewed study was saved. Newer work is not saved; use Retry saving for the current committed study. Unapplied fields are excluded.');
    } else {
      savedGeneration = generation; manualSave = false; saveFailed = false;
      storageMessage('Saved locally · browser storage');
      announce('Saved copy replaced. Your current fields, photo, mask and history were kept.');
    }
    reported = true;
  } catch (error) {
    protectStorage(error instanceof Error ? error.message : 'Saved-copy replacement could not be confirmed.'); reported = true;
    if (error instanceof SavedCopyProtected && store) retireStore(store);
  } finally {
    if (recoveryOwner === owner) {
      recoveryOwner = null;
      if (!reported) protectStorage('Saved-copy replacement was retired or canceled. Current work was kept.');
      refreshStorageControls(); cancelButton.hidden = !operation && !previewBusy;
    }
  }
}
async function start(): Promise<void> {
  const owner = newOwner(); initialOwner = owner; refreshControls();
  try {
    const target = await freshStore(owner);
    if (!target || !ownerCurrent(owner)) { protectStorage('Initial restore retired. Current work was kept.'); return; }
    const prepared = await prepareLoad(target, owner);
    if (!prepared || !ownerCurrent(owner)) { protectStorage('Initial restore retired. Current work was kept.'); return; }
    acceptPrepared(target, prepared.loaded, prepared.history);
  } catch (error) {
    protectStorage(abortError(error) ? 'Initial restore canceled. Current work was kept.'
      : error instanceof Error ? error.message : 'Saved study could not be restored.');
  } finally {
    if (initialOwner === owner) { initialOwner = null; initialPending = false; refreshStorageControls(); cancelButton.hidden = !operation && !previewBusy; }
  }
}
window.addEventListener('pagehide', event => {
  lifetime++; editorIntent++; initialOwner?.controller.abort(); recoveryOwner?.controller.abort();
  clearTimeout(saveTimer); pendingSave = null; stopTransientWork(); if (gesture) cancelGesture();
  if (initialPending || recoveryOwner || saving) protectStorage('Pending storage authority was retired. Current work was kept.');
  for (const url of downloadUrls) URL.revokeObjectURL(url); downloadUrls.clear();
  if (!event.persisted) { terminal = true; if (store) retireStore(store); }
  refreshControls();
});
refreshControls(); void start();
