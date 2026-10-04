import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.ts';
import { History } from '../src/history.ts';

const raster = () => ({ width: 2, height: 1, rgba: new Uint8ClampedArray([231,1,99,0,4,5,6,64]) });
const source = { fileName: 'Original.png', format: 'png' as const, width: 2, height: 1 };
const image = () => model.createImageAsset(raster(), source);
const project = () => model.createProject(image());

test('retains hidden RGB and returns independently mutable decoded pixels', () => {
  const asset = image();
  const first = model.decodePixels(asset); first.rgba[0] = 0;
  assert.deepEqual(model.decodePixels(asset).rgba, raster().rgba);
  assert.equal(asset.rgba, '5wFjAAQFBkA=');
});
test('project roundtrip preserves literal labels and detached fields', () => {
  const p = project(); p.title = '  🌊 study  ';
  const restored = model.parseProjectJson(model.serializeProject(p));
  assert.deepEqual(restored, p); restored.settings.border = 0;
  assert.equal(p.settings.border, 48);
});
test('rejects extra fields, accessors and nonordinary prototypes without calling getters', () => {
  const p = project(); let calls = 0;
  const bad = { ...p, get surprise() { calls++; return 1; } };
  assert.throws(() => model.validateProject(bad)); assert.equal(calls, 0);
  const required = { ...p, get title() { calls++; return p.title; } };
  assert.throws(() => model.validateProject(required)); assert.equal(calls, 0);
  assert.throws(() => model.validateProject(Object.assign(Object.create({}), p)));
  assert.throws(() => model.validateSettings({ ...p.settings, border: 0.5 }));
  assert.throws(() => model.validateSettings({ ...p.settings, colorA: '#ABCDEF' }));
});
test('base64 canonical pad bits, shape, dimensions and metadata are checked before decoding', () => {
  const a = image();
  for (const rgba of ['5wFjAAQFBkB=', '5wFjAAQFBkA', '5wFjAAQFBkA=\n', '!!!!', '']) {
    assert.throws(() => model.validateImageAsset({ ...a, rgba }));
  }
  assert.throws(() => model.validateImageAsset({ ...a, width: 3 }));
  assert.throws(() => model.validateImageAsset({ ...a, source: { ...source, width: 8193 } }));
  assert.throws(() => model.validateImageAsset({ ...a, source: { ...source, width: 4 } }));
  assert.throws(() => model.validateImageAsset({ ...a, source: { ...source, format: 'procedural' } }));
});
test('bounds literal Unicode, controls, ID and all numeric inputs', () => {
  const p = project();
  for (const title of ['', ' ', '\uD800', 'a\n', 'a\u007f', 'a\u0085', '🌊'.repeat(81)]) {
    assert.throws(() => model.validateProject({ ...p, title }));
  }
  assert.equal(model.validateProject({ ...p, title: '🌊'.repeat(80) }).title.length, 160);
  for (const border of [NaN, Infinity, -1, 129, '1']) assert.throws(() => model.validateSettings({ ...p.settings, border }));
  assert.throws(() => model.validateProject({ ...p, id: 'A0000000-0000-4000-8000-000000000000' }));
});
test('JSON admission rejects duplicate decoded keys, invalid nesting and excessive bytes', () => {
  const p = project(); const json = model.serializeProject(p);
  assert.throws(() => model.parseProjectJson(json.replace('"title":', '"ti\\u0074le":"shadow","title":')));
  assert.throws(() => model.parseProjectJson('['.repeat(17) + '0' + ']'.repeat(17)), {
    message: 'Project must be bounded valid JSON without duplicate keys.',
  });
  assert.throws(() => model.parseProjectJson(' '.repeat(4*1024*1024) + json));
  assert.throws(() => model.parseProjectJson(json.replace('"schemaVersion":1', '"schemaVersion":1e999')));
  assert.throws(() => model.parseProjectJson(json + ' false'));
});
test('edit applies atomically and cannot replace project image or mutate input', () => {
  const p = project();
  const changed = model.updateProject(p, { title: 'New', settings: { ...p.settings, border: 0 } });
  assert.equal(p.title, 'Color context study'); assert.equal(changed.settings.border, 0);
  assert.equal(changed.id, p.id); assert.deepEqual(changed.image, p.image);
  assert.throws(() => model.updateProject(p, { title: 'New', settings: { ...p.settings, border: 999 } }));
});
test('history preserves redo on no-op and rejects image changes atomically', () => {
  const p = project(); const history = new History(p);
  const next = model.updateProject(p, { title: 'next', settings: p.settings });
  assert.equal(history.commit(next), true); assert.equal(history.undo().title, p.title);
  assert.equal(history.commit(p), false); assert.equal(history.canRedo, true);
  assert.throws(() => history.commit(project())); assert.equal(history.canRedo, true);
  assert.throws(() => history.commit({ ...p, image: image() }));
  assert.equal(history.canRedo, true); assert.deepEqual(history.current, p);
  const snapshot = history.current; snapshot.settings.border = 128;
  assert.equal(history.current.settings.border, 48); assert.equal(history.redo().title, 'next');
  assert.throws(() => history.reset({ ...p, title: '' })); assert.equal(history.current.title, 'next');
});
test('history caps at 30 retained edit states and drops redo for real new edits', () => {
  const p = project(); const history = new History(p);
  for (let i=1;i<=40;i++) history.commit(model.updateProject(p, { title: `edit ${i}`, settings: p.settings }));
  let undone = 0; while (history.canUndo) { history.undo(); undone++; }
  assert.equal(undone, 29); assert.equal(history.current.title, 'edit 11');
  history.commit(model.updateProject(p, { title: 'branch', settings: p.settings }));
  assert.equal(history.canRedo, false);
  history.reset(p); assert.equal(history.canUndo, false); assert.deepEqual(history.current, p);
});
