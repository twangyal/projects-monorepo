import { createDwellTracker } from './dwell.js';
import { resolveTarget } from './resolver.js';
import { createGazeFilter } from './gaze-filter.js';
import { ASSIST_RADIUS, resolveAssistedTarget } from './target-assist.js';
import { setupWorkspace } from './workspace-view.js';
import { setupAccuracyCheck } from './accuracy-view.js';
import { createCameraLoader } from './camera-loader.js';
import { setupKeyboard } from './keyboard.js';
import { resetCameraCalibration, recordCalibrationClick } from './camera-calibration.js';
import { releaseCamera } from './camera-cleanup.js';
import { identifyCamera, retireCamera, retireCameraModel } from './camera-retirement.js';

const dwell = createDwellTracker();
const stabilizer = createGazeFilter();
const loadCamera = createCameraLoader(document, window);
const CALIBRATION_CLICKS = 3;
const CALIBRATION_POINTS = [
  [10, 12], [50, 12], [90, 12],
  [10, 50], [50, 50], [90, 50],
  [10, 88], [50, 88], [90, 88],
];

const startButton = document.querySelector('#startCamera');
const simulateButton = document.querySelector('#simulate');
const recalibrateButton = document.querySelector('#recalibrate');
const status = document.querySelector('#status');
const calibration = document.querySelector('#calibration');
const stage = document.querySelector('#calibrationStage');
const playground = document.querySelector('#playground');
const navigationRoot = document.querySelector('#navigationRoot');
const trackingControls = document.querySelector('#trackingControls');
const pageUpButton = document.querySelector('#pageUp');
const pageDownButton = document.querySelector('#pageDown');
const result = document.querySelector('#result');
const cursor = document.querySelector('#gazeCursor');
const dwellFill = document.querySelector('#dwellFill');
const pauseButton = document.querySelector('#pauseTracking');
const stopButton = document.querySelector('#stopTracking');
const accuracyButton = document.querySelector('#checkAccuracy');
const accuracy = setupAccuracyCheck(document, window, resetTracking);

let currentTarget = null;
let simulationPoint = null;
let simulationFrame = null;
let trackingMode = null;
let calibrationIndex = 0;
let calibrationClicks = 0;
let gazeHandler = null;
let cameraReady = false;
let cameraStarting = false;
let cameraSession = 0;
let cameraApi = null;
let cameraStartup = null;
let needsFreshCamera = false;
let paused = false;
let assistRadius = ASSIST_RADIUS.standard;
let resolvedTarget = null;
const safetyTarget = target => target === pauseButton || target === stopButton;
const pointerHandler = event => {
  simulationPoint = { x: event.clientX, y: event.clientY };
};

function setStatus(message) {
  status.textContent = message;
}

function moveCursor(x, y) {
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  cursor.classList.add('visible');
}

function clearFocus() {
  currentTarget?.classList.remove('gaze-focus', 'gaze-assisted');
  currentTarget = null;
  resolvedTarget = null;
  cursor.classList.remove('ambiguous');
  dwellFill.style.width = '0%';
}

function hideCursor() {
  cursor.classList.remove('visible', 'ambiguous');
}

function activate(target) {
  const label = target.textContent.trim();
  target.classList.add('activated');
  window.setTimeout(() => target.classList.remove('activated'), 420);
  result.textContent = `${label} confirmed.`;
  target.click();
}

function consumePoint(x, y, now = performance.now()) {
  // Held-out checks measure the estimator itself, so they keep raw camera predictions.
  const point = trackingMode === 'camera' ? stabilizer.filter(x, y, now) : { x, y };
  if (accuracy.active && !paused && trackingMode && !document.hidden) {
    accuracy.sample({ x, y }, now);
    // No nearby assist here: a measurement dot near the toolbar must not cancel the check.
    const target = point && resolveTarget(document, trackingControls, point.x, point.y);
    if (!safetyTarget(target)) {
      dwell.update(null, now);
      clearFocus();
      hideCursor();
      return;
    }
  }
  if (!point || !trackingMode || document.hidden || (!paused && playground.classList.contains('hidden'))) {
    dwell.reset({ preserveConfirmation: paused });
    stabilizer.reset();
    clearFocus();
    hideCursor();
    return;
  }
  const resolution = resolveAssistedTarget(document, paused ? trackingControls : navigationRoot, point.x, point.y, {
    radius: accuracy.active ? 0 : assistRadius,
    current: resolvedTarget,
    eligible: paused || accuracy.active ? safetyTarget : () => true,
  });
  if (paused && !resolution.target && !resolution.ambiguous) {
    dwell.update(null, now);
    clearFocus();
    hideCursor();
    return;
  }
  moveCursor(point.x, point.y);
  const selection = dwell.update(resolution.target, now);
  if (selection.target !== currentTarget) {
    clearFocus();
    currentTarget = selection.target;
    currentTarget?.classList.add('gaze-focus');
  }
  resolvedTarget = resolution.target;
  currentTarget?.classList.toggle('gaze-assisted', resolution.assisted);
  cursor.classList.toggle('ambiguous', resolution.ambiguous);
  dwellFill.style.width = `${selection.progress * 100}%`;
  if (selection.activated) {
    activate(selection.activated);
    clearFocus();
    resolvedTarget = selection.activated;
  }
}

function renderCalibrationPoint() {
  stage.replaceChildren();
  if (calibrationIndex >= CALIBRATION_POINTS.length) {
    finishCalibration();
    return;
  }
  const [x, y] = CALIBRATION_POINTS[calibrationIndex];
  const dot = document.createElement('button');
  dot.className = 'calibration-dot';
  dot.style.left = `${x}%`;
  dot.style.top = `${y}%`;
  dot.setAttribute('aria-label', `Calibration point ${calibrationIndex + 1}`);
  dot.textContent = `${calibrationClicks + 1}`;
  dot.disabled = paused;
  dot.addEventListener('click', event => {
    if (paused) return;
    if (trackingMode === 'camera' && !recordCalibrationClick(cameraApi, event, dot)) {
      setStatus('No eye sample recorded. Look at the dot with your face visible, then click it with a pointer.');
      return;
    }
    calibrationClicks += 1;
    if (calibrationClicks >= CALIBRATION_CLICKS) {
      calibrationClicks = 0;
      calibrationIndex += 1;
    }
    renderCalibrationPoint();
  });
  stage.append(dot);
  setStatus(`Calibration point ${Math.min(calibrationIndex + 1, CALIBRATION_POINTS.length)} of ${CALIBRATION_POINTS.length}.`);
}

function beginCalibration() {
  pageUpButton.disabled = true;
  pageDownButton.disabled = true;
  accuracyButton.disabled = true;
  accuracy.cancel();
  if (cameraReady) resetCameraCalibration(cameraApi);
  dwell.reset({ preserveConfirmation: paused });
  clearFocus();
  simulationPoint = null;
  hideCursor();
  calibrationIndex = 0;
  calibrationClicks = 0;
  playground.classList.add('hidden');
  calibration.classList.remove('hidden');
  renderCalibrationPoint();
}

function finishCalibration() {
  calibration.classList.add('hidden');
  playground.classList.remove('hidden');
  recalibrateButton.disabled = false;
  accuracyButton.disabled = false;
  pageUpButton.disabled = paused;
  pageDownButton.disabled = paused;
  setStatus(trackingMode === 'camera' ? 'Gaze tracking active. Look at a target and hold.' : 'Simulation active. Move the pointer over a target and hold.');
}

function enableSimulation() {
  if (trackingMode) return;
  trackingMode = 'simulation';
  paused = false;
  document.addEventListener('pointermove', pointerHandler);
  document.documentElement.addEventListener('pointerleave', resetTracking);
  function sample(now) {
    if (simulationPoint) consumePoint(simulationPoint.x, simulationPoint.y, now);
    simulationFrame = window.requestAnimationFrame(sample);
  }
  simulationFrame = window.requestAnimationFrame(sample);
  simulateButton.disabled = true;
  startButton.disabled = true;
  pauseButton.disabled = false;
  stopButton.disabled = false;
  beginCalibration();
}

async function enableCamera() {
  if (trackingMode || cameraStarting) return;
  const session = ++cameraSession;
  const canceled = Symbol('canceled');
  let cancel;
  const cancellation = new Promise(resolve => { cancel = () => resolve(canceled); });
  const startup = { cancel, settled: false, retire: null };
  cameraStartup = startup;
  cameraStarting = true;
  try {
    trackingMode = 'camera';
    startButton.disabled = true;
    simulateButton.disabled = true;
    stopButton.disabled = false;
    setStatus('Loading camera tracking. You may be asked for webcam permission.');
    const fresh = needsFreshCamera;
    needsFreshCamera = false;
    const api = await Promise.race([loadCamera({ fresh }), cancellation]);
    if (api === canceled || session !== cameraSession) return;
    cameraApi = api;
    identifyCamera(api, session);
    api.saveDataAcrossSessions(false);
    api.showPredictionPoints(false);
    const handler = data => {
      if (trackingMode !== 'camera' || gazeHandler !== handler) return;
      if (data) consumePoint(data.x, data.y);
      else resetTracking();
    };
    gazeHandler = handler;
    api.setGazeListener(gazeHandler);
    const beginning = Promise.resolve(api.begin());
    const settled = () => {
      startup.settled = true;
      if (session !== cameraSession) {
        if (startup.retire) startup.retire();
        else releaseCamera(api, document);
      }
    };
    beginning.then(settled, settled);
    const ready = await Promise.race([beginning, cancellation]);
    if (ready === canceled || session !== cameraSession) return;
    api.removeMouseEventListeners();
    cameraReady = true;
    pauseButton.disabled = false;
    stopButton.disabled = false;
    beginCalibration();
  } catch (error) {
    if (session === cameraSession) {
      console.error(error);
      stopTracking();
      setStatus('Camera tracking could not start. Check camera permission or use pointer simulation.');
    }
  } finally {
    if (cameraStartup === startup) {
      cameraStartup = null;
      cameraStarting = false;
      startButton.disabled = trackingMode !== null;
    }
  }
}

function resetTracking(preserveConfirmation = false) {
  accuracy.cancel();
  stabilizer.reset();
  dwell.reset({ preserveConfirmation: preserveConfirmation === true || paused });
  clearFocus();
  simulationPoint = null;
  hideCursor();
}

function stopTracking() {
  const wasCamera = trackingMode === 'camera';
  cameraStartup?.cancel();
  cameraSession++;
  trackingMode = null;
  cameraReady = false;
  paused = false;
  resetTracking();
  if (simulationFrame !== null) window.cancelAnimationFrame(simulationFrame);
  simulationFrame = null;
  document.removeEventListener('pointermove', pointerHandler);
  document.documentElement.removeEventListener('pointerleave', resetTracking);
  if (wasCamera && cameraApi) {
    // end() cannot cancel an inference already awaiting; its API must not be reused.
    needsFreshCamera = true;
    retireCameraModel(cameraApi);
    if (cameraStartup && !cameraStartup.settled) {
      cameraStartup.retire = retireCamera(cameraApi, document, window);
    } else releaseCamera(cameraApi, document);
  }
  cameraApi = null;
  gazeHandler = null;
  startButton.disabled = cameraStarting;
  simulateButton.disabled = false;
  recalibrateButton.disabled = true;
  accuracyButton.disabled = true;
  pauseButton.disabled = true;
  pauseButton.textContent = 'Pause tracking';
  pauseButton.setAttribute('aria-pressed', 'false');
  stopButton.disabled = true;
  pageUpButton.disabled = true;
  pageDownButton.disabled = true;
  calibration.classList.add('hidden');
  setStatus('Tracking stopped. Choose a mode to start again.');
}

pauseButton.addEventListener('click', () => {
  if (!trackingMode) return;
  paused = !paused;
  resetTracking(true);
  pauseButton.textContent = paused ? 'Resume tracking' : 'Pause tracking';
  pauseButton.setAttribute('aria-pressed', String(paused));
  pageUpButton.disabled = paused || playground.classList.contains('hidden');
  pageDownButton.disabled = pageUpButton.disabled;
  setStatus(paused ? 'Navigation paused. Camera stays on until Stop tracking.' : 'Tracking resumed. Hold on a target to confirm.');
  if (!calibration.classList.contains('hidden')) {
    renderCalibrationPoint();
    if (paused) setStatus('Calibration paused. Resume tracking to continue.');
  }
});
stopButton.addEventListener('click', stopTracking);
for (const [button, direction] of [[pageUpButton, -1], [pageDownButton, 1]]) {
  button.addEventListener('click', () => {
    if (!trackingMode || paused || playground.classList.contains('hidden')) return;
    window.scrollBy({ top: direction * Math.max(200, (window.innerHeight ?? 800) * .65), behavior: 'auto' });
    resetTracking(true);
  });
}
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && trackingMode && !paused && !pauseButton.disabled) pauseButton.click();
});
accuracyButton.addEventListener('click', () => {
  if (!trackingMode || paused || playground.classList.contains('hidden')) return;
  resetTracking();
  accuracy.start(trackingMode);
});

document.addEventListener('visibilitychange', resetTracking);
window.addEventListener('blur', resetTracking);
window.addEventListener('resize', () => {
  resetTracking();
  if (trackingMode === 'simulation' || cameraReady) beginCalibration();
});
window.addEventListener('scroll', () => resetTracking(true), true);

const dwellChoices = [['dwellDefault', 900], ['dwellSlow', 1500], ['dwellVerySlow', 2500]];
for (const [id, milliseconds] of dwellChoices) {
  document.querySelector(`#${id}`).addEventListener('click', () => {
    if (!dwell.setDwellMs(milliseconds)) return;
    resetTracking(true);
    for (const [choiceId] of dwellChoices) {
      document.querySelector(`#${choiceId}`).setAttribute('aria-pressed', String(choiceId === id));
    }
    document.querySelector('#dwellDuration').textContent = `Hold for ${milliseconds / 1000} seconds to confirm. Look away before confirming again.`;
  });
}

const assistChoices = [['assistOff', 'off'], ['assistStandard', 'standard'], ['assistWide', 'wide']];
const assistDescriptions = {
  off: 'Nearby assist is off. Only the control directly under your gaze can be confirmed.',
  standard: 'Standard nearby assist. Gaze within 48 pixels of one control selects it; similarly close controls are skipped.',
  wide: 'Wide nearby assist. Gaze within 96 pixels of one control selects it; similarly close controls are skipped.',
};
for (const [id, level] of assistChoices) {
  document.querySelector(`#${id}`).addEventListener('click', () => {
    if (assistRadius === ASSIST_RADIUS[level]) return;
    assistRadius = ASSIST_RADIUS[level];
    resetTracking(true);
    for (const [choiceId] of assistChoices) {
      document.querySelector(`#${choiceId}`).setAttribute('aria-pressed', String(choiceId === id));
    }
    document.querySelector('#assistDescription').textContent = assistDescriptions[level];
  });
}

startButton.addEventListener('click', enableCamera);
const keyboard = setupKeyboard(document, () => resetTracking(true));
setupWorkspace(document, () => {
  keyboard.sync();
  resetTracking(true);
}, keyboard.close);
simulateButton.addEventListener('click', enableSimulation);
recalibrateButton.addEventListener('click', () => {
  accuracyButton.disabled = true;
  accuracy.cancel();
  clearFocus();
  beginCalibration();
});

window.addEventListener('beforeunload', stopTracking);
