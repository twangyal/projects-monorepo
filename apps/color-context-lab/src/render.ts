import { createImageAsset, decodePixels, validateProject } from './model.ts';
import type { Comparison, ImageAsset, Project, Raster } from './types.ts';

const LINEAR = Float64Array.from({ length: 256 }, (_, byte) => {
  const s = byte / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
});
function rgb(color: string): number[] { return [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16)); }
function luminance(color: number[]): number { return .2126 * LINEAR[color[0]!]! + .7152 * LINEAR[color[1]!]! + .0722 * LINEAR[color[2]!]!; }
export function renderComparison(project: Project): Comparison {
  const snapshot = validateProject(project);
  const source = decodePixels(snapshot.image);
  const { border, mode, colorA, colorB, cellSize } = snapshot.settings;
  const width = source.width + border * 2;
  const height = source.height + border * 2;
  const baseline: Raster = { width, height, rgba: new Uint8ClampedArray(width * height * 4) };
  const result: Raster = { width, height, rgba: new Uint8ClampedArray(width * height * 4) };
  const colors = [rgb(colorA), rgb(colorB)];
  const grayY = luminance([128, 128, 128]);
  const differences = colors.map(color => ({ squared: color.reduce((sum, byte) => sum + (byte - 128) ** 2, 0), maximum: Math.max(...color.map(byte => Math.abs(byte - 128))), y: Math.abs(luminance(color) - grayY) }));
  let squared = 0;
  let maximum = 0;
  let yDelta = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (x >= border && x < border + source.width && y >= border && y < border + source.height) {
        const from = ((y - border) * source.width + x - border) * 4;
        const pixel = source.rgba.subarray(from, from + 4);
        baseline.rgba.set(pixel, offset);
        result.rgba.set(pixel, offset);
      } else {
        const index = mode === 'checker' ? (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 : 0;
        const color = colors[index]!;
        baseline.rgba.set([128, 128, 128, 255], offset);
        result.rgba.set([...color, 255], offset);
        squared += differences[index]!.squared;
        maximum = Math.max(maximum, differences[index]!.maximum);
        yDelta += differences[index]!.y;
      }
    }
  }
  return { baseline, result, metrics: { artworkChangedPixels: 0, artworkMaxChannelDelta: 0, surroundPixels: width * height - source.width * source.height, totalPixels: width * height, rgbRmse: Math.sqrt(squared / (3 * width * height)), maxRgbDelta: maximum, meanAbsoluteLuminanceDelta: yDelta / (width * height) } };
}
export function createDemoImage(): ImageAsset {
  const rgba = new Uint8ClampedArray(128 * 128 * 4);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const color = (x - 64) ** 2 + (y - 64) ** 2 < 900 ? [239, 85, 93] : [2 * x, 2 * y, 255 - x];
      rgba.set([...color, x < 8 ? 0 : x < 16 ? 64 : 255], (y * 128 + x) * 4);
    }
  }
  return createImageAsset({ width: 128, height: 128, rgba }, { fileName: 'Procedural color study', format: 'procedural', width: 128, height: 128 });
}
