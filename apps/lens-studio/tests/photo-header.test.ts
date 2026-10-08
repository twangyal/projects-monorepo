import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPhotoHeader, validatePhotoAsset } from '../src/photo-header.ts';
import { asset, chunk, concat, jpeg, png, pngHeader, tiff, webp } from './photo-fixtures.ts';

test('normalized PNG assets have exact detached fields and actual matching header dimensions', () => {
  const input=asset(), output=validatePhotoAsset(input);
  assert.deepEqual(output,input); assert.notEqual(output,input);
  assert.deepEqual(inspectPhotoHeader(png()),{format:'png',width:2,height:1,orientation:1});
  for(const value of [null,[],{...input,extra:true},{...input,width:3},{...input,height:NaN},{...input,id:'bad'},asset(jpeg()),{...input,dataUrl:'https://example.com/a.png'},asset(pngHeader(1281,1),1281,1)]) assert.throws(()=>validatePhotoAsset(value));
});
test('stored metadata, accessors, inherited objects and noncanonical base64 are rejected', () => {
  for(const name of ['eXIf','tEXt','zTXt','iTXt']) assert.throws(()=>validatePhotoAsset(asset(png(2,1,[chunk(name,name==='eXIf'?tiff(1):Uint8Array.of(1))]))),/metadata|orientation/i);
  const getter={...asset()};Object.defineProperty(getter,'dataUrl',{get(){throw new Error('Accessor ran');}}); assert.throws(()=>validatePhotoAsset(getter),/plain|data|fields/i);
  assert.throws(()=>validatePhotoAsset(Object.assign(Object.create({ inherited:true }),asset())));
  for(const encoded of ['AB==','AAA','AA=A','AAAA\n']) assert.throws(()=>validatePhotoAsset({...asset(),dataUrl:'data:image/png;base64,'+encoded}),/base64/i);
});
test('source header gate rejects animation, truncation, checksum corruption and unsafe dimensions', () => {
  for(const bytes of [pngHeader(8193,1),pngHeader(5000,4000),webp(8193,1),png(2,1,[chunk('acTL',new Uint8Array(8))]),webp(120,60,undefined,true),png().subarray(0,40),jpeg().subarray(0,8),webp().subarray(0,40)]) assert.throws(()=>inspectPhotoHeader(bytes));
  const bad=png();bad[29]^=1;assert.throws(()=>inspectPhotoHeader(bad),/corrupt|checksum/i);
  assert.throws(()=>inspectPhotoHeader(new Uint8Array(8388609)),/8 MiB/);
  assert.throws(()=>inspectPhotoHeader(new TextEncoder().encode('<svg/>')),/PNG|JPEG|WebP/);
});
test('all orientation values are bounded and parsed from JPEG, PNG and WebP metadata', () => {
  for(let orientation=1;orientation<=8;orientation++) {
    for(const bytes of [jpeg(120,60,orientation),png(120,60,[chunk('eXIf',tiff(orientation))]),webp(120,60,orientation)]) assert.equal(inspectPhotoHeader(bytes).orientation,orientation);
  }
  for(const bytes of [jpeg(120,60,9),png(2,1,[chunk('eXIf',tiff(9))]),webp(120,60,0)]) assert.throws(()=>inspectPhotoHeader(bytes),/corrupt|orientation/i);
  const metadata=tiff(6);new DataView(metadata.buffer).setUint32(4,0xffffffff,true);assert.throws(()=>inspectPhotoHeader(png(2,1,[chunk('eXIf',metadata)])));
  assert.throws(()=>inspectPhotoHeader(png(2,1,[chunk('eXIf',tiff(1)),chunk('eXIf',tiff(1))])));
});
test('normalized decoded-byte cap applies before compressed image inspection', () => {
  const oversized='A'.repeat(Math.ceil((7340032+1)/3)*4);
  assert.throws(()=>validatePhotoAsset({...asset(),dataUrl:'data:image/png;base64,'+oversized}),/7 MiB|size|bytes/i);
  const duplicate=concat(png().subarray(0,33),png().subarray(8));assert.throws(()=>inspectPhotoHeader(duplicate));
});
