import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parsePcm16Wav,admitSequenceAudio,assertAdmittedWavAsset,sequenceAudioDescriptor,planSoundtrack} from '../src/sequence-audio.js';

function chunk(name,bytes){const result=new Uint8Array(8+bytes.length+(bytes.length%2));const view=new DataView(result.buffer);result.set(new TextEncoder().encode(name));view.setUint32(4,bytes.length,true);result.set(bytes,8);return result;}
function wav({rate=44100,channels=1,frames=rate,fmt18=false,extra=[]}={}){
  const fmt=new Uint8Array(fmt18?18:16),view=new DataView(fmt.buffer);view.setUint16(0,1,true);view.setUint16(2,channels,true);view.setUint32(4,rate,true);view.setUint32(8,rate*channels*2,true);view.setUint16(12,channels*2,true);view.setUint16(14,16,true);
  const pcm=new Uint8Array(frames*channels*2),samples=new DataView(pcm.buffer);
  for(let i=0;i<Math.min(12,frames*channels);i++)samples.setInt16(i*2,[-32768,-16384,-1,0,1,16384,32767][i%7],true);
  const chunks=[chunk('fmt ',fmt),...extra,chunk('data',pcm)],length=12+chunks.reduce((n,c)=>n+c.length,0),result=new Uint8Array(length),head=new DataView(result.buffer);result.set(new TextEncoder().encode('RIFF'));head.setUint32(4,length-8,true);result.set(new TextEncoder().encode('WAVE'),8);let offset=12;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}

test('original mono/stereo PCM framing, fmt18 and padded ancillary chunks retain literal bytes',async()=>{
  for(const options of [{},{rate:48000,channels:2,fmt18:true,extra:[chunk('JUNK',new Uint8Array([7]))]}]){
    const bytes=wav(options),result=parsePcm16Wav(bytes);assert.equal(result.sampleRate,options.rate??44100);assert.equal(result.channels,options.channels??1);assert.equal(result.frameCount,result.sampleRate);assert.equal(result.dataBytes,result.frameCount*result.channels*2);
    const asset=await admitSequenceAudio(new Blob([bytes],{type:'audio/wav'}));assert.equal(asset.sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()),bytes);assert.ok(Object.isFrozen(asset));assert.equal(assertAdmittedWavAsset(asset),asset);assert.deepEqual(sequenceAudioDescriptor(asset),{sha256:asset.sha256,bytes:bytes.length,sampleRate:result.sampleRate,channels:result.channels,frameCount:result.frameCount});assert.throws(()=>assertAdmittedWavAsset({...asset}));
  }
});

test('RIFF framing/format/duplicate/padding/count failures are atomic',()=>{
  const original=wav();const mutations=[b=>b[3]=88,b=>new DataView(b.buffer).setUint32(4,b.length-7,true),b=>new DataView(b.buffer).setUint16(20,3,true),b=>new DataView(b.buffer).setUint16(22,3,true),b=>new DataView(b.buffer).setUint32(24,22050,true),b=>new DataView(b.buffer).setUint32(28,1,true),b=>new DataView(b.buffer).setUint16(32,1,true),b=>new DataView(b.buffer).setUint16(34,8,true)];
  for(const mutate of mutations){const bytes=original.slice();mutate(bytes);const before=bytes.slice();assert.throws(()=>parsePcm16Wav(bytes));assert.deepEqual(bytes,before);}
  assert.throws(()=>parsePcm16Wav(original.subarray(0,original.length-1)));
  assert.throws(()=>parsePcm16Wav(wav({extra:[chunk('data',new Uint8Array())]})));
  const extension=wav({fmt18:true});extension[36]=1;assert.throws(()=>parsePcm16Wav(extension));
  const sixtyFour=wav({extra:Array.from({length:62},()=>chunk('JUNK',new Uint8Array()))});assert.equal(parsePcm16Wav(sixtyFour).frameCount,44100);assert.throws(()=>parsePcm16Wav(wav({extra:Array.from({length:63},()=>chunk('JUNK',new Uint8Array()))})));
});

test('integer frame duration and exact12MiB container cap inclusive, plus one refused',()=>{
  assert.throws(()=>parsePcm16Wav(wav({frames:44099})));assert.equal(parsePcm16Wav(wav({rate:48000,channels:2,frames:2880000})).frameCount,2880000);assert.throws(()=>parsePcm16Wav(wav({frames:2646001})));
  const maximum=12*1024*1024,base=wav(),padded=wav({extra:[chunk('JUNK',new Uint8Array(maximum-base.length-8))]});assert.equal(padded.length,maximum);assert.equal(parsePcm16Wav(padded).frameCount,44100);assert.throws(()=>parsePcm16Wav(new Uint8Array(maximum+1)));
});

test('admission captures native bytes, preserves subarray samples, and preabort refuses',async()=>{
  const bytes=wav(),large=new Uint8Array(bytes.length+20);large.set(bytes,10);assert.equal(parsePcm16Wav(large.subarray(10,-10)).frameCount,44100);
  const abort=new AbortController();abort.abort();await assert.rejects(admitSequenceAudio(new Blob([bytes]),{signal:abort.signal}),/cancel|abort/i);await assert.rejects(admitSequenceAudio({size:bytes.length,arrayBuffer:()=>bytes.buffer}));
});

test('literal sample-frame crop maps once across sequence time without looping/stretching',async()=>{
  const asset=await admitSequenceAudio(new Blob([wav({rate:48000,channels:2,frames:192000})]));const metadata=sequenceAudioDescriptor(asset),settings={label:'Original <stereo>',asset:metadata,inFrame:24000,outFrame:168000,startTime:.75,gain:.25};
  const plan=planSoundtrack(settings,asset,3);assert.deepEqual(plan,{sampleRate:48000,channels:2,frameCount:192000,inFrame:24000,outFrame:168000,startTime:.75,gain:.25,sequenceDuration:3,audibleStart:.75,audibleEnd:3,audible:true});assert.ok(Object.isFrozen(plan));assert.equal(settings.outFrame,168000);
  const absent=planSoundtrack({...settings,startTime:60},asset,0);assert.equal(absent.audible,false);assert.equal(absent.startTime,60);assert.equal(absent.audibleStart,0);assert.equal(absent.audibleEnd,0);assert.equal(planSoundtrack({...settings,gain:0},asset,3).audible,false);
});

test('whole settings and matching asset admission rejects invalid crop/options atomically',async()=>{
  const asset=await admitSequenceAudio(new Blob([wav()])),soundtrack={label:'Original',asset:sequenceAudioDescriptor(asset),inFrame:0,outFrame:4410,startTime:0,gain:1};assert.equal(planSoundtrack(soundtrack,asset,1).audibleEnd,.1);
  for(const patch of [{inFrame:.1},{outFrame:4409},{outFrame:44101},{gain:NaN},{gain:1.01},{startTime:-1},{startTime:60.01},{asset:{...soundtrack.asset,sha256:'0'.repeat(64)}},{label:'\ud800'},{unknown:1}])assert.throws(()=>planSoundtrack({...soundtrack,...patch},asset,1));
  assert.throws(()=>planSoundtrack(soundtrack,{...asset},1));assert.throws(()=>planSoundtrack(soundtrack,asset,61));assert.equal(soundtrack.inFrame,0);
});
