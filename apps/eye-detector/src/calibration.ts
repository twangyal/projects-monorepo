export interface Point { x: number; y: number }
export interface Sample { features: number[]; point: Point }
export interface Calibration {
  means: number[];
  scales: number[];
  weights: number[][];
  error: number;
}

const finite = (values: number[]) => values.every(Number.isFinite);
const vector = (features: number[], model: Pick<Calibration, 'means' | 'scales'>) =>
  [1, ...features.map((value, i) => (value - model.means[i]) / model.scales[i])];
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

function solve(matrix: number[][], values: number[]): number[] {
  const rows = matrix.map((row, i) => [...row, values[i]]);
  for (let col = 0; col < values.length; col++) {
    let pivot = col;
    for (let row = col + 1; row < rows.length; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    if (Math.abs(divisor) < 1e-10) throw new Error('Calibration could not be fitted. Try again.');
    rows[col] = rows[col].map(value => value / divisor);
    for (let row = 0; row < rows.length; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      rows[row] = rows[row].map((value, i) => value - factor * rows[col][i]);
    }
  }
  return rows.map(row => row[values.length]);
}

export function fitCalibration(samples: Sample[]): Calibration {
  if (samples.some(s => s.features.length !== 4 || !finite([...s.features, s.point.x, s.point.y]) ||
    s.point.x < 0 || s.point.x > 1 || s.point.y < 0 || s.point.y > 1)) {
    throw new Error('Invalid calibration observations.');
  }
  const counts = new Map<string, number>();
  samples.forEach(s => {
    const key = `${s.point.x},${s.point.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  if (counts.size < 9 || [...counts.values()].some(count => count < 3)) {
    throw new Error('Look at all nine points with at least three observations each.');
  }
  const means = [0, 1, 2, 3].map(i => samples.reduce((sum, s) => sum + s.features[i], 0) / samples.length);
  const deviations = means.map((mean, i) => Math.sqrt(samples.reduce((sum, s) =>
    sum + (s.features[i] - mean) ** 2, 0) / samples.length));
  if (deviations[0] < 0.003 || deviations[1] < 0.003) {
    throw new Error('Not enough eye movement. Keep your head still and follow each point.');
  }
  const scales = deviations.map(value => Math.max(value, 0.02));
  const vectors = samples.map(s => vector(s.features, { means, scales }));
  const matrix = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) =>
    vectors.reduce((sum, v) => sum + v[i] * v[j], 0) + (i === j ? 0.001 : 0)));
  const weights = (['x', 'y'] as const).map(axis => solve(matrix,
    [0, 1, 2, 3, 4].map(i => samples.reduce((sum, s, j) => sum + vectors[j][i] * s.point[axis], 0))));
  const error = Math.sqrt(samples.reduce((sum, s, i) => sum +
    (dot(vectors[i], weights[0]) - s.point.x) ** 2 +
    (dot(vectors[i], weights[1]) - s.point.y) ** 2, 0) / samples.length);
  if (!Number.isFinite(error) || error > 0.12) {
    throw new Error('Calibration fit is too imprecise. Improve lighting and try again.');
  }
  return { means, scales, weights, error };
}

export function predictGaze(model: Calibration, features: number[]): Point | null {
  if (features.length !== 4 || !finite(features)) return null;
  const v = vector(features, model);
  const [x, y] = model.weights.map(weights => dot(v, weights));
  if (!finite([x, y]) || x < -0.15 || x > 1.15 || y < -0.15 || y > 1.15) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/** MediaPipe refined Face Mesh: iris position within each eye, plus face position. */
export function eyeFeatures(mesh: Point[]): number[] | null {
  if (mesh.length < 478 || !mesh.every(p => finite([p.x, p.y]))) return null;
  const eyes = [[33, 133, 159, 145, 468], [362, 263, 386, 374, 473]].map(([a, b, top, bottom, iris]) => {
    const width = Math.abs(mesh[b].x - mesh[a].x);
    const height = Math.abs(mesh[bottom].y - mesh[top].y);
    if (width < 0.01 || height / width < 0.12) return null;
    return [(mesh[iris].x - Math.min(mesh[a].x, mesh[b].x)) / width,
      (mesh[iris].y - Math.min(mesh[top].y, mesh[bottom].y)) / height];
  });
  if (!eyes[0] || !eyes[1]) return null;
  return [(eyes[0][0] + eyes[1][0]) / 2, (eyes[0][1] + eyes[1][1]) / 2, mesh[1].x, mesh[1].y];
}
