// Camera gaze from the irises. The camera's face model (MediaPipe FaceMesh, through WebGazer) finds each iris as well
// as the face's landmarks. Where each iris sits between its eye's corners and lids, with the head's turn, tilt and
// place in the picture (head-pointer.js), says where the eyes point. Calibration and used controls pair those with
// screen points, and a ridge regression maps one to the other. On real laptop webcam pictures of 15 people
// (MPIIFaceGaze) it landed a median of 58 mm from the looked-at point. WebGazer's own regression on eye-patch pixels
// landed 81 mm, because it fits its few calibration samples too closely.
import { headFeatures } from './head-pointer.js';

// FaceMesh landmark indices: each eye's outer corner, inner corner, upper lid and lower lid (the subject's right eye,
// then left), and the two iris centres the iris model adds after the 468 mesh points.
const RIGHT_EYE = [33, 133, 159, 145], LEFT_EYE = [263, 362, 386, 374], IRISES = [468, 473];
/** Samples needed before the irises place the gaze (one a calibration point), and the most kept (the oldest give way). */
export const MIN_IRIS_SAMPLES = 9, MAX_IRIS_SAMPLES = 200;
// Ridge penalties per sample, on features in standard deviations; the one that best predicts each sample from the
// others is used, so a few samples are fitted cautiously and many closely.
const PENALTIES = [0.001, 0.01, 0.1, 1];
// The head is taken to have moved away from where it was calibrated when its turn, tilt or place is more than
// MOVED_SPREAD times the calibration's own spread from the calibration's average; a still calibration counts as
// having spread at least HEAD_FLOOR (eye widths for turn and tilt, the picture's size for place).
export const MOVED_SPREAD = 3;
const HEAD = [6, 7, 8, 9], HEAD_FLOOR = [0.08, 0.08, 0.04, 0.04];

/**
 * The eyes' pose in one frame from FaceMesh landmarks with irises (`positions`, [x, y, z] in video pixels, at least
 * 478 of them) in a `width` by `height` picture: for each eye, the iris's place along the line between the corners and
 * across it, in eye widths, and how open the eye is; then the head's pose (headFeatures). Null when the irises or
 * any landmark used are missing or implausible.
 */
export function irisFeatures(positions, width = 640, height = 480) {
  if (!Array.isArray(positions) || positions.length < 478) return null;
  const point = index => { const p = positions[index]; return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null; };
  const irises = IRISES.map(point);
  if (!irises.every(Boolean)) return null;
  const eye = ([outer, inner, upper, lower]) => {
    const a = point(outer), b = point(inner), up = point(upper), down = point(lower);
    if (!a || !b || !up || !down) return null;
    const ex = b[0] - a[0], ey = b[1] - a[1], span = Math.hypot(ex, ey);
    if (span < 4) return null;
    const ux = ex / span, uy = ey / span, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    // The iris nearer this eye's middle is its own, whichever order the model gives them in.
    const c = irises.reduce((best, p) => Math.hypot(p[0] - mx, p[1] - my) < Math.hypot(best[0] - mx, best[1] - my) ? p : best);
    return [((c[0] - a[0]) * ux + (c[1] - a[1]) * uy) / span, ((c[1] - my) * ux - (c[0] - mx) * uy) / span, Math.hypot(up[0] - down[0], up[1] - down[1]) / span];
  };
  const right = eye(RIGHT_EYE), left = eye(LEFT_EYE), head = headFeatures(positions, width, height);
  return right && left && head ? [...right, ...left, ...head] : null;
}

/** The inverse of a small square matrix by Gauss-Jordan elimination with partial pivoting; null when it is singular. */
function invert(matrix) {
  const n = matrix.length, m = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(m[row][column]) > Math.abs(m[pivot][column])) pivot = row;
    if (Math.abs(m[pivot][column]) < 1e-12) return null;
    [m[column], m[pivot]] = [m[pivot], m[column]];
    const scale = m[column][column];
    for (let k = 0; k < 2 * n; k++) m[column][k] /= scale;
    for (let row = 0; row < n; row++) if (row !== column) {
      const factor = m[row][column];
      if (factor) for (let k = 0; k < 2 * n; k++) m[row][k] -= factor * m[column][k];
    }
  }
  return m.map(row => row.slice(n));
}

const median = values => { const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };

/** Pairs of eye pose and screen point, and the map between them: a ridge regression on the pose (see PENALTIES). */
export function createIrisModel() {
  let samples = [];
  let fitted = null;

  function fit() {
    fitted = null;
    if (samples.length < MIN_IRIS_SAMPLES) return;
    const count = samples.length, size = samples[0].features.length;
    const mean = Array.from({ length: size }, (_, k) => samples.reduce((sum, s) => sum + s.features[k], 0) / count);
    const spread = Array.from({ length: size }, (_, k) => Math.sqrt(samples.reduce((sum, s) => sum + (s.features[k] - mean[k]) ** 2, 0) / count));
    const scale = spread.map(value => value || 1);
    const rows = samples.map(s => [...s.features.map((value, k) => (value - mean[k]) / scale[k]), 1]);
    const width = size + 1, gram = Array.from({ length: width }, () => new Array(width).fill(0));
    for (const row of rows) for (let i = 0; i < width; i++) for (let j = 0; j < width; j++) gram[i][j] += row[i] * row[j];
    const targets = ['x', 'y'].map(axis => Array.from({ length: width }, (_, i) => rows.reduce((sum, row, n) => sum + row[i] * samples[n][axis], 0)));
    let best = null;
    for (const penalty of PENALTIES) {
      // The constant term is not shrunk.
      const inverse = invert(gram.map((row, i) => row.map((value, j) => value + (i === j && i < size ? penalty * count : 0))));
      if (!inverse) continue;
      const weights = targets.map(target => inverse.map(row => row.reduce((sum, value, j) => sum + value * target[j], 0)));
      // Each sample as predicted without it (the ridge's leave-one-out residual), at once.
      const errors = rows.map((row, n) => {
        const leverage = row.reduce((sum, value, i) => sum + value * inverse[i].reduce((inner, w, j) => inner + w * row[j], 0), 0);
        const residual = weights.map((w, axis) => row.reduce((sum, value, i) => sum + value * w[i], 0) - samples[n][axis ? 'y' : 'x']);
        return Math.hypot(...residual) / Math.max(1e-6, 1 - leverage);
      });
      const score = median(errors);
      if (Number.isFinite(score) && (!best || score < best.score)) best = { score, weights };
    }
    if (best) fitted = { mean, scale, spread, weights: best.weights };
  }

  const valid = features => Array.isArray(features) && features.length === 10 && features.every(Number.isFinite);
  return {
    /** One eye pose paired with the screen point the eyes were on; false when there was no pose. */
    add(features, x, y) {
      if (!valid(features) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      samples.push({ features: [...features], x, y });
      if (samples.length > MAX_IRIS_SAMPLES) samples = samples.slice(-MAX_IRIS_SAMPLES);
      fit();
      return true;
    },
    /** Where an eye pose looks on the screen, or null before enough calibration. */
    predict(features) {
      if (!fitted || !valid(features)) return null;
      const row = [...features.map((value, k) => (value - fitted.mean[k]) / fitted.scale[k]), 1];
      const [x, y] = fitted.weights.map(w => row.reduce((sum, value, i) => sum + value * w[i], 0));
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    },
    /** How far a pose's head is from where it was in calibration, in spreads (see MOVED_SPREAD); 0 before calibration. */
    offset(features) {
      if (!fitted || !valid(features)) return 0;
      return Math.max(...HEAD.map((k, i) => Math.abs(features[k] - fitted.mean[k]) / Math.max(fitted.spread[k], HEAD_FLOOR[i])));
    },
    clear() { samples = []; fitted = null; },
    get size() { return samples.length; },
    get ready() { return fitted !== null; },
    /** The samples as plain data, for saving a calibration. */
    get samples() { return samples.map(({ features, x, y }) => ({ features: [...features], x, y })); },
    /** Replaces the samples with saved ones; false when any is malformed (nothing changes then). */
    setSamples(list) {
      if (!Array.isArray(list) || !list.every(s => valid(s?.features) && Number.isFinite(s?.x) && Number.isFinite(s?.y))) return false;
      samples = list.slice(-MAX_IRIS_SAMPLES).map(({ features, x, y }) => ({ features: [...features], x, y }));
      fit();
      return true;
    },
  };
}
