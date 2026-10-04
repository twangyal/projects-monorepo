import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { planeScale, projectPoint, renderPixels } from '../src/render.ts';
import { encodePng } from '../src/png.ts';
import { authoredScene, defaults, fixtureProject, texture } from './oracle/fixtures.ts';
import { errorBetween, scalarReference } from './oracle/scalar.ts';
import type { Plane } from '../src/types.ts';

test('analytical pinhole distances agree in both perspective directions and subject stays anchored', () => {
  for (const [target, scales] of [[40, [1.2, 1, 8 / 9]], [85, [51 / 65, 1, 34 / 27]]] as const) {
    const settings = { ...defaults, mode: 'perspective' as const, targetFocal: target };
    for (const plane of [0, 1, 2] as Plane[]) assert.ok(Math.abs(planeScale(settings, plane) - scales[plane]!) < 1e-14);
    assert.deepEqual(projectPoint({ x: 3.125, y: 9.25 }, settings, 1, 31, 19), { x: 3.125, y: 9.25 });
    assert.deepEqual(projectPoint({ x: 3.125, y: 9.25 }, { ...settings, shiftX: .25, shiftY: -.125 }, 1, 31, 19), { x: 10.875, y: 6.875 });
  }
});

for (const mode of ['fixed', 'perspective'] as const) {
  test(`${mode} identity retains arbitrary masks, alpha and source bytes with canonical transparent RGB`, () => {
    const source = texture(), original = source.rgba.slice();
    const labels = Uint8Array.from({ length: source.width * source.height }, (_, i) => i % 3);
    const mask = labels.slice(), project = fixtureProject(source, labels, { mode });
    const result = renderPixels(source, project);
    const expected = source.rgba.slice();
    for (let i = 0; i < expected.length; i += 4) if (!expected[i + 3]) expected.fill(0, i, i + 3);
    assert.deepEqual(result.rgba, expected);
    assert.equal(result.missingFraction, 0);
    assert.deepEqual(source.rgba, original); assert.deepEqual(labels, mask);
  });
}

for (const dimensions of [[23, 15], [16, 11], [1, 1]] as const) {
  for (const settings of [
    { ...defaults, targetFocal: 100 },
    { ...defaults, targetFocal: 25 },
    { ...defaults, targetFocal: 37.5, shiftX: .1375, shiftY: -.2211 },
    { ...defaults, mode: 'perspective' as const, targetFocal: 40 },
    { ...defaults, mode: 'perspective' as const, targetFocal: 85 },
    { ...defaults, mode: 'perspective' as const, targetFocal: 85, shiftX: -.3197, shiftY: .25 },
  ]) {
    test(`independent scalar gate ${dimensions.join('x')} ${settings.mode} ${settings.targetFocal} shift ${settings.shiftX},${settings.shiftY}`, t => {
      const source = texture(...dimensions);
      const labels = Uint8Array.from({ length: source.width * source.height }, (_, i) => ((i * 17 + Math.floor(i / source.width)) % 5) % 3);
      const project = fixtureProject(source, labels, settings);
      const expected = scalarReference(source, settings, labels), actual = renderPixels(source, project);
      const errors = errorBetween(actual, expected);
      t.diagnostic(`max RGBA error=${errors.rgba}; missingFraction error=${errors.coverage}`);
      assert.ok(errors.rgba <= 1, `RGBA maximum error ${errors.rgba}`);
      assert.ok(errors.coverage <= 1e-9, `Coverage error ${errors.coverage}`);
      const decoded = PNG.sync.read(Buffer.from(encodePng(actual)));
      assert.equal(decoded.width, source.width); assert.equal(decoded.height, source.height);
      assert.deepEqual(decoded.data, Buffer.from(actual.rgba));
    });
  }
}

test('authored opaque planes expose holes and the near plane occludes the subject', () => {
  const { source, labels } = authoredScene();
  for (let i = 0; i < labels.length; i++) source.rgba.set(labels[i] === 0 ? [255, 0, 0, 255] : labels[i] === 1 ? [0, 255, 0, 255] : [0, 0, 255, 255], i * 4);
  for (const targetFocal of [40, 85]) {
    const project = fixtureProject(source, labels, { mode: 'perspective', targetFocal });
    const expected = scalarReference(source, project.settings, labels), actual = renderPixels(source, project);
    const errors = errorBetween(actual, expected);
    assert.ok(errors.rgba <= 1); assert.ok(errors.coverage <= 1e-9);
    assert.ok(actual.missingFraction > 0); assert.ok(actual.rgba.some((value, i) => i % 4 === 3 && value === 0));
    if (targetFocal === 85) {
      assert.deepEqual([...actual.rgba.slice((9 * 31 + 11) * 4, (9 * 31 + 11) * 4 + 4)], [255, 0, 0, 255]);
      assert.deepEqual([...actual.rgba.slice((9 * 31 + 21) * 4, (9 * 31 + 21) * 4 + 4)], [0, 0, 0, 0]);
    }
  }
});

test('premultiplied edge filtering retains bright color and coverage is independent of source alpha', () => {
  const source = { width: 5, height: 3, rgba: new Uint8ClampedArray(5 * 3 * 4) };
  for (let i = 0; i < 15; i++) source.rgba.set(i % 5 < 3 ? [251, 17, 139, 2] : [0, 240, 0, 0], i * 4);
  const labels = new Uint8Array(15).fill(1);
  const project = fixtureProject(source, labels, { targetFocal: 37.5, shiftX: .1 });
  const actual = renderPixels(source, project), expected = scalarReference(source, project.settings, labels);
  assert.ok(errorBetween(actual, expected).rgba <= 1);
  for (let i = 0; i < actual.rgba.length; i += 4) {
    if (actual.rgba[i + 3]) assert.deepEqual([...actual.rgba.slice(i, i + 3)], [251, 17, 139]);
    else assert.deepEqual([...actual.rgba.slice(i, i + 3)], [0, 0, 0]);
  }
  const opaque = { ...source, rgba: source.rgba.slice() };
  for (let i = 3; i < opaque.rgba.length; i += 4) opaque.rgba[i] = 255;
  assert.equal(renderPixels(opaque, project).missingFraction, actual.missingFraction);
});

test('independent PNG decoding preserves low-alpha straight bytes across stored-block boundaries', () => {
  for (const [width, height] of [[23, 15], [257, 70]]) {
    const source = texture(width, height), before = source.rgba.slice();
    const bytes = encodePng(source), decoded = PNG.sync.read(Buffer.from(bytes));
    assert.equal(decoded.width, width); assert.equal(decoded.height, height);
    assert.deepEqual(decoded.data, Buffer.from(before)); assert.deepEqual(source.rgba, before);
  }
});
