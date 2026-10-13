import type { Plane, Raster } from './types.ts';

/**
 * Preparation and interpretation of learned monocular depth (Depth Anything V2 Small).
 *
 * The model returns *relative inverse depth*: larger means nearer, with an unknown scale and offset
 * per photo. Values here are therefore normalized display positions (0 farthest, 1 nearest), never
 * distances. They only propose which of the three editable planes a pixel belongs to.
 */
export const MODEL_SIDE = 518;
export const PATCH = 14;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** DPT "lower bound" resize: keep aspect, shorter side at least 518, both sides multiples of 14. */
export function modelSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Use a decoded photo with positive dimensions.');
  const scale = MODEL_SIDE / Math.min(width, height);
  const fit = (value: number): number => {
    let size = Math.round(value * scale / PATCH) * PATCH;
    if (size < MODEL_SIDE) size = Math.ceil(value * scale / PATCH) * PATCH;
    return Math.max(PATCH, size);
  };
  return { width: fit(width), height: fit(height) };
}

/** Antialiased separable linear resampling weights from `source` to `target` samples. */
function weights(source: number, target: number): { start: Int32Array; count: Int32Array; values: Float32Array; stride: number } {
  const scale = source / target, support = Math.max(1, scale), stride = Math.ceil(support * 2) + 2;
  const start = new Int32Array(target), count = new Int32Array(target), values = new Float32Array(target * stride);
  for (let i = 0; i < target; i++) {
    const center = (i + 0.5) * scale - 0.5;
    const first = Math.max(0, Math.floor(center - support) + 1), last = Math.min(source - 1, Math.ceil(center + support) - 1);
    let total = 0, n = 0;
    for (let j = first; j <= last && n < stride; j++, n++) {
      const w = Math.max(0, 1 - Math.abs(j - center) / support);
      values[i * stride + n] = w; total += w;
    }
    if (total <= 0) { // Degenerate edge: take the nearest source sample.
      values[i * stride] = 1; start[i] = Math.min(source - 1, Math.max(0, Math.round(center))); count[i] = 1; continue;
    }
    for (let k = 0; k < n; k++) values[i * stride + k] /= total;
    start[i] = first; count[i] = n;
  }
  return { start, count, values, stride };
}

/** Resample `channels` interleaved float channels. */
function resample(data: Float32Array, width: number, height: number, channels: number, toWidth: number, toHeight: number): Float32Array {
  const horizontal = weights(width, toWidth), vertical = weights(height, toHeight);
  const rows = new Float32Array(toWidth * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < toWidth; x++) {
      const base = horizontal.start[x]!, n = horizontal.count[x]!;
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let k = 0; k < n; k++) sum += data[((y * width) + base + k) * channels + c]! * horizontal.values[x * horizontal.stride + k]!;
        rows[(y * toWidth + x) * channels + c] = sum;
      }
    }
  }
  const out = new Float32Array(toWidth * toHeight * channels);
  for (let y = 0; y < toHeight; y++) {
    const base = vertical.start[y]!, n = vertical.count[y]!;
    for (let x = 0; x < toWidth; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let k = 0; k < n; k++) sum += rows[((base + k) * toWidth + x) * channels + c]! * vertical.values[y * vertical.stride + k]!;
        out[(y * toWidth + x) * channels + c] = sum;
      }
    }
  }
  return out;
}

/** The normalized photo as the model's planar float input (alpha composited over black). */
export function modelInput(raster: Raster): { data: Float32Array; width: number; height: number } {
  const size = modelSize(raster.width, raster.height), pixels = raster.width * raster.height;
  const rgb = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const alpha = raster.rgba[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = raster.rgba[i * 4 + c]! / 255 * alpha;
  }
  const scaled = resample(rgb, raster.width, raster.height, 3, size.width, size.height), plane = size.width * size.height;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) data[c * plane + i] = (scaled[i * 3 + c]! - MEAN[c]!) / STD[c]!;
  return { data, width: size.width, height: size.height };
}

/** Model output back at photo resolution, mapped so the 1st–99th percentiles span 0 (far) to 1 (near). */
export function photoDepth(raw: Float32Array, width: number, height: number, photoWidth: number, photoHeight: number): Float32Array {
  if (raw.length !== width * height) throw new Error('The depth output does not match its declared size.');
  for (let i = 0; i < raw.length; i++) if (!Number.isFinite(raw[i]!)) throw new Error('The depth model produced invalid values.');
  const field = resample(raw, width, height, 1, photoWidth, photoHeight);
  const sorted = Float32Array.from(field).sort();
  const low = sorted[Math.floor((sorted.length - 1) * 0.01)]!, high = sorted[Math.ceil((sorted.length - 1) * 0.99)]!;
  const span = high - low;
  if (!(span > 1e-6)) throw new Error('The depth model found no depth variation in this photo.');
  for (let i = 0; i < field.length; i++) field[i] = Math.min(1, Math.max(0, (field[i]! - low) / span));
  return field;
}

/** The depth value below which the given share of pixels lies. */
export function quantile(depth: Float32Array, share: number): number {
  const sorted = Float32Array.from(depth).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * share)))]!;
}

export interface Thresholds { farBelow: number; nearAbove: number }

/** A starting split: the farthest half is far, the nearest 5% is near, the rest is the subject plane. */
export function defaultThresholds(depth: Float32Array): Thresholds {
  return { farBelow: round(quantile(depth, 0.5)), nearAbove: round(Math.max(quantile(depth, 0.95), quantile(depth, 0.5) + 0.02)) };
}

/** Subject band centred on a picked point: everything clearly nearer is near, clearly farther is far. */
export function thresholdsAround(value: number, halfWidth = 0.12): Thresholds {
  return { farBelow: round(Math.max(0, value - halfWidth)), nearAbove: round(Math.min(1, value + halfWidth)) };
}

function round(value: number): number { return Math.round(value * 1000) / 1000; }

export function validThresholds(t: Thresholds): boolean {
  return Number.isFinite(t.farBelow) && Number.isFinite(t.nearAbove) && t.farBelow >= 0 && t.nearAbove <= 1 && t.farBelow < t.nearAbove;
}

/** Proposed plane per pixel: near (0) at or above `nearAbove`, far (2) below `farBelow`, otherwise subject (1). */
export function proposePlanes(depth: Float32Array, t: Thresholds): Uint8Array {
  if (!validThresholds(t)) throw new Error('Keep the far limit below the near limit, both between 0 and 1.');
  const labels = new Uint8Array(depth.length);
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    labels[i] = (d >= t.nearAbove ? 0 : d < t.farBelow ? 2 : 1) satisfies Plane;
  }
  return labels;
}

export function planeShares(labels: Uint8Array): [number, number, number] {
  const counts = [0, 0, 0];
  for (const label of labels) counts[label]!++;
  return counts.map(count => count / Math.max(1, labels.length)) as [number, number, number];
}
