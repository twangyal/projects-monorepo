import { deflateSync } from 'node:zlib';
import type { PhotoAsset } from '../src/types.ts';

export function photo(width = 8, height = 6): PhotoAsset {
  function chunk(kind: string, payload: Buffer): Buffer {
    const data = Buffer.concat([Buffer.from(kind), payload]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(payload.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
  return { id: '11111111-1111-4111-8111-111111111111', width, height, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
}
