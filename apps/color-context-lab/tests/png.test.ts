import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { inspectPng, encodePng } from '../src/png.ts';
import type { Raster } from '../src/types.ts';
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function crc(bytes: Uint8Array): number { let value=0xffffffff; for(const byte of bytes) { value ^= byte; for(let bit=0;bit<8;bit++) value=(value>>>1)^((value&1)?0xedb88320:0); } return (value^0xffffffff)>>>0; }
function chunk(name:string, bytes:Uint8Array): Buffer { const head=Buffer.alloc(8); head.writeUInt32BE(bytes.length); head.write(name,4); const body=Buffer.concat([head.subarray(4),bytes]), tail=Buffer.alloc(4); tail.writeUInt32BE(crc(body)); return Buffer.concat([head,bytes,tail]); }
function header(width=1,height=1,type=6,depth=8,interlace=0): Buffer { const b=Buffer.alloc(13); b.writeUInt32BE(width); b.writeUInt32BE(height,4); b[8]=depth;b[9]=type;b[12]=interlace;return chunk('IHDR',b); }
const data=()=>chunk('IDAT',deflateSync(Buffer.from([0,23,45,67,255])));
function png(middle:Buffer[]=[],h=header()): Uint8Array { return Buffer.concat([signature,h,...middle,data(),chunk('IEND',Buffer.alloc(0))]); }
function chunks(bytes: Uint8Array): {name:string;data:Buffer}[] { const b=Buffer.from(bytes); const result=[]; for(let at=8;at<b.length;) { const size=b.readUInt32BE(at); const name=b.toString('ascii',at+4,at+8), payload=b.subarray(at+8,at+8+size); assert.equal(b.readUInt32BE(at+8+size),crc(b.subarray(at+4,at+8+size))); result.push({name,data:payload});at+=size+12; }return result; }

test('PNG admission walks complete CRC-valid RGB/RGBA chunks and bounded source dimensions',()=>{
  assert.deepEqual(inspectPng(png()),{width:1,height:1,colorType:6});
  assert.deepEqual(inspectPng(png([],header(8192,1,2))),{width:8192,height:1,colorType:2});
  assert.throws(()=>inspectPng(png([],header(8192,2048))));
  assert.throws(()=>inspectPng(png([],header(8193,1))));
});
test('PNG rejects bad CRC, every truncated prefix, duplicate headers/end, trailing bytes and separated IDAT',()=>{
  const valid=png();assert.deepEqual(inspectPng(valid),{width:1,height:1,colorType:6});
  for(let end=0;end<valid.length;end++)assert.throws(()=>inspectPng(valid.subarray(0,end)));
  const wrong=valid.slice();wrong[29]^=1;assert.throws(()=>inspectPng(wrong));
  assert.throws(()=>inspectPng(png([header()])));
  assert.throws(()=>inspectPng(Buffer.concat([valid,Buffer.from([0])])));
  assert.throws(()=>inspectPng(Buffer.concat([signature,header(),data(),chunk('tEXt',Buffer.from('x\0y')),data(),chunk('IEND',Buffer.alloc(0))])));
});
test('supported subset rejects palette, animation, orientation, invalid chunk spelling and unsupported header modes',()=>{
  assert.deepEqual(inspectPng(png()),{width:1,height:1,colorType:6});
  for(const name of ['PLTE','acTL','fcTL','fdAT','eXIf','ABCD','tExt','tx1t']) assert.throws(()=>inspectPng(png([chunk(name,Buffer.from([0]))])),name);
  for(const h of [header(1,1,0),header(1,1,3),header(1,1,6,16),header(1,1,6,8,1),header(0,1)])assert.throws(()=>inspectPng(png([],h)));
});
test('ancillary bound counts payload plus twelve framing bytes exactly',()=>{
  const exact=chunk('tEXt',Buffer.alloc(256*1024-12,65));
  assert.deepEqual(inspectPng(png([exact])),{width:1,height:1,colorType:6});
  assert.throws(()=>inspectPng(png([chunk('tEXt',Buffer.alloc(256*1024-11,65))])));
});
test('exact PNG emits sRGB and lossless straight RGBA including hidden and low-alpha RGB',()=>{
  const pixels=new Uint8ClampedArray([1,2,3,0,4,5,6,1,255,128,10,255]);
  const before=pixels.slice(), encoded=encodePng({width:3,height:1,rgba:pixels});
  const parts=chunks(encoded);assert.deepEqual(parts.map(p=>p.name),['IHDR','sRGB','IDAT','IEND']);
  assert.deepEqual(parts[1]!.data,Buffer.from([0]));
  assert.deepEqual(inflateSync(parts[2]!.data),Buffer.from([0,...pixels]));
  assert.deepEqual(pixels,before);assert.deepEqual(inspectPng(encoded),{width:3,height:1,colorType:6});
});
test('stored-DEFLATE crosses block boundaries and maximum976 raster fits exact4MiB bound',()=>{
  for(const side of [128,976]) {
    const pixels=new Uint8ClampedArray(side*side*4);for(let i=0;i<pixels.length;i++)pixels[i]=(i*31)%256;
    const encoded=encodePng({width:side,height:side,rgba:pixels}), parts=chunks(encoded), raw=inflateSync(parts[2]!.data);
    assert.equal(raw.length,side*(side*4+1));
    for(let y=0;y<side;y++){assert.equal(raw[y*(side*4+1)],0);assert.deepEqual(raw.subarray(y*(side*4+1)+1,(y+1)*(side*4+1)),Buffer.from(pixels.subarray(y*side*4,(y+1)*side*4)));}
    assert.ok(encoded.length<=4*1024*1024);if(side===976)assert.equal(encoded.length,3811651);
  }
});
test('encoder rejects invalid dimensions and incomplete typed rasters before exporting',()=>{
  for(const value of [{width:0,height:1,rgba:new Uint8ClampedArray(0)},{width:977,height:1,rgba:new Uint8ClampedArray(3908)},{width:1,height:1,rgba:new Uint8ClampedArray(3)},{width:1,height:1,rgba:[1,2,3,4]}])assert.throws(()=>encodePng(value as Raster));
});
