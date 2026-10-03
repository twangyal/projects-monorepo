import { createDwellTracker } from './dwell.js';
import { resolveTarget } from './resolver.js';
import { setupWorkspace } from './workspace-view.js';

const dwell = createDwellTracker();
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

let currentTarget = null;
let simulationPoint = null;
let simulationFrame = null;
let trackingMode = null;
let calibrationIndex = 0;
let calibrationClicks = 0;
let gazeHandler = null;

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
  if (document.hidden || playground.classList.contains('hidden') ||
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
  dot.addEventListener('click', () => {
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
  setStatus(trackingMode === 'camera' ? 'Gaze tracking active. Look at a target and hold.' : 'Simulation active. Move the pointer over a target and hold.');
}

function enableSimulation() {
  trackingMode = 'simulation';
  document.addEventListener('pointermove', event => {
    simulationPoint = { x: event.clientX, y: event.clientY };
  });
  document.documentElement.addEventListener('pointerleave', resetTracking);
  function sample(now) {
    if (simulationPoint) consumePoint(simulationPoint.x, simulationPoint.y, now);
    simulationFrame = window.requestAnimationFrame(sample);
  }
  simulationFrame = window.requestAnimationFrame(sample);
  simulateButton.disabled = true;
  startButton.disabled = true;
  beginCalibration();
}

async function enableCamera() {
  if (!window.webgazer) {
    setStatus('WebGazer did not load. Try pointer simulation instead.');
    return;
  }
  try {
    trackingMode = 'camera';
    startButton.disabled = true;
    simulateButton.disabled = true;
    gazeHandler = data => {
      if (data) consumePoint(data.x, data.y);
      else resetTracking();
    };
    window.webgazer.setGazeListener(gazeHandler);
    await window.webgazer.begin();
    beginCalibration();
  } catch (error) {
    console.error(error);
    startButton.disabled = false;
    simulateButton.disabled = false;
    setStatus('Camera tracking could not start. Check camera permission or use pointer simulation.');
  }
}

function resetTracking() {
  dwell.reset();
  clearFocus();
  simulationPoint = null;
  cursor.classList.remove('visible');
}

document.addEventListener('visibilitychange', resetTracking);
window.addEventListener('blur', resetTracking);
window.addEventListener('resize', resetTracking);
window.addEventListener('scroll', resetTracking, true);

startButton.addEventListener('click', enableCamera);
setupWorkspace(document, resetTracking);
simulateButton.addEventListener('click', enableSimulation);
recalibrateButton.addEventListener('click', () => {
  clearFocus();
  beginCalibration();
});

window.addEventListener('beforeunload', () => {
  if (simulationFrame !== null) window.cancelAnimationFrame(simulationFrame);
  if (trackingMode === 'camera' && window.webgazer) {
    if (gazeHandler) window.webgazer.clearGazeListener();
    window.webgazer.end();
  }
});
