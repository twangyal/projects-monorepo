import './style.css';
import { fitCalibration, predictGaze, type Calibration, type Point, type Sample } from './calibration';
import { chooseTarget, DwellSelector, type Selection } from './decision';
import { BrowserActions } from './actions';
import { CameraTracker } from './tracker';
import { VoiceConfirmation } from './voice';
import { createWorkspace } from './workspace';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Look home"><svg aria-hidden="true" viewBox="0 0 48 32"><path d="M2 16S10 3 24 3s22 13 22 13-8 13-22 13S2 16 2 16Z"/><circle cx="24" cy="16" r="7"/></svg>look<span>Gaze navigation lab</span></a>
    <span class="local-badge"><i></i> Webcam processing stays local</span>
  </header>
  <main>
    <section class="hero"><div><p class="eyebrow">EYE DETECTOR / EXPERIMENT 001</p><h1>Look, then decide.</h1><p class="hero-copy">A glance finds the target. You choose what happens next.<br> Explore a gentler way to navigate, one deliberate action at a time.</p></div><div class="hero-note"><span>01 /</span> LOOK &nbsp;→&nbsp; HOLD &nbsp;→&nbsp; CONFIRM<p>Built for exploration.<br>Calibrated to you.</p></div></section>
    <div class="layout">
      <aside class="assistant-panel" aria-label="Gaze assistant controls">
        <div class="panel-heading"><span class="eyebrow">YOUR ASSISTANT</span><span id="mode-pill" class="mode-pill">Standby</span></div>
        <h2>Make yourself<br> comfortable.</h2><p class="muted">Use your webcam, or try the interaction with your pointer first.</p>
        <button id="start-camera" class="primary">Start webcam <span aria-hidden="true">→</span></button>
        <button id="simulate" class="secondary">Try simulation <span aria-hidden="true">→</span></button>
        <div class="session-tools"><button id="calibrate" disabled>Calibrate gaze</button><button id="pause" disabled aria-label="Pause assistant">Pause</button></div>
        <section class="decision-panel" aria-label="Suggested action"><div class="panel-heading"><span class="eyebrow">NEXT ACTION</span><span class="baseline-badge">LOCAL BASELINE</span></div><h3 id="decision-title">Waiting for a look</h3><p id="decision-reason">Only controls in the workspace can be selected.</p><div class="dwell-track" role="progressbar" aria-label="Target dwell" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="dwell-fill"></div></div><button id="confirm" class="confirm-button" aria-label="Confirm action" disabled>Confirm action <span aria-hidden="true">↵</span></button><p class="shortcut-note">Hold for 0.9s, then press <kbd>Enter</kbd> or <kbd>Space</kbd>.</p></section>
        <div class="camera-preview"><video id="camera-video" autoplay muted playsinline aria-label="Local webcam preview"></video><div id="camera-placeholder"><span aria-hidden="true">◎</span><span>Your camera, your browser.</span></div><span id="signal-state" class="preview-caption">No camera is running</span></div>
        <p id="session-status" class="session-status" role="status">Ready when you are. No camera is required for simulation.</p>
        <label class="voice-option"><input id="voice" type="checkbox" disabled> Say “confirm” to act</label><p class="voice-disclosure">Optional speech recognition may send audio to your browser vendor. Enabling it grants microphone access.</p>
      </aside>
      <section class="workspace-column" aria-label="Demo browser"><div class="workspace-label"><span><i></i> THE PRACTICE SPACE</span><span id="workspace-hint">Mouse and keyboard work here, too.</span></div><div id="workspace" class="workspace"></div><div class="workspace-tip"><span aria-hidden="true">✳</span><p><strong>Suggestions, with a reason.</strong> Nearby controls are ranked by gaze position. Uncertain choices wait for a clearer look. Your confirmation always comes last.</p></div><section class="activity" aria-label="Action history"><span class="eyebrow">SESSION NOTES</span><ol id="action-log"><li class="empty-log">Your confirmed actions will appear here.</li></ol></section></section>
    </div>
    <footer class="site-footer"><span>Look / a browser interaction experiment</span><span>Approximate gaze · Explicit confirmation · No account</span></footer>
  </main>
  <div id="gaze-dot" class="gaze-dot" hidden aria-hidden="true"></div>
  <dialog id="calibration-dialog" aria-labelledby="calibration-heading">
    <div class="calibration-message"><p class="eyebrow">CALIBRATION</p><h2 id="calibration-heading">Follow the point with your eyes.</h2><p>Keep your head still and face the camera. Each point records automatically.<br>If no face is visible, recording waits. Press Escape to cancel.</p><p id="calibration-progress" role="status"></p><button id="cancel-calibration">Cancel calibration</button></div>
    <div id="calibration-point" aria-hidden="true"><span></span></div>
  </dialog>`;

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => element<HTMLButtonElement>(id);
const setText = (id: string, text: string) => { if (element(id).textContent !== text) element(id).textContent = text; };
const workspace = element('workspace');
workspace.tabIndex = -1;
const actions = new BrowserActions(workspace);
const selector = new DwellSelector();
const tracker = new CameraTracker(element<HTMLVideoElement>('camera-video'));
const voice = new VoiceConfirmation();
const voiceInput = element<HTMLInputElement>('voice');
const dialog = element<HTMLDialogElement>('calibration-dialog');
const dot = element('gaze-dot');
let mode: 'idle' | 'simulation' | 'starting' | 'camera' | 'calibrating' = 'idle';
let model: Calibration | null = null;
let signal: (Point & { time: number }) | null = null;
let simulationInside = false;
let selection: Selection | null = null;
let highlighted: string | null = null;
let sessionGeneration = 0;
let calibrationTimer = 0;
let calibrationPoints: Point[] = [];
let samples: Sample[] = [];
let pointIndex = 0;
let pointStarted = 0;
let pointSamples = 0;
let lastSample = 0;

function clearSelection() {
  selector.reset(); selection = null; signal = null; highlighted = null;
  workspace.querySelectorAll('.gaze-target').forEach(el => el.classList.remove('gaze-target', 'gaze-ready'));
  button('confirm').disabled = true;
  dot.hidden = true;
}

function updateControls() {
  const active = mode !== 'idle';
  document.body.classList.toggle('assistant-active', active);
  button('start-camera').disabled = mode === 'starting' || mode === 'camera' || mode === 'calibrating';
  button('calibrate').disabled = mode !== 'camera';
  button('pause').disabled = !active;
  voiceInput.disabled = !voice.supported || !['camera', 'simulation'].includes(mode);
  element('camera-placeholder').hidden = mode === 'camera' || mode === 'calibrating';
  setText('mode-pill', mode === 'simulation' ? 'Simulation' : mode === 'camera' ? 'Webcam' : mode === 'calibrating' ? 'Calibrating' : mode === 'starting' ? 'Starting…' : 'Standby');
  setText('workspace-hint', mode === 'simulation' ? 'Pointer simulates gaze. Confirmation is still yours.' : 'Mouse and keyboard work here, too.');
}

function cancelCalibration() {
  clearTimeout(calibrationTimer);
  if (dialog.open) dialog.close();
  if (mode === 'calibrating') mode = 'camera';
  samples = [];
  updateControls(); clearSelection();
}

function pause(message = 'Assistant paused') {
  sessionGeneration++;
  cancelCalibration(); tracker.stop(); voice.stop(); voiceInput.checked = false;
  mode = 'idle'; model = null; simulationInside = false;
  clearSelection(); updateControls();
  setText('session-status', message);
  setText('signal-state', 'Camera and voice are off');
}

function logAction(label: string) {
  clearSelection();
  const log = element('action-log');
  log.querySelector('.empty-log')?.remove();
  const item = document.createElement('li');
  const text = document.createElement('span');
  const time = document.createElement('time');
  text.textContent = label;
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  item.append(text, time); log.prepend(item);
  while (log.children.length > 5) log.lastElementChild?.remove();
  setText('session-status', `Action completed: ${label}.`);
}
createWorkspace(workspace, logAction);

function confirm() {
  if (!selection?.ready || !signal || !['camera', 'simulation'].includes(mode)) return;
  if (performance.now() - signal.time > (mode === 'simulation' ? 1200 : 600)) { clearSelection(); return; }
  const current = chooseTarget(signal, actions.targets());
  if (!current.target || current.target.id !== selection.target?.id) { clearSelection(); return; }
  const id = current.target.id;
  clearSelection();
  if (!actions.confirm(id)) setText('session-status', 'The control changed. Look at a target again.');
  else workspace.focus({ preventScroll: true });
}
button('confirm').addEventListener('click', confirm);
button('pause').addEventListener('click', () => pause());
button('simulate').addEventListener('click', () => {
  pause(); mode = 'simulation'; updateControls();
  workspace.focus({ preventScroll: true });
  setText('signal-state', 'Simulation · no webcam');
  setText('session-status', 'Move your pointer over a workspace control, hold, then confirm. Simulation does not track your eyes.');
});

workspace.addEventListener('pointermove', event => {
  if (mode !== 'simulation') return;
  simulationInside = true;
  signal = { x: event.clientX, y: event.clientY, time: performance.now() };
});
workspace.addEventListener('pointerleave', () => { simulationInside = false; });
window.addEventListener('scroll', () => { if (mode === 'simulation') { clearSelection(); simulationInside = false; } }, true);

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !dialog.open) { pause(); return; }
  if (event.repeat || !['Enter', ' '].includes(event.key) || !selection?.ready) return;
  const target = event.target as HTMLElement;
  if (target.closest('button, a, input, textarea, select, [contenteditable]')) return;
  event.preventDefault(); confirm();
});

function messageFor(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera permission was denied. Allow access in your browser or try simulation.';
    if (error.name === 'NotFoundError') return 'No webcam was found. Connect a camera or try simulation.';
    if (error.name === 'NotReadableError') return 'The webcam is busy. Close other camera apps or try simulation.';
  }
  return error instanceof Error ? error.message : 'Camera tracking failed. Try simulation or restart the webcam.';
}

button('start-camera').addEventListener('click', async () => {
  pause(); mode = 'starting'; updateControls();
  const generation = sessionGeneration;
  setText('session-status', 'Allow camera access. The first local vision-model load may take a moment.');
  setText('signal-state', 'Starting local vision model…');
  try {
    const started = await tracker.start(next => {
      if (!next) {
        clearSelection();
        setText('signal-state', 'Face or open eyes not detected');
        return;
      }
      setText('signal-state', 'Face detected · local processing');
      if (mode === 'calibrating') { collectCalibration(next); return; }
      if (mode !== 'camera' || !model) return;
      const point = predictGaze(model, next);
      if (!point) { clearSelection(); setText('signal-state', 'Gaze outside calibrated range'); return; }
      const x = point.x * innerWidth, y = point.y * innerHeight;
      const fresh = signal && performance.now() - signal.time < 600;
      signal = { x: fresh ? signal!.x * 0.65 + x * 0.35 : x,
        y: fresh ? signal!.y * 0.65 + y * 0.35 : y, time: performance.now() };
    }, error => pause(messageFor(error)));
    if (!started || generation !== sessionGeneration) return;
    mode = 'camera'; updateControls();
    setText('session-status', 'Camera ready. Calibrate gaze to enable eye navigation. Keep your head still and use good lighting.');
  } catch (error) { if (generation === sessionGeneration) pause(messageFor(error)); }
});

function showCalibrationPoint() {
  const point = calibrationPoints[pointIndex];
  const target = element('calibration-point');
  target.style.left = `${point.x * 100}%`; target.style.top = `${point.y * 100}%`;
  target.style.setProperty('--capture', '0');
  pointStarted = performance.now(); pointSamples = 0; lastSample = 0;
  setText('calibration-progress', `Point ${pointIndex + 1} of 9 · look at the lavender dot`);
  calibrationTimer = window.setTimeout(() => {
    cancelCalibration(); model = null;
    setText('session-status', 'Calibration timed out. Check that your face and eyes are visible, then try again.');
  }, 20000);
}

function collectCalibration(next: number[]) {
  const now = performance.now();
  // Give the eyes time to settle before collecting independent video frames.
  if (now - pointStarted < 750 || now - lastSample < 40) return;
  lastSample = now;
  samples.push({ features: [...next], point: calibrationPoints[pointIndex] });
  pointSamples++;
  element('calibration-point').style.setProperty('--capture', String(pointSamples / 24));
  if (pointSamples < 24) return;
  clearTimeout(calibrationTimer);
  pointIndex++;
  if (pointIndex < calibrationPoints.length) { showCalibrationPoint(); return; }
  try {
    model = fitCalibration(samples);
    const error = Math.round(model.error * 100);
    cancelCalibration();
    workspace.focus({ preventScroll: true });
    setText('session-status', `Calibration complete. Training fit error: ${error}% of screen size (not measured accuracy). Look at a workspace control and confirm.`);
  } catch (error) {
    cancelCalibration(); model = null;
    setText('session-status', messageFor(error));
  }
}

button('calibrate').addEventListener('click', () => {
  if (mode !== 'camera') return;
  clearSelection(); model = null; samples = []; pointIndex = 0;
  calibrationPoints = [0.12, 0.5, 0.88].flatMap(y => [0.12, 0.5, 0.88].map(x => ({ x, y })));
  mode = 'calibrating'; voice.stop(); voiceInput.checked = false; updateControls();
  dialog.showModal(); showCalibrationPoint();
});
button('cancel-calibration').addEventListener('click', () => { cancelCalibration(); setText('session-status', 'Calibration cancelled. Choose Calibrate gaze to try again.'); });
dialog.addEventListener('cancel', event => { event.preventDefault(); cancelCalibration(); setText('session-status', 'Calibration cancelled. Choose Calibrate gaze to try again.'); });
window.addEventListener('resize', () => {
  clearSelection(); simulationInside = false;
  if (mode === 'calibrating') cancelCalibration();
  if (model || mode === 'camera') {
    model = null;
    setText('session-status', 'The viewport changed. Calibrate gaze again before continuing.');
  }
});

voiceInput.addEventListener('change', () => {
  if (!voiceInput.checked) { voice.stop(); return; }
  const enabled = voice.start(confirm, message => { voiceInput.checked = false; setText('session-status', message); });
  voiceInput.checked = enabled;
  if (enabled) setText('session-status', 'Voice enabled. Say exactly “confirm” when a target is ready. Recognition may use your browser vendor’s service.');
});
if (!voice.supported) {
  document.querySelector('.voice-disclosure')!.textContent = 'Voice confirmation is unavailable in this browser. Use Enter, Space, or the confirm button.';
}

document.addEventListener('visibilitychange', () => { if (document.hidden && mode !== 'idle') pause('Assistant paused because this tab was hidden.'); });
window.addEventListener('pagehide', () => pause());

function frame(now: number) {
  if (mode === 'simulation' && simulationInside && signal) signal.time = now;
  const valid = signal && now - signal.time < (mode === 'simulation' ? 1200 : 600) && ['camera', 'simulation'].includes(mode);
  const decision = valid ? chooseTarget(signal!, actions.targets()) : { target: null,
    reason: mode === 'camera' && !model ? 'Calibrate gaze to begin.' : mode === 'idle' ? 'Start your webcam or try simulation.' : 'Look toward a control in the workspace.' };
  selection = selector.update(decision, now);
  const id = selection.target?.id ?? null;
  if (id !== highlighted) {
    workspace.querySelectorAll('.gaze-target').forEach(el => el.classList.remove('gaze-target', 'gaze-ready'));
    highlighted = id;
  }
  if (id) {
    const target = [...workspace.querySelectorAll<HTMLElement>('[data-gaze]')].find(el => el.dataset.gaze === id);
    target?.classList.add('gaze-target'); target?.classList.toggle('gaze-ready', selection.ready);
  }
  setText('decision-title', selection.target?.label ?? 'Waiting for a look');
  const confirmLabel = selection.target ? `Confirm: ${selection.target.label} ` : 'Confirm action ';
  if (button('confirm').firstChild!.textContent !== confirmLabel) button('confirm').firstChild!.textContent = confirmLabel;
  setText('decision-reason', selection.ready ? `${selection.reason} Ready for your confirmation.` : selection.reason);
  element('dwell-fill').style.width = `${selection.progress * 100}%`;
  const progress = element('dwell-fill').parentElement!;
  const value = String(Math.round(selection.progress * 100));
  if (progress.getAttribute('aria-valuenow') !== value) progress.setAttribute('aria-valuenow', value);
  button('confirm').disabled = !selection.ready;
  dot.hidden = !valid;
  if (valid) dot.style.transform = `translate(${signal!.x}px, ${signal!.y}px)`;
  requestAnimationFrame(frame);
}
updateControls(); requestAnimationFrame(frame);
