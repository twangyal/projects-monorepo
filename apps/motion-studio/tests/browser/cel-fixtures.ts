import { deflateSync } from 'node:zlib';

export interface Key { frame: number; x: number; y: number; scale: number; rotation: number; opacity: number; easing: 'linear' | 'hold' | 'ease' }
export interface Stroke { color: string; width: number; points: { x: number; y: number }[] }
export interface Cel { frame: number; strokes: Stroke[] }
export interface Layer { id: string; name: string; kind: 'drawing' | 'image'; keys: Key[]; strokes?: Stroke[]; cels?: Cel[]; image?: { dataUrl: string; width: number; height: number } }
export interface Film { schemaVersion: 1 | 2; title: string; background: string; frameCount: number; layers: Layer[] }
export const key = (frame = 0, x = 320, y = 180): Key => ({ frame, x, y, scale: 1, rotation: 0, opacity: 1, easing: 'linear' });
export const line = (color = '#FF0000'): Stroke => ({ color, width: 20, points: [{ x: -80, y: 0 }, { x: 80, y: 0 }] });
export const dot = (color = '#00FF00'): Stroke => ({ color, width: 20, points: [{ x: 0, y: 0 }] });
export function legacy(blank = false): Film {
  return { schemaVersion: 1, title: 'Original <drawing> · legacy', background: '#FFFFFF', frameCount: 24,
    layers: [{ id: 'paint', name: 'Paint', kind: 'drawing', strokes: blank ? [] : [line()], keys: [key()] }] };
}
// Literal known-field migration expectation; never invokes the producer validator.
export function migrated(input: Film): Film {
  return { ...structuredClone(input), schemaVersion: 2, layers: input.layers.map(layer => layer.kind === 'drawing'
    ? { id: layer.id, name: layer.name, kind: 'drawing', cels: [{ frame: 0, strokes: structuredClone(layer.strokes!) }], keys: structuredClone(layer.keys) }
    : structuredClone(layer)) };
}
export function media(): Film {
  return { schemaVersion: 2, title: 'Held primary colors', background: '#FFFFFF', frameCount: 24, layers: [
    { id: 'paint', name: 'Paint', kind: 'drawing', keys: [key()], cels: [{ frame: 0, strokes: [line()] }, { frame: 6, strokes: [line('#0000FF')] }, { frame: 12, strokes: [] }] },
    { id: 'moving', name: 'Moving green dot', kind: 'drawing', keys: [key(0, 100, 60), key(12, 196, 60)], cels: [{ frame: 0, strokes: [dot()] }] },
  ] };
}
export function shortening(): Film {
  const result = media(); result.frameCount = 48;
  result.layers[0].cels = [{ frame: 0, strokes: [line()] }, { frame: 12, strokes: [line('#0000FF')] }, { frame: 30, strokes: [] }];
  result.layers[0].keys = [key(0, 100), key(47, 570)];
  result.layers[1].cels = [{ frame: 0, strokes: [dot()] }, { frame: 24, strokes: [] }, { frame: 40, strokes: [dot('#0000FF')] }];
  result.layers[1].keys = [key(0, 100, 60), key(24, 220, 60), key(47, 335, 60)];
  return result;
}
function crc(bytes: Uint8Array): number { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(name: string, bytes: Uint8Array): Buffer { const type = Buffer.from(name), data = Buffer.from(bytes), result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); type.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc(Buffer.concat([type, data])), data.length + 8); return result; }
export function originalPng(): Buffer { const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6; const row = [0, 255, 0, 255, 255, 255, 0, 255, 255]; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Uint8Array.from([...row, ...row]))), chunk('IEND', Buffer.alloc(0))]); }
