import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { MAX_PNG_CHUNKS, MotionError } from './types.ts';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const table = new Uint32Array(256);
for (let value = 0; value < 256; value++) {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  table[value] = crc;
}
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ table[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function invalid(): never { throw new MotionError('invalid', 'The embedded PNG is malformed or could not be fully decoded.'); }

/** Complete physical admission, bounded zlib proof, then actual pixel decode. */
export function validatePng(bytes: Uint8Array, width: number, height: number): void {
  try {
    const source = Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if (source.length > 1.5 * 1024 * 1024 || source.length < 45 || !source.subarray(0,8).equals(signature)) invalid();
    let at = 8, count = 0, depth = 0, type = -1, interlace = 0, palette = 0, transparency = false;
    let seenData = false, endedData = false, ended = false;
    const data: Buffer[] = [];
    while (at < source.length) {
      if (++count > MAX_PNG_CHUNKS || at + 12 > source.length) invalid();
      const length = source.readUInt32BE(at);
      if (length > source.length - at - 12) invalid();
      for (let letter = at+4; letter < at+8; letter++) if (!(source[letter] >= 65 && source[letter] <= 90 || source[letter] >= 97 && source[letter] <= 122)) invalid();
      const name = source.toString('ascii',at+4,at+8);
      if (!/^[A-Za-z]{4}$/.test(name) || source[at+6] & 32) invalid();
      const payload = source.subarray(at+8,at+8+length);
      if (crc32(source.subarray(at+4,at+8+length)) !== source.readUInt32BE(at+8+length)) invalid();
      if (count === 1 && name !== 'IHDR') invalid();
      if (seenData && name !== 'IDAT') endedData = true;
      if (name === 'IHDR') {
        if (count !== 1 || length !== 13 || payload.readUInt32BE(0) !== width || payload.readUInt32BE(4) !== height
            || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 800 || height > 800) invalid();
        depth = payload[8]; type = payload[9]; interlace = payload[12];
        const allowed: Record<number, number[]> = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
        if (!allowed[type]?.includes(depth) || payload[10] || payload[11] || interlace > 1) invalid();
      } else if (name === 'PLTE') {
        if (palette || transparency || seenData || type === 0 || type === 4 || !length || length % 3 || length > 768) invalid();
        palette = length / 3;
        if (type === 3 && palette > 2 ** depth) invalid();
      } else if (name === 'tRNS') {
        if (transparency || seenData || type === 4 || type === 6) invalid();
        if (type === 3) { if (!palette || length > palette) invalid(); }
        else {
          if (length !== (type === 0 ? 2 : 6)) invalid();
          for (let position = 0; position < length; position += 2) if (payload.readUInt16BE(position) >= 2 ** depth) invalid();
        }
        transparency = true;
      } else if (name === 'IDAT') {
        if (endedData || (type === 3 && !palette)) invalid();
        seenData = true; data.push(payload);
      } else if (name === 'IEND') {
        if (length || !seenData || at+12 !== source.length) invalid(); ended = true;
      } else if (name === 'acTL' || name === 'fcTL' || name === 'fdAT') invalid();
      else if (!(source[at+4] & 32)) invalid();
      else if (name === 'gAMA' && (length !== 4 || payload.readUInt32BE(0) === 0 || palette || seenData)) invalid();
      at += length+12;
    }
    if (!ended) invalid();
    const channels: Record<number, number> = {0:1,2:3,3:1,4:2,6:4};
    const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
    let expected = 0;
    for (const [x,y,dx,dy] of passes) {
      const w = Math.max(0,Math.ceil((width-x)/dx)), h = Math.max(0,Math.ceil((height-y)/dy));
      if (w && h) expected += h * (1 + Math.ceil(w * depth * channels[type] / 8));
    }
    if (!expected || expected > 6 * 1024 * 1024) invalid();
    const compressed = Buffer.concat(data);
    // pngjs's interlaced inflater lacks an output bound; establish it first.
    const inflated = inflateSync(compressed,{maxOutputLength:expected+1,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
    if (inflated.buffer.length !== expected || inflated.engine.bytesWritten !== compressed.length) invalid();
    const decoded = PNG.sync.read(source,{checkCRC:true});
    if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width*height*4) invalid();
  } catch { invalid(); }
}
