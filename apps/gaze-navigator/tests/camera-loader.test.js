import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraLoader } from '../src/camera-loader.js';

test('fresh loading replaces a retired estimator instance', async () => {
  const oldApi = { retired: true };
  const scripts = [];
  const doc = { createElement: () => ({ remove() {} }), head: { append: script => scripts.push(script) } };
  const win = { webgazer: oldApi, setTimeout: () => 1, clearTimeout() {} };
  const load = createCameraLoader(doc, win);
  const pending = load({ fresh: true });
  assert.equal(scripts.length, 1, 'fresh startup must execute a new library instance');
  const newApi = { retired: false };
  win.webgazer = newApi;
  scripts[0].onload();
  assert.equal(await pending, newApi);
  assert.equal(await load(), newApi);
});

function harness() {
  let script;
  let timeout;
  let removed = 0;
  const window = { setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {} };
  const document = {
    createElement: () => ({ remove: () => { removed++; } }),
    head: { append: node => { script = node; } },
  };
  return { window, document, get script() { return script; }, get removed() { return removed; }, timeout: () => timeout() };
}

test('loads camera only on demand and shares pending requests', async () => {
  const env = harness();
  const load = createCameraLoader(env.document, env.window);
  assert.equal(env.script, undefined);
  const first = load();
  assert.equal(load(), first);
  assert.match(env.script.src, /webgazer@3\.3\.0/);
  const camera = {};
  env.window.webgazer = camera;
  env.script.onload();
  assert.equal(await first, camera);
  assert.equal(await load(), camera);
});

test('failed and timed-out loads remove the script and can retry', async () => {
  const env = harness();
  const load = createCameraLoader(env.document, env.window);
  const first = load();
  env.script.onerror();
  await assert.rejects(first, /load/);
  const second = load();
  env.timeout();
  await assert.rejects(second, /timed out/);
  assert.equal(env.removed, 2);
  const third = load();
  env.window.webgazer = {};
  env.script.onload();
  await third;
});
