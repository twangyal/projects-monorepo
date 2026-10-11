import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
const api=await import('../src/mask-png.ts').catch(()=>null);
function file(){const p=new PNG({width:2,height:1});p.data=Buffer.from([105,159,144,255,118,132,200,255]);return PNG.sync.write(p);}
function crc(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function patch(bytes:Buffer,type:string,change:(payload:Buffer)=>void){const out=Buffer.from(bytes);let offset=8;while(offset<out.length){const n=out.readUInt32BE(offset);if(out.toString('ascii',offset+4,offset+8)===type){change(out.subarray(offset+8,offset+8+n));out.writeUInt32BE(crc(out.subarray(offset+4,offset+8+n)),offset+8+n);return out;}offset+=n+12;}throw Error('Missing chunk');}
test('strict mask PNG admits actual compressed stream and refuses corrupt Adler32',async()=>{assert.ok(api,'Strict mask stream admission is missing');await api.validateMaskPng(file(),2,1);const bad=patch(file(),'IDAT',p=>{p[p.length-1]^=1;});await assert.rejects(api.validateMaskPng(bad,2,1));});
test('strict mask PNG rejects precision conversion and wrong dimensions before native decoding',async()=>{assert.ok(api);const precise=patch(file(),'IHDR',p=>{p[8]=16;});await assert.rejects(api.validateMaskPng(precise,2,1),/8-bit/);await assert.rejects(api.validateMaskPng(file(),1,1),/dimensions/);});
function chunk(type:string,payload:Buffer){const out=Buffer.alloc(payload.length+12);out.writeUInt32BE(payload.length);out.write(type,4,'ascii');payload.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,out.length-4)),out.length-4);return out;}
function rewriteData(transform:(payload:Buffer)=>Buffer){const source=file(),parts=[source.subarray(0,8)];let offset=8;while(offset<source.length){const n=source.readUInt32BE(offset),type=source.toString('ascii',offset+4,offset+8),payload=source.subarray(offset+8,offset+8+n);parts.push(chunk(type,type==='IDAT'?transform(payload):payload));offset+=n+12;}return Buffer.concat(parts);}
test('strict zlib validation refuses trailing garbage and excess decoded rows',async()=>{
 assert.ok(api);await assert.rejects(api.validateMaskPng(rewriteData(p=>Buffer.concat([p,Buffer.from([1,2,3])])),2,1));
 const {deflateSync}=await import('node:zlib');await assert.rejects(api.validateMaskPng(rewriteData(()=>deflateSync(Buffer.alloc(100))),2,1),/exceeds/);await assert.rejects(api.validateMaskPng(rewriteData(()=>deflateSync(Buffer.from([5,105,159,144,255,118,132,200,255]))),2,1),/filter/);
});
test('strict chunk order refuses palette after image data and unknown critical chunks',async()=>{
 assert.ok(api);const source=file(),end=source.length-12;for(const type of ['PLTE','ABCD'])await assert.rejects(api.validateMaskPng(Buffer.concat([source.subarray(0,end),chunk(type,Buffer.from([0,0,0])),source.subarray(end)]),2,1));
});
