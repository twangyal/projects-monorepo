import test from 'node:test';
import assert from 'node:assert/strict';
import {createSequenceDocument,validateSequenceDocument,validateSequenceBundle,replaceSequence,attachSequenceSoundtrack,setSequenceSoundtrack,removeSequenceSoundtrack,SequenceDocumentHistory} from '../src/sequence-document.js';
import {admitSequenceAudio} from '../src/sequence-audio.js';
import {importLegacySequence,encodeSequenceArchive,decodeSequenceArchive} from '../src/sequence-archive.js';

function original(){return {schemaVersion:3,kind:'shot-studio-sequence',title:'Original cut',sources:[{id:'original',label:'Copied film',film:{schemaVersion:3,title:'Original \ud800 film',light:.75,actors:[{name:'A',color:'#ff0000',performanceMode:'loop',x:-1,z:0,action:'idle'},{name:'B',color:'#00ff00',performanceMode:'loop',x:1,z:0,action:'wave'}],shots:[{name:'Opening',duration:3,eye:[0,2,7],target:[0,1,0],fov:45,cameraMode:'static'},{name:'Moving',duration:2,eye:[0,2,7],target:[0,1,0],fov:45,cameraMode:'linear',endEye:[2,2,7],endTarget:[0,1,0]}]}}],clips:[{id:'later',sourceId:'original',shotIndex:1,label:'Excerpt',inTime:.25,outTime:1.75}]};}
function wrapper(){return {schemaVersion:1,kind:'shot-studio-sequence-document',sequence:original(),soundtrack:null};}
function bare(){return {document:wrapper(),asset:null};}
function wav(total=44+96000,tag=0){
 const bytes=new Uint8Array(total),view=new DataView(bytes.buffer),word=(at,text)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
 word(0,'RIFF');view.setUint32(4,total-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,96000,true);view.setInt16(44,tag,true);
 if(total>96044){word(96044,'JUNK');view.setUint32(96048,total-96052,true);bytes[total-1]=tag;}
 return new Blob([bytes],{type:'audio/wav'});
}
const settings=(bundle,patch={})=>{const {inFrame,outFrame,startTime,gain,label}=bundle.document.soundtrack;return{inFrame,outFrame,startTime,gain,label,...patch};};

test('document wraps unchanged original source clocks and detached literal UTF16 metadata',()=>{
 const input=original(),before=JSON.stringify(input),document=createSequenceDocument(input);
 assert.deepEqual(document,wrapper());assert.equal(JSON.stringify(input),before);
 document.sequence.sources[0].film.shots[1].endEye[0]=9;
 assert.equal(input.sources[0].film.shots[1].endEye[0],2);
 assert.deepEqual(createSequenceDocument(),{schemaVersion:1,kind:'shot-studio-sequence-document',sequence:{schemaVersion:3,kind:'shot-studio-sequence',title:'Scene sequence',sources:[],clips:[]},soundtrack:null});
});
test('legacy rich1/2 and original remote1 migrate only inside detached wrapper',()=>{
 const current=original();
 for(const schemaVersion of [1,2]){
  const legacy=structuredClone(current);legacy.schemaVersion=schemaVersion;legacy.clips=legacy.clips.map(({inTime,outTime,...clip})=>{void inTime;void outTime;return clip;});
  const raw=JSON.stringify(legacy),result=importLegacySequence(raw);
  assert.deepEqual(result.document.sequence.sources,current.sources);assert.deepEqual(result.document.sequence.clips,[{...current.clips[0],inTime:0,outTime:2}]);assert.equal(result.asset,null);assert.equal(raw,JSON.stringify(legacy));
 }
 const remote=structuredClone(current);remote.schemaVersion=1;remote.sources=remote.sources.map(({label,...value})=>({...value,name:label}));remote.clips=[{sourceId:'original',shotIndex:1}];
 assert.deepEqual(importLegacySequence(JSON.stringify(remote)).document.sequence.clips,[{id:'legacy-clip-1',sourceId:'original',shotIndex:1,label:'Moving',inTime:0,outTime:2}]);
});
test('strict new metadata never invokes accessors or accepts malformed envelopes',()=>{
 let calls=0;const getter=wrapper();Object.defineProperty(getter,'soundtrack',{enumerable:true,get(){calls++;return null;}});assert.throws(()=>validateSequenceDocument(getter));assert.equal(calls,0);
 for(const value of [{...wrapper(),extra:true},{...wrapper(),schemaVersion:true},{...wrapper(),sequence:{...original(),schemaVersion:2}},Object.assign(Object.create({}),wrapper()),{...bare(),unexpected:1}]){
  assert.throws(()=>Object.hasOwn(value,'document')?validateSequenceBundle(value):validateSequenceDocument(value));
 }
});
test('history no-op preserves Redo; valid replacement and removal keep old source graphs independent',()=>{
 const history=new SequenceDocumentHistory(bare()),changed=replaceSequence(history.current,{...original(),title:'Second cut'});
 history.commit(changed);assert.equal(history.canUndo,true);history.undo();assert.equal(history.canRedo,true);
 history.commit(history.current);assert.equal(history.canRedo,true);
 const leaked=history.current;leaked.document.sequence.title='Caller';assert.equal(history.current.document.sequence.title,'Original cut');
 history.redo();assert.equal(history.current.document.sequence.title,'Second cut');
 history.clear();assert.equal(history.canUndo,false);assert.equal(history.canRedo,false);assert.equal(history.current.document.sequence.title,'Second cut');
});
test('ordinary 30-prior history eviction and invalid edits preserve exact cursor',()=>{
 const history=new SequenceDocumentHistory(bare());
 for(let i=1;i<=32;i++)history.commit(replaceSequence(history.current,{...original(),title:`Edit ${i}`}));
 for(let i=0;i<30;i++)history.undo();assert.equal(history.current.document.sequence.title,'Edit 2');assert.equal(history.canUndo,false);
 const before=history.current;assert.throws(()=>history.commit({...before,asset:{}}));assert.deepEqual(history.current,before);assert.equal(history.canRedo,true);
});
test('complete silent archive preserves exact schema3 source values and deterministic bytes',async()=>{
 const encoded=await encodeSequenceArchive(bare()),raw=new Uint8Array(await encoded.arrayBuffer());
 assert.equal(new TextDecoder().decode(raw.subarray(0,8)),'SHOTSEQ1');const view=new DataView(raw.buffer);assert.equal(view.getUint32(12,true),0);assert.equal(raw.length,16+view.getUint32(8,true));
 const result=await decodeSequenceArchive(encoded);assert.deepEqual(result,bare());assert.deepEqual(new Uint8Array(await (await encodeSequenceArchive(result)).arrayBuffer()),raw);
});

test('real admitted PCM is shared through trim/remove/Undo; caller-created assets cannot forge admission',async()=>{
 const asset=await admitSequenceAudio(wav()),attached=attachSequenceSoundtrack(bare(),asset,' Original music '),before=original();
 assert.equal(attached.asset,asset);assert.deepEqual(attached.document.soundtrack,{label:' Original music ',asset:{sha256:asset.sha256,bytes:96044,sampleRate:48000,channels:1,frameCount:48000},inFrame:0,outFrame:48000,startTime:0,gain:1});
 const history=new SequenceDocumentHistory(attached),trimmed=setSequenceSoundtrack(history.current,settings(attached,{inFrame:2400,outFrame:24000,startTime:.125,gain:.5}));history.commit(trimmed);
 assert.deepEqual(trimmed.document.sequence,before);assert.equal(trimmed.asset,asset);
 history.commit(removeSequenceSoundtrack(history.current));assert.equal(history.current.asset,null);history.undo();assert.equal(history.current.asset,asset);assert.equal(history.current.document.soundtrack.inFrame,2400);
 history.undo();assert.equal(history.current.document.soundtrack.inFrame,0);history.redo();assert.equal(history.current.document.soundtrack.startTime,.125);
 assert.throws(()=>validateSequenceBundle({...attached,asset:{...asset}}));
 const mismatch=structuredClone(attached.document);mismatch.soundtrack.asset.sha256='a'.repeat(64);assert.throws(()=>validateSequenceBundle({document:mismatch,asset}));
});
test('range/frame/gain/label admission refuses atomically and retains inaudible metadata',async()=>{
 const asset=await admitSequenceAudio(wav()),base=attachSequenceSoundtrack(bare(),asset,'Track');
 for(const patch of [{inFrame:.5},{outFrame:48001},{outFrame:4799},{inFrame:-1},{gain:1.0001},{gain:NaN},{startTime:60.001},{label:'\ud800'},{label:'x'.repeat(81)},{label:'a\n'}, {label:'a\u2028b'}])assert.throws(()=>setSequenceSoundtrack(base,settings(base,patch)));
 assert.equal(setSequenceSoundtrack(base,settings(base,{outFrame:4800})).document.soundtrack.outFrame,4800);
 const empty={schemaVersion:3,kind:'shot-studio-sequence',title:'Empty',sources:[],clips:[]};const retained=replaceSequence(setSequenceSoundtrack(base,settings(base,{startTime:60,gain:0})),empty);
 assert.equal(retained.document.soundtrack.startTime,60);assert.equal(retained.asset,asset);assert.equal(base.document.soundtrack.gain,1);
});
test('history admits exact64MiB unique WAV reachability and refuses the next unique asset atomically without silent eviction',async()=>{
 const history=new SequenceDocumentHistory(bare());
 for(let i=0;i<5;i++)history.commit(attachSequenceSoundtrack(history.current,await admitSequenceAudio(wav(12*1024*1024,i+1)),`Large ${i}`));
 const boundary=await admitSequenceAudio(wav(4*1024*1024,6));history.commit(attachSequenceSoundtrack(history.current,boundary,'Boundary'));assert.equal(history.current.asset,boundary);
 const tiny=await admitSequenceAudio(wav(96044,7)),before=history.current;
 assert.throws(()=>history.commit(attachSequenceSoundtrack(history.current,tiny,'Overflow')),/64 MiB|history/i);assert.deepEqual(history.current,before);
 history.undo();assert.equal(history.canRedo,true);
 const tooLarge=await admitSequenceAudio(wav(4*1024*1024+2,8)),unchanged=history.current;
 assert.throws(()=>history.commit(attachSequenceSoundtrack(history.current,tooLarge,'Cap plus two')),/64 MiB|history/i);assert.deepEqual(history.current,unchanged);assert.equal(history.canRedo,true);
 history.commit(history.current);assert.equal(history.canRedo,true);
 // Branch truncation releases the 4 MiB asset before charging the small new one.
 history.commit(attachSequenceSoundtrack(history.current,tiny,'Small branch'));assert.equal(history.canRedo,false);assert.equal(history.current.asset,tiny);
 history.clear();history.commit(attachSequenceSoundtrack(history.current,boundary,'Released budget'));assert.equal(history.current.asset,boundary);
});

test('same exact WAV deduplicates across independently admitted assets and normal eviction releases old assets',async()=>{
 const first=await admitSequenceAudio(wav()),duplicate=await admitSequenceAudio(wav()),base=attachSequenceSoundtrack(bare(),first,'Original'),history=new SequenceDocumentHistory(base);
 assert.notEqual(first,duplicate);assert.equal(first.sha256,duplicate.sha256);
 history.commit(attachSequenceSoundtrack(history.current,duplicate,'Renamed'));assert.equal(history.current.asset,first);
 history.undo();history.commit(attachSequenceSoundtrack(history.current,duplicate,'Original'));assert.equal(history.canRedo,true);assert.equal(history.current.asset,first);
 const different=await admitSequenceAudio(wav(96044,33));history.commit(attachSequenceSoundtrack(history.current,different,'New audio'));
 for(let i=0;i<30;i++)history.commit(replaceSequence(history.current,{...original(),title:`After ${i}`}));
 for(let i=0;i<30;i++)history.undo();assert.equal(history.canUndo,false);assert.equal(history.current.asset,different);assert.equal(history.current.document.soundtrack.label,'New audio');
});
