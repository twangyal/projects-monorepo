import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageAsset, createProject, decodePixels, parseProjectJson, serializeProject, updateProject, validateImageAsset, validateProject, validateSettings } from '../src/model.ts';
import { LIMITS } from '../src/types.ts';

function image() {
  return createImageAsset({ width: 2, height: 1, rgba: new Uint8ClampedArray([123, 42, 3, 0, 251, 19, 211, 1]) }, { fileName: ' source 📈.png ', format: 'png', width: 2, height: 1 });
}

test('raw RGBA bytes, hidden/low-alpha RGB and literal labels survive complete backup without a codec', () => {
  const asset = image(), project = createProject(asset, ' Literal <title> 📈 ');
  assert.deepEqual(Array.from(decodePixels(asset).rgba), [123, 42, 3, 0, 251, 19, 211, 1]);
  assert.equal(asset.rgba, 'eyoDAPsT0wE=');
  const raw = serializeProject(project), reopened = parseProjectJson(raw);
  assert.deepEqual(reopened, project); assert.equal(reopened.title, ' Literal <title> 📈 ');
  assert.equal(reopened.image.source.fileName, ' source 📈.png ');
  const output = decodePixels(asset); output.rgba.fill(0); asset.source.fileName = 'Changed';
  assert.deepEqual(Array.from(decodePixels(project.image).rgba), [123, 42, 3, 0, 251, 19, 211, 1]);
  assert.equal(project.image.source.fileName, ' source 📈.png ');
});

test('project/settings validation detaches objects and ignores no unsupported fields', () => {
  const project = createProject(image());
  assert.deepEqual(project.settings, { mode: 'solid', border: 48, colorA: '#808080', colorB: '#808080', cellSize: 16 });
  const edit = { title: 'Changed', settings: { mode: 'checker' as const, border: 128, colorA: '#000000', colorB: '#ffffff', cellSize: 4 } };
  const next = updateProject(project, edit); edit.settings.border = 0;
  assert.equal(next.settings.border, 128); assert.equal(project.settings.border, 48);
  for (const patch of [{ border: -1 }, { border: 129 }, { border: 1.5 }, { border: NaN }, { cellSize: 3 }, { cellSize: 129 }, { colorA: '#FFFFFF' }, { colorB: '#123456\n' }, { mode: 'unknown' }, { extra: true }]) assert.throws(() => validateSettings({ ...project.settings, ...patch }));
  for (const patch of [{ schemaVersion: 2 }, { id: project.id + '\n' }, { title: '   ' }, { title: 'x\u0000y' }, { extra: 1 }]) assert.throws(() => validateProject({ ...project, ...patch }));
  assert.throws(() => updateProject(project, { ...edit, extra: 1 } as typeof edit));
});

test('ordinary data descriptors are checked before accessors execute', () => {
  const project = createProject(image()); let invoked = 0;
  for (const [value, field, check] of [[{ ...project }, 'image', validateProject], [{ ...project.settings }, 'border', validateSettings], [{ ...project.image }, 'rgba', validateImageAsset]] as const) {
    Object.defineProperty(value, field, { enumerable: true, get: () => { invoked++; return null; } });
    assert.throws(() => check(value));
  }
  assert.equal(invoked, 0);
  assert.throws(() => validateSettings(Object.assign(Object.create({ inherited: 1 }), project.settings)));
  assert.throws(() => validateSettings(Object.assign([], project.settings)));
  assert.throws(() => validateProject({ ...project, [Symbol('extra')]: 1 }));
});

test('canonical base64 checks length, alphabet, padding and unused bits before pixel decode', () => {
  const asset = image(); assert.equal(validateImageAsset(asset).rgba, asset.rgba);
  for (const rgba of ['eyoDAPsT0wF=', 'eyoDAPsT0wE', 'eyoDAPsT0wE==', 'eyoDAPsT0wE=\n', 'eyoD PsT0wE=', 'eyoD_PsT0wE=', 'data:image/png;base64,' + asset.rgba, '=yoDAPsT0wE=', 'A'.repeat(LIMITS.rgbaBytes * 2)]) assert.throws(() => validateImageAsset({ ...asset, rgba }));
  const one = createImageAsset({ width: 1, height: 1, rgba: new Uint8ClampedArray([0, 1, 2, 3]) }, { fileName: 'one.png', format: 'png', width: 1, height: 1 });
  assert.equal(one.rgba, 'AAECAw=='); assert.throws(() => validateImageAsset({ ...one, rgba: 'AAECAx==' }));
});

test('source dimensions determine exact normalized geometry, and procedural metadata is fixed128 square', () => {
  const width = 720, height = 1;
  const good = createImageAsset({ width, height, rgba: new Uint8ClampedArray(width * height * 4) }, { fileName: 'thin.png', format: 'png', width: 8192, height: 1 });
  assert.equal(good.width, 720); assert.equal(good.height, 1);
  for (const source of [{ ...good.source, width: 0 }, { ...good.source, width: 8193 }, { ...good.source, height: 8192 }, { ...good.source, width: 719 }, { ...good.source, format: 'jpeg' }, { ...good.source, format: 'procedural' }]) assert.throws(() => validateImageAsset({ ...good, source }));
  const demo = createImageAsset({ width: 128, height: 128, rgba: new Uint8ClampedArray(128 * 128 * 4) }, { fileName: 'Procedural color study', format: 'procedural', width: 128, height: 128 });
  assert.equal(decodePixels(demo).rgba.length, 65536);
  assert.throws(() => validateImageAsset({ ...demo, source: { ...demo.source, width: 127 } }));
});

test('creation validates exact raster views and copies the selected view without touching unrelated bytes', () => {
  const storage = new Uint8ClampedArray([99, 0, 1, 2, 3, 4, 5, 6, 7, 99]);
  const asset = createImageAsset({ width: 2, height: 1, rgba: storage.subarray(1, 9) }, { fileName: 'view.png', format: 'png', width: 2, height: 1 });
  storage.fill(0); assert.deepEqual(Array.from(decodePixels(asset).rgba), [0, 1, 2, 3, 4, 5, 6, 7]);
  const source = { fileName: 'a.png', format: 'png' as const, width: 1, height: 1 };
  for (const raster of [{ width: 1, height: 1, rgba: new Uint8Array(4) }, { width: 1, height: 1, rgba: new Uint8ClampedArray(3) }, { width: 1, height: 1, rgba: new Uint8ClampedArray(new SharedArrayBuffer(4)) }, { width: 721, height: 1, rgba: new Uint8ClampedArray(2884) }]) assert.throws(() => createImageAsset(raster as Parameters<typeof createImageAsset>[0], source));
});

test('metadata counts code points without narrowing astral input or silently trimming it', () => {
  const asset = image(); asset.source.fileName = '📈'.repeat(240);
  const project = createProject(asset, '📈'.repeat(80));
  assert.equal(project.title.length, 160); assert.equal(project.image.source.fileName.length, 480);
  for (const title of ['📈'.repeat(81), '\ud800', 'a\nb', 'a\tb', 'a\u007fb', 'a\u0085b']) assert.throws(() => createProject(asset, title));
  assert.throws(() => validateImageAsset({ ...asset, source: { ...asset.source, fileName: '📈'.repeat(241) } }));
});

test('strict JSON rejects duplicate decoded keys, invalid scalar text, unknown shapes and deep or oversized input', () => {
  const project = createProject(image()), raw = serializeProject(project);
  assert.deepEqual(parseProjectJson(raw), project);
  for (const text of [raw.replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1'), raw.replace('"border":48', '"border":1e999'), raw.replace('"title":"Color context study"', '"title":"\\ud800"'), raw + '{}', '['.repeat(17) + '0' + ']'.repeat(17), '{"__proto__":{},"__proto__":{}}', '\ud800']) assert.throws(() => parseProjectJson(text));
  const padded = raw + ' '.repeat(LIMITS.projectBytes - Buffer.byteLength(raw));
  assert.deepEqual(parseProjectJson(padded), project); assert.throws(() => parseProjectJson(padded + ' '), /4 MiB/);
});

test('the maximum normalized payload is admitted and preserved exactly within complete backup bounds', () => {
  const pixels = new Uint8ClampedArray(LIMITS.rgbaBytes);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
  const asset = createImageAsset({ width: 720, height: 720, rgba: pixels }, { fileName: 'maximum.png', format: 'png', width: 720, height: 720 });
  assert.equal(asset.rgba.length, 2764800);
  const raw = serializeProject(createProject(asset)); assert.ok(Buffer.byteLength(raw) < LIMITS.projectBytes);
  assert.deepEqual(decodePixels(parseProjectJson(raw).image).rgba, pixels);
});

test('single-line project and source labels reject Unicode line and paragraph separators', () => {
  for (const separator of ['\u2028', '\u2029']) {
    const image = createImageAsset({ width: 1, height: 1, rgba: new Uint8ClampedArray(4) }, { fileName: 'source.png', format: 'png', width: 1, height: 1 });
    assert.throws(() => createProject(image, `First${separator}Second`), /single-line/);
    assert.throws(() => validateImageAsset({ ...image, source: { ...image.source, fileName: `First${separator}Second.png` } }), /single-line/);
  }
});
