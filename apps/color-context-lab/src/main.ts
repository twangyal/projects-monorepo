import './style.css';
import { createProject, parseProjectJson, serializeProject, updateProject, validateProject } from './model.ts';
import { History } from './history.ts';
import { ProjectStore } from './storage.ts';
import { createDemoImage } from './render.ts';
import { cancelJobs, exportPng, exportReport, normalize, preview } from './jobs.ts';
import { experimentExamples, loadExperimentReport } from './experiment.ts';
import type { ExperimentReport } from './experiment.ts';
import { LIMITS } from './types.ts';
import type { Comparison, EditState, Project, Raster } from './types.ts';

function node<T extends HTMLElement>(id: string): T { const found = document.getElementById(id); if (!found) throw new Error('Missing workbench control.'); return found as T; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] { const element = document.createElement(tag); element.textContent = text; if (cls) element.className = cls; return element; }
const form = node<HTMLFormElement>('settings-form');
const title = node<HTMLInputElement>('project-title'), mode = node<HTMLSelectElement>('surround-mode');
const border = node<HTMLInputElement>('border-size'), colorA = node<HTMLInputElement>('color-a'), colorB = node<HTMLInputElement>('color-b'), cell = node<HTMLInputElement>('cell-size');
const imageFile = node<HTMLInputElement>('image-file'), projectFile = node<HTMLInputElement>('project-file');
const error = node<HTMLParagraphElement>('error'), previewStatus = node<HTMLParagraphElement>('preview-status'), saveStatus = node<HTMLParagraphElement>('save-status');
const originalCanvas = node<HTMLCanvasElement>('original-canvas'), resultCanvas = node<HTMLCanvasElement>('result-canvas');
const buttons = Object.fromEntries(['apply-changes','discard-changes','undo','redo','stop-job','download-source','download-result','download-project','download-report','retry-save','retry-load','raw-backup','continue-unsaved','save-current','clear-saved'].map(id => [id, node<HTMLButtonElement>(id)]));
const fields = [title, mode, border, colorA, colorB, cell];
const store = new ProjectStore();
let project: Project | null = null, history: History | null = null;
let generation = 0, intent = 0, sequence = 0, saveEpoch = 0, loadEpoch = 0;
let startup = true, memoryEnabled = false, protectedSave = true, recoveryVisible = false, untouchedDemo = false;
let dirty = false, durableGeneration = -1, saveFailed = false;
let frame: Comparison | null = null, frameGeneration = -1;
let saveTimer: ReturnType<typeof setTimeout> | undefined, saving = false;
let pendingSave: { project: Project; generation: number; epoch: number } | null = null;
let pendingLoad: { id: number; generation: number; intent: number } | null = null;
let explicitWrite: number | null = null;
interface Operation { id: number; generation: number; intent: number; abort: AbortController; timer: ReturnType<typeof setTimeout>; kind: string }
let operation: Operation | null = null;
const urls = new Set<string>();
function showError(message = ''): void { error.textContent = message; error.hidden = !message; }
function own(op: Operation): boolean { return operation === op && generation === op.generation && intent === op.intent && !op.abort.signal.aborted; }
function cancelWork(message = 'Stopped. Applied project, history and unsent fields were kept.'): void {
  const old = operation; operation = null; if (old) { clearTimeout(old.timer); old.abort.abort(); cancelJobs(); previewStatus.textContent = message; }
  updateControls();
}
function begin(kind: string): Operation {
  cancelWork(); showError(); const abort = new AbortController();
  const op: Operation = { id: ++sequence, generation, intent, abort, kind, timer: setTimeout(() => { if (operation === op) { cancelWork('Operation timed out. Applied work was kept; try again.'); showError('The operation exceeded 30 seconds. No partial image or download was published.'); } }, LIMITS.jobTimeoutMs) };
  operation = op; previewStatus.textContent = `${kind}…`; updateControls(); return op;
}
function finish(op: Operation): void { if (operation !== op) return; clearTimeout(op.timer); operation = null; updateControls(); }
function retirePendingLoad(): void { if (pendingLoad && !startup) { pendingLoad = null; loadEpoch++; updateControls(); } }
function editorIntent(): void {
  intent++; retirePendingLoad();
  cancelWork(frameGeneration === generation ? 'Applied settings preview — unsent changes are not shown' : 'Previous preview — current applied comparison is unavailable'); showError();
}
function rawEdit(): EditState {
  function integer(input: HTMLInputElement): number { const value = input.value.trim(); if (!value || value.length > 64 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error('Use complete integer pixel values.'); const parsed = Number(value); if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new Error('Pixel values must be finite integers.'); return parsed; }
  if (title.value.length > LIMITS.titleCharacters * 2) throw new Error('Study title must use at most 80 Unicode characters.');
  return { title: title.value, settings: { mode: mode.value as 'solid' | 'checker', border: integer(border), colorA: colorA.value, colorB: colorB.value, cellSize: integer(cell) } };
}
function fillFields(): void {
  if (!project) return; title.value = project.title; mode.value = project.settings.mode; border.value = String(project.settings.border); colorA.value = project.settings.colorA; colorB.value = project.settings.colorB; cell.value = String(project.settings.cellSize); dirty = false;
}
function enabled(): boolean { return !startup && memoryEnabled && !!project; }
function updateControls(): void {
  for (const field of fields) field.disabled = !enabled(); imageFile.disabled = !enabled(); projectFile.disabled = !enabled();
  buttons['apply-changes'].disabled = !enabled(); buttons['discard-changes'].disabled = !enabled() || !dirty;
  buttons.undo.disabled = !enabled() || !history?.canUndo; buttons.redo.disabled = !enabled() || !history?.canRedo;
  buttons['stop-job'].disabled = !operation;
  buttons['download-project'].disabled = !enabled(); buttons['download-source'].disabled = !enabled();
  buttons['download-result'].disabled = !enabled() || dirty; buttons['download-report'].disabled = !enabled() || dirty;
  buttons['save-current'].disabled = startup || !project || explicitWrite !== null;
  buttons['clear-saved'].disabled = startup || explicitWrite !== null;
  buttons['retry-load'].disabled = startup || !!pendingLoad || explicitWrite !== null;
  buttons['continue-unsaved'].disabled = startup;
  buttons['raw-backup'].disabled = startup;
  buttons['retry-save'].hidden = !saveFailed && !(enabled() && !protectedSave && durableGeneration !== generation);
  buttons['retry-save'].disabled = !enabled() || protectedSave || explicitWrite !== null;
  node('recovery').hidden = !recoveryVisible;
  if (project) {
    const source = project.image.source;
    node('source-info').textContent = `${source.format === 'procedural' ? 'Procedural demonstration' : 'Normalized PNG · supplied metadata'}: ${source.fileName} · source ${source.width} × ${source.height} · normalized ${project.image.width} × ${project.image.height}.`;
  }
  if (dirty && frameGeneration === generation) previewStatus.textContent = 'Applied settings preview — unsent changes are not shown';
}
function displayRaster(canvas: HTMLCanvasElement, raster: Raster): void { canvas.width = raster.width; canvas.height = raster.height; const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas presentation is unavailable.'); const image = context.createImageData(raster.width, raster.height); image.data.set(raster.rgba); context.putImageData(image, 0, 0); }
function displayComparison(comparison: Comparison): void {
  displayRaster(originalCanvas, comparison.baseline); displayRaster(resultCanvas, comparison.result);
  const metrics = comparison.metrics, container = node('metrics'); container.replaceChildren(el('h3', metrics.artworkChangedPixels === 0 && metrics.artworkMaxChannelDelta === 0 ? 'Artwork pixels unchanged' : 'Artwork pixel differences'));
  const list = el('dl'); for (const [label, value] of [['Changed artwork pixels',metrics.artworkChangedPixels],['Artwork maximum RGBA delta',metrics.artworkMaxChannelDelta],['Surround pixels',metrics.surroundPixels],['Total pixels',metrics.totalPixels],['Encoded RGB RMSE (byte units)',metrics.rgbRmse],['Maximum RGB delta (byte units)',metrics.maxRgbDelta],['Mean absolute relative luminance delta',metrics.meanAbsoluteLuminanceDelta]] as const) list.append(el('dt', label),el('dd',String(value))); container.append(list,el('p','Numerical diagnostics, not human-perception measurements or a protection score.','hint'));
}
async function renderPreview(): Promise<void> {
  if (!project) return; const captured = project, op = begin('Rendering applied comparison');
  if (frameGeneration !== generation) { node('metrics').replaceChildren(el('p','Previous preview — current metrics are not available yet.','hint')); }
  try { const next = await preview(captured, { signal: op.abort.signal }); if (!own(op)) return; frame = next; frameGeneration = generation; displayComparison(next); previewStatus.textContent = dirty ? 'Applied settings preview — unsent changes are not shown' : 'Applied settings preview ready.'; }
  catch { if (own(op)) { showError('Comparison failed. The applied project and previous preview were kept. Use Apply changes or Discard unsent changes to retry.'); previewStatus.textContent = 'Previous preview — not the current applied settings.'; node('metrics').replaceChildren(el('p','Current metrics unavailable.','hint')); } }
  finally { finish(op); }
}
function publish(candidate: Project, restored: boolean, demo = false): void {
  const validated = validateProject(candidate), nextHistory = new History(validated);
  cancelWork(); project = validated; history = nextHistory; generation++; intent++; untouchedDemo = demo; dirty = false; fillFields();
  frameGeneration = -1; durableGeneration = restored ? generation : -1; updateControls(); void renderPreview();
}
function apply(): void {
  if (!enabled() || !project || !history) return;
  try { const next = updateProject(project, rawEdit()); editorIntent(); const changed = history.commit(next); project = history.current; if (changed) { generation++; untouchedDemo = false; scheduleSave(); } dirty = false; updateControls(); void renderPreview(); }
  catch (caught) { showError(`${caught instanceof Error && caught.message.length <= 200 ? caught.message : 'Invalid settings.'} Your exact unsent fields and applied project were kept.`); }
}
function discard(): void {
  if (!enabled() || !dirty) return; const capturedGeneration = generation, capturedIntent = intent;
  if (!confirm('Discard all unsent title and surround changes? The applied project and history will be kept.')) return;
  if (capturedGeneration !== generation || capturedIntent !== intent) return;
  editorIntent(); fillFields(); updateControls(); if (frameGeneration === generation && frame) { displayComparison(frame); previewStatus.textContent = 'Applied settings preview ready.'; } else void renderPreview();
}
function changeHistory(redo: boolean): void {
  if (!enabled() || !history) return;
  if (dirty) { showError('Apply changes or Discard unsent changes before Undo or Redo. Your drafts were kept.'); return; }
  if (redo ? !history.canRedo : !history.canUndo) return;
  try { editorIntent(); project = redo ? history.redo() : history.undo(); generation++; untouchedDemo = false; fillFields(); scheduleSave(); updateControls(); void renderPreview(); } catch { showError('History change failed. Applied work was kept.'); }
}
function scheduleSave(): void {
  durableGeneration = -1; clearTimeout(saveTimer);
  if (protectedSave) { saveStatus.textContent = 'Saving disabled · current project is in memory. Use Save current project to explicitly save applied changes.'; return; }
  saveStatus.textContent = 'Unsaved applied changes · saving…'; saveTimer = setTimeout(() => { if (!project || protectedSave) return; pendingSave = { project, generation, epoch: saveEpoch }; void savePump(); }, 250);
}
async function savePump(): Promise<void> {
  if (saving) return; saving = true;
  try { while (pendingSave) { const task = pendingSave; pendingSave = null; if (task.epoch !== saveEpoch || protectedSave) continue;
    try { await store.save(task.project); if (task.epoch !== saveEpoch || task.generation !== generation || protectedSave) continue; durableGeneration = generation; saveFailed = false; saveStatus.textContent = 'Saved in this browser.'; }
    catch { if (task.epoch !== saveEpoch || task.generation !== generation) continue; saveFailed = true; saveStatus.textContent = 'Not saved · applied work remains in memory. Download project or Retry saving.'; }
    updateControls();
  } } finally { saving = false; }
}
function protectWrites(): void { protectedSave = true; saveEpoch++; clearTimeout(saveTimer); pendingSave = null; }
async function explicitSave(): Promise<void> {
  if (startup || !project || explicitWrite !== null) return;
  const captured = project, capturedGeneration = generation, capturedIntent = intent;
  if (!confirm(`Save the applied current project in this browser? ${protectedSave ? 'This may overwrite an unreadable or unknown saved record. ' : ''}Unsent fields are not included and will be kept.`)) return;
  if (capturedGeneration !== generation || capturedIntent !== intent || project !== captured) return;
  retirePendingLoad(); protectWrites(); const epoch = saveEpoch; explicitWrite = epoch; updateControls(); saveStatus.textContent = 'Saving applied current project…';
  try { await store.save(captured); if (explicitWrite !== epoch || saveEpoch !== epoch) return; if (generation !== capturedGeneration || intent !== capturedIntent) { saveStatus.textContent = 'An earlier applied snapshot was saved. Newer work remains in memory and automatic saving remains disabled.'; return; } protectedSave = false; memoryEnabled = true; recoveryVisible = false; durableGeneration = generation; saveFailed = false; saveStatus.textContent = 'Saved in this browser.'; }
  catch { if (explicitWrite === epoch && saveEpoch === epoch) { saveFailed = true; saveStatus.textContent = 'Not saved · saving remains protected. Download project or explicitly Save current project again.'; } }
  finally { if (explicitWrite === epoch) explicitWrite = null; updateControls(); }
}
async function clearSaved(): Promise<void> {
  if (startup || explicitWrite !== null) return;
  const capturedGeneration = generation, capturedIntent = intent;
  if (!confirm('Clear the saved project from this browser? Current in-memory artwork, history and unsent fields stay intact. Later edits will not automatically recreate the saved copy. Download project first if needed.')) return;
  if (capturedGeneration !== generation || capturedIntent !== intent) return;
  retirePendingLoad(); protectWrites(); const epoch = saveEpoch; explicitWrite = epoch; updateControls(); saveStatus.textContent = 'Clearing saved project…';
  try { await store.clear(); if (saveEpoch !== epoch || explicitWrite !== epoch) return; durableGeneration = -1; saveFailed = false; recoveryVisible = false; saveStatus.textContent = 'Saved project cleared · current work stays in memory; automatic saving remains disabled.'; }
  catch { if (saveEpoch === epoch) { recoveryVisible = true; saveStatus.textContent = 'Could not clear the saved project. Current work was kept; automatic saving remains disabled.'; } }
  finally { if (explicitWrite === epoch) explicitWrite = null; updateControls(); }
}
async function loadSaved(initial = false): Promise<void> {
  if (pendingLoad || explicitWrite !== null) return;
  if (!initial) { intent++; cancelWork('Checking the saved record. Applied artwork and unsent fields were kept.'); }
  const receipt = { id: ++loadEpoch, generation, intent }; pendingLoad = receipt; updateControls();
  const current = () => pendingLoad === receipt && loadEpoch === receipt.id && generation === receipt.generation && intent === receipt.intent;
  try { const restored = await store.load(); if (!current()) return;
    if (!initial && restored && project) { if (!confirm('Replace the current in-memory project and unsent fields with the recovered saved project? Current undo history will be replaced. Download the current project first if needed.')) return; if (!current()) return; }
    if (restored) { protectedSave = false; recoveryVisible = false; memoryEnabled = true; startup = false; publish(restored, true); saveStatus.textContent = 'Restored from this browser.'; }
    else { protectedSave = false; recoveryVisible = false; memoryEnabled = true; startup = false; durableGeneration = -1; if (!project) publish(createProject(createDemoImage()),false,true); saveStatus.textContent = 'No saved project · current work is not saved. A real edit or explicit Save current project can save it.'; }
  } catch { if (current()) { protectWrites(); recoveryVisible = true; startup = false; if (!project) publish(createProject(createDemoImage()),false,true); saveStatus.textContent = 'Saved project could not be loaded. Its record is protected; retry, download raw data or Continue without saving.'; } }
  finally { if (pendingLoad === receipt) pendingLoad = null; updateControls(); }
}
function download(bytes: string | Uint8Array, type: string, name: string): void {
  const body = typeof bytes === 'string' ? bytes : new Uint8Array(bytes); const url = URL.createObjectURL(new Blob([body], {type})); urls.add(url); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); },1000);
}
async function exportArtifact(kind: 'source' | 'result' | 'project' | 'report'): Promise<void> {
  if (!enabled() || !project || (dirty && (kind === 'result' || kind === 'report'))) return;
  const captured = project, op = begin('Preparing applied-only download');
  try {
    const result = kind === 'project' ? serializeProject(captured) : kind === 'report' ? await exportReport(captured,{signal:op.abort.signal}) : await exportPng(captured,kind,{signal:op.abort.signal});
    if (!own(op)) return;
    download(result,kind === 'project' ? 'application/json' : kind === 'report' ? 'text/html;charset=utf-8' : 'image/png',kind === 'project' ? 'color-context-project.json' : kind === 'report' ? 'color-context-report.html' : `color-context-${kind}.png`);
    previewStatus.textContent = 'Applied changes only downloaded. Unsent fields were kept.';
  } catch { if (own(op)) { showError('Download failed or was canceled. Applied work and the previous preview were kept.'); previewStatus.textContent='No download published. Applied work and unsent fields were kept.'; } }
  finally { if (operation === op) { finish(op); if (!dirty && frameGeneration !== generation) void renderPreview(); } }
}
async function importFile(file: File, png: boolean): Promise<void> {
  if (!enabled()) return; retirePendingLoad(); const op = begin(png ? 'Normalizing PNG' : 'Reading complete project');
  try {
    let candidate: Project;
    if (png) candidate = createProject(await normalize(file,{signal:op.abort.signal}));
    else { if (!file.size || file.size > LIMITS.projectBytes) throw new Error('Project size'); const bytes = await file.arrayBuffer(); if (!own(op)) return; candidate = parseProjectJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
    if (!own(op)) return; candidate = validateProject(candidate);
    if ((!untouchedDemo || dirty || protectedSave) && !confirm('Replace the current applied artwork and its undo history? Unsent fields will be discarded only if this complete replacement succeeds. Download the current project first if needed.')) { if(own(op))previewStatus.textContent='Replacement declined. Applied artwork and unsent fields were kept.'; return; }
    if (!own(op)) return; finish(op); publish(candidate,false); untouchedDemo = false; scheduleSave();
  } catch { if (own(op)) { previewStatus.textContent='No replacement published. Applied artwork and unsent fields were kept.'; showError(png ? 'PNG import rejected. Use an 8-bit RGB/RGBA noninterlaced PNG without animation or orientation metadata, within 8 MiB and source-size limits. Current artwork and drafts were kept.' : 'Project rejected in full. Check valid UTF-8, exact schema, raw RGBA and the 4 MiB limit. Current artwork and drafts were kept.'); } }
  finally { finish(op); }
}
form.addEventListener('input',()=>{if(!enabled())return;dirty=true;editorIntent();updateControls();});
form.addEventListener('change',()=>{if(!enabled())return;dirty=true;editorIntent();updateControls();});
form.addEventListener('submit',event=>{event.preventDefault();apply();});
buttons['discard-changes'].onclick = discard; buttons.undo.onclick = ()=>changeHistory(false); buttons.redo.onclick = ()=>changeHistory(true);
buttons['stop-job'].onclick = ()=>cancelWork();
buttons['download-source'].onclick = ()=>{void exportArtifact('source');}; buttons['download-result'].onclick = ()=>{void exportArtifact('result');}; buttons['download-project'].onclick = ()=>{void exportArtifact('project');}; buttons['download-report'].onclick = ()=>{void exportArtifact('report');};
imageFile.onchange = ()=>{const file=imageFile.files?.[0];imageFile.value='';if(file)void importFile(file,true);}; projectFile.onchange = ()=>{const file=projectFile.files?.[0];projectFile.value='';if(file)void importFile(file,false);};
buttons['retry-load'].onclick = ()=>{void loadSaved();}; buttons['retry-save'].onclick = ()=>{if(!project||protectedSave)return;pendingSave={project,generation,epoch:saveEpoch};void savePump();};
buttons['save-current'].onclick = ()=>{void explicitSave();}; buttons['clear-saved'].onclick = ()=>{void clearSaved();};
buttons['continue-unsaved'].onclick = ()=>{if(startup)return;retirePendingLoad();memoryEnabled=true;protectWrites();saveStatus.textContent='Saving disabled · working in memory. Save current project is the explicit way to enable saving.';updateControls();if(project&&frameGeneration!==generation)void renderPreview();};
buttons['raw-backup'].onclick = ()=>{void (async()=>{try{const raw=await store.exportRaw();if(raw===null)showError('No saved string record is available.');else download(raw,'application/json','color-context-raw-saved-record.json');}catch{showError('Raw saved record could not be exported safely. It was kept unchanged.');}})();};
node<HTMLSelectElement>('comparison-view').onchange = ()=>{node('paired-views').classList.toggle('actual',node<HTMLSelectElement>('comparison-view').value==='actual');};
let syncingScroll=false; const scrolls=Array.from(document.querySelectorAll<HTMLElement>('.canvas-scroll'));for(const scroll of scrolls)scroll.addEventListener('scroll',()=>{if(syncingScroll)return;syncingScroll=true;for(const other of scrolls)if(other!==scroll){other.scrollLeft=scroll.scrollLeft;other.scrollTop=scroll.scrollTop;}syncingScroll=false;});
window.addEventListener('beforeunload',event=>{if(dirty||project&&durableGeneration!==generation){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',event=>{retireExperiment();intent++;loadEpoch++;pendingLoad=null;cancelWork();for(const url of urls)URL.revokeObjectURL(url);urls.clear();if(!event.persisted){clearTimeout(saveTimer);store.close();}});
window.addEventListener('pageshow',event=>{if(event.persisted){updateControls();if(startup)void loadSaved(true);else if(project&&frameGeneration!==generation&&!dirty)void renderPreview();if(!experiment&&!experimentRequest)void fetchExperiment();}});

let experiment: ExperimentReport | null = null, experimentText: string | null = null;
let experimentRequest: { abort: AbortController } | null = null;
function retireExperiment(): void { const pending = experimentRequest; experimentRequest = null; pending?.abort.abort(); }
const experimentDownload = node<HTMLButtonElement>('download-experiment');
function showExperiment(report: ExperimentReport): void {
  const container=node('experiment-results');container.replaceChildren();node('experiment-status').textContent=`${report.status === 'not-run' ? 'Not run' : report.status} · development readiness: ${report.readiness.status}`;
  container.append(el('p',report.provenance),el('p','Training arms: neutral, correlated and independent. The retrained center-mask bypass is distinct from inference-only masking. No result applies to uploaded artwork.','notice'));
  if(report.status==='complete'&&report.evaluations.length>0&&report.evaluations.every(value=>value.flipFraction===0)){container.append(el('p','This frozen experiment observed no change in predicted labels under the tested surround changes: every measured paired prediction-flip fraction was zero. This does not demonstrate artwork protection.','notice'));if(report.evaluations.every(value=>value.accuracy===1&&value.balancedAccuracy===1))container.append(el('p','Every measured condition classified these procedural fixtures correctly. This result does not establish performance on artwork, human perception or generative models.','hint'));}
  if(report.readiness.reason)container.append(el('p',report.readiness.reason,'warning'));if(report.error)container.append(el('p',report.error,'warning'));
  const provenance=el('details');provenance.append(el('summary','Inspect provenance and environment'),el('pre',JSON.stringify({protocolHash:report.protocolHash,generatorHash:report.generatorHash,manifestHash:report.manifestHash,environment:report.environment},null,2)));container.append(provenance);
  const readiness=el('ul');for(const value of report.readiness.neutralDevelopment)readiness.append(el('li',`Neutral raw seed ${value.seed}: development balanced accuracy ${value.balancedAccuracy} (minimum ${report.readiness.minimum})`));container.append(readiness);
  if(report.models.length){const development=el('details');development.append(el('summary','Inspect all development fits'));const table=el('table');const header=el('tr');for(const label of['Seed','Training arm','Training preprocessing','Development balanced accuracy','Development accuracy','Fit seconds'])header.append(el('th',label));table.append(header);for(const model of report.models){const row=el('tr');for(const value of[model.seed,model.arm,model.training,model.development.balancedAccuracy,model.development.accuracy,model.fitSeconds])row.append(el('td',String(value)));table.append(row);}const scroll=el('div','','experiment-table-scroll');scroll.append(table);development.append(scroll);container.append(development);}
  const grouping=new Map<string,typeof report.evaluations>();for(const value of report.evaluations){const key=`${value.arm} · training ${value.training} · suite ${value.suite} · test ${value.preprocessing}`;const group=grouping.get(key)??[];group.push(value);grouping.set(key,group);}
  if(grouping.size){const table=el('table');const head=el('tr');for(const label of ['Condition','Seeds','Balanced accuracy mean / min / max','Paired flips mean / min / max','Baseline difference mean / min / max'])head.append(el('th',label));table.append(head);for(const[key,values]of grouping){const row=el('tr');const summary=(name:'balancedAccuracy'|'flipFraction'|'baselineDifference')=>{if(values.length!==3)return 'Incomplete — all three seeds required';const numbers=values.map(value=>value[name]);return`${numbers.reduce((a,b)=>a+b,0)/numbers.length} / ${Math.min(...numbers)} / ${Math.max(...numbers)}`;};row.append(el('th',key),el('td',values.map(value=>String(value.seed)).join(', ')),el('td',summary('balancedAccuracy')),el('td',summary('flipFraction')),el('td',summary('baselineDifference')));table.append(row);}const scroll=el('div','','experiment-table-scroll');scroll.tabIndex=0;scroll.append(table);container.append(scroll);}
  else container.append(el('p','No test evaluations are available. No success or effect is inferred from missing results.','hint'));
  const examples=el('div','','experiment-examples');for(const example of experimentExamples(report)){const item=el('section');item.append(el('h3',example.label));for(const[key,raster]of[['Neutral',example.neutral],['Matched context',example.matched],['Shifted context',example.shifted]]as const){const label=el('div');label.append(el('p',key));const canvas=el('canvas');displayRaster(canvas,raster);label.append(canvas);item.append(label);}examples.append(item);}container.append(examples);
  const limitations=el('ul');for(const limitation of report.limitations)limitations.append(el('li',limitation));container.append(el('h3','Limits of this experiment'),limitations);
  const full=el('details');full.append(el('summary','Inspect full per-seed records and predictions'),el('pre',JSON.stringify(report,null,2)));container.append(full);
}
async function fetchExperiment(): Promise<void> {
  retireExperiment(); const request={abort:new AbortController()};experimentRequest=request;const abort=request.abort,timer=setTimeout(()=>abort.abort(),10000);const current=()=>experimentRequest===request&&!abort.signal.aborted;
  try{const response=await fetch('./experiment-report.json',{signal:abort.signal,cache:'no-store'});if(!current()||!response.ok||!response.body)throw new Error('Unavailable');const reader=response.body.getReader();let length=0;const chunks:Uint8Array[]=[];try{while(true){const{done,value}=await reader.read();if(!current())throw new Error('Retired');if(done)break;if(length+value.length>LIMITS.experimentReportBytes)throw new Error('Oversize');length+=value.length;chunks.push(value);}}finally{reader.releaseLock();}if(!current())throw new Error('Retired');const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),parsed=loadExperimentReport(text);if(!current())return;experiment=parsed;experimentText=text;showExperiment(parsed);experimentDownload.disabled=false;}
  catch{if(experimentRequest===request){node('experiment-status').textContent='Results unavailable — no experiment outcome is claimed.';experimentDownload.disabled=true;}}
  finally{clearTimeout(timer);abort.abort();if(experimentRequest===request)experimentRequest=null;}
}
experimentDownload.onclick=()=>{if(experiment&&experimentText!==null)download(experimentText,'application/json','color-context-experiment.json');};
updateControls();void loadSaved(true);void fetchExperiment();
