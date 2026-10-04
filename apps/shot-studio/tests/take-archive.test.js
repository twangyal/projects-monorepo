import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createProject} from '../src/model.js';
import {TakeError,TAKE_LIMITS} from '../src/takes.js';
import {sha256Blob,encodeTakeBackup,decodeTakeBackup} from '../src/take-archive.js';
const data=Buffer.from([0x1a,0x45,0xdf,0xa3,1,2,3]);
const metadata=()=>({schemaVersion:1,id:'00000000-0000-4000-8000-000000000001',name:' Local 🎬 take ',recordedAt:'2026-10-04T12:00:00.000Z',origin:'recorded-here',film:createProject(),video:{mime:'video/webm;codecs=vp9',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}});
const video=()=>new Blob([data],{type:metadata().video.mime});
function framed(text,payload=data){const raw=Buffer.from(text),header=Buffer.alloc(16);header.write('SHOTTAK1');header.writeUInt32LE(raw.length,8);header.writeUInt32LE(payload.length,12);return new Blob([header,raw,payload]);}
const manifest=()=>{const result=metadata();delete result.id;return result;};
test('actual framed backup preserves exact recording bytes/film while import forces unverified provenance and no local ID',async()=>{
 const source=metadata(),out=await encodeTakeBackup(source,video()),bytes=Buffer.from(await out.arrayBuffer());assert.equal(bytes.subarray(0,8).toString(),'SHOTTAK1');assert.equal(bytes.readUInt32LE(12),data.length);
 const literal=JSON.parse(bytes.subarray(16,16+bytes.readUInt32LE(8)));assert.deepEqual(literal,manifest());assert.equal(Object.hasOwn(literal,'id'),false);assert(bytes.subarray(16+bytes.readUInt32LE(8)).equals(data));
 const parsed=await decodeTakeBackup(out);assert.deepEqual(parsed.metadataWithoutId,{...manifest(),origin:'imported-declared'});assert.equal(Object.hasOwn(parsed.metadataWithoutId,'id'),false);assert(Buffer.from(await parsed.video.arrayBuffer()).equals(data));assert.equal(source.origin,'recorded-here');
});
test('SHA256 is real and bounded, encoder never publishes a mismatched pair',async()=>{
 assert.equal(await sha256Blob(new Blob(['abc'])),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 await assert.rejects(encodeTakeBackup({...metadata(),video:{...metadata().video,sha256:'a'.repeat(64)}},video()),TakeError);
 await assert.rejects(encodeTakeBackup(metadata(),new Blob([data],{type:'text/html'})),TakeError);
 await assert.rejects(sha256Blob(new Blob([new Uint8Array(TAKE_LIMITS.videoBytes+1)])),TakeError);
});
test('all truncations, exact EOF lengths, magic/version and size bounds fail closed',async()=>{
 const bytes=Buffer.from(await (await encodeTakeBackup(metadata(),video())).arrayBuffer());for(const size of[0,7,15,16,17,bytes.length-1])await assert.rejects(decodeTakeBackup(new Blob([bytes.subarray(0,size)])),TakeError);
 const bad=Buffer.from(bytes);bad[0]^=1;await assert.rejects(decodeTakeBackup(new Blob([bad])),TakeError);await assert.rejects(decodeTakeBackup(new Blob([bytes,Buffer.from([0])])),TakeError);
 const header=Buffer.alloc(16);header.write('SHOTTAK1');header.writeUInt32LE(TAKE_LIMITS.manifestBytes+1,8);header.writeUInt32LE(1,12);await assert.rejects(decodeTakeBackup(new Blob([header])),TakeError);
});
test('strict UTF8/duplicate JSON/depth/unknown fields and Unicode must reject before installing media',async()=>{
 const raw=JSON.stringify(manifest());for(const text of[raw.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),raw.replace('"schemaVersion":1','"schemaVersion":NaN'),raw.replace('"schemaVersion":1','"schemaVersion":1,"unexpected":[]'),raw.replace(' Local 🎬 take ','\\ud800'),JSON.stringify({...manifest(),film:{...createProject(),junk:Array.from({length:1},()=>Array.from({length:1},()=>[]))}})])await assert.rejects(decodeTakeBackup(framed(text)),TakeError);
 const invalidUtf8=Buffer.from([0xff]);const header=Buffer.alloc(16);header.write('SHOTTAK1');header.writeUInt32LE(1,8);header.writeUInt32LE(data.length,12);await assert.rejects(decodeTakeBackup(new Blob([header,invalidUtf8,data])),TakeError);
});
test('cancellation retires late genuine Blob reads without rewriting the source or publishing results',async()=>{
 const abort=new AbortController();abort.abort();await assert.rejects(encodeTakeBackup(metadata(),video(),{signal:abort.signal}),error=>error.code==='cancelled');await assert.rejects(decodeTakeBackup(framed(JSON.stringify(manifest())),{signal:abort.signal}),error=>error.code==='cancelled');
});
test('exact80KiB manifest accepts legal whitespace;plus1 and excess depth reject',async()=>{
 const raw=JSON.stringify(manifest()),exact=raw+' '.repeat(TAKE_LIMITS.manifestBytes-Buffer.byteLength(raw));assert.equal(Buffer.byteLength(exact),TAKE_LIMITS.manifestBytes);assert.equal((await decodeTakeBackup(framed(exact))).metadataWithoutId.name,metadata().name);
 await assert.rejects(decodeTakeBackup(framed(exact+' ')),TakeError);
 const nested=raw.replace('"name":" Local 🎬 take "','"name":'+ '['.repeat(17)+'0'+']'.repeat(17));await assert.rejects(decodeTakeBackup(framed(nested)),TakeError);
 await assert.rejects(decodeTakeBackup(framed('\ufeff'+raw)),TakeError);
});
test('genuine exact32MiB SHA/archive bytes roundtrip;synthetic payload is not claimed playable',async()=>{
 const payload=new Uint8Array(TAKE_LIMITS.videoBytes),hash=createHash('sha256').update(payload).digest('hex'),meta={...metadata(),video:{mime:'video/webm',bytes:payload.byteLength,sha256:hash}},source=new Blob([payload],{type:'video/webm'});assert.equal(await sha256Blob(source),hash);
 const archive=await encodeTakeBackup(meta,source),header=Buffer.from(await archive.slice(0,16).arrayBuffer());assert.equal(header.readUInt32LE(12),33554432);assert.equal(archive.size,16+header.readUInt32LE(8)+33554432);const result=await decodeTakeBackup(archive);assert.equal(result.video.size,33554432);assert.equal(await sha256Blob(result.video),hash);
 const larger=new Blob([source,new Uint8Array(1)],{type:'video/webm'});await assert.rejects(sha256Blob(larger),TakeError);await assert.rejects(encodeTakeBackup({...meta,video:{...meta.video,bytes:larger.size}},larger),TakeError);
});
test('Abort rejects promptly while real completed Blob bytes are delayed, and late delivery stays retired',async()=>{
 const source=video(),native=source.arrayBuffer.bind(source);let release,entered;const ready=new Promise(resolve=>{entered=resolve;});Object.defineProperty(source,'arrayBuffer',{value:async()=>{const bytes=await native();entered();return new Promise(resolve=>{release=()=>resolve(bytes);});}});
 const abort=new AbortController(),pending=sha256Blob(source,{signal:abort.signal});await ready;abort.abort();await assert.rejects(pending,error=>error.code==='cancelled');release();await new Promise(resolve=>setImmediate(resolve));assert.equal(source.size,data.length);
});
