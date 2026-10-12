import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProjectJson, serializeProject, validateSettings } from '../src/model.ts';
import { renderComparison } from '../src/render.ts';
import { rawProject, TINY } from './oracle/color-fixtures.ts';
import { STRIPE_SETTINGS, tinyStripe } from './oracle/stripe-fixtures.ts';

test('directional surrounds match independently frozen rows and columns and retain every artwork byte', () => {
  for (const direction of ['horizontal', 'vertical'] as const) {
    const settings = validateSettings({ ...STRIPE_SETTINGS, mode: `${direction}-stripes` });
    const project = rawProject(settings), before = serializeProject(project);
    const { result, baseline, metrics } = renderComparison(project), expected = tinyStripe(direction);
    assert.deepEqual(result, expected); assert.equal(serializeProject(project), before);
    let squared = 0, maximum = 0, yDelta = 0;
    const linear = (byte: number) => byte <= 10 ? byte / 255 / 12.92 : ((byte / 255 + .055) / 1.055) ** 2.4;
    const weights = [.2126, .7152, .0722];
    for (let i = 0; i < expected.rgba.length; i += 4) {
      let a = 0, b = 0;
      for (let c = 0; c < 3; c++) {
        const difference = expected.rgba[i + c]! - baseline.rgba[i + c]!;
        squared += difference ** 2; maximum = Math.max(maximum, Math.abs(difference));
        a += weights[c]! * linear(expected.rgba[i + c]!); b += weights[c]! * linear(baseline.rgba[i + c]!);
      }
      yDelta += Math.abs(a - b);
    }
    assert.equal(metrics.rgbRmse, Math.sqrt(squared / (3 * 210))); assert.equal(metrics.maxRgbDelta, maximum);
    assert.ok(Math.abs(metrics.meanAbsoluteLuminanceDelta - yDelta / 210) < 1e-14);
    assert.equal(metrics.surroundPixels, 204); assert.equal(metrics.artworkChangedPixels, 0);
    for (let row = 0; row < 2; row++) assert.deepEqual(result.rgba.slice(((6 + row) * 15 + 6) * 4, ((6 + row) * 15 + 9) * 4), TINY.slice(row * 12, (row + 1) * 12));
  }
});

test('striped project and named alternatives round-trip without changing legacy project shape', () => {
  const legacy = rawProject(), encoded = serializeProject(legacy);
  assert.equal(serializeProject(parseProjectJson(encoded)), encoded); assert.equal(Object.hasOwn(parseProjectJson(encoded), 'variants'), false);
  const first = validateSettings({ ...STRIPE_SETTINGS, mode: 'horizontal-stripes' });
  const second = validateSettings({ ...STRIPE_SETTINGS, mode: 'vertical-stripes' });
  const striped = { ...rawProject(first), variants: [{ name: 'Horizontal', settings: first }, { name: 'Vertical', settings: second }] };
  assert.deepEqual(parseProjectJson(serializeProject(striped)), striped);
  for (const bad of [{ ...first, mode: 'diagonal-stripes' }, { ...second, cellSize: 3 }, { ...first, cellSize: 129 }, { ...second, border: 129 }]) assert.throws(() => validateSettings(bad));
});

test('zero-width and neutral stripe colors reduce exactly to unchanged source or neutral framing', () => {
  for (const mode of ['horizontal-stripes', 'vertical-stripes']) {
    const zero = renderComparison(rawProject(validateSettings({ ...STRIPE_SETTINGS, mode, border: 0 })));
    assert.deepEqual(zero.result.rgba, TINY); assert.deepEqual(zero.result, zero.baseline); assert.equal(zero.metrics.rgbRmse, 0);
    const gray = renderComparison(rawProject(validateSettings({ ...STRIPE_SETTINGS, mode, colorA: '#808080', colorB: '#808080' })));
    assert.deepEqual(gray.result, gray.baseline); assert.equal(gray.metrics.rgbRmse, 0); assert.equal(gray.metrics.meanAbsoluteLuminanceDelta, 0);
  }
});

test('both directions render the unchanged maximum 976-square canvas with exact color area and hidden source pixels', () => {
  const rgba = new Uint8ClampedArray(720 * 720 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([9, 8, 7, 0], i);
  for (const mode of ['horizontal-stripes', 'vertical-stripes']) {
    const settings = validateSettings({ ...STRIPE_SETTINGS, mode, border: 128, colorA: '#ffffff', colorB: '#000000' });
    const { result, metrics } = renderComparison(rawProject(settings, 720, 720, rgba));
    assert.equal(result.width, 976); assert.equal(result.height, 976);
    let black = 0;
    for (let i = 0; i < result.rgba.length; i += 4) if (result.rgba[i] === 0 && result.rgba[i + 3] === 255) black++;
    assert.equal(black, 217088); assert.equal(metrics.surroundPixels, 434176);
    assert.equal(metrics.rgbRmse, Math.sqrt(217088 * (127 ** 2 + 128 ** 2) / (976 ** 2)));
    for (let y = 0; y < 720; y++) assert.deepEqual(result.rgba.subarray(((y + 128) * 976 + 128) * 4, ((y + 128) * 976 + 848) * 4), rgba.subarray(y * 2880, (y + 1) * 2880));
  }
});
