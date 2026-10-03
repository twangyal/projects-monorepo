const DWELL_MS = 900;
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
let targetStartedAt = 0;
let lastActivatedTarget = null;
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
  targetStartedAt = 0;
  dwellFill.style.width = '0%';
}

function resolveTarget(x, y) {
  const element = document.elementFromPoint(x, y);
  return element?.closest?.('[data-gaze-target]') ?? null;
}

function activate(target) {
  const label = target.textContent.trim();
  target.classList.add('activated');
  window.setTimeout(() => target.classList.remove('activated'), 420);
  result.textContent = `${label} confirmed. In a real integration this would hand off a typed action to the browser controller.`;
  lastActivatedTarget = target;
  window.setTimeout(() => {
    if (lastActivatedTarget === target) lastActivatedTarget = null;
  }, 700);
}

function consumePoint(x, y, now = performance.now()) {
  moveCursor(x, y);
  const target = resolveTarget(x, y);
  if (!target || target === lastActivatedTarget) {
    clearFocus();
    return;
  }

  if (target !== currentTarget) {
    clearFocus();
    currentTarget = target;
    targetStartedAt = now;
    target.classList.add('gaze-focus');
  }

  const progress = Math.min(1, (now - targetStartedAt) / DWELL_MS);
  dwellFill.style.width = `${progress * 100}%`;
  if (progress >= 1) {
    activate(target);
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
  document.addEventListener('pointermove', event => consumePoint(event.clientX, event.clientY));
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
      if (data && !playground.classList.contains('hidden')) consumePoint(data.x, data.y);
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

startButton.addEventListener('click', enableCamera);
simulateButton.addEventListener('click', enableSimulation);
recalibrateButton.addEventListener('click', () => {
  clearFocus();
  beginCalibration();
});

window.addEventListener('beforeunload', () => {
  if (trackingMode === 'camera' && window.webgazer) {
    if (gazeHandler) window.webgazer.clearGazeListener();
    window.webgazer.end();
  }
});
