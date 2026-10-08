import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,performerAt} from '../src/model.js';
import * as sequence from '../src/sequence.js';
import {SequenceHistory,SequenceDraftStore,SEQUENCE_DRAFT_KEY} from '../src/sequence-store.js';

function film(){
  const value=createProject();
  value.shots[0].duration=2;
  value.shots[1]={name:'Original travel',duration:4,
    eye:[-2,2,8],target:[-2,1,0],fov:40,cameraMode:'linear',endEye:[2,2,8],endTarget:[2,1,0]};
  value.actors[0]={name:'Original blocking',color:'#ff0000',performanceMode:'blocking',cues:[
    {time:0,x:0,z:0,action:'idle',visible:true},
    {time:3,x:1,z:0,action:'wave',visible:true},
    {time:5,x:3,z:0,action:'idle',visible:false},
  ]};
  return value;
}
function clip(id='clip',inTime=1,outTime=3){return {id,sourceId:'source',shotIndex:1,label:'Middle excerpt',inTime,outTime};}
function current(){return {schemaVersion:3,kind:'shot-studio-sequence',title:'Original cut',sources:[{id:'source',label:'Detached source',film:film()}],clips:[clip()]};}
function oldRich(version=2){const value=current();value.schemaVersion=version;value.clips=value.clips.map(({inTime:_in,outTime:_out,...rest})=>rest);return value;}
function unchanged(value,action){const before=JSON.stringify(value);assert.throws(action);assert.equal(JSON.stringify(value),before);}

test('existing schema2 whole clips migrate to detached canonical3 full ranges without changing source films',()=>{
  const old=oldRich(),before=JSON.stringify(old),originalFilm=JSON.stringify(old.sources[0].film);
  const migrated=sequence.validateSequence(old);
  assert.equal(migrated.schemaVersion,3);
  assert.deepEqual(migrated.clips,[clip('clip',0,4)]);
  assert.equal(JSON.stringify(migrated.sources[0].film),originalFilm);
  assert.equal(JSON.stringify(old),before);
  migrated.sources[0].film.actors[0].cues[1].x=-4;
  assert.equal(old.sources[0].film.actors[0].cues[1].x,1);
  assert.equal(sequence.createSequence().schemaVersion,3);
});

test('both strict schema1 forms migrate ranges while preserving source text and deterministic display fallback',()=>{
  const rich=oldRich(1),remote={schemaVersion:1,kind:rich.kind,title:rich.title,
    sources:rich.sources.map(({id,label,film})=>({id,name:label,film})),
    clips:[{sourceId:'source',shotIndex:1},{sourceId:'source',shotIndex:1}]};
  remote.sources[0].film.shots[1].name='Original \ud800 name';
  const raw=JSON.stringify(remote),migrated=sequence.importSequence(raw);
  assert.deepEqual(sequence.validateSequence(rich).clips,[clip('clip',0,4)]);
  assert.equal(migrated.schemaVersion,3);
  assert.deepEqual(migrated.clips.map(c=>[c.id,c.label,c.inTime,c.outTime]),[
    ['legacy-clip-1','Shot 2',0,4],['legacy-clip-2','Shot 2',0,4],
  ]);
  assert.equal(migrated.sources[0].film.shots[1].name,'Original \ud800 name');
  assert.equal(JSON.stringify(remote),raw);
});

test('old-version range fields and future or mixed shapes refuse rather than silently losing a trim',()=>{
  for(const version of [1,2])for(const field of ['inTime','outTime']){
    const input=oldRich(version);input.clips[0][field]=field==='inTime'?1:3;
    unchanged(input,()=>sequence.validateSequence(input));
  }
  for(const mutate of [v=>v.schemaVersion=4,v=>delete v.clips[0].outTime,
    v=>v.clips[0].extra=true,v=>v.sources[0].name='wrong form']){
    const input=current();mutate(input);unchanged(input,()=>sequence.validateSequence(input));
  }
  const getter=current();Object.defineProperty(getter.clips[0],'inTime',{enumerable:true,get(){throw Error('Accessor executed');}});
  assert.throws(()=>sequence.validateSequence(getter),/accessor/i);
});

test('trimmed camera follows the middle of original travel and performer time retains the original source prefix',()=>{
  const input=current(),before=JSON.stringify(input),prepared=sequence.prepareSequence(input);
  const start=prepared.clipFrame(0,0),middle=prepared.clipFrame(0,1),end=prepared.clipFrame(0,2);
  assert.deepEqual([start.shotLocal,middle.shotLocal,end.shotLocal],[1,2,3]);
  assert.deepEqual([start.sourceGlobal,middle.sourceGlobal,end.sourceGlobal],[3,4,5]);
  assert.deepEqual([start.camera.eye[0],middle.camera.eye[0],end.camera.eye[0]],[-1,0,1]);
  assert.equal(performerAt(middle.sourceFilm,0,middle.sourceGlobal).x,2);
  assert.equal(performerAt(end.sourceFilm,0,end.sourceGlobal).visible,false);
  assert.equal(prepared.clips[0].sourceStart,2);
  assert.equal(prepared.clips[0].sourceDuration,4);
  assert.equal(prepared.clips[0].duration,2);
  assert.equal(JSON.stringify(input),before);
  assert.equal(JSON.stringify(prepared.document.sources[0].film),JSON.stringify(input.sources[0].film));
});

test('explicit endpoints preserve Out exactly when in plus represented span does not round back to Out',()=>{
  const input=current();input.clips=[clip('first',.3,.9),clip('second',.2,.9)];
  assert.notEqual(.3+(.9-.3),.9);assert.notEqual(.2+(.9-.2),.9);
  const prepared=sequence.prepareSequence(input);
  for(let index=0;index<2;index++){
    const end=prepared.clipFrame(index,prepared.clips[index].duration);
    assert.equal(end.shotLocal,.9);assert.equal(end.sourceGlobal,2+.9);
    assert.equal(prepared.clipFrame(index,-10).shotLocal,input.clips[index].inTime);
    assert.equal(prepared.clipFrame(index,100).shotLocal,.9);
  }
  assert.equal(prepared.frameAt(prepared.duration).shotLocal,.9);
});

test('fractional trimmed cuts use ordered prefixes and explicit selected End differs from the next clip In',()=>{
  const input=current();input.clips=[clip('one',0,1.1),clip('two',0,1.2),clip('three',0,1.3)];
  const prepared=sequence.prepareSequence(input),cut=1.1+1.2;
  assert.equal(prepared.duration,3.6);
  assert.equal(prepared.frameAt(cut).clipId,'three');
  assert.equal(prepared.frameAt(cut).clipLocal,0);assert.equal(prepared.frameAt(cut).shotLocal,0);
  assert.equal(prepared.clipFrame(1,1.2).shotLocal,1.2);
  assert.equal(prepared.frameAt(3.6).clipLocal,1.3);assert.equal(prepared.frameAt(3.6).shotLocal,1.3);
  for(const value of [NaN,Infinity,'1'])assert.throws(()=>prepared.frameAt(value));
});

test('minimum and source bounds use represented numbers with no rounding epsilon or clamping',()=>{
  assert.equal(sequence.MIN_SEQUENCE_CLIP_SECONDS,.1);
  const input=current();
  const minimum=sequence.setSequenceClipRange(input,'clip',0,.1);
  assert.equal(minimum.clips[0].outTime-minimum.clips[0].inTime,.1);
  const negativeZero=sequence.setSequenceClipRange(input,'clip',-0,4);
  assert.equal(Object.is(negativeZero.clips[0].inTime,-0),false);
  for(const [start,end] of [[0,.09999999999999999],[.9,1],[1,1],[2,1],[-.1,1],
    [0,4.000000000000001],[NaN,3],[1,Infinity],['1',3],[1,null]]){
    unchanged(input,()=>sequence.setSequenceClipRange(input,'clip',start,end));
  }
  unchanged(input,()=>sequence.setSequenceClipRange(input,'absent',1,3));
});

test('range reset and repeat/reorder/rename preserve unrelated ranges, full sources and original inputs',()=>{
  const input=current(),before=JSON.stringify(input),edited=sequence.setSequenceClipRange(input,'clip',.25,3.25);
  const repeated=sequence.addSequenceClip(edited,{...edited.clips[0],id:'repeat'});
  const moved=sequence.moveSequenceClip(repeated,'repeat',-1);
  const renamed=sequence.renameSequenceClip(moved,'repeat','Repeated excerpt');
  const reset=sequence.resetSequenceClipRange(renamed,'repeat');
  assert.deepEqual(reset.clips.map(c=>[c.id,c.inTime,c.outTime]),[['repeat',0,4],['clip',.25,3.25]]);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(reset.sources,input.sources);
  assert.equal(sequence.prepareSequence(repeated).clipFrame(0,1).sourceGlobal,
    sequence.prepareSequence(repeated).clipFrame(1,1).sourceGlobal);
  unchanged(input,()=>sequence.resetSequenceClipRange(input,'absent'));
});

test('twenty trimmed clips fit exact sixty; one extra clip, actual excess and reset over quota refuse atomically',()=>{
  const input=current();input.clips=Array.from({length:20},(_,i)=>clip(`clip-${i}`,0,3));
  assert.equal(sequence.sequenceDuration(input),60);
  for(let i=0;i<19;i++)assert.equal(sequence.sequenceDuration(sequence.moveSequenceClip(input,`clip-${i}`,1)),60);
  unchanged(input,()=>sequence.addSequenceClip(input,clip('extra',0,3)));
  unchanged(input,()=>sequence.setSequenceClipRange(input,'clip-0',0,3.00000000000001));
  unchanged(input,()=>sequence.resetSequenceClipRange(input,'clip-0'));
  assert.equal(sequence.prepareSequence(input).frameAt(60).shotLocal,3);
});

test('range validation occurs before history changes; identical and refused edits retain the redo branch',()=>{
  const input=current(),history=new SequenceHistory(input);
  const edited=sequence.setSequenceClipRange(input,'clip',.5,3.5);
  history.commit(edited);history.undo();assert.equal(history.canRedo,true);
  history.commit(sequence.setSequenceClipRange(history.current,'clip',1,3));
  assert.equal(history.canRedo,true);
  assert.throws(()=>history.commit({...history.current,clips:[clip('clip',1,1)]}));
  assert.equal(history.canRedo,true);assert.deepEqual(history.current,input);
  assert.deepEqual(history.redo(),edited);
});

test('prepared trim snapshot is frozen and detached from later range/source edits',()=>{
  const input=current(),prepared=sequence.prepareSequence(input),before=prepared.clipFrame(0,.5);
  input.clips[0].inTime=0;input.clips[0].outTime=4;input.sources[0].film.shots[1].endEye[0]=9;
  assert.deepEqual(prepared.clipFrame(0,.5),before);
  for(const value of [prepared,prepared.document,prepared.document.clips[0],prepared.clips[0],before,before.camera.eye])assert.equal(Object.isFrozen(value),true);
  assert.throws(()=>{prepared.document.clips[0].outTime=4;},TypeError);
});

test('legacy draft migrates in memory only, while raw input byte limits and protected writes remain exact',()=>{
  const legacy=oldRich(),raw=JSON.stringify(legacy);let writes=0;
  const values=new Map([[SEQUENCE_DRAFT_KEY,raw]]),storage={getItem:key=>values.get(key)??null,setItem(key,value){writes++;values.set(key,value);}};
  const store=new SequenceDraftStore(()=>storage);
  assert.equal(store.sequence.schemaVersion,3);assert.equal(writes,0);assert.equal(values.get(SEQUENCE_DRAFT_KEY),raw);
  assert.deepEqual(store.sequence.clips,[clip('clip',0,4)]);
  store.save(sequence.setSequenceClipRange(store.sequence,'clip',1,3));
  assert.equal(writes,1);assert.equal(JSON.parse(values.get(SEQUENCE_DRAFT_KEY)).schemaVersion,3);
  const json=JSON.stringify(current()),size=new TextEncoder().encode(json).length;
  assert.deepEqual(sequence.importSequence(json+' '.repeat(327680-size)),current());
  assert.throws(()=>sequence.importSequence(json+' '.repeat(327680-size+1)));
});
