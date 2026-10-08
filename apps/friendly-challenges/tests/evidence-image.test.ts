import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPhotoHeader, stripGeneratedJpegMetadata } from '../src/photo-header.ts';
import { normalizeEvidenceImage } from '../src/evidence-image.ts';
function crc(bytes:Uint8Array):number{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(name:string,body:Uint8Array):Uint8Array<ArrayBuffer>{const out=new Uint8Array(body.length+12),v=new DataView(out.buffer);v.setUint32(0,body.length);out.set(new TextEncoder().encode(name),4);out.set(body,8);v.setUint32(body.length+8,crc(out.subarray(4,body.length+8)));return out;}
function png(w=4,h=2,animated=false):Uint8Array<ArrayBuffer>{const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);v.setUint32(0,w);v.setUint32(4,h);ihdr[8]=8;ihdr[9]=6;const parts=[Uint8Array.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...(animated?[chunk('acTL',new Uint8Array(8))]:[]),chunk('IDAT',Uint8Array.of(1)),chunk('IEND',new Uint8Array())];const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let n=0;for(const p of parts){out.set(p,n);n+=p.length;}return out;}
// Header-only original fixtures: full compressed-pixel validity remains native decode authority.
function orientedJpeg():Uint8Array<ArrayBuffer>{return Uint8Array.from([255,216,255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0,255,192,0,17,8,0,2,0,4,3,1,17,0,2,17,0,3,17,0,255,218,0,2,255,217]);}
function generated(w=4,h=2,size=100):Uint8Array<ArrayBuffer>{const out=new Uint8Array(size);out.set([255,216,255,192,0,17,8,h>>>8,h&255,w>>>8,w&255,3,1,17,0,2,17,0,3,17,0,255,218,0,2]);out.set([255,217],size-2);return out;}
const originalBitmap=globalThis.createImageBitmap,originalCanvas=globalThis.OffscreenCanvas;
test.afterEach(()=>{globalThis.createImageBitmap=originalBitmap;globalThis.OffscreenCanvas=originalCanvas;});
function nativeDouble(w=4,h=2,sizes=[100]):{events:string[];closed:()=>number}{let close=0;const events:string[]=[];globalThis.createImageBitmap=async(_source,options)=>{assert.equal(typeof options === 'object' ? options.imageOrientation : undefined,'from-image');return{width:w,height:h,close(){close++;}} as ImageBitmap;};
  class Canvas{width:number;height:number;constructor(width:number,height:number){this.width=width;this.height=height;events.push(`size:${width}x${height}`);}getContext(_kind:string,options:{colorSpace:string}){assert.equal(options.colorSpace,'srgb');return{fillStyle:'',fillRect(){events.push('white');},drawImage(){events.push('draw');},imageSmoothingEnabled:false,imageSmoothingQuality:'low'};}async convertToBlob(options:{type:string;quality:number}){events.push(`quality:${options.quality}`);return new Blob([generated(this.width,this.height,sizes.shift()??100)],{type:options.type});}}
  globalThis.OffscreenCanvas=Canvas as unknown as typeof OffscreenCanvas;return{events,closed:()=>close};}

test('source header admits PNG exact 16 MP and oriented JPEG without decoding',()=>{
  assert.deepEqual(inspectPhotoHeader(png(4000,4000)),{format:'png',width:4000,height:4000,orientation:1});assert.deepEqual(inspectPhotoHeader(orientedJpeg()),{format:'jpeg',width:4,height:2,orientation:6});
});
test('APNG, wrong format, corruption, too many pixels and over 8 MiB fail before browser decoder',async()=>{
  let calls=0;globalThis.createImageBitmap=async()=>{calls++;throw new Error();};
  for(const data of [png(4001,4000),png(4,2,true),Uint8Array.of(71,73,70),png().slice(0,-1),new Uint8Array(8*1024*1024+1)])await assert.rejects(normalizeEvidenceImage(new File([data],'private.png',{type:'image/png'})));
  assert.equal(calls,0);
});
test('normalization caps side without upscale, fills white before draw and closes bitmap',async()=>{
  const n=nativeDouble(4000,2000);const result=await normalizeEvidenceImage(new File([png(4000,2000)],'private.png',{type:'image/png'}));assert.deepEqual([result.width,result.height,result.blob.type],[1024,512,'image/jpeg']);assert.deepEqual(n.events,['size:1024x512','white','draw','quality:0.9']);assert.equal(n.closed(),1);
});
test('orientation is applied by native decoder exactly once and dimensions checked',async()=>{
  const n=nativeDouble(2,4);const result=await normalizeEvidenceImage(new File([orientedJpeg()],'private.jpg',{type:'image/jpeg'}));assert.deepEqual([result.width,result.height],[2,4]);assert.equal(n.closed(),1);
  nativeDouble(4,2);await assert.rejects(normalizeEvidenceImage(new File([orientedJpeg()],'wrong.jpg',{type:'image/jpeg'})),/dimensions/i);
});
test('fixed quality sequence retains first legal blob and refuses final oversize without shrinking',async()=>{
  const n=nativeDouble(4,2,[524289,524289,524288]);const result=await normalizeEvidenceImage(new File([png()],'x.png'));assert.equal(result.blob.size,524288);assert.deepEqual(n.events.filter(e=>e.startsWith('quality:')),['quality:0.9','quality:0.8','quality:0.7']);
  const bad=nativeDouble(4,2,Array(5).fill(524289));await assert.rejects(normalizeEvidenceImage(new File([png()],'x.png')),/512/i);assert.equal(bad.closed(),1);
});
test('abort during pending decode promptly rejects and closes late bitmap without canvas publication',async()=>{
  nativeDouble();let release:(b:ImageBitmap)=>void=()=>{};let closed=0;globalThis.createImageBitmap=()=>new Promise<ImageBitmap>(r=>{release=r;});const controller=new AbortController();
  const pending=normalizeEvidenceImage(new File([png()],'x.png'),controller.signal);await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,{name:'AbortError'});release({width:4,height:2,close(){closed++;}} as ImageBitmap);await new Promise(r=>setImmediate(r));assert.equal(closed,1);
});
test('MIME spoofing and aborted file reads cannot reach decode',async()=>{
  let calls=0;globalThis.createImageBitmap=async()=>{calls++;throw new Error();};await assert.rejects(normalizeEvidenceImage(new File([png()],'x.jpg',{type:'image/jpeg'})));
  const controller=new AbortController();controller.abort();await assert.rejects(normalizeEvidenceImage(new File([png()],'x.png'),controller.signal),{name:'AbortError'});assert.equal(calls,0);
});

test('generated ICC and comment metadata are stripped before the exact preview; concatenated source rejects',()=>{
  const base=generated(),icc=Uint8Array.from([255,226,0,16,...new TextEncoder().encode('ICC_PROFILE\0'),1,1]),comment=Uint8Array.from([255,254,0,5,65,66,67]);
  const withMetadata=new Uint8Array(base.length+icc.length+comment.length);withMetadata.set(base.subarray(0,2));withMetadata.set(icc,2);withMetadata.set(comment,2+icc.length);withMetadata.set(base.subarray(2),2+icc.length+comment.length);
  assert.deepEqual(stripGeneratedJpegMetadata(withMetadata),base);
  const concat=new Uint8Array(base.length*2);concat.set(base);concat.set(base,base.length);assert.throws(()=>inspectPhotoHeader(concat),/multiple|trailing/i);
});
