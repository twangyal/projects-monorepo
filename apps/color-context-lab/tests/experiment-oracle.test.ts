import test from 'node:test';
import assert from 'node:assert/strict';
import { loadExperimentReport, experimentExamples, type ExperimentReport, type ModelResult, type Evaluation, type Arm, type Preprocess, type Suite } from '../src/experiment.ts';

// Entirely synthetic validator fixtures, authored before producer implementation.
// These arrays are NOT protocol fits, predictions or scientific outcome evidence.
const seeds = [1729, 2718, 3141] as const;
const arms: Arm[] = ['neutral', 'correlated', 'independent'];
const suites: Suite[] = ['neutral', 'matched', 'shifted', 'independent'];
const training: Preprocess[] = ['raw', 'mask'];
const clone = <T>(value: T): T => structuredClone(value);
const sampleId = (split: string, label: number, family: number, variant: number) => `${split}-c${label}-f${String(family).padStart(3, '0')}-v${variant}`;
function statistics(predictions: number[], perClass: number) {
  const confusion = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  predictions.forEach((prediction, index) => { confusion[Math.floor(index / perClass)][prediction]++; });
  const correct = confusion.reduce((sum, row, label) => sum + row[label], 0);
  return { confusion, accuracy: correct / predictions.length, balancedAccuracy: confusion.reduce((sum, row, label) => sum + row[label] / perClass, 0) / 4 };
}
function notRun(): ExperimentReport {
  return { schemaVersion: 1, protocol: 'context-shapes-v1', status: 'not-run', provenance: 'Independent synthetic validator fixture; no models were fitted.', protocolHash: null, generatorHash: null, manifestHash: null, environment: null, readiness: { status: 'pending', minimum: 0.8, neutralDevelopment: [], reason: null }, testSamples: [], examples: [], models: [], evaluations: [], limitations: ['Not scientific evidence or an artwork-protection result.'], error: null };
}
function complete(): ExperimentReport {
  const models: ModelResult[] = [];
  for (const seed of seeds) for (const arm of arms) for (const mode of training) {
    const predictions = Array.from({ length: 320 }, (_, index) => { const label = Math.floor(index / 80); return arm === 'neutral' && mode === 'raw' && index % 80 < 8 ? (label + 1) % 4 : label; });
    models.push({ seed, arm, training: mode, coefficientHash: 'a'.repeat(64), iterations: 200, fitSeconds: 0.5, development: { predictions, ...statistics(predictions, 80) } });
  }
  const evaluations: Evaluation[] = [];
  for (const seed of seeds) for (const arm of arms) for (const mode of training) for (const suite of suites) for (const preprocessing of mode === 'raw' ? training : ['mask'] as const) {
    const errorsPerClass = mode === 'mask' || preprocessing === 'mask' ? 0 : arm === 'neutral' ? 16 : arm === 'independent' ? 32 : ({ neutral: 80, matched: 0, shifted: 160, independent: 40 })[suite];
    const predictions = Array.from({ length: 640 }, (_, index) => { const label = Math.floor(index / 160); return index % 160 < errorsPerClass ? (label + 1) % 4 : label; });
    evaluations.push({ seed, arm, training: mode, suite, preprocessing, predictions, ...statistics(predictions, 160), flipFraction: 0, baselineDifference: 0 });
  }
  for (const result of evaluations) {
    const neutral = evaluations.find(other => other.seed === result.seed && other.arm === result.arm && other.training === result.training && other.suite === 'neutral' && other.preprocessing === result.preprocessing)!;
    const baseline = evaluations.find(other => other.seed === result.seed && other.arm === 'neutral' && other.training === result.training && other.suite === result.suite && other.preprocessing === result.preprocessing)!;
    result.flipFraction = result.predictions.filter((value, index) => value !== neutral.predictions[index]).length / 640;
    result.baselineDifference = result.balancedAccuracy - baseline.balancedAccuracy;
  }
  const centers = [64, 88, 136, 184];
  return { ...notRun(), status: 'complete', protocolHash: 'b'.repeat(64), generatorHash: 'c'.repeat(64), manifestHash: 'd'.repeat(64), environment: { python: '3.12.13', numpy: '2.3.5', pillow: '12.3.0', sklearn: '1.8.0', scipy: '1.17.0', platform: 'Independent synthetic validator fixture', threadLimit: 1, numericLibraries: 'No fit: fabricated coefficient hash is validator test data only.' }, readiness: { status: 'pass', minimum: 0.8, neutralDevelopment: seeds.map(seed => ({ seed, balancedAccuracy: 0.9 })), reason: null }, testSamples: Array.from({ length: 640 }, (_, index) => { const label = Math.floor(index / 160) as 0 | 1 | 2 | 3; return { id: sampleId('test', label, Math.floor((index % 160) / 2), index % 2), label }; }), examples: centers.map((value, label) => ({ sampleId: sampleId('development', label, 0, 0), label: label as 0 | 1 | 2 | 3, centerRgb: Buffer.alloc(24 * 24 * 3, value).toString('base64') })), models, evaluations };
}
const admit = (report: ExperimentReport) => loadExperimentReport(JSON.stringify(report));

test('oracle: truthful not-run is detached and has no learned or held-out claims', () => {
  const original = notRun(), result = admit(original);
  assert.deepEqual(result, original); result.limitations.push('Detached'); assert.equal(original.limitations.length, 1);
  assert.deepEqual(experimentExamples(original), []);
  const bad = notRun(); bad.readiness.status = 'pass'; assert.throws(() => admit(bad));
});

test('oracle: complete108 matrix preserves independently derived confusion, flips and negative effects', () => {
  const report = admit(complete()); assert.equal(report.models.length, 18); assert.equal(report.evaluations.length, 108);
  const select = (arm: Arm, suite: Suite, preprocessing: Preprocess = 'raw') => report.evaluations.find(e => e.seed === 1729 && e.arm === arm && e.training === 'raw' && e.suite === suite && e.preprocessing === preprocessing)!;
  assert.deepEqual(select('neutral', 'neutral').confusion, [[144, 16, 0, 0], [0, 144, 16, 0], [0, 0, 144, 16], [16, 0, 0, 144]]);
  assert.equal(select('correlated', 'matched').accuracy, 1); assert.equal(select('correlated', 'matched').flipFraction, 0.5);
  assert.ok(Math.abs(select('correlated', 'matched').baselineDifference - 0.1) < 1e-12);
  assert.equal(select('correlated', 'shifted').balancedAccuracy, 0); assert.equal(select('correlated', 'shifted').flipFraction, 0.5);
  assert.equal(select('correlated', 'shifted').baselineDifference, -0.9);
  assert.equal(select('correlated', 'shifted', 'mask').accuracy, 1); assert.equal(select('correlated', 'shifted', 'mask').baselineDifference, 0);
  const values = report.evaluations.filter(e => e.arm === 'correlated' && e.training === 'raw' && e.suite === 'shifted' && e.preprocessing === 'raw').map(e => e.balancedAccuracy);
  assert.deepEqual([Math.min(...values), values.reduce((a, b) => a + b) / 3, Math.max(...values)], [0, 0, 0]);
});

test('oracle: strict readiness includes every neutral raw seed, no test data on inconclusive', () => {
  const report = complete(); report.status = 'inconclusive'; report.evaluations = []; report.testSamples = [];
  for (const model of report.models) if (model.arm === 'neutral' && model.training === 'raw') {
    const predictions = Array.from({ length: 320 }, (_, index) => { const label = Math.floor(index / 80); return index % 80 < 20 ? (label + 1) % 4 : label; });
    model.development = { predictions, ...statistics(predictions, 80) };
  }
  report.readiness = { status: 'fail', minimum: 0.8, neutralDevelopment: seeds.map(seed => ({ seed, balancedAccuracy: 0.75 })), reason: 'All neutral development baselines below preregistered threshold; no test inference.' };
  assert.deepEqual(admit(report), report);
  const bad = clone(report); bad.testSamples = complete().testSamples; assert.throws(() => admit(bad));
  const falselyReady = complete(); falselyReady.models[0].development = clone(report.models[0].development); assert.throws(() => admit(falselyReady));
});

test('oracle: metric tampering and mismatched baseline or paired neutral references reject', () => {
  const good = complete(); assert.equal(admit(good).status, 'complete');
  const mutations: ((r: ExperimentReport) => void)[] = [
    r => { r.evaluations[0].confusion[0][0]++; },
    r => { r.evaluations[0].accuracy += 0.001; },
    r => { r.evaluations[0].balancedAccuracy += 0.001; },
    r => { r.evaluations[0].flipFraction = 0.1; },
    r => { r.evaluations[12].baselineDifference = 0; },
    r => { r.models[0].development.predictions[0] = 0; },
    r => { r.readiness.neutralDevelopment[2].balancedAccuracy = 1; },
  ];
  for (const mutate of mutations) { const bad = clone(good); mutate(bad); assert.throws(() => admit(bad)); }
});

test('oracle: complete ordered matrix refuses missing, duplicate, reordered and mask-trained raw rows', () => {
  const good = complete(); assert.equal(admit(good).status, 'complete');
  const mutations: ((r: ExperimentReport) => void)[] = [
    r => { r.evaluations.pop(); }, r => { r.models.pop(); },
    r => { r.evaluations[1] = clone(r.evaluations[0]); },
    r => { [r.models[0], r.models[1]] = [r.models[1], r.models[0]]; },
    r => { r.evaluations[8].preprocessing = 'raw'; },
    r => { r.testSamples[0].id = 'test-c0-f080-v0'; },
    r => { [r.testSamples[0], r.testSamples[1]] = [r.testSamples[1], r.testSamples[0]]; },
    r => { r.testSamples[0].label = 1; },
    r => { r.evaluations[0].predictions[0] = 4; },
  ];
  for (const mutate of mutations) { const bad = clone(good); mutate(bad); assert.throws(() => admit(bad)); }
});

test('oracle: error can retain referentially complete evidence without claiming completion', () => {
  const early = { ...notRun(), status: 'error' as const, error: 'Independent fixture: failure before generation.' };
  assert.deepEqual(admit(early), early);
  const later = complete(); later.status = 'error'; later.error = 'Independent fixture: stopped after first complete model evaluation block.'; later.evaluations = later.evaluations.slice(0, 8);
  assert.deepEqual(admit(later), later);
  const bad = clone(later); bad.readiness.status = 'pending'; assert.throws(() => admit(bad));
});

test('oracle: example geometry and equal sqrt84 distortion use untouched literal center bytes', () => {
  const report = complete(), output = experimentExamples(admit(report));
  assert.equal(output.length, 4);
  const palettes = [[152, 128, 128], [104, 128, 128], [128, 152, 128], [128, 104, 128]];
  for (let label = 0; label < 4; label++) {
    const item = output[label];
    for (const variant of ['neutral', 'matched', 'shifted'] as const) {
      const raster = item[variant]; assert.equal(raster.width, 32); assert.equal(raster.height, 32);
      let squared = 0, borderPixels = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const inside = x >= 4 && x < 28 && y >= 4 && y < 28;
        const color = inside ? Array(3).fill([64, 88, 136, 184][label]) : variant === 'neutral' ? [128, 128, 128] : palettes[(label + (variant === 'shifted' ? 1 : 0)) % 4];
        const offset = (y * 32 + x) * 4;
        assert.deepEqual([...raster.rgba.slice(offset, offset + 4)], [...color, 255]);
        if (!inside) { borderPixels++; for (const channel of color) squared += (channel - 128) ** 2; }
      }
      assert.equal(borderPixels, 448); assert.equal(squared, variant === 'neutral' ? 0 : 258048);
      assert.equal(Math.sqrt(squared / 3072), variant === 'neutral' ? 0 : Math.sqrt(84));
    }
  }
  output[0].matched.rgba.fill(0); assert.notEqual(output[0].neutral.rgba[0], 0);
  assert.equal(experimentExamples(report)[0].matched.rgba[0], 152);
});

test('oracle: duplicate JSON keys, malformed source examples, bounds and unsafe strings reject', () => {
  const good = complete(); assert.equal(admit(good).status, 'complete');
  assert.throws(() => loadExperimentReport(JSON.stringify(notRun()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')));
  assert.throws(() => loadExperimentReport(' '.repeat(512 * 1024) + JSON.stringify(notRun())));
  const mutations: ((r: ExperimentReport) => void)[] = [
    r => { r.examples[0].centerRgb = r.examples[0].centerRgb.slice(4); },
    r => { r.examples[0].sampleId = 'development-c0-f001-v0'; },
    r => { r.protocolHash = 'A'.repeat(64); },
    r => { r.environment!.threadLimit = 2 as 1; },
    r => { r.provenance = 'bad\ud800'; }, r => { r.provenance = 'bad\u0000'; },
    r => { Object.assign(r, { inventedProtectionScore: 100 }); },
    r => { r.models[0].fitSeconds = 600.1; },
  ];
  for (const mutate of mutations) { const bad = clone(good); mutate(bad); assert.throws(() => admit(bad)); }
});
