import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeSequenceArchive,decodeSequenceArchive,importLegacySequence} from '../src/sequence-archive.js';
import {attachSequenceSoundtrack} from '../src/sequence-document.js';
import {admitSequenceAudio} from '../src/sequence-audio.js';
const original={schemaVersion:1,kind:'shot-studio-sequence-document',sequence:{schemaVersion:3,kind:'shot-studio-sequence',title:' Literal <cut> 😀 ',sources:[],clips:[]},soundtrack:null};
function framed(text=JSON.stringify(original),wav=new Uint8Array()){
 const encoded=typeof text==='string'?new TextEncoder().encode(text):text,header=new Uint8Array(16),view=new DataView(header.buffer);header.set(new TextEncoder().encode('SHOTSEQ1'));view.setUint32(8,encoded.length,true);view.setUint32(12,wav.length,true);return new Blob([header,encoded,wav]);
}
function audio(){
 const data=new Uint8Array(44+44100*4),view=new DataView(data.buffer),word=(at,text)=>data.set(new TextEncoder().encode(text),at);
 word(0,'RIFF');view.setUint32(4,data.length-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,44100,true);view.setUint32(28,176400,true);view.setUint16(32,4,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,176400,true);
 for(let frame=0;frame<44100;frame++){view.setInt16(44+frame*4,frame%4===0?12345:-2345,true);view.setInt16(46+frame*4,frame%7===0?-10001:777,true);}return data;
}

test('independently framed complete metadata imports literally without producer writer',async()=>{
 const bundle=await decodeSequenceArchive(framed());assert.deepEqual(bundle,{document:original,asset:null});
 const output=new Uint8Array(await (await encodeSequenceArchive(bundle)).arrayBuffer());assert.deepEqual(output,new Uint8Array(await framed().arrayBuffer()));
});
test('fatal UTF8 duplicate keys nonfinite depth and wrong schema refuse complete import',async()=>{
 for(const value of [framed(new Uint8Array([123,34,0xff,34,58,49,125])),framed(JSON.stringify(original).replace('"schemaVersion":1','"schemaVersion":0,"schemaVersion":1')),framed('{"x":1e999}'),framed('['.repeat(10000)+']'.repeat(10000)),framed(JSON.stringify({...original,kind:'other'})),framed(JSON.stringify({...original,unexpected:true})),framed('\ufeff'+JSON.stringify(original))])await assert.rejects(decodeSequenceArchive(value));
});
test('header total and per-part admission rejects trailing/truncated/oversized before native reads',async()=>{
 const valid=new Uint8Array(await framed().arrayBuffer());
 for(const bytes of [valid.subarray(0,15),valid.subarray(0,valid.length-1),new Uint8Array([...valid,0]),new Uint8Array(valid).fill(0,0,8)])await assert.rejects(decodeSequenceArchive(new Blob([bytes])));
 for(const [offset,length] of [[8,0],[8,331777],[12,12582913]]){const bytes=valid.slice();new DataView(bytes.buffer).setUint32(offset,length,true);await assert.rejects(decodeSequenceArchive(new Blob([bytes])));}
 let reads=0;const old=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){reads++;return old.call(this);};
 try{await assert.rejects(decodeSequenceArchive(new Blob([new Uint8Array(16*1024*1024+1)])));assert.equal(reads,0);}finally{Blob.prototype.arrayBuffer=old;}
});
test('raw metadata exact324KiB admitted and +1 refused without changing canonical result',async()=>{
 const text=JSON.stringify(original),padded=text+' '.repeat(331776-new TextEncoder().encode(text).length);
 assert.deepEqual(await decodeSequenceArchive(framed(padded)),{document:original,asset:null});await assert.rejects(decodeSequenceArchive(framed(padded+' ')));
});
test('exact original stereo WAV bytes and independently hashed descriptor roundtrip',async()=>{
 const bytes=audio(),sha256=createHash('sha256').update(bytes).digest('hex'),asset=await admitSequenceAudio(new Blob([bytes],{type:'audio/wav'}));
 const bundle=attachSequenceSoundtrack({document:original,asset:null},asset,'Stereo original');
 assert.equal(bundle.document.soundtrack.asset.sha256,sha256);
 const backup=await encodeSequenceArchive(bundle),raw=new Uint8Array(await backup.arrayBuffer()),length=new DataView(raw.buffer).getUint32(8,true);assert.deepEqual(raw.slice(16+length),bytes);
 const restored=await decodeSequenceArchive(backup);assert.deepEqual(restored.document,bundle.document);assert.deepEqual(new Uint8Array(await restored.asset.blob.arrayBuffer()),bytes);assert.deepEqual(new Uint8Array(await (await encodeSequenceArchive(restored)).arrayBuffer()),raw);
 const corrupt=raw.slice();corrupt[corrupt.length-1]^=1;await assert.rejects(decodeSequenceArchive(new Blob([corrupt])));
 const descriptor=structuredClone(bundle.document);descriptor.soundtrack.asset.frameCount++;await assert.rejects(decodeSequenceArchive(framed(JSON.stringify(descriptor),bytes)));
 await assert.rejects(decodeSequenceArchive(framed(JSON.stringify(bundle.document))));await assert.rejects(decodeSequenceArchive(framed(JSON.stringify(original),bytes)));
});
test('pre-abort and cancel during real header read cannot publish partial bundles',async()=>{
 const stopped=new AbortController();stopped.abort();await assert.rejects(encodeSequenceArchive({document:original,asset:null},{signal:stopped.signal}),/cancel/i);await assert.rejects(decodeSequenceArchive(framed(),{signal:stopped.signal}),/cancel/i);
 const controller=new AbortController(),old=Blob.prototype.arrayBuffer;let release,entered;const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 Blob.prototype.arrayBuffer=async function(){const bytes=await old.call(this);entered();await gate;return bytes;};
 try{const pending=decodeSequenceArchive(framed(),{signal:controller.signal});await reached;controller.abort();await assert.rejects(pending,/cancel/i);release();await new Promise(resolve=>setImmediate(resolve));}finally{release?.();Blob.prototype.arrayBuffer=old;}
});
test('legacy JSON remains independently bounded and yields no invented soundtrack',()=>{
 const text=JSON.stringify(original.sequence);assert.deepEqual(importLegacySequence(text),{document:original,asset:null});assert.throws(()=>importLegacySequence(text+' '.repeat(327680)));assert.throws(()=>importLegacySequence(JSON.stringify(original)));
});
