import { PNG } from 'pngjs';
import type { Project, Raster, Settings } from '../../src/types';

export const defaults: Settings = { mode: 'fixed', sourceFocal: 50, targetFocal: 50, shiftX: 0, shiftY: 0, near: .6, far: 2 };

export function texture(width = 23, height = 15): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    rgba.set([(x * 37 + y * 11) % 256, (x * 13 + y * 43) % 256, (x * 7 + y * 29 + 83) % 256, [255, 1, 7, 64, 128, 254, 0][(x + 2 * y) % 7]!], index);
  }
  return { width, height, rgba };
}

export function authoredScene(width = 31, height = 19) {
  const source = texture(width, height);
  const labels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    labels[index] = x < width / 3 ? 0 : x > 2 * width / 3 ? 2 : 1;
    source.rgba[index * 4 + 3] = 255;
  }
  return { source, labels };
}

export function independentPng(source: Raster): Buffer {
  const image = new PNG({ width: source.width, height: source.height });
  image.data = Buffer.from(source.rgba);
  return PNG.sync.write(image);
}

/** Valid PNG chunk framing/CRCs, deliberately invalid compressed image data. */
export function undecodablePng(source: Raster): Buffer {
  const encoded = independentPng(source);
  const data = Buffer.from([0x78, 0x01, 0xff, 0xff, 0xff, 0xff]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); chunk.write('IDAT', 4); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 8 + data.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return Buffer.concat([encoded.subarray(0, 33), chunk, encoded.subarray(encoded.length - 12)]);
}

export function fixtureProject(source: Raster, labels: Uint8Array, patch: Partial<Settings> = {}): Project {
  return {
    schemaVersion: 1, id: '01234567-89ab-4cde-8f01-23456789abcd', title: 'Independent authored fixture',
    photo: { id: '01234567-89ab-4cde-8f01-23456789abce', width: source.width, height: source.height, dataUrl: `data:image/png;base64,${independentPng(source).toString('base64')}` },
    settings: { ...defaults, ...patch },
    depth: { width: source.width, height: source.height, labels: Buffer.from(labels).toString('base64') },
  };
}
