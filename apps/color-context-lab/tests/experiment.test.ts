import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { experimentExamples, loadExperimentReport, type ExperimentReport, type ModelSeed } from '../src/experiment.ts';

const published = readFileSync(new URL('../public/experiment-report.json', import.meta.url), 'utf8');
// Independently authored test-only fixture, stable after actual result publication.
const original = JSON.stringify({ schemaVersion: 1, protocol: 'context-shapes-v1', status: 'not-run',
  provenance: 'Test-only not-run fixture; no measured outcomes.', protocolHash: null, generatorHash: null, manifestHash: null, environment: null,
  readiness: { status: 'pending', minimum: 0.8, neutralDevelopment: [], reason: null },
  testSamples: [], examples: [], models: [], evaluations: [], limitations: ['Test-only procedural fixture.'], error: null });
const seeds: ModelSeed[] = [1729, 2718, 3141];
function measured(): ExperimentReport {
  const result = JSON.parse(original) as ExperimentReport;
  result.status = 'complete'; result.provenance = 'Test-only authored predictions; no measured experiment outcome.';
  result.protocolHash = 'a'.repeat(64); result.generatorHash = 'b'.repeat(64); result.manifestHash = 'c'.repeat(64);
  result.environment = { python: '3.12.14', numpy: '2.3.5', pillow: '12.3.0', sklearn: '1.8.0', scipy: '1.17.0', platform: 'Test only', threadLimit: 1, numericLibraries: 'Test only' };
  const dev = Array.from({ length: 320 }, (_, i) => Math.floor(i / 80));
  const predictions = Array.from({ length: 640 }, (_, i) => Math.floor(i / 160));
  const confusion = (n: number) => Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i === j ? n : 0));
  result.testSamples = predictions.map((label, i) => ({ id: `test-c${label}-f${String(Math.floor((i % 160) / 2)).padStart(3, '0')}-v${i % 2}`, label: label as 0 | 1 | 2 | 3 }));
  result.examples = [0, 1, 2, 3].map(label => ({ sampleId: `development-c${label}-f000-v0`, label: label as 0 | 1 | 2 | 3, centerRgb: Buffer.alloc(1728, 192).toString('base64') }));
  for (const seed of seeds) for (const arm of ['neutral', 'correlated', 'independent'] as const) for (const training of ['raw', 'mask'] as const) {
    result.models.push({ seed, arm, training, coefficientHash: 'd'.repeat(64), iterations: 200, fitSeconds: 1,
      development: { predictions: [...dev], confusion: confusion(80), accuracy: 1, balancedAccuracy: 1 } });
    for (const suite of ['neutral', 'matched', 'shifted', 'independent'] as const) for (const preprocessing of training === 'raw' ? ['raw', 'mask'] as const : ['mask'] as const) {
      result.evaluations.push({ seed, arm, training, suite, preprocessing, predictions: [...predictions], confusion: confusion(160), accuracy: 1, balancedAccuracy: 1, flipFraction: 0, baselineDifference: 0 });
    }
  }
  result.readiness = { status: 'pass', minimum: 0.8, neutralDevelopment: seeds.map(seed => ({ seed, balancedAccuracy: 1 })), reason: null };
  return result;
}

test('authored not-run fixture has detached arrays', () => {
  const first = loadExperimentReport(original);
  assert.equal(first.status, 'not-run'); assert.equal(first.readiness.status, 'pending');
  first.limitations.push('changed');
  assert.notDeepEqual(first.limitations, loadExperimentReport(original).limitations);
  assert.deepEqual(experimentExamples(first), []);
});

test('complete authored report independently recomputes 18 development and 108 evaluation records', () => {
  const expected = measured();
  assert.deepEqual(loadExperimentReport(JSON.stringify(expected)), expected);
  assert.equal(expected.evaluations.length, 108);
  assert.ok(Buffer.byteLength(JSON.stringify(expected)) < 512 * 1024);
});

test('strict syntax, strings, hashes, depth and byte admission', () => {
  const errors = [original.replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1'), original.replace('"not-run"', '"not-run","unexpected":0'),
    original.replace('"protocolHash":null', '"protocolHash":"' + 'a'.repeat(63) + '\\n"'), original.replace('"provenance":', '"provenance":"\\ud800","other":'),
    original.replace('"models":[]', '"models":' + '['.repeat(17) + '0' + ']'.repeat(17)), ' '.repeat(512 * 1024 + 1),
    original.replace('"minimum":0.8', '"minimum":1e999')];
  for (const text of errors) assert.throws(() => loadExperimentReport(text));
});

test('rejects forged confusion, readiness, predictions, tuples and comparisons', () => {
  const changes = [
    (r: ExperimentReport) => { r.models[0]!.development.confusion[0]![0] = 79; },
    (r: ExperimentReport) => { r.readiness.neutralDevelopment[0]!.balancedAccuracy = 0.9; },
    (r: ExperimentReport) => { r.evaluations[0]!.predictions[0] = 4; },
    (r: ExperimentReport) => { r.evaluations[2]!.flipFraction = 0.5; },
    (r: ExperimentReport) => { r.evaluations[20]!.baselineDifference = 0.1; },
    (r: ExperimentReport) => { r.evaluations[1] = r.evaluations[0]!; },
    (r: ExperimentReport) => { r.testSamples[0]!.id = 'test-c0-f000-v1'; },
    (r: ExperimentReport) => { r.examples[0]!.centerRgb = 'A'.repeat(2303) + '='; },
    (r: ExperimentReport) => { r.models[0]!.fitSeconds = Infinity; },
  ];
  for (const change of changes) { const report = measured(); change(report); assert.throws(() => loadExperimentReport(JSON.stringify(report))); }
});

test('inconclusive cannot contain held-out predictions, and complete error blocks remain honest', () => {
  const failed = measured(); failed.status = 'inconclusive'; failed.testSamples = []; failed.evaluations = [];
  for (const model of failed.models.filter(m => m.arm === 'neutral' && m.training === 'raw')) {
    model.development = { predictions: Array(320).fill(0), confusion: [[80, 0, 0, 0], [80, 0, 0, 0], [80, 0, 0, 0], [80, 0, 0, 0]], accuracy: 0.25, balancedAccuracy: 0.25 };
  }
  failed.readiness = { status: 'fail', minimum: 0.8, neutralDevelopment: seeds.map(seed => ({ seed, balancedAccuracy: 0.25 })), reason: 'Clean shape baseline failed.' };
  assert.deepEqual(loadExperimentReport(JSON.stringify(failed)), failed);
  failed.testSamples = measured().testSamples; assert.throws(() => loadExperimentReport(JSON.stringify(failed)));
  const partial = measured(); partial.status = 'error'; partial.error = 'Stopped after a complete evaluation block.'; partial.evaluations = partial.evaluations.slice(0, 8);
  assert.deepEqual(loadExperimentReport(JSON.stringify(partial)), partial);
  partial.evaluations.pop(); assert.throws(() => loadExperimentReport(JSON.stringify(partial)));
});

test('example raster is opaque with identical center and explicit palette context', () => {
  const examples = experimentExamples(measured());
  assert.equal(examples.length, 4);
  assert.deepEqual(Array.from(examples[0]!.matched.rgba.slice(0, 4)), [152, 128, 128, 255]);
  assert.deepEqual(Array.from(examples[0]!.shifted.rgba.slice(0, 4)), [104, 128, 128, 255]);
  for (const example of examples) {
    assert.equal(example.neutral.width, 32);
    for (const image of [example.neutral, example.matched, example.shifted]) {
      for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) assert.deepEqual(Array.from(image.rgba.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)), [192, 192, 192, 255]);
    }
  }
});

test('published artifact validates its actual declared status without assuming fitting occurred', () => {
  const validated = loadExperimentReport(published);
  assert.equal(validated.status, (JSON.parse(published) as ExperimentReport).status);
});
