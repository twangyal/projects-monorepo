import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { createProject } from '../src/model.ts';
import { createPngArchive, validatePngArchive } from '../src/png-archive.ts';

function png(): Uint8Array {
  const image = new PNG({ width: 640, height: 360 });
  image.data.fill(255);
  return PNG.sync.write(image);
}
function archive() {
  const project = createProject(); project.frameCount = 12;
  const builder = createPngArchive(project);
  for (let i = 0; i < 12; i++) builder.addFrame(png());
  return { project, bytes: builder.finish() };
}
// Independent bitwise oracle, without production CRC/header helpers.
function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
test('stored ZIP carries literal manifest and all ordered decodable opaque PNGs', () => {
  const { project, bytes } = archive(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0; const names: string[] = [];
  for (let i = 0; i < 13; i++) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 6, true), 0);
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + length)); names.push(name);
    const data = bytes.subarray(offset + 30 + length, offset + 30 + length + size);
    assert.equal(view.getUint32(offset + 14, true), crc(data));
    if (!i) assert.deepEqual(JSON.parse(new TextDecoder().decode(data)), { format: 'motion-studio-png-frames', version: 1, title: project.title, width: 640, height: 360, frameCount: 12, fps: { numerator: 12, denominator: 1 }, frames: Array.from({ length: 12 }, (_, n) => `frames/frame-${String(n + 1).padStart(4, '0')}.png`) });
    else { const decoded = PNG.sync.read(Buffer.from(data)); assert.equal(decoded.width, 640); assert.equal(decoded.height, 360); assert.ok(decoded.data.every(value => value === 255)); }
    offset += 30 + length + size;
  }
  const centralStart = offset;
  for (const name of names) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const length = view.getUint16(offset + 28, true);
    assert.equal(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length)), name);
    const local = view.getUint32(offset + 42, true); assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint32(offset + 16, true), view.getUint32(local + 14, true));
    offset += 46 + length;
  }
  assert.equal(view.getUint32(offset, true), 0x06054b50);
  assert.equal(view.getUint16(offset + 10, true), 13);
  assert.equal(view.getUint32(offset + 12, true), offset - centralStart);
  assert.equal(view.getUint32(offset + 16, true), centralStart);
  assert.equal(offset + 22, bytes.length);
  validatePngArchive(bytes, project);
});
test('incomplete, extra, invalid and over-cap frames refuse without a partial archive', () => {
  const project = createProject(); project.frameCount = 12;
  const builder = createPngArchive(project);
  assert.throws(() => builder.finish(), /frame/i);
  assert.throws(() => builder.addFrame(new Uint8Array()), /PNG/i);
  const oversized = new Uint8Array(1024 * 1024 + 1); oversized.set(png());
  assert.throws(() => builder.addFrame(oversized), /MiB|limit/i);
  for (let i = 0; i < 12; i++) builder.addFrame(png());
  assert.throws(() => builder.addFrame(png()), /frame/i);
  assert.ok(builder.finish().length > 0);
  assert.throws(() => builder.finish(), /finished/i);
});
test('truncated PNG, internal CRC damage and wrong dimensions refuse before entering the archive', () => {
  const builder = createPngArchive(createProject()), image = png();
  assert.throws(() => builder.addFrame(image.subarray(0,33)), /PNG|image|truncated/i);
  const corrupt = image.slice();corrupt[corrupt.length-1]^=1;
  assert.throws(() => builder.addFrame(corrupt), /PNG|image|CRC/i);
  const wrong = new PNG({width:639,height:360});wrong.data.fill(255);
  assert.throws(() => builder.addFrame(PNG.sync.write(wrong)), /640|PNG/i);
});
test('exact 96 MiB complete archive admits while one extra byte refuses before frame retention', () => {
  const project=createProject();project.frameCount=96;
  const original=png(), small=createPngArchive(project);
  for(let frame=0;frame<96;frame++)small.addFrame(original);
  const overhead=small.finish().length-96*original.length;
  function padded(size:number) {
    const result=new Uint8Array(size),view=new DataView(result.buffer),at=original.length-12,length=size-original.length-12;
    result.set(original.subarray(0,at));view.setUint32(at,length);result.set(new TextEncoder().encode('paDd'),at+4);
    view.setUint32(at+8+length,crc(result.subarray(at+4,at+8+length)));result.set(original.subarray(at),size-12);
    return result;
  }
  const max=padded(1024*1024),lastSize=96*1024*1024-overhead-95*max.length,builder=createPngArchive(project);
  assert.equal(PNG.sync.read(Buffer.from(max)).width,640); // Padding is disclosed valid ancillary capacity data.
  for(let frame=0;frame<95;frame++)builder.addFrame(max);
  assert.throws(()=>builder.addFrame(padded(lastSize+1)),/96 MiB/);
  builder.addFrame(padded(lastSize));assert.equal(builder.finish().length,96*1024*1024);
});
test('admission rejects modified data, names, dimensions, headers, trailing bytes and another manifest', () => {
  const { project, bytes } = archive();
  for (const position of [0, 6, 14, 30, bytes.length - 6, bytes.length - 1]) {
    const changed = bytes.slice(); changed[position] ^= 1;
    assert.throws(() => validatePngArchive(changed, project));
  }
  const changed = bytes.slice(); changed[100] ^= 1; assert.throws(() => validatePngArchive(changed, project));
  assert.throws(() => validatePngArchive(new Uint8Array([...bytes, 0]), project));
  assert.throws(() => validatePngArchive(bytes, { ...project, title: 'Different' }));
});
