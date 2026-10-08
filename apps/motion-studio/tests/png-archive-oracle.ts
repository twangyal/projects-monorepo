import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

// Test-only ZIP reader with an independent bitwise CRC and actual PNG decoding.
export function inspectFrames(buffer: Buffer) {
  const frames: PNG[] = [], names: string[] = [], positions: number[] = [];
  let manifest: Record<string, unknown> = {}, at = 0;
  function crc(data: Uint8Array) {
    let result = 0xffffffff;
    for (const value of data) { result ^= value; for (let bit=0;bit<8;bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0); }
    return (result ^ 0xffffffff) >>> 0;
  }
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    positions.push(at);
    assert.equal(buffer.readUInt16LE(at+6),0);assert.equal(buffer.readUInt16LE(at+8),0);assert.equal(buffer.readUInt16LE(at+28),0);
    const size=buffer.readUInt32LE(at+18), n=buffer.readUInt16LE(at+26),name=buffer.subarray(at+30,at+30+n).toString();
    names.push(name);assert.equal(buffer.readUInt32LE(at+22),size);
    const data=buffer.subarray(at+30+n,at+30+n+size);assert.equal(crc(data),buffer.readUInt32LE(at+14));
    if (names.length===1) { assert.equal(name,'manifest.json');manifest=JSON.parse(data.toString()); }
    else {
      assert.equal(name,`frames/frame-${String(frames.length+1).padStart(4,'0')}.png`);
      assert.ok(data.length<=1024*1024);const png=PNG.sync.read(data,{checkCRC:true});assert.equal(png.width,640);assert.equal(png.height,360);
      for (let i=3;i<png.data.length;i+=4) assert.equal(png.data[i],255);
      frames.push(png);
    }
    at+=30+n+size;
  }
  const central=at;
  for (let i=0;i<names.length;i++) {
    assert.equal(buffer.readUInt32LE(at),0x02014b50);const n=buffer.readUInt16LE(at+28);
    assert.equal(buffer.subarray(at+46,at+46+n).toString(),names[i]);assert.equal(buffer.readUInt32LE(at+42),positions[i]);
    assert.equal(buffer.readUInt32LE(at+16),buffer.readUInt32LE(positions[i]+14));
    assert.equal(buffer.readUInt32LE(at+20),buffer.readUInt32LE(positions[i]+18));
    at+=46+n;
  }
  assert.equal(buffer.readUInt32LE(at),0x06054b50);assert.equal(buffer.readUInt16LE(at+8),names.length);assert.equal(buffer.readUInt16LE(at+10),names.length);
  assert.equal(buffer.readUInt32LE(at+12),at-central);assert.equal(buffer.readUInt32LE(at+16),central);assert.equal(buffer.length,at+22);
  assert.equal(manifest.format,'motion-studio-png-frames');assert.equal(manifest.version,1);assert.equal(manifest.width,640);assert.equal(manifest.height,360);assert.equal(manifest.frameCount,frames.length);
  assert.deepEqual(manifest.fps,{numerator:12,denominator:1});assert.deepEqual(manifest.frames,names.slice(1));
  return { manifest, frames };
}
