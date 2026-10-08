import { deflateSync } from 'node:zlib';
import type { Comparison, Project, Raster, Settings } from '../../src/types.ts';

export const ID = '01987654-3210-4321-8765-0123456789ab';
export const IMAGE_ID = '02987654-3210-4321-8765-0123456789ab';
export const DEFAULTS: Settings = { mode: 'solid', border: 48, colorA: '#808080', colorB: '#808080', cellSize: 16 };
// Hidden RGB and low alpha deliberately test raw-pixel retention independently of Canvas.
export const TINY = new Uint8ClampedArray([
  17, 33, 251, 0, 255, 1, 129, 1, 3, 97, 201, 64,
  255, 0, 31, 255, 10, 200, 90, 128, 0, 1, 2, 255,
]);
export function rawProject(settings: Partial<Settings> = {}, width = 3, height = 2, rgba: Uint8ClampedArray = TINY): Project {
  return { schemaVersion: 1, id: ID, title: 'Literal <script> context 🧾',
    image: { id: IMAGE_ID, width, height, rgba: Buffer.from(rgba).toString('base64'), source: { fileName: '<img src=x> original.png', format: 'png', width, height } },
    settings: { ...DEFAULTS, ...settings } };
}
export function literalRaster(width: number, height: number): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    rgba.set([x * 37 % 256, y * 53 % 256, (x * 7 + y * 11) % 256, [0, 1, 64, 128, 255][(x + y) % 5]!], i);
  }
  return { width, height, rgba };
}
export function scalar(project: Project): Comparison {
  const { image, settings } = project, b = settings.border, width = image.width + 2 * b, height = image.height + 2 * b;
  const original = Buffer.from(image.rgba, 'base64'), baseline = new Uint8ClampedArray(width * height * 4), result = new Uint8ClampedArray(baseline.length);
  const colors = [settings.colorA, settings.colorB].map(color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16)));
  const linear = (byte: number) => { const s = byte / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; };
  const luminance = (bytes: Uint8ClampedArray, i: number) => .2126 * linear(bytes[i]!) + .7152 * linear(bytes[i + 1]!) + .0722 * linear(bytes[i + 2]!);
  let squared = 0, max = 0, luminanceDelta = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, artwork = x >= b && x < b + image.width && y >= b && y < b + image.height;
    if (artwork) { const source = ((y - b) * image.width + x - b) * 4; baseline.set(original.subarray(source, source + 4), i); result.set(original.subarray(source, source + 4), i); }
    else { baseline.set([128, 128, 128, 255], i); const parity = settings.mode === 'checker' ? (Math.floor(x / settings.cellSize) + Math.floor(y / settings.cellSize)) % 2 : 0; result.set([...colors[parity]!, 255], i); }
    for (let c = 0; c < 3; c++) { const delta = result[i + c]! - baseline[i + c]!; squared += delta * delta; max = Math.max(max, Math.abs(delta)); }
    luminanceDelta += Math.abs(luminance(result, i) - luminance(baseline, i));
  }
  return { baseline: { width, height, rgba: baseline }, result: { width, height, rgba: result }, metrics: {
    artworkChangedPixels: 0, artworkMaxChannelDelta: 0, surroundPixels: width * height - image.width * image.height, totalPixels: width * height,
    rgbRmse: Math.sqrt(squared / (3 * width * height)), maxRgbDelta: max, meanAbsoluteLuminanceDelta: luminanceDelta / (width * height),
  } };
}
// Independent original PNG writer. Production encoder/inspector is never called for fixture bytes.
export function crc(bytes: Uint8Array): number {
  let sum = 0xffffffff;
  for (const byte of bytes) { sum ^= byte; for (let bit = 0; bit < 8; bit++) sum = (sum >>> 1) ^ (sum & 1 ? 0xedb88320 : 0); }
  return (sum ^ 0xffffffff) >>> 0;
}
export function chunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type), payload = Buffer.from(data), result = Buffer.alloc(12 + payload.length);
  result.writeUInt32BE(payload.length); name.copy(result, 4); payload.copy(result, 8); result.writeUInt32BE(crc(Buffer.concat([name, payload])), result.length - 4); return result;
}
export function originalPng(raster: Raster, extras: Buffer[] = []): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(raster.width); header.writeUInt32BE(raster.height, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc((raster.width * 4 + 1) * raster.height);
  for (let y = 0; y < raster.height; y++) Buffer.from(raster.rgba.subarray(y * raster.width * 4, (y + 1) * raster.width * 4)).copy(scanlines, y * (raster.width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), ...extras, chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
