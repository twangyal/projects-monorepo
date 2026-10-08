import { validateProject, type Project } from './model.ts';
import { inspectImageHeader } from './images.ts';

export const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
export const MAX_FRAME_PNG_BYTES = 1024 * 1024;
export const MAX_MANIFEST_BYTES = 16 * 1024;
const text = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ table[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function fail(): never { throw new Error('Invalid PNG frame archive.'); }
function png(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_FRAME_PNG_BYTES) throw new Error('PNG frame exceeds the 1 MiB limit.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || [137,80,78,71,13,10,26,10].some((byte,i) => bytes[i] !== byte)
      || v.getUint32(8) !== 13 || v.getUint32(12) !== 0x49484452
      || v.getUint32(16) !== 640 || v.getUint32(20) !== 360) throw new Error('Invalid 640×360 PNG frame.');
  inspectImageHeader(bytes, 'image/png');
  let at = 8;
  while (at < bytes.length) {
    const size = v.getUint32(at);
    if (crc(bytes.subarray(at + 4, at + 8 + size)) !== v.getUint32(at + 8 + size)) throw new Error('Invalid PNG chunk CRC.');
    at += size + 12;
  }
}
function manifest(project: Project) {
  const safe = validateProject(project);
  const frames = Array.from({ length: safe.frameCount }, (_, i) => `frames/frame-${String(i + 1).padStart(4, '0')}.png`);
  const bytes = text.encode(JSON.stringify({ format: 'motion-studio-png-frames', version: 1, title: safe.title, width: 640, height: 360, frameCount: safe.frameCount, fps: { numerator: 12, denominator: 1 }, frames }));
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error('Frame manifest exceeds the 16 KiB limit.');
  return { frames, bytes };
}
type Entry = { name: Uint8Array; bytes: Uint8Array; crc: number; offset: number };
/** Only fixed frame paths can enter this export-only ZIP writer. */
export function createPngArchive(project: Project) {
  const contract = manifest(project), entries: Entry[] = [];
  let count = 0, localBytes = 0, centralBytes = 0, finished = false;
  function add(name: string, bytes: Uint8Array) {
    const path = text.encode(name), localSize = 30 + path.length + bytes.length, centralSize = 46 + path.length;
    if (localBytes + centralBytes + localSize + centralSize + 22 > MAX_ARCHIVE_BYTES) throw new Error('PNG archive exceeds the 96 MiB limit.');
    // Snapshot admission owns the bytes even when the caller later reuses its buffer.
    const owned = bytes.slice();
    entries.push({ name: path, bytes: owned, crc: crc(owned), offset: localBytes });
    localBytes += localSize; centralBytes += centralSize;
  }
  add('manifest.json', contract.bytes);
  return {
    addFrame(bytes: Uint8Array): void {
      if (finished || count >= contract.frames.length) throw new Error('No further frames may enter this archive.');
      png(bytes); add(contract.frames[count], bytes); count++;
    },
    finish(): Uint8Array<ArrayBuffer> {
      if (finished) throw new Error('PNG archive already finished.');
      if (count !== contract.frames.length) throw new Error('PNG archive needs every animation frame.');
      const result = new Uint8Array(localBytes + centralBytes + 22), v = new DataView(result.buffer);
      const u16 = (offset: number, value: number) => v.setUint16(offset, value, true);
      const u32 = (offset: number, value: number) => v.setUint32(offset, value, true);
      let at = localBytes;
      for (const entry of entries) {
        const n = entry.name.length, size = entry.bytes.length, o = entry.offset;
        u32(o, 0x04034b50); u16(o + 4, 20); u16(o + 12, 33);
        u32(o + 14, entry.crc); u32(o + 18, size); u32(o + 22, size); u16(o + 26, n);
        result.set(entry.name, o + 30); result.set(entry.bytes, o + 30 + n);
        u32(at, 0x02014b50); u16(at + 4, 20); u16(at + 6, 20); u16(at + 14, 33);
        u32(at + 16, entry.crc); u32(at + 20, size); u32(at + 24, size); u16(at + 28, n); u32(at + 42, o);
        result.set(entry.name, at + 46); at += 46 + n;
      }
      u32(at, 0x06054b50); u16(at + 8, entries.length); u16(at + 10, entries.length);
      u32(at + 12, centralBytes); u32(at + 16, localBytes);
      finished = true; entries.length = 0;
      return result;
    },
  };
}

/** Refuse malformed or incomplete worker replies before any Blob/download. */
export function validatePngArchive(bytes: Uint8Array, project: Project): void {
  const contract = manifest(project), names = ['manifest.json', ...contract.frames];
  if (bytes.length < 22 || bytes.length > MAX_ARCHIVE_BYTES) fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22;
  const u16 = (o: number) => v.getUint16(o, true), u32 = (o: number) => v.getUint32(o, true);
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== names.length || u16(end + 10) !== names.length || u16(end + 20)) fail();
  const central = u32(end + 16);
  if (central > end || u32(end + 12) !== end - central) fail();
  let at = 0, directory = central;
  for (let i = 0; i < names.length; i++) {
    const name = text.encode(names[i]), n = name.length;
    if (at + 30 + n > central || directory + 46 + n > end) fail();
    const size = u32(at + 18);
    if (u32(at) !== 0x04034b50 || u16(at + 4) !== 20 || u16(at + 6) || u16(at + 8) || u16(at + 10) || u16(at + 12) !== 33 || u32(at + 22) !== size || u16(at + 26) !== n || u16(at + 28) || size > (i ? MAX_FRAME_PNG_BYTES : MAX_MANIFEST_BYTES) || at + 30 + n + size > central) fail();
    if (name.some((byte,j) => bytes[at + 30 + j] !== byte || bytes[directory + 46 + j] !== byte)) fail();
    const data = bytes.subarray(at + 30 + n, at + 30 + n + size);
    if (crc(data) !== u32(at + 14)) fail();
    if (i) png(data); else if (data.length !== contract.bytes.length || data.some((byte,j) => byte !== contract.bytes[j])) fail();
    if (u32(directory) !== 0x02014b50 || u16(directory + 4) !== 20 || u16(directory + 6) !== 20 || u16(directory + 8) || u16(directory + 10) || u16(directory + 12) || u16(directory + 14) !== 33 || u32(directory + 16) !== u32(at + 14) || u32(directory + 20) !== size || u32(directory + 24) !== size || u16(directory + 28) !== n || u16(directory + 30) || u16(directory + 32) || u16(directory + 34) || u16(directory + 36) || u32(directory + 38) || u32(directory + 42) !== at) fail();
    at += 30 + n + size; directory += 46 + n;
  }
  if (at !== central || directory !== end) fail();
}
