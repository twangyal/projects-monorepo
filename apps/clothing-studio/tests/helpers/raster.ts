import { deflateSync } from 'node:zlib';
function chunk(type: string, data: Buffer) {
  const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(4, out.length - 4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
}
/** Genuine PNG, optionally padded with a valid private ancillary chunk to a base64 length. */
export function png(width = 1, height = 1, encodedLength?: number): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const row = Buffer.alloc(width * 4 + 1); for (let x = 0; x < width; x++) { row[x * 4 + 1] = 255; row[x * 4 + 4] = 255; }
  const data = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({length: height}, () => row))))]);
  const end = chunk('IEND', Buffer.alloc(0));
  if (encodedLength === undefined) return Buffer.concat([data, end]);
  const total = encodedLength / 4 * 3;
  if (!Number.isInteger(total) || total < data.length + end.length + 12) throw new Error('Invalid PNG padding length');
  return Buffer.concat([data, chunk('npAD', Buffer.alloc(total - data.length - end.length - 12)), end]);
}
export const pngUrl = (width = 1, height = 1, encodedLength?: number) => `data:image/png;base64,${png(width, height, encodedLength).toString('base64')}`;
