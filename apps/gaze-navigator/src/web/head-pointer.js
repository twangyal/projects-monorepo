// Head pointer: the circle follows where the head points rather than where the eyes look. Webcam eye tracking often
// lands 100-200 px from the target; turning the head is coarser work but steadier, which suits people who can turn
// their head comfortably. The camera's face model (MediaPipe FaceMesh, through WebGazer) already finds the face's
// landmarks in every frame; the nose tip's place relative to the eye corners says how the head is turned, and the
// eyes' place in the picture where the head is. Calibration and used controls pair those with screen points, and a
// ridge regression maps one to the other.

// FaceMesh landmark indices: nose tip and the outer corners of the eyes (the subject's right eye, then left).
const NOSE = 1, RIGHT_EYE = 33, LEFT_EYE = 263;
/** Samples needed before the pointer is placed, and the most kept (the oldest give way to used controls). */
export const MIN_HEAD_SAMPLES = 6, MAX_HEAD_SAMPLES = 200;
// The ridge penalty per sample, on the head's turn and tilt in standard deviations and on its place in the picture in
// tenths of the picture: a calibration where the head stayed put cannot give its place a large weight.
const RIDGE = 0.002, PLACE_UNIT = 0.1;

/**
 * The head's pose in one frame from FaceMesh landmarks (`positions`, [x, y, z] in video pixels) in a `width` by
 * `height` picture: [turn, tilt, x, y]. Turn and tilt are the nose tip's offset from between the eyes, along and across
 * the line through the eyes, in eye widths, so leaning the head sideways does not move the pointer; x and y are where
 * the eyes are in the picture (0 to 1). Null when the landmarks are missing or implausible.
 */
export function headFeatures(positions, width = 640, height = 480) {
  if (!Array.isArray(positions) || positions.length <= LEFT_EYE || !(width > 0) || !(height > 0)) return null;
  const point = index => { const p = positions[index]; return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null; };
  const nose = point(NOSE), right = point(RIGHT_EYE), left = point(LEFT_EYE);
  if (!nose || !right || !left) return null;
  const ex = left[0] - right[0], ey = left[1] - right[1], span = Math.hypot(ex, ey);
  if (span < 4) return null;
  const mx = (left[0] + right[0]) / 2, my = (left[1] + right[1]) / 2, dx = nose[0] - mx, dy = nose[1] - my;
  return [(dx * ex + dy * ey) / span / span, (dy * ex - dx * ey) / span / span, mx / width, my / height];
}

/** Solves the square system `a`·w = `b` by Gaussian elimination with partial pivoting; null when it is singular. */
function solve(a, b) {
  const n = b.length, m = a.map((row, i) => [...row, b[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(m[row][column]) > Math.abs(m[pivot][column])) pivot = row;
    if (Math.abs(m[pivot][column]) < 1e-12) return null;
    [m[column], m[pivot]] = [m[pivot], m[column]];
    for (let row = column + 1; row < n; row++) {
      const factor = m[row][column] / m[column][column];
      for (let k = column; k <= n; k++) m[row][k] -= factor * m[column][k];
    }
  }
  const w = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row][n];
    for (let k = row + 1; k < n; k++) sum -= m[row][k] * w[k];
    w[row] = sum / m[row][row];
  }
  return w;
}

/**
 * Pairs of head pose and screen point, and the map between them: a ridge regression on the pose (see RIDGE).
 */
export function createHeadModel() {
  let samples = [];
  let fitted = null;

  function fit() {
    fitted = null;
    if (samples.length < MIN_HEAD_SAMPLES) return;
    const count = samples.length, size = samples[0].features.length;
    const mean = Array.from({ length: size }, (_, k) => samples.reduce((sum, s) => sum + s.features[k], 0) / count);
    const scale = Array.from({ length: size }, (_, k) => k >= 2 ? PLACE_UNIT : Math.sqrt(samples.reduce((sum, s) => sum + (s.features[k] - mean[k]) ** 2, 0) / count) || 1);
    const rows = samples.map(s => [...s.features.map((value, k) => (value - mean[k]) / scale[k]), 1]);
    const width = size + 1, normal = Array.from({ length: width }, () => new Array(width).fill(0));
    for (const row of rows) for (let i = 0; i < width; i++) for (let j = 0; j < width; j++) normal[i][j] += row[i] * row[j];
    // The constant term is not shrunk.
    for (let i = 0; i < size; i++) normal[i][i] += RIDGE * count;
    const weights = ['x', 'y'].map(axis => solve(normal, Array.from({ length: width }, (_, i) => rows.reduce((sum, row, n) => sum + row[i] * samples[n][axis], 0))));
    if (weights.every(Boolean)) fitted = { mean, scale, weights };
  }

  const valid = features => Array.isArray(features) && features.length === 4 && features.every(Number.isFinite);
  return {
    /** One pose paired with the screen point the head pointed at; false when there was no pose. */
    add(features, x, y) {
      if (!valid(features) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      samples.push({ features: [...features], x, y });
      if (samples.length > MAX_HEAD_SAMPLES) samples = samples.slice(-MAX_HEAD_SAMPLES);
      fit();
      return true;
    },
    /** Where a pose points on the screen, or null before enough calibration. */
    predict(features) {
      if (!fitted || !valid(features)) return null;
      const row = [...features.map((value, k) => (value - fitted.mean[k]) / fitted.scale[k]), 1];
      const [x, y] = fitted.weights.map(w => row.reduce((sum, value, i) => sum + value * w[i], 0));
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    },
    clear() { samples = []; fitted = null; },
    get size() { return samples.length; },
    /** The samples as plain data, for saving a calibration. */
    get samples() { return samples.map(({ features, x, y }) => ({ features: [...features], x, y })); },
    /** Replaces the samples with saved ones; false when any is malformed (nothing changes then). */
    setSamples(list) {
      if (!Array.isArray(list) || !list.every(s => valid(s?.features) && Number.isFinite(s?.x) && Number.isFinite(s?.y))) return false;
      samples = list.slice(-MAX_HEAD_SAMPLES).map(({ features, x, y }) => ({ features: [...features], x, y }));
      fit();
      return true;
    },
  };
}
