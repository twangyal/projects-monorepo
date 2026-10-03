import { createDwellTracker } from './dwell.js';
import { resolveTarget } from './resolver.js';
import { setupWorkspace } from './workspace-view.js';
import { setupAccuracyCheck } from './accuracy-view.js';
import { createCameraLoader } from './camera-loader.js';
import { setupKeyboard } from './keyboard.js';
import { resetCameraCalibration, recordCalibrationClick } from './camera-calibration.js';
import { releaseCamera } from './camera-cleanup.js';

const dwell = createDwellTracker();
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
let paused = false;
const pointerHandler = event => {
  if (!paused) simulationPoint = { x: event.clientX, y: event.clientY };
};

function setStatus(message) {
  status.textContent = message;
}

function moveCursor(x, y) {
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  cursor.classList.add('visible');
}

function clearFocus() {
  currentTarget?.classList.remove('gaze-focus');
  currentTarget = null;
  dwellFill.style.width = '0%';
}

function activate(target) {
  const label = target.textContent.trim();
  target.classList.add('activated');
  window.setTimeout(() => target.classList.remove('activated'), 420);
  result.textContent = `${label} confirmed.`;
  target.click();
}

function consumePoint(x, y, now = performance.now()) {
  if (accuracy.active && !paused && trackingMode && !document.hidden) {
    accuracy.sample({ x, y }, now);
    return;
  }
  if (paused || !trackingMode || document.hidden || playground.classList.contains('hidden') ||
      !Number.isFinite(x) || !Number.isFinite(y)) {
    dwell.reset();
    clearFocus();
    cursor.classList.remove('visible');
    return;
  }
  moveCursor(x, y);
  const target = resolveTarget(document, playground, x, y);
  const selection = dwell.update(target, now);
  if (selection.target !== currentTarget) {
    clearFocus();
    currentTarget = selection.target;
    currentTarget?.classList.add('gaze-focus');
  }
  dwellFill.style.width = `${selection.progress * 100}%`;
  if (selection.activated) {
    activate(selection.activated);
    clearFocus();
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
    if (trackingMode === 'camera' && !recordCalibrationClick(window.webgazer, event, dot)) {
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
  accuracyButton.disabled = true;
  accuracy.cancel();
  if (cameraReady) resetCameraCalibration(window.webgazer);
  dwell.reset();
  clearFocus();
  simulationPoint = null;
  cursor.classList.remove('visible');
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
  cameraStarting = true;
  try {
    trackingMode = 'camera';
    startButton.disabled = true;
    simulateButton.disabled = true;
    stopButton.disabled = false;
    setStatus('Loading camera tracking. You may be asked for webcam permission.');
    await loadCamera();
    if (session !== cameraSession) return;
    window.webgazer.saveDataAcrossSessions(false);
    window.webgazer.showPredictionPoints(false);
    const handler = data => {
      if (trackingMode !== 'camera' || gazeHandler !== handler) return;
      if (data) consumePoint(data.x, data.y);
      else resetTracking();
    };
    gazeHandler = handler;
    window.webgazer.setGazeListener(gazeHandler);
    await window.webgazer.begin();
    if (session !== cameraSession) {
      releaseCamera(window.webgazer, document);
      return;
    }
    window.webgazer.removeMouseEventListeners();
    cameraReady = true;
    pauseButton.disabled = false;
    stopButton.disabled = false;
    beginCalibration();
  } catch (error) {
    if (session === cameraSession) {
      console.error(error);
      stopTracking();
      setStatus('Camera tracking could not start. Check camera permission or use pointer simulation.');
    } else if (window.webgazer) releaseCamera(window.webgazer, document);
  } finally {
    cameraStarting = false;
    startButton.disabled = trackingMode !== null;
  }
}

function resetTracking(preserveConfirmation = false) {
  accuracy.cancel();
  dwell.reset({ preserveConfirmation: preserveConfirmation === true });
  clearFocus();
  simulationPoint = null;
  cursor.classList.remove('visible');
}

function stopTracking() {
  const wasCamera = trackingMode === 'camera';
  cameraSession++;
  trackingMode = null;
  cameraReady = false;
  paused = false;
  resetTracking();
  if (simulationFrame !== null) window.cancelAnimationFrame(simulationFrame);
  simulationFrame = null;
  document.removeEventListener('pointermove', pointerHandler);
  document.documentElement.removeEventListener('pointerleave', resetTracking);
  if (wasCamera && window.webgazer) {
    releaseCamera(window.webgazer, document);
  }
  gazeHandler = null;
  startButton.disabled = cameraStarting;
  simulateButton.disabled = false;
  recalibrateButton.disabled = true;
  accuracyButton.disabled = true;
  pauseButton.disabled = true;
  pauseButton.textContent = 'Pause tracking';
  stopButton.disabled = true;
  calibration.classList.add('hidden');
  setStatus('Tracking stopped. Choose a mode to start again.');
}

pauseButton.addEventListener('click', () => {
  if (!trackingMode) return;
  paused = !paused;
  resetTracking();
  pauseButton.textContent = paused ? 'Resume tracking' : 'Pause tracking';
  setStatus(paused ? 'Navigation paused. Camera stays on until Stop tracking.' : 'Tracking resumed. Hold on a target to confirm.');
  if (!calibration.classList.contains('hidden')) {
    renderCalibrationPoint();
    if (paused) setStatus('Calibration paused. Resume tracking to continue.');
  }
});
stopButton.addEventListener('click', stopTracking);
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

startButton.addEventListener('click', enableCamera);
const keyboard = setupKeyboard(document, () => resetTracking(true));
setupWorkspace(document, () => {
  keyboard.sync();
  resetTracking(true);
});
simulateButton.addEventListener('click', enableSimulation);
recalibrateButton.addEventListener('click', () => {
  accuracyButton.disabled = true;
  accuracy.cancel();
  clearFocus();
  beginCalibration();
});

window.addEventListener('beforeunload', stopTracking);
