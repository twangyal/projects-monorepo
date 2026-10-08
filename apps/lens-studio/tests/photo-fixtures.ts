import { deflateSync } from 'node:zlib';
export const PHOTO_ID = '12345678-1234-4234-8234-123456789abc';
export function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
export function chunk(name: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(payload.length + 12), view = new DataView(output.buffer);
  view.setUint32(0, payload.length); output.set(new TextEncoder().encode(name), 4); output.set(payload, 8);
  let crc = 0xffffffff;
  for (const byte of output.subarray(4, output.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(output.length - 4, (crc ^ 0xffffffff) >>> 0);
  return output;
}
export function tiff(orientation: number): Uint8Array {
  const output = new Uint8Array(26), view = new DataView(output.buffer);
  output.set([73,73,42,0,8,0,0,0,1,0]);
  view.setUint16(10, 0x112, true); view.setUint16(12, 3, true); view.setUint32(14, 1, true); view.setUint16(18, orientation, true);
  return output;
}
export function png(width = 2, height = 1, extras: Uint8Array[] = []): Uint8Array {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  const pixels = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { pixels[y * (width * 4 + 1) + 1 + x * 4] = 220; pixels[y * (width * 4 + 1) + 4 + x * 4] = 255; }
  return concat(Uint8Array.of(137,80,78,71,13,10,26,10), chunk('IHDR', header), ...extras, chunk('IDAT', deflateSync(pixels)), chunk('IEND', new Uint8Array()));
}
export function pngHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  return concat(Uint8Array.of(137,80,78,71,13,10,26,10), chunk('IHDR', header), chunk('IDAT', Uint8Array.of(0)), chunk('IEND', new Uint8Array()));
}
export function jpeg(width = 120, height = 60, orientation?: number): Uint8Array {
  const metadata = orientation === undefined ? new Uint8Array() : concat(Uint8Array.of(255,225,0,34,69,120,105,102,0,0), tiff(orientation));
  return concat(Uint8Array.of(255,216), metadata, Uint8Array.of(255,192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0,255,217));
}
export function webp(width = 120, height = 60, orientation?: number, animated = false): Uint8Array {
  const output = new Uint8Array(44), view = new DataView(output.buffer);
  output.set(new TextEncoder().encode('RIFF')); view.setUint32(4, 36, true); output.set(new TextEncoder().encode('WEBPVP8X'), 8);
  view.setUint32(16,10,true); output[20] = (animated ? 2 : 0) | (orientation === undefined ? 0 : 8);
  for (let i = 0; i < 3; i++) { output[24+i]=(width-1)>>(8*i); output[27+i]=(height-1)>>(8*i); }
  output.set(new TextEncoder().encode('VP8L'),30); view.setUint32(34,5,true); output[38]=47; view.setUint32(39,(width-1)|((height-1)<<14),true);
  if (orientation === undefined) return output;
  const exif = new Uint8Array(34); exif.set(new TextEncoder().encode('EXIF')); new DataView(exif.buffer).setUint32(4,26,true); exif.set(tiff(orientation),8);
  const result=concat(output,exif); new DataView(result.buffer).setUint32(4,result.length-8,true); return result;
}
export const asset = (data = png(), width = 2, height = 1) => ({ id:PHOTO_ID, width, height, dataUrl:'data:image/png;base64,' + Buffer.from(data).toString('base64') });
