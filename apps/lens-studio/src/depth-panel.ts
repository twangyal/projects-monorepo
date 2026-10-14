import { defaultThresholds, planeShares, proposePlanes, thresholdsAround, validThresholds, type Thresholds } from './depth-estimate.ts';
import { estimateDepth } from './depth-job.ts';
import { DEPTH_MODEL, loadHostedModel, verifiedModel, verifyModel } from './depth-model.ts';
import { encodeMask, validateProject } from './model.ts';
import type { Project } from './types.ts';

export interface DepthHost {
  project(): Project | null;
  /** True while an export, gesture or other exclusive work owns the study. */
  locked(): boolean;
  commit(next: Project): void;
  announce(text: string, error?: boolean): void;
}

const COLORS = [[219, 113, 77], [105, 159, 144], [118, 132, 200]] as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
}
function button(label: string, action: () => void, className = ''): HTMLButtonElement {
  const node = el('button', label, className); node.type = 'button'; node.addEventListener('click', action); return node;
}
function percent(share: number): string { return `${Math.round(share * 100)}%`; }

/** “Estimated depth”: a learned proposal for the three editable planes, reviewed before it replaces the mask. */
export function mountDepthPanel(host: DepthHost): { element: HTMLElement; refresh(): void } {
  const panel = el('section', '', 'panel'); panel.id = 'depth-estimate-panel';
  panel.append(el('h2', 'Estimated depth'), el('p', `${DEPTH_MODEL.name} (${DEPTH_MODEL.license}) estimates relative depth in this browser. It proposes which plane each pixel belongs to; values are not distances, and edges, glass, reflections and thin objects are often wrong. Review the proposal, then correct it with the authored-depth tools.`, 'hint'));
  const status = el('p', '', 'hint'); status.id = 'depth-estimate-status'; status.setAttribute('role', 'status');
  const estimate = button('Estimate depth', () => { void run(); }, 'primary');
  const cancel = button('Cancel estimate', () => controller?.abort()); cancel.hidden = true;
  const modelField = el('label', 'Choose depth model file', 'field'); modelField.hidden = true;
  const modelInput = el('input'); modelInput.type = 'file'; modelInput.accept = '.onnx'; modelInput.id = 'depth-model-file'; modelField.append(modelInput);
  const modelHelp = el('p', `This installation does not host the model. Run npm run fetch-depth-model where the app is built, or download ${DEPTH_MODEL.source} (${(DEPTH_MODEL.bytes / 1e6).toFixed(1)} MB) and choose it here. It is checked against its pinned SHA-256 and stays on this device.`, 'hint'); modelHelp.hidden = true;

  const review = el('div', '', 'depth-review'); review.id = 'depth-review'; review.hidden = true;
  const canvas = el('canvas'); canvas.id = 'depth-proposal'; canvas.setAttribute('aria-label', 'Proposed planes: near orange, subject green, far blue. Click the subject to centre the subject band on it.');
  const shares = el('p', '', 'hint'); shares.id = 'depth-shares'; shares.setAttribute('aria-live', 'polite');
  const slider = (label: string, id: string): HTMLInputElement => {
    const wrap = el('label', label, 'field'); const input = el('input'); input.type = 'range'; input.min = '0'; input.max = '1000'; input.step = '1'; input.id = id;
    wrap.append(input); review.append(wrap); input.addEventListener('input', () => { if (!estimateState) return; const t = { farBelow: Number(farInput.value) / 1000, nearAbove: Number(nearInput.value) / 1000 }; if (validThresholds(t)) { estimateState.thresholds = t; draw(); } else syncSliders(); });
    return input;
  };
  review.append(canvas, shares);
  const farInput = slider('Far plane: depth below', 'depth-far-below');
  const nearInput = slider('Near plane: depth from', 'depth-near-from');
  const apply = button('Apply proposal as depth mask', applyProposal, 'primary');
  const discard = button('Discard estimate', () => { estimateState = null; review.hidden = true; status.textContent = 'Estimate discarded. The depth mask was not changed.'; refresh(); });
  review.append(el('p', 'Click the subject in this preview to centre the subject band on its depth, or adjust both limits. Applying replaces the whole depth mask as one undoable edit.', 'hint'), apply, discard);
  panel.append(status, estimate, cancel, modelField, modelHelp, review);

  let controller: AbortController | null = null;
  let estimateState: { photoId: string; width: number; height: number; depth: Float32Array; thresholds: Thresholds } | null = null;

  function syncSliders(): void {
    if (!estimateState) return;
    farInput.value = String(Math.round(estimateState.thresholds.farBelow * 1000));
    nearInput.value = String(Math.round(estimateState.thresholds.nearAbove * 1000));
  }
  function draw(): void {
    if (!estimateState) return;
    const { width, height, depth, thresholds } = estimateState;
    const labels = proposePlanes(depth, thresholds), rgba = new Uint8ClampedArray(labels.length * 4);
    for (let i = 0; i < labels.length; i++) {
      const color = COLORS[labels[i]!]!, shade = 0.55 + 0.45 * depth[i]!;
      rgba.set([color[0] * shade, color[1] * shade, color[2] * shade, 255], i * 4);
    }
    canvas.width = width; canvas.height = height; canvas.getContext('2d')?.putImageData(new ImageData(rgba, width, height), 0, 0);
    const [near, subject, far] = planeShares(labels);
    shares.textContent = `Near ${percent(near)} · Subject ${percent(subject)} · Far ${percent(far)}. Brighter means estimated nearer.`;
    syncSliders();
  }
  canvas.addEventListener('click', event => {
    if (!estimateState) return;
    const box = canvas.getBoundingClientRect();
    const x = Math.min(estimateState.width - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * estimateState.width)));
    const y = Math.min(estimateState.height - 1, Math.max(0, Math.floor((event.clientY - box.top) / box.height * estimateState.height)));
    estimateState.thresholds = thresholdsAround(estimateState.depth[y * estimateState.width + x]!);
    draw();
  });

  async function model(signal: AbortSignal): Promise<Blob | null> {
    const ready = verifiedModel();
    if (ready) return ready;
    status.textContent = 'Checking for the depth model…';
    const hosted = await loadHostedModel(signal);
    if (!hosted) { modelField.hidden = false; modelHelp.hidden = false; status.textContent = 'Choose the depth model file to continue.'; }
    return hosted;
  }
  modelInput.addEventListener('change', async () => {
    const file = modelInput.files?.[0]; modelInput.value = '';
    if (!file) return;
    status.textContent = 'Checking the model file against its pinned checksum…';
    try { await verifyModel(file); modelField.hidden = true; modelHelp.hidden = true; status.textContent = 'Model verified. Estimating depth…'; void run(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : 'This model file could not be used.'; }
  });

  async function run(): Promise<void> {
    const project = host.project();
    if (!project || controller || host.locked()) return;
    const photo = project.photo, own = new AbortController(); controller = own; refresh();
    try {
      const blob = await model(own.signal);
      if (!blob) return;
      status.textContent = 'Loading the depth model…';
      const result = await estimateDepth(blob, photo, own.signal, (stage, threads) => {
        status.textContent = stage === 'model' ? 'Loading the depth model…' : `Estimating depth on this device (${threads ?? 1} ${threads === 1 ? 'thread' : 'threads'}). This can take up to a minute.`;
      });
      if (host.project()?.photo.id !== photo.id) { status.textContent = 'The photo changed while estimating, so that estimate was discarded.'; return; }
      estimateState = { photoId: photo.id, width: result.width, height: result.height, depth: result.values, thresholds: defaultThresholds(result.values) };
      review.hidden = false; draw();
      status.textContent = `Depth estimated in ${result.seconds.toFixed(1)} s. Review the proposal; nothing has changed yet.`;
    } catch (error) {
      status.textContent = error instanceof DOMException && error.name === 'AbortError' ? 'Depth estimation canceled. Nothing was changed.' : error instanceof Error ? error.message : 'Depth estimation failed.';
    } finally { if (controller === own) controller = null; refresh(); }
  }

  function applyProposal(): void {
    const project = host.project(), state = estimateState;
    if (!project || !state || host.locked()) return;
    if (project.photo.id !== state.photoId) { host.announce('This estimate belongs to another photo and was not applied.', true); return; }
    try {
      const labels = proposePlanes(state.depth, state.thresholds);
      host.commit(validateProject({ ...project, depth: encodeMask(labels, state.width, state.height) }));
      host.announce('Estimated planes applied as one undoable edit. Correct edges with the authored-depth tools; Undo restores the previous mask.');
    } catch { host.announce('The estimate could not be applied. The current mask was kept.', true); }
  }

  function refresh(): void {
    const project = host.project(), busy = !!controller;
    if (estimateState && project?.photo.id !== estimateState.photoId) { estimateState = null; review.hidden = true; }
    estimate.disabled = !project || busy || host.locked(); cancel.hidden = !busy;
    apply.disabled = !estimateState || host.locked(); discard.disabled = !estimateState;
    farInput.disabled = nearInput.disabled = !estimateState;
    if (!project) status.textContent = '';
    else if (!busy && !estimateState && !status.textContent) status.textContent = 'Estimate depth to get a starting proposal for the three planes.';
  }
  refresh();
  return { element: panel, refresh };
}
