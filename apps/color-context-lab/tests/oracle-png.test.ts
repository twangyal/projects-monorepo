import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync, deflateSync } from 'node:zlib';
import { inspectPng, encodePng } from '../src/png.ts';

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
// Independent bitwise CRC oracle: production uses a lookup table.
function crc(bytes: Uint8Array) { let c=0xffffffff; for(const b of bytes) { c^=b; for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
function chunk(type:string,data=Buffer.alloc(0)) {
  const body=Buffer.concat([Buffer.from(type),data]); const size=Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum=Buffer.alloc(4); checksum.writeUInt32BE(crc(body)); return Buffer.concat([size,body,checksum]);
}
function header(w=2,h=1,color=6,depth=8,interlace=0) {
  const data=Buffer.alloc(13); data.writeUInt32BE(w,0); data.writeUInt32BE(h,4); data[8]=depth; data[9]=color; data[12]=interlace;
  return chunk('IHDR',data);
}
function fixture(chunks:Buffer[]) { return Buffer.concat([signature,...chunks]); }
function valid() { return fixture([header(),chunk('IDAT',deflateSync(Buffer.from([0,11,22,33,0,44,55,66,1]))),chunk('IEND')]); }
function decode(bytes:Uint8Array) {
  const png=Buffer.from(bytes); assert.deepEqual(png.subarray(0,8),signature);
  let at=8; let width=0,height=0; const types:string[]=[]; const idats:Buffer[]=[];
  while(at<png.length) {
    const size=png.readUInt32BE(at); const type=png.toString('ascii',at+4,at+8); types.push(type);
    const data=png.subarray(at+8,at+8+size);
    assert.equal(png.readUInt32BE(at+8+size),crc(png.subarray(at+4,at+8+size)));
    if(type==='IHDR') { width=data.readUInt32BE(0); height=data.readUInt32BE(4); assert.deepEqual([...data.subarray(8)],[8,6,0,0,0]); }
    if(type==='sRGB') assert.deepEqual([...data],[0]);
    if(type==='IDAT') idats.push(data);
    at+=size+12;
  }
  assert.equal(at,png.length); assert.deepEqual(types,['IHDR','sRGB','IDAT','IEND']);
  const raw=inflateSync(Buffer.concat(idats)); assert.equal(raw.length,height*(width*4+1));
  const pixels=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++) { const start=y*(width*4+1); assert.equal(raw[start],0); raw.copy(pixels,y*width*4,start+1,start+1+width*4); }
  return {width,height,pixels};
}
test('inspects independently compressed PNG and preserves source/header dimensions',()=>{
  assert.deepEqual(inspectPng(valid()),{width:2,height:1,colorType:6});
  assert.deepEqual(inspectPng(fixture([header(3,5,2),chunk('IDAT',Buffer.from([1])),chunk('IEND')])),{width:3,height:5,colorType:2});
});
test('export is independently inflated with CRC/Adler checks and exact zero-alpha RGB',()=>{
  const rgba=new Uint8ClampedArray([201,17,255,0,12,45,78,1]);
  const result=decode(encodePng({width:2,height:1,rgba}));
  assert.equal(result.width,2); assert.deepEqual(result.pixels,Buffer.from(rgba));
});
test('maximum output stays within 4 MiB with exact stored-block boundaries',()=>{
  const rgba=new Uint8ClampedArray(976*976*4);
  for(let i=0;i<rgba.length;i++) rgba[i]=(i*73+19)%256;
  const png=encodePng({width:976,height:976,rgba});
  assert.ok(png.length<=4*1024*1024); const result=decode(png);
  assert.equal(result.height,976); assert.deepEqual(result.pixels,Buffer.from(rgba));
});
test('rejects CRC corruption, truncation, wrong signature, trailing bytes and oversized input',()=>{
  const corrupt=valid(); corrupt[29]=corrupt[29]!^1;
  for(const bytes of [corrupt,valid().subarray(0,valid().length-1),Buffer.from('not a png'),Buffer.concat([valid(),Buffer.from([0])]),Buffer.alloc(8*1024*1024+1)]) assert.throws(()=>inspectPng(bytes));
});
test('rejects unsupported raster modes and dimension/pixel bounds',()=>{
  for(const h of [header(0,1),header(8193,1),header(4096,4096),header(2,1,3),header(2,1,0),header(2,1,6,16),header(2,1,6,8,1)]) assert.throws(()=>inspectPng(fixture([h,chunk('IDAT',Buffer.from([1])),chunk('IEND')])));
  assert.throws(()=>encodePng({width:977,height:1,rgba:new Uint8ClampedArray(977*4)}));
  assert.throws(()=>encodePng({width:1,height:1,rgba:new Uint8ClampedArray(3)}));
});
test('chunk grammar rejects reordered, duplicate, unsupported and interrupted critical groups',()=>{
  const idat=chunk('IDAT',Buffer.from([1])); const end=chunk('IEND');
  const malformed=[
    [idat,header(),end],[header(),header(),idat,end],[header(),end],
    [header(),chunk('IDAT'),end],[header(),idat,chunk('tEXt'),idat,end],
    [header(),chunk('PLTE'),idat,end],[header(),chunk('ABCD'),idat,end],
    [header(),chunk('acTL'),idat,end],[header(),chunk('eXIf'),idat,end],
    [header(),chunk('abca'),idat,end],[header(),chunk('a1Ca'),idat,end],
    [header(),idat,chunk('IEND',Buffer.from([0]))],
  ];
  for(const chunks of malformed) assert.throws(()=>inspectPng(fixture(chunks)));
});
test('ancillary cap includes framing and legal split IDAT groups remain admissible',()=>{
  const compressed=deflateSync(Buffer.from([0,11,22,33,0,44,55,66,1]));
  const first=chunk('IDAT',compressed.subarray(0,5));
  const second=chunk('IDAT',compressed.subarray(5)); const end=chunk('IEND');
  const text=(size:number)=>{const data=Buffer.alloc(size,65); data.write('Comment\0'); return chunk('tEXt',data);};
  assert.deepEqual(inspectPng(fixture([header(),text(256*1024-12),first,second,end])),{width:2,height:1,colorType:6});
  assert.throws(()=>inspectPng(fixture([header(),text(256*1024-11),first,second,end])));
});
