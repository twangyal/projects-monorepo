import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPhotoHeader, validatePhotoAsset } from '../src/photo-header.ts';

function jpeg(width = 720, height = 720, size = 17): Uint8Array {
  const parts: number[] = [255, 216];
  let remaining = size - 17;
  while (remaining > 0) {
    if (remaining < 4) throw new Error('Invalid fixture padding.');
    const payload = Math.min(65533, remaining - 4);
    parts.push(255, 254, (payload + 2) >> 8, (payload + 2) & 255);
    for (let i = 0; i < payload; i++) parts.push(0);
    remaining -= payload + 4;
  }
  parts.push(255, 192, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 17, 0, 255, 217);
  return Uint8Array.from(parts);
}
const uri = (bytes: Uint8Array) => 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
const asset = (bytes = jpeg()) => ({ id: 'a'.repeat(32), mime: 'image/jpeg', width: 720, height: 720, dataUrl: uri(bytes) });

test('stored photos validate JPEG header dimensions and return a detached exact shape', () => {
  const input = asset(); const result = validatePhotoAsset(input);
  assert.deepEqual(result, input); assert.notEqual(result, input);
  assert.equal(validatePhotoAsset(asset(jpeg(720, 720, 204800))).width, 720);
});
test('stored photo cap measures decoded bytes rather than URI length', () => {
  assert.throws(() => validatePhotoAsset(asset(jpeg(720, 720, 204801))), /200 KiB|204800/);
});
test('exact fields, normalized dimensions, ID and MIME are required', () => {
  for (const input of [null, [], { ...asset(), extra: true }, { ...asset(), width: 721 }, { ...asset(), height: NaN },
    { ...asset(), id: 'invalid' }, { ...asset(), mime: 'image/png' }, asset(jpeg(719)), { ...asset(), dataUrl: 'https://example.com/photo.jpg' }]) {
    assert.throws(() => validatePhotoAsset(input));
  }
  assert.throws(() => validatePhotoAsset(Object.assign(Object.create({ inherited: true }), asset())));
  const accessor = { ...asset() }; Object.defineProperty(accessor, 'dataUrl', { get() { throw new Error('Accessor must not run'); } });
  assert.throws(() => validatePhotoAsset(accessor), /plain|data|fields/i);
});
test('base64 rejects noncanonical bits, whitespace, wrong prefix and malformed padding', () => {
  for (const encoded of ['AA=A', 'AB==', 'AAA', 'AAAA\n', 'data:image/jpeg;base64,AAAA']) {
    assert.throws(() => validatePhotoAsset({ ...asset(), dataUrl: 'data:image/jpeg;base64,' + encoded }), /base64|JPEG/i);
  }
});
test('malformed JPEG segments and concealed frame headers are rejected before decoding', () => {
  for (const bytes of [jpeg().subarray(0, 12), Uint8Array.of(255, 216, 255, 224, 255, 255, 255, 217),
    Uint8Array.from([...jpeg().subarray(0, 15), ...jpeg(8193, 1).subarray(2)])]) assert.throws(() => inspectPhotoHeader(bytes), /corrupt|truncated|dimensions|frame/i);
  assert.throws(() => inspectPhotoHeader(jpeg(5000, 4000)), /pixels/);
  assert.throws(() => inspectPhotoHeader(jpeg(8193, 1)), /8192|dimensions/);
  assert.throws(() => inspectPhotoHeader(jpeg(), 'image/png'), /match/);
  assert.throws(() => inspectPhotoHeader(new Uint8Array(8388609)), /8 MiB/);
  assert.throws(() => inspectPhotoHeader(new TextEncoder().encode('<svg/>')), /JPEG|PNG|WebP/);
});

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function pngChunk(name: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12); new DataView(result.buffer).setUint32(0, data.length);
  result.set(new TextEncoder().encode(name), 4); result.set(data, 8); return result;
}
function png(width: number, height: number, animated = false): Uint8Array {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  return concat(Uint8Array.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header),
    ...(animated ? [pngChunk('acTL', new Uint8Array(8))] : []), pngChunk('IDAT', Uint8Array.of(0)), pngChunk('IEND', new Uint8Array()));
}
function webp(animated = false, width = 720, height = 720): Uint8Array {
  const result = new Uint8Array(44), view = new DataView(result.buffer);
  result.set(new TextEncoder().encode('RIFF')); view.setUint32(4, 36, true); result.set(new TextEncoder().encode('WEBPVP8X'), 8);
  view.setUint32(16, 10, true); result[20] = animated ? 2 : 0;
  for (let i = 0; i < 3; i++) { result[24+i] = (width-1) >> (8*i); result[27+i] = (height-1) >> (8*i); }
  result.set(new TextEncoder().encode('VP8L'), 30); view.setUint32(34, 5, true); result[38] = 47;
  view.setUint32(39, (width-1) | ((height-1) << 14), true); return result;
}
test('source static PNG/WebP headers enforce animation, matching dimensions, truncation and edge limits', () => {
  assert.deepEqual(inspectPhotoHeader(png(800, 400)), { format:'png',width:800,height:400 });
  assert.deepEqual(inspectPhotoHeader(webp()), { format:'webp',width:720,height:720 });
  for (const bytes of [png(720,720,true), webp(true)]) assert.throws(() => inspectPhotoHeader(bytes), /animated|static/i);
  for (const bytes of [png(8193,1), png(5000,4000), webp(false,8193,1), png(1,1).subarray(0,45), webp().subarray(0,40)]) assert.throws(() => inspectPhotoHeader(bytes));
  const mismatch = webp(); mismatch[39] = 3; assert.throws(() => inspectPhotoHeader(mismatch), /dimensions|match/i);
});
test('source JPEGs can contain bounded legal metadata beyond stored JPEG cap', () => {
  assert.equal(inspectPhotoHeader(jpeg(720, 720, 524288)).width, 720);
});

test('JPEG orientation is read from bounded TIFF metadata for correct phone-photo decoding', () => {
  const exif = new Uint8Array(36), view = new DataView(exif.buffer);
  exif.set([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0]);
  view.setUint16(20,0x112,true);view.setUint16(22,3,true);view.setUint32(24,1,true);view.setUint16(28,6,true);
  const source=concat(jpeg(120,60).subarray(0,2),exif,jpeg(120,60).subarray(2));
  assert.equal(inspectPhotoHeader(source).orientation,6);
  const malformed=source.slice();new DataView(malformed.buffer).setUint32(16,0xffffffff,true);
  assert.throws(()=>inspectPhotoHeader(malformed),/EXIF|corrupt|metadata/i);
});

function tiff(orientation: number): Uint8Array {
  const result=new Uint8Array(26),view=new DataView(result.buffer);
  result.set([73,73,42,0,8,0,0,0,1,0]);view.setUint16(10,0x112,true);view.setUint16(12,3,true);view.setUint32(14,1,true);view.setUint16(18,orientation,true);return result;
}
test('PNG eXIf and WebP EXIF read bounded TIFF orientation without losing container dimensions',()=>{
  const base=png(120,60),oriented=concat(base.subarray(0,33),pngChunk('eXIf',tiff(6)),base.subarray(33));
  assert.equal(inspectPhotoHeader(oriented).orientation,6);
  const source=webp(false,120,60),chunk=new Uint8Array(34);chunk.set(new TextEncoder().encode('EXIF'));new DataView(chunk.buffer).setUint32(4,26,true);chunk.set(tiff(6),8);
  const combined=concat(source,chunk);new DataView(combined.buffer).setUint32(4,combined.length-8,true);combined[20]|=8;
  assert.equal(inspectPhotoHeader(combined).orientation,6);
  const invalid=tiff(9);assert.throws(()=>inspectPhotoHeader(concat(base.subarray(0,33),pngChunk('eXIf',invalid),base.subarray(33))),/corrupt|EXIF/i);
});
