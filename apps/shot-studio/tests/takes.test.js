import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/model.js';
import {TakeError,TAKE_LIMITS,validateTakeMetadata,createTakeMetadata,validateLibrary} from '../src/takes.js';
const id='00000000-0000-4000-8000-000000000001';
const metadata=()=>({schemaVersion:1,id,name:' Literal take ',recordedAt:'2026-10-04T12:00:00.000Z',origin:'recorded-here',film:createProject(),video:{mime:'video/webm',bytes:3,sha256:'a'.repeat(64)}});
const blob=()=>new Blob(['abc'],{type:'video/webm'});
test('metadata captures exact independent schema3 film and name without changing title',()=>{
 const input=metadata(),out=validateTakeMetadata(input);assert.deepEqual(out,input);out.film.actors[0].x=3;assert.equal(input.film.actors[0].x,-1.2);
 const {id,name,recordedAt,origin,film,video}=input;assert.deepEqual(createTakeMetadata({id,name,recordedAt,origin,film,mime:video.mime,bytes:video.bytes,sha256:video.sha256}),input);
 assert.equal(out.name,' Literal take ');assert.equal(out.film.title,'The arrival');
});
test('metadata admits exact bounds but rejects invalid Unicode/types/extra keys before getter execution',()=>{
 for(const name of ['x'.repeat(80),'🎬'.repeat(40)])assert.equal(validateTakeMetadata({...metadata(),name}).name,name);
 for(const name of ['', ' ', 'x'.repeat(81), '🎬'.repeat(41),'x\0','\ud800'])assert.throws(()=>validateTakeMetadata({...metadata(),name}),TakeError);
 for(const change of [{schemaVersion:true},{id:'../../other'},{recordedAt:'2026-02-30T00:00:00.000Z'},{recordedAt:'2026-10-04'},{origin:'verified'},{extra:1}])assert.throws(()=>validateTakeMetadata({...metadata(),...change}),TakeError);
 for(const video of [{...metadata().video,bytes:0},{...metadata().video,bytes:TAKE_LIMITS.videoBytes+1},{...metadata().video,sha256:'A'.repeat(64)},{...metadata().video,mime:'text/html'}])assert.throws(()=>validateTakeMetadata({...metadata(),video}),TakeError);
 assert.equal(validateTakeMetadata({...metadata(),video:{...metadata().video,bytes:TAKE_LIMITS.videoBytes}}).video.bytes,TAKE_LIMITS.videoBytes);
 let called=0;const input=metadata();Object.defineProperty(input,'name',{enumerable:true,get(){called++;return 'Unsafe';}});assert.throws(()=>validateTakeMetadata(input),TakeError);assert.equal(called,0);
 const legacy=metadata();legacy.film.schemaVersion=2;assert.throws(()=>validateTakeMetadata(legacy),TakeError);
});
test('complete20-shot64-cue film is admitted without claiming an unreachable exact64KiB fixture',()=>{
 const input=metadata();input.film.actors=input.film.actors.map(a=>({name:a.name,color:a.color,performanceMode:'blocking',cues:Array.from({length:32},(_,i)=>({time:i/31*60,x:i===0?0:.12345678901234567,z:.23456789012345678,action:'wave',visible:true}))}));input.film.shots=Array.from({length:20},()=>({...input.film.shots[0],name:'🎬'.repeat(20),duration:3}));
 assert.doesNotThrow(()=>validateTakeMetadata(input));
});
test('four unique32MiB structural pairs charge128MiB even when native immutable Blob bytes are shared',()=>{
 const video=new Blob([new Uint8Array(TAKE_LIMITS.videoBytes)],{type:'video/webm'}),records=Array.from({length:4},(_,i)=>({metadata:{...metadata(),id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,video:{...metadata().video,bytes:TAKE_LIMITS.videoBytes}},video}));
 const result=validateLibrary({schemaVersion:1,revision:Number.MAX_SAFE_INTEGER,records});assert.equal(result.records.length,4);assert.equal(result.records.reduce((sum,row)=>sum+row.video.size,0),134217728);assert.throws(()=>validateLibrary({schemaVersion:1,revision:1,records:[...records,{...records[0],metadata:{...records[0].metadata,id:'00000000-0000-4000-8000-000000000005'}}]}),TakeError);
 // Synthetic bytes test structural/budget admission only, not hashing, media decode or memory use.
});
test('library requires exact dense bounded unique pairs and safe revisions; detached metadata and immutable Blob',()=>{
 const video=blob(),input={schemaVersion:1,revision:0,records:[{metadata:metadata(),video}]},out=validateLibrary(input);assert.deepEqual(out,input);assert.notEqual(out,input);assert.notEqual(out.records[0].metadata,input.records[0].metadata);assert.equal(out.records[0].video.size,3);
 for(const revision of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,true])assert.throws(()=>validateLibrary({...input,revision}),TakeError);
 for(const records of [new Array(1),[...input.records,...input.records],Array.from({length:5},(_,i)=>({metadata:{...metadata(),id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`},video})),[{metadata:metadata(),video:new Blob(['abcd'],{type:'video/webm'})}],[{metadata:metadata(),video:new Blob(['abc'],{type:'text/html'})}],[{metadata:metadata(),video:{size:3,type:'video/webm'}}]])assert.throws(()=>validateLibrary({...input,records}),TakeError);
 assert.deepEqual(validateLibrary({schemaVersion:1,revision:0,records:[]}),{schemaVersion:1,revision:0,records:[]});
});
