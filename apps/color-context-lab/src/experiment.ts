import type { Raster } from './types.ts';

export type Arm = 'neutral' | 'correlated' | 'independent';
export type Preprocess = 'raw' | 'mask';
export type Suite = 'neutral' | 'matched' | 'shifted' | 'independent';
export type ModelSeed = 1729 | 2718 | 3141;
export interface ModelResult {
  seed: ModelSeed; arm: Arm; training: Preprocess;
  coefficientHash: string; iterations: 200; fitSeconds: number;
  development: { predictions: number[]; confusion: number[][]; accuracy: number; balancedAccuracy: number };
}
export interface Evaluation {
  seed: ModelSeed; arm: Arm; training: Preprocess; suite: Suite; preprocessing: Preprocess;
  predictions: number[]; confusion: number[][]; accuracy: number; balancedAccuracy: number;
  flipFraction: number; baselineDifference: number;
}
export interface ExperimentReport {
  schemaVersion: 1; protocol: 'context-shapes-v1';
  status: 'not-run' | 'inconclusive' | 'complete' | 'error';
  provenance: string; protocolHash: string | null; generatorHash: string | null; manifestHash: string | null;
  environment: { python: string; numpy: string; pillow: string; sklearn: string; scipy: string;
    platform: string; threadLimit: 1; numericLibraries: string } | null;
  readiness: { status: 'pending' | 'pass' | 'fail'; minimum: 0.8;
    neutralDevelopment: { seed: ModelSeed; balancedAccuracy: number }[]; reason: string | null };
  testSamples: { id: string; label: 0 | 1 | 2 | 3 }[];
  examples: { sampleId: string; label: 0 | 1 | 2 | 3; centerRgb: string }[];
  models: ModelResult[]; evaluations: Evaluation[]; limitations: string[]; error: string | null;
}

const seeds = [1729, 2718, 3141] as const;
const arms = ['neutral', 'correlated', 'independent'] as const;
const trainingModes = ['raw', 'mask'] as const;
const suites = ['neutral', 'matched', 'shifted', 'independent'] as const;
const palette = [[152, 128, 128], [104, 128, 128], [128, 152, 128], [128, 104, 128]] as const;
const fail = (): never => { throw new Error('Invalid or inconsistent procedural experiment report.'); };
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail();
  }
  return value as Record<string, unknown>;
}
function array(value: unknown, max: number, exact?: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || (exact !== undefined && value.length !== exact)) return fail();
  if (Reflect.ownKeys(value).length !== value.length + 1) return fail();
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) return fail();
  }
  return value;
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max * 2) return fail();
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit < 32 || (unit >= 127 && unit <= 159)) return fail();
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return fail();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return fail();
    if (++count > max) return fail();
  }
  return value;
}
function number(value: unknown, min = 0, max = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail();
  return value;
}
function equal(actual: unknown, expected: unknown): void { if (actual !== expected) fail(); }
function metric(actual: unknown, expected: number): void { if (Math.abs(number(actual, -1, 1) - expected) > 1e-12) fail(); }
function hash(value: unknown): void { if (typeof value !== 'string' || !/^[a-f0-9]{64}$(?![\s\S])/.test(value)) fail(); }
function parseStrict(text: string): unknown {
  if (typeof text !== 'string' || text.length > 524288 || new TextEncoder().encode(text).length > 524288) return fail();
  let pos = 0;
  const skip = () => { while (pos < text.length && /[\t\r\n ]/.test(text[pos]!)) pos++; };
  function quoted(): string {
    const start = pos++;
    let done = false;
    while (pos < text.length) {
      const c = text[pos++];
      if (c === '\\') pos++;
      else if (c === '"') { done = true; break; }
    }
    if (!done) return fail();
    let result: unknown;
    try { result = JSON.parse(text.slice(start, pos)); } catch { return fail(); }
    // All JSON strings, including unknown fields, have the same Unicode policy.
    if (typeof result !== 'string') return fail();
    if (result.length > 0) string(result, 524288);
    return result;
  }
  function value(depth: number): unknown {
    if (depth > 16) return fail();
    skip(); const c = text[pos];
    if (c === '"') return quoted();
    if (c === '{') {
      pos++; skip(); const result: Record<string, unknown> = {}; const seen = new Set<string>();
      if (text[pos] === '}') { pos++; return result; }
      while (true) {
        skip(); if (text[pos] !== '"') return fail();
        const key = quoted(); if (seen.has(key)) return fail(); seen.add(key);
        skip(); if (text[pos++] !== ':') return fail();
        Object.defineProperty(result, key, { value: value(depth + 1), enumerable: true, configurable: true, writable: true });
        skip(); const delimiter = text[pos++]; if (delimiter === '}') return result; if (delimiter !== ',') return fail();
      }
    }
    if (c === '[') {
      pos++; skip(); const result: unknown[] = [];
      if (text[pos] === ']') { pos++; return result; }
      while (true) { result.push(value(depth + 1)); skip(); const delimiter = text[pos++]; if (delimiter === ']') return result; if (delimiter !== ',') return fail(); }
    }
    const token = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(pos));
    if (!token) return fail(); pos += token[0].length;
    const parsed: unknown = JSON.parse(token[0]);
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) return fail();
    return parsed;
  }
  const result = value(0); skip(); if (pos !== text.length) return fail(); return result;
}
function predictions(value: unknown, count: number): number[] {
  return array(value, count, count).map(p => { const n = number(p, 0, 3); if (!Number.isInteger(n)) return fail(); return n; });
}
function derived(record: Record<string, unknown>, count: number): { predictions: number[]; balancedAccuracy: number } {
  const list = predictions(record.predictions, count);
  const expected = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (let i = 0; i < count; i++) expected[Math.floor(i / (count / 4))]![list[i]!]!++;
  const confusion = array(record.confusion, 4, 4);
  for (let i = 0; i < 4; i++) {
    const row = array(confusion[i], 4, 4);
    for (let j = 0; j < 4; j++) equal(row[j], expected[i]![j]);
  }
  const accuracy = expected.reduce((sum, row, i) => sum + row[i]!, 0) / count;
  metric(record.accuracy, accuracy); metric(record.balancedAccuracy, accuracy);
  return { predictions: list, balancedAccuracy: accuracy };
}
function centerBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length !== 2304 || !/^[A-Za-z0-9+/]{2304}$(?![\s\S])/.test(value)) return fail();
  let decoded: string;
  try { decoded = atob(value); } catch { return fail(); }
  if (decoded.length !== 1728 || btoa(decoded) !== value) return fail();
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
function validate(value: unknown): ExperimentReport {
  const root = object(value, ['schemaVersion', 'protocol', 'status', 'provenance', 'protocolHash', 'generatorHash', 'manifestHash', 'environment', 'readiness', 'testSamples', 'examples', 'models', 'evaluations', 'limitations', 'error']);
  equal(root.schemaVersion, 1); equal(root.protocol, 'context-shapes-v1');
  if (!['not-run', 'inconclusive', 'complete', 'error'].includes(root.status as string)) return fail();
  string(root.provenance, 1000);
  const limitations = array(root.limitations, 12); if (limitations.length === 0) return fail(); limitations.forEach(v => string(v, 1000));
  const readiness = object(root.readiness, ['status', 'minimum', 'neutralDevelopment', 'reason']);
  equal(readiness.minimum, 0.8);
  if (!['pending', 'pass', 'fail'].includes(readiness.status as string)) return fail();
  if (readiness.reason !== null) string(readiness.reason, 1000);
  if (root.error !== null) string(root.error, 1000);
  const models = array(root.models, 18);
  const evaluations = array(root.evaluations, 108);
  const samples = array(root.testSamples, 640);
  const examples = array(root.examples, 4);
  const readinessRows = array(readiness.neutralDevelopment, 3);
  if (root.status === 'not-run') {
    for (const key of ['protocolHash', 'generatorHash', 'manifestHash', 'environment', 'error']) equal(root[key], null);
    equal(readiness.status, 'pending'); equal(readiness.reason, null);
    if (models.length || evaluations.length || samples.length || examples.length || readinessRows.length) return fail();
    return value as ExperimentReport;
  }
  const availableHashes = ['protocolHash', 'generatorHash', 'manifestHash'].filter(key => root[key] !== null);
  availableHashes.forEach(key => hash(root[key]));
  if (root.status !== 'error' && availableHashes.length !== 3) return fail();
  if (root.environment !== null) {
    const env = object(root.environment, ['python', 'numpy', 'pillow', 'sklearn', 'scipy', 'platform', 'threadLimit', 'numericLibraries']);
    for (const key of ['python', 'numpy', 'pillow', 'sklearn', 'scipy']) string(env[key], 64);
    if (!/^3\.12\.\d+$(?![\s\S])/.test(env.python as string)) return fail();
    equal(env.numpy, '2.3.5'); equal(env.pillow, '12.3.0'); equal(env.sklearn, '1.8.0'); equal(env.scipy, '1.17.0'); equal(env.threadLimit, 1);
    string(env.platform, 256); string(env.numericLibraries, 4096);
  } else if (root.status !== 'error') return fail();
  if ((models.length || examples.length || evaluations.length) && (availableHashes.length !== 3 || root.environment === null)) return fail();
  if (examples.length !== 0 && examples.length !== 4) return fail();
  examples.forEach((v, i) => { const e = object(v, ['sampleId', 'label', 'centerRgb']); equal(e.label, i); equal(e.sampleId, `development-c${i}-f000-v0`); centerBytes(e.centerRgb); });
  if (models.length && examples.length !== 4) return fail();
  const modelTuples = seeds.flatMap(seed => arms.flatMap(arm => trainingModes.map(training => ({ seed, arm, training }))));
  const neutralMetrics = new Map<number, number>();
  models.forEach((v, i) => {
    const m = object(v, ['seed', 'arm', 'training', 'coefficientHash', 'iterations', 'fitSeconds', 'development']);
    const tuple = modelTuples[i]!; equal(m.seed, tuple.seed); equal(m.arm, tuple.arm); equal(m.training, tuple.training);
    hash(m.coefficientHash); equal(m.iterations, 200); number(m.fitSeconds, 0, 600);
    const d = object(m.development, ['predictions', 'confusion', 'accuracy', 'balancedAccuracy']);
    const result = derived(d, 320);
    if (m.arm === 'neutral' && m.training === 'raw') neutralMetrics.set(tuple.seed, result.balancedAccuracy);
  });
  if (readiness.status === 'pending') {
    equal(readiness.reason, null); if (readinessRows.length || evaluations.length || samples.length) return fail();
  } else {
    if (models.length !== 18 || readinessRows.length !== 3) return fail();
    readinessRows.forEach((v, i) => { const row = object(v, ['seed', 'balancedAccuracy']); equal(row.seed, seeds[i]); metric(row.balancedAccuracy, neutralMetrics.get(seeds[i]!)!); });
    const passes = [...neutralMetrics.values()].every(n => n >= 0.8);
    equal(readiness.status, passes ? 'pass' : 'fail');
    if (passes) equal(readiness.reason, null); else string(readiness.reason, 1000);
  }
  if (samples.length && samples.length !== 640) return fail();
  samples.forEach((v, i) => { const s = object(v, ['id', 'label']); const label = Math.floor(i / 160); equal(s.label, label); equal(s.id, `test-c${label}-f${String(Math.floor((i % 160) / 2)).padStart(3, '0')}-v${i % 2}`); });
  const expectedEvaluations = modelTuples.flatMap(m => suites.flatMap(suite => (m.training === 'raw' ? trainingModes : ['mask'] as const).map(preprocessing => ({ ...m, suite, preprocessing }))));
  const evaluated = new Map<string, { predictions: number[]; balancedAccuracy: number }>();
  evaluations.forEach((v, i) => {
    const e = object(v, ['seed', 'arm', 'training', 'suite', 'preprocessing', 'predictions', 'confusion', 'accuracy', 'balancedAccuracy', 'flipFraction', 'baselineDifference']);
    const tuple = expectedEvaluations[i]!;
    for (const key of ['seed', 'arm', 'training', 'suite', 'preprocessing'] as const) equal(e[key], tuple[key]);
    const result = derived(e, 640);
    const key = (arm: string, suite: string) => `${tuple.seed}/${arm}/${tuple.training}/${suite}/${tuple.preprocessing}`;
    // The current neutral baseline can refer to itself.
    evaluated.set(key(tuple.arm, tuple.suite), result);
    const neutral = evaluated.get(key(tuple.arm, 'neutral'));
    const baseline = evaluated.get(key('neutral', tuple.suite));
    if (!neutral || !baseline) return fail();
    metric(e.flipFraction, result.predictions.filter((p, j) => p !== neutral.predictions[j]).length / 640);
    metric(e.baselineDifference, result.balancedAccuracy - baseline.balancedAccuracy);
  });
  if (evaluations.length) {
    equal(readiness.status, 'pass'); if (samples.length !== 640 || models.length !== 18) return fail();
    // Retain whole per-model blocks only, including on an error.
    const last = expectedEvaluations[evaluations.length - 1]!;
    const next = expectedEvaluations[evaluations.length];
    if (next && last.seed === next.seed && last.arm === next.arm && last.training === next.training) return fail();
  }
  if (samples.length) equal(readiness.status, 'pass');
  if (root.status === 'complete') {
    equal(readiness.status, 'pass'); equal(root.error, null);
    if (models.length !== 18 || evaluations.length !== 108 || samples.length !== 640 || examples.length !== 4) return fail();
  } else if (root.status === 'inconclusive') {
    equal(readiness.status, 'fail'); equal(root.error, null);
    if (models.length !== 18 || evaluations.length || samples.length || examples.length !== 4) return fail();
  } else string(root.error, 1000);
  return value as ExperimentReport;
}

export function loadExperimentReport(text: string): ExperimentReport {
  return validate(parseStrict(text));
}
export function experimentExamples(report: ExperimentReport): { label: string; neutral: Raster; matched: Raster; shifted: Raster }[] {
  const admitted = validate(report);
  const labels = ['Horizontal bar', 'Vertical bar', 'Cross', 'Disk'];
  return admitted.examples.map(example => {
    const center = centerBytes(example.centerRgb);
    const image = (color: readonly number[]): Raster => {
      const rgba = new Uint8ClampedArray(32 * 32 * 4);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        const c = x >= 4 && x < 28 && y >= 4 && y < 28 ? center.subarray(((y - 4) * 24 + x - 4) * 3, ((y - 4) * 24 + x - 4) * 3 + 3) : color;
        rgba[i] = c[0]!; rgba[i + 1] = c[1]!; rgba[i + 2] = c[2]!; rgba[i + 3] = 255;
      }
      return { width: 32, height: 32, rgba };
    };
    return { label: labels[example.label]!, neutral: image([128, 128, 128]), matched: image(palette[example.label]!), shifted: image(palette[(example.label + 1) % 4]!) };
  });
}
