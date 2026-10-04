import type { Raster, Rendered, Settings } from '../../src/types';

/** Small-fixture oracle: enumerate every source pixel using a tent footprint.
 * This deliberately avoids production geometry, floor/fraction sampling helpers,
 * mask validation and PNG encoding. It is too slow for editor-sized images.
 */
export function scalarReference(source: Raster, settings: Settings, labels: Uint8Array): Rendered {
  const { width, height } = source;
  const output = new Uint8ClampedArray(width * height * 4);
  const ratio = settings.targetFocal / settings.sourceFocal;
  const shift = [settings.shiftX * width, settings.shiftY * height];
  const center = [width / 2, height / 2];
  const distances = [settings.near, 1, settings.far];
  const planes = settings.mode === 'fixed' ? [-1] : [2, 1, 0];
  let uncovered = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = [0, 0, 0];
    let alpha = 0, coverage = 0;
    for (const plane of planes) {
      // Invert the declared pinhole projection directly: inverse magnification
      // is (Z + camera displacement)/(focal ratio * Z).
      const z = plane < 0 ? 1 : distances[plane]!;
      const inverse = settings.mode === 'fixed' ? 1 / ratio : plane === 1 ? 1 : (z + ratio - 1) / (ratio * z);
      const qx = center[0]! + (x + .5 - center[0]! - shift[0]!) * inverse;
      const qy = center[1]! + (y + .5 - center[1]! - shift[1]!) * inverse;
      const front = [0, 0, 0];
      let a = 0, c = 0;
      for (let sy = 0; sy < height; sy++) for (let sx = 0; sx < width; sx++) {
        const index = sy * width + sx;
        if (plane >= 0 && labels[index] !== plane) continue;
        const weight = Math.max(0, 1 - Math.abs(qx - sx - .5)) * Math.max(0, 1 - Math.abs(qy - sy - .5));
        if (!weight) continue;
        const opacity = source.rgba[index * 4 + 3]! / 255;
        c += weight;
        a += weight * opacity;
        for (let channel = 0; channel < 3; channel++) front[channel]! += weight * opacity * source.rgba[index * 4 + channel]! / 255;
      }
      a = Math.max(0, Math.min(1, a)); c = Math.max(0, Math.min(1, c));
      for (let channel = 0; channel < 3; channel++) color[channel] = front[channel]! + color[channel]! * (1 - a);
      alpha = a + alpha * (1 - a);
      coverage = c + coverage * (1 - c);
    }
    const index = (y * width + x) * 4;
    output[index + 3] = Math.round(255 * Math.max(0, Math.min(1, alpha)));
    if (output[index + 3] && alpha) for (let channel = 0; channel < 3; channel++) output[index + channel] = Math.round(255 * color[channel]! / alpha);
    uncovered += 1 - Math.max(0, Math.min(1, coverage));
  }
  return { width, height, rgba: output, missingFraction: uncovered / (width * height) };
}

export function errorBetween(actual: Rendered, expected: Rendered) {
  let maximum = 0;
  for (let index = 0; index < expected.rgba.length; index++) maximum = Math.max(maximum, Math.abs(actual.rgba[index]! - expected.rgba[index]!));
  return { rgba: maximum, coverage: Math.abs(actual.missingFraction - expected.missingFraction) };
}
