import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyCamera, retireCamera } from '../src/camera-retirement.js';
import { deferred } from '../test-support/dom.js';

const document = { getElementById: () => null };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('retirement waits for active inference and disposes only its owned model resources', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const disposed = [];
  const resource = name => ({ dispose() { disposed.push(name); if (name === 'mesh') throw new Error('already disposed'); } });
  const tracker = {
    getEyePatches: () => (++calls === 1 ? first.promise : second.promise),
    model: Promise.resolve({ pipeline: {
      meshDetector: resource('mesh'), irisModel: resource('iris'),
      boundingBoxDetector: { blazeFaceModel: resource('face'), anchors: resource('anchors'), inputSize: resource('input') },
    } }),
  };
  const api = { getTracker: () => tracker };
  identifyCamera(api, 1);
  const predictionOne = tracker.getEyePatches();
  const predictionTwo = tracker.getEyePatches();
  predictionTwo.catch(() => {});
  const finish = retireCamera(api, document, {});
  await flush();
  assert.deepEqual(disposed, [], 'in-flight inference still needs model weights');
  first.resolve({ eye: 'sample' });
  await predictionOne;
  assert.deepEqual(disposed, [], 'all active calls must settle');
  const afterRetirement = tracker.getEyePatches();
  assert.equal(calls, 2, 'retired trackers must not start new inference');
  assert.equal(await afterRetirement, null);
  second.reject(new Error('inference canceled'));
  await assert.rejects(predictionTwo, /canceled/);
  await flush();
  assert.deepEqual(disposed, ['mesh', 'iris', 'face', 'anchors', 'input']);
  finish();
  await flush();
  assert.equal(disposed.length, 5, 'cleanup remains idempotent');
});

test('a model loaded after retirement is disposed without starting inference', async () => {
  const loading = deferred();
  let disposed = 0;
  let inferred = 0;
  const tracker = { model: loading.promise, getEyePatches() { inferred++; return null; } };
  const api = { getTracker: () => tracker };
  identifyCamera(api, 2);
  retireCamera(api, document, {});
  loading.resolve({ dispose() { disposed++; } });
  await flush();
  assert.equal(disposed, 1);
  assert.equal(await tracker.getEyePatches(), null);
  assert.equal(inferred, 0);
});
