import test from 'node:test';
import assert from 'node:assert/strict';
import { bundledModelPath, bundledOnlyFetch } from '../src/web/face-models.js';

test('the three WebGazer face models resolve to bundled files', () => {
  assert.equal(bundledModelPath('https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1/model.json?tfjs-format=file'), 'vendor/face-models/blazeface/model.json');
  assert.equal(bundledModelPath('https://tfhub.dev/mediapipe/tfjs-model/facemesh/1/default/1/group1-shard1of1.bin?tfjs-format=file'), 'vendor/face-models/facemesh/group1-shard1of1.bin');
  assert.equal(bundledModelPath('https://tfhub.dev/mediapipe/tfjs-model/iris/1/default/2/model.json?tfjs-format=file'), 'vendor/face-models/iris/model.json');
  for (const other of ['https://tfhub.dev/other/model/1/model.json', 'http://tfhub.dev/mediapipe/tfjs-model/iris/1/default/2/model.json',
    'https://evil.example/mediapipe/tfjs-model/iris/1/default/2/model.json', 'not a url']) assert.equal(bundledModelPath(other), null, other);
});

test('the capture frame serves bundled models and refuses every other network request', async () => {
  const seen = [];
  const fetch = bundledOnlyFetch(async url => { seen.push(String(url)); return 'ok'; }, path => `chrome-extension://id/${path}`);
  assert.equal(await fetch('https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1/model.json?tfjs-format=file'), 'ok');
  assert.equal(await fetch('chrome-extension://id/vendor/webgazer.js'), 'ok');
  await assert.rejects(fetch('https://www.kaggle.com/models/tensorflow/blazeface'), /no network requests/);
  await assert.rejects(fetch(new URL('https://example.com/track')), /no network requests/);
  assert.deepEqual(seen, ['chrome-extension://id/vendor/face-models/blazeface/model.json', 'chrome-extension://id/vendor/webgazer.js']);
});
