import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectImageHeader, validatePhotoHeader, importPhoto, validatePhoto } from '../src/media.ts';

function png(width = 640, height = 480): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([73, 69, 78, 68], 37);
  return bytes;
}

function jpeg(width = 640, height = 480): Uint8Array {
  return Uint8Array.from([
    255, 216, 255, 224, 0, 4, 0, 0,
    255, 192, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3,
    1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
  ]);
}

function webp(width = 640, height = 480, kind: 'VP8X' | 'VP8L' | 'VP8 ' = 'VP8X'): Uint8Array {
  const dataSize = kind === 'VP8L' ? 5 : 10;
  const bytes = new Uint8Array(20 + dataSize + (dataSize % 2));
  bytes.set([...Buffer.from('RIFF')]);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set([...Buffer.from('WEBP')], 8);
  bytes.set([...Buffer.from(kind)], 12);
  new DataView(bytes.buffer).setUint32(16, dataSize, true);
  if (kind === 'VP8X') {
    const view = new DataView(bytes.buffer);
    view.setUint32(24, width - 1, true);
    bytes[27] = (height - 1) & 255;
    bytes[28] = ((height - 1) >> 8) & 255;
    bytes[29] = ((height - 1) >> 16) & 255;
  } else if (kind === 'VP8L') {
    bytes[20] = 0x2f;
    new DataView(bytes.buffer).setUint32(21, ((height - 1) << 14) | (width - 1), true);
  } else {
    bytes.set([0, 0, 0, 157, 1, 42], 20);
    const view = new DataView(bytes.buffer);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  }
  return bytes;
}

test('bounded image headers identify PNG, JPEG and all three WebP header forms', () => {
  for (const [bytes, mimeType, format] of [
    [png(), 'image/png', 'png'], [jpeg(), 'image/jpeg', 'jpeg'],
    [webp(), 'image/webp', 'webp'], [webp(640, 480, 'VP8L'), 'image/webp', 'webp'],
    [webp(640, 480, 'VP8 '), 'image/webp', 'webp'],
  ] as const) {
    assert.deepEqual(inspectImageHeader(bytes, mimeType), { format, width: 640, height: 480 });
  }
});

test('dimensions are bounded before decoder access with exact resource boundaries', () => {
  assert.equal(inspectImageHeader(png(8000, 2000), 'image/png').width, 8000);
  for (const bytes of [png(8001, 1), png(5000, 4000), png(0, 1)]) {
    assert.throws(() => inspectImageHeader(bytes, 'image/png'), /dimensions|pixels|8000|16/i);
  }
  assert.throws(() => inspectImageHeader(jpeg(8001, 1), 'image/jpeg'), /dimensions|8000/i);
  assert.throws(() => inspectImageHeader(webp(5000, 4000), 'image/webp'), /pixels|dimensions|16/i);
});

test('WebP canvas metadata cannot conceal oversized or mismatched compressed-frame dimensions', () => {
  for (const [width, height] of [[9000, 1], [100, 100]]) {
    const canvasHeader = webp(640, 480);
    const frame = webp(width, height, 'VP8 ').subarray(12);
    const combined = new Uint8Array(canvasHeader.length + frame.length);
    combined.set(canvasHeader);
    combined.set(frame, canvasHeader.length);
    new DataView(combined.buffer).setUint32(4, combined.length - 8, true);
    assert.throws(() => inspectImageHeader(combined, 'image/webp'), /dimensions|8000|metadata/i);
  }
});

test('magic must match the allowed MIME type and truncated containers are rejected', () => {
  for (const [bytes, type] of [[png(), 'image/jpeg'], [jpeg(), 'image/png'], [webp(), 'image/gif']] as const) {
    assert.throws(() => inspectImageHeader(bytes, type), /type|format|PNG|JPEG|WebP/i);
  }
  for (const [bytes, type] of [[png(), 'image/png'], [jpeg(), 'image/jpeg'], [webp(), 'image/webp']] as const) {
    assert.throws(() => inspectImageHeader(bytes.subarray(0, bytes.length - 2), type), /corrupt|truncated|invalid/i);
  }
  const corruptPng = png();
  new DataView(corruptPng.buffer).setUint32(8, 0xffffffff);
  assert.throws(() => inspectImageHeader(corruptPng, 'image/png'), /corrupt|truncated|invalid/i);
  const corruptWebp = webp();
  new DataView(corruptWebp.buffer).setUint32(16, 0xffffffff, true);
  assert.throws(() => inspectImageHeader(corruptWebp, 'image/webp'), /corrupt|truncated|invalid/i);
});

test('JPEG marker scanning handles metadata but rejects unbounded or invalid segments', () => {
  const corrupt = jpeg();
  corrupt[4] = 255;
  corrupt[5] = 255;
  assert.throws(() => inspectImageHeader(corrupt, 'image/jpeg'), /corrupt|truncated|invalid/i);
  const noFrame = Uint8Array.from([255, 216, 255, 218, 0, 2, 255, 217]);
  assert.throws(() => inspectImageHeader(noFrame, 'image/jpeg'), /dimensions|corrupt|invalid/i);
  const giantMetadata = new Uint8Array(350_000);
  giantMetadata.set([255, 216]);
  let offset = 2;
  while (offset + 60_004 < giantMetadata.length) {
    giantMetadata.set([255, 225, 234, 98], offset);
    offset += 60_004;
  }
  giantMetadata.set(jpeg().subarray(8), offset);
  giantMetadata.set([255, 217], giantMetadata.length - 2);
  assert.throws(() => inspectImageHeader(giantMetadata, 'image/jpeg'), /header|metadata|corrupt|invalid/i);
});

test('backup photo headers round trip and require canonical JPEG data URI and matching dimensions', () => {
  const bytes = jpeg(100, 200);
  const photo = { dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`, width: 100, height: 200, name: 'portrait.jpg' };
  assert.deepEqual(validatePhotoHeader(photo), bytes);
  for (const bad of [
    { ...photo, width: 101 }, { ...photo, height: 1201 },
    { ...photo, dataUrl: 'https://example.test/photo.jpg' },
    { ...photo, dataUrl: photo.dataUrl.replace('jpeg', 'png') },
    { ...photo, dataUrl: 'data:image/jpeg;base64,%%%%' },
    { ...photo, dataUrl: `data:image/jpeg;base64,${'A'.repeat(3 * 1024 * 1024)}` },
    { ...photo, name: 'x'.repeat(121) },
  ]) assert.throws(() => validatePhotoHeader(bad), /photo|JPEG|image|dimension|name|size|MiB|metadata/i);
});

test('null backup photos need no decoder and invalid encoded backup dimensions fail before decode', async () => {
  await validatePhoto(null);
  await assert.rejects(validatePhoto({ dataUrl: `data:image/jpeg;base64,${Buffer.from(jpeg(8001, 1)).toString('base64')}`, width: 1, height: 1, name: 'bad.jpg' }), /dimensions|8000|metadata/i);
});

test('oversized imports fail without reading or decoding file bytes', async () => {
  let read = false;
  const file = {
    size: 10 * 1024 * 1024 + 1, type: 'image/png', name: 'too-large.png',
    arrayBuffer: () => { read = true; throw new Error('Must not read'); },
  } as unknown as File;
  await assert.rejects(importPhoto(file), /10 MiB|size|large/i);
  assert.equal(read, false);
});
