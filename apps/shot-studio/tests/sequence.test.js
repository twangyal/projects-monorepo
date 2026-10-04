import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,performerAt} from '../src/model.js';

let api;
try { api=await import('../src/sequence.js'); } catch { api={}; }
const required=['createSequence','validateSequence','importSequence','captureSource','appendClip','removeClip','moveClip','removeSource','sequenceDuration','sequenceFrameAt','SequenceHistory'];
test('sequence domain publishes separate bounded editing and clock APIs',()=>{
  for(const name of required)assert.equal(typeof api[name],'function',name);
});
const fixture=()=>{
  const film=createProject();film.title='Amber scene';film.light=.4;
  film.shots[0].duration=3;
  Object.assign(film.shots[1],{duration:5,cameraMode:'linear',eye:[0,2,6],target:[0,1,0],endEye:[4,2,6],endTarget:[0,1,0]});
  film.actors[0]={name:'Timed',color:'#ff0000',performanceMode:'blocking',cues:[
    {time:0,x:-3,z:0,action:'idle',visible:true},
    {time:2,x:-1,z:0,action:'wave',visible:true},
    {time:5,x:2,z:0,action:'walk',visible:false},
    {time:8,x:3,z:0,action:'idle',visible:true}]};
  return film;
};
const prepared=()=>api.captureSource(api.createSequence(),{id:'amber',name:'Amber',film:fixture()});
test('empty sequence is valid, detached and cannot be rendered',()=>{
  const p=api.createSequence();assert.deepEqual(p,{schemaVersion:1,kind:'shot-studio-sequence',title:'New sequence',sources:[],clips:[]});
  assert.equal(api.sequenceDuration(p),0);assert.throws(()=>api.sequenceFrameAt(p,0),/clip|empty/i);
  const q=api.validateSequence(p);q.sources.push({});assert.equal(p.sources.length,0);
});
test('captured source preserves the complete source film independent of all later edits',()=>{
  const film=fixture(),original=structuredClone(film),p=api.captureSource(api.createSequence(),{id:'amber',name:'Amber',film});
  film.actors[0].cues[0].x=4;film.shots[0].duration=4;film.title='Edited';
  assert.deepEqual(p.sources[0].film,original);assert.equal(p.clips.length,0);
  const validated=api.validateSequence(p);validated.sources[0].film.actors[0].cues[0].x=0;assert.deepEqual(p.sources[0].film,original);
});
test('later source shot starts at original 3s; camera and action phase use source time',()=>{
  let p=api.appendClip(prepared(),'amber',1);
  const v=api.sequenceFrameAt(p,1);
  assert.equal(v.sequenceTime,1);assert.equal(v.sourceTime,4);assert.equal(v.local,1);assert.equal(v.shotIndex,1);
  assert.equal(v.camera.fov,40);assert.deepEqual(v.camera.target,[0,1,0]);
  for(const [i,want] of [.8,2,6].entries())assert.ok(Math.abs(v.camera.eye[i]-want)<1e-12);
  assert.deepEqual(performerAt(v.film,0,v.sourceTime),performerAt(fixture(),0,4));
  assert.equal(performerAt(v.film,0,v.sourceTime).x,1);
  assert.equal(performerAt(v.film,0,v.sourceTime).visible,true);
  assert.ok(Math.abs(performerAt(v.film,0,v.sourceTime).arm-(.8+.5*Math.sin(12)))<1e-12);
  assert.equal(api.sequenceFrameAt(p,2).sourceTime,5);
  assert.equal(performerAt(v.film,0,5).visible,false);
});
test('repeat resets original shot clock and exact hard cut selects the next source',()=>{
  let p=api.appendClip(prepared(),'amber',1);p=api.appendClip(p,'amber',1);
  const blue=createProject();blue.title='Blue';blue.light=1.8;blue.shots[0].duration=2;
  p=api.captureSource(p,{id:'blue',name:'Blue',film:blue});p=api.appendClip(p,'blue',0);
  assert.equal(api.sequenceDuration(p),12);
  assert.equal(api.sequenceFrameAt(p,4.999).index,0);
  assert.equal(api.sequenceFrameAt(p,5).index,1);assert.equal(api.sequenceFrameAt(p,5).sourceTime,3);
  const cut=api.sequenceFrameAt(p,10);assert.equal(cut.sourceId,'blue');assert.equal(cut.sourceTime,0);assert.equal(cut.film.light,1.8);
  const end=api.sequenceFrameAt(p,12);assert.equal(end.index,2);assert.equal(end.sourceTime,2);assert.equal(end.local,2);
  assert.equal(api.sequenceFrameAt(p,-5).sequenceTime,0);assert.equal(api.sequenceFrameAt(p,100).sequenceTime,12);
});
test('fractional cut and source clocks use independently accumulated durations',()=>{
  const film=createProject();film.shots=[...Array(3)].map((_,i)=>({...structuredClone(film.shots[0]),name:`S${i}`,duration:1.1}));
  let p=api.captureSource(api.createSequence(),{id:'f',name:'Fractional',film});
  for(const i of [2,1,2])p=api.appendClip(p,'f',i);
  assert.equal(api.sequenceFrameAt(p,1.1).index,1);assert.equal(api.sequenceFrameAt(p,1.1).sourceTime,1.1);
  const end=api.sequenceFrameAt(p,3.3000000000000003);assert.equal(end.local,1.1);assert.equal(end.sourceTime,3.3000000000000003);
});
test('sequence frames detach their film and camera from durable snapshots',()=>{
  const p=api.appendClip(prepared(),'amber',1),before=JSON.stringify(p),v=api.sequenceFrameAt(p,0);
  v.film.title='Changed';v.camera.eye[0]=15;v.film.actors[0].cues[0].x=4;assert.equal(JSON.stringify(p),before);
});
test('four sources admitted, fifth and duplicate id rejected atomically',()=>{
  let p=api.createSequence();for(let i=0;i<4;i++)p=api.captureSource(p,{id:`s${i}`,name:`S${i}`,film:fixture()});
  const before=JSON.stringify(p);assert.throws(()=>api.captureSource(p,{id:'s4',name:'Fifth',film:fixture()}));
  assert.throws(()=>api.captureSource(p,{id:'s0',name:'Duplicate',film:fixture()}));assert.equal(JSON.stringify(p),before);
});
test('twenty clips and exact sixty seconds admitted; quotas refuse without mutation',()=>{
  const film=createProject();film.shots=[{...film.shots[0],duration:3}];
  let p=api.captureSource(api.createSequence(),{id:'s',name:'S',film});
  for(let i=0;i<20;i++)p=api.appendClip(p,'s',0);
  assert.equal(api.sequenceDuration(p),60);const before=JSON.stringify(p);
  assert.throws(()=>api.appendClip(p,'s',0));assert.equal(JSON.stringify(p),before);
  const long=createProject();long.shots[0].duration=15;
  let q=api.captureSource(api.createSequence(),{id:'l',name:'L',film:long});for(let i=0;i<4;i++)q=api.appendClip(q,'l',0);
  assert.throws(()=>api.appendClip(q,'l',0));assert.equal(q.clips.length,4);
});
test('move, remove and repeat preserve original sources; referenced source cannot be removed',()=>{
  let p=api.appendClip(prepared(),'amber',0);p=api.appendClip(p,'amber',1);
  const sources=JSON.stringify(p.sources),q=api.moveClip(p,1,-1);assert.deepEqual(q.clips.map(c=>c.shotIndex),[1,0]);assert.equal(JSON.stringify(q.sources),sources);
  assert.throws(()=>api.removeSource(q,'amber'),/clip|used|referenc/i);
  let empty=api.removeClip(api.removeClip(q,0),0);empty=api.removeSource(empty,'amber');assert.deepEqual(empty.sources,[]);
  for(const i of [-1,2,NaN,.5,'0'])assert.throws(()=>api.removeClip(p,i));
  for(const d of [-2,0,2,'1'])assert.throws(()=>api.moveClip(p,0,d));assert.throws(()=>api.moveClip(p,0,-1));
});
test('sequence parser rejects films as sequences, wrong versions and extra keys',()=>{
  const p=prepared();assert.deepEqual(api.importSequence(JSON.stringify(p)),p);
  for(const candidate of [fixture(),{...p,schemaVersion:2},{...p,kind:'other'},{...p,extra:true}])assert.throws(()=>api.importSequence(JSON.stringify(candidate)));
  for(const key of ['title','sources','clips','kind']){const q=structuredClone(p);delete q[key];assert.throws(()=>api.validateSequence(q));}
});
test('source and clip shape, complete schema3 snapshots, indices and references are strict',()=>{
  const p=api.appendClip(prepared(),'amber',0);
  const mutations=[q=>q.sources[0].extra=1,q=>q.clips[0].extra=1,q=>q.clips[0].sourceId='absent',q=>q.clips[0].shotIndex=2,
    q=>q.clips[0].shotIndex='0',q=>q.sources[0].film.schemaVersion=2,q=>q.sources[0].film.actors[0].cues[0].time=1,
    q=>q.sources[0].id='',q=>q.sources[0].name='',q=>q.title='\ud800',q=>q.sources[0].name='\udfff',q=>q.sources.push(structuredClone(q.sources[0]))];
  for(const mutate of mutations){const q=structuredClone(p);mutate(q);assert.throws(()=>api.validateSequence(q));}
  const sparse=structuredClone(p);sparse.clips.length=2;assert.throws(()=>api.validateSequence(sparse));
  let reads=0;const getter=structuredClone(p);Object.defineProperty(getter.sources[0],'name',{enumerable:true,get(){reads++;return 'X';}});
  assert.throws(()=>api.validateSequence(getter));assert.equal(reads,0);
});
test('import and all time APIs reject coercion and nonfinite values',()=>{
  assert.throws(()=>api.importSequence(' '.repeat(300*1024+1)));assert.throws(()=>api.importSequence({}));assert.throws(()=>api.importSequence('{broken'));
  const p=api.appendClip(prepared(),'amber',0);
  for(const time of [NaN,Infinity,-Infinity,'1',null,undefined])assert.throws(()=>api.sequenceFrameAt(p,time));
});
test('source film text rejects malformed Unicode instead of silently retaining replacement text',()=>{
  for(const mutate of [f=>f.title='\ud800',f=>f.actors[0].name='\udfff',f=>f.shots[1].name='\ud800']){
    const film=fixture();mutate(film);assert.throws(()=>api.captureSource(api.createSequence(),{id:'bad',name:'Valid',film}));
  }
});
test('sequence import admits exact 300 KiB JSON input and rejects the next byte',()=>{
  const text=JSON.stringify(prepared()),padded=text+' '.repeat(300*1024-Buffer.byteLength(text));
  assert.equal(Buffer.byteLength(padded),300*1024);assert.deepEqual(api.importSequence(padded),prepared());assert.throws(()=>api.importSequence(padded+' '));
});
test('bounded history preserves redo after invalid or identical edits and detaches callers',()=>{
  const h=new api.SequenceHistory(prepared());h.commit(api.appendClip(h.current,'amber',0));h.undo();assert.equal(h.canRedo,true);
  h.commit(h.current);assert.equal(h.canRedo,true);assert.throws(()=>h.commit({...h.current,title:''}));assert.equal(h.canRedo,true);
  assert.equal(h.redo().clips.length,1);const out=h.current;out.sources[0].film.title='Alien';assert.equal(h.current.sources[0].film.title,'Amber scene');
  h.undo();h.commit({...h.current,title:'New'});assert.equal(h.canRedo,false);
  for(let i=0;i<35;i++)h.commit({...h.current,title:`Edit ${i}`});let n=0;while(h.canUndo){h.undo();n++;}assert.equal(n,30);
});
