import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,performerAt} from '../src/model.js';
import * as sequence from '../src/sequence.js';
import {SequenceHistory,SequenceDraftStore,SEQUENCE_DRAFT_KEY} from '../src/sequence-store.js';

// Adapted independent concurrent tests: original literal clocks and geometry
// remain unchanged; edits now name stable clip IDs and evaluation is prepared.
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
const withAmber=()=>sequence.addSequenceSource(sequence.createSequence(),{id:'amber',label:'Amber',film:fixture()});
const amberClip=(id,shotIndex)=>({id,sourceId:'amber',shotIndex,label:`Amber shot ${shotIndex+1}`});

test('current separate domain, prepared clock and store history APIs are callable',()=>{
  for(const name of ['createSequence','validateSequence','importSequence','addSequenceSource','addSequenceClip','removeSequenceClip','moveSequenceClip','removeSequenceSource','sequenceDuration','prepareSequence'])assert.equal(typeof sequence[name],'function',name);
  assert.equal(typeof SequenceHistory,'function');assert.equal(typeof SequenceDraftStore,'function');
});
test('empty canonical sequence is valid, detached and cannot be rendered',()=>{
  const p=sequence.createSequence();assert.deepEqual(p,{schemaVersion:2,kind:'shot-studio-sequence',title:'Scene sequence',sources:[],clips:[]});
  assert.equal(sequence.sequenceDuration(p),0);assert.throws(()=>sequence.prepareSequence(p).frameAt(0),/clip|empty/i);
  const q=sequence.validateSequence(p);q.sources.push({});assert.equal(p.sources.length,0);
});
test('captured source preserves the complete source film independent of all later edits',()=>{
  const film=fixture(),original=structuredClone(film),p=sequence.addSequenceSource(sequence.createSequence(),{id:'amber',label:'Amber',film});
  film.actors[0].cues[0].x=4;film.shots[0].duration=4;film.title='Edited';
  assert.deepEqual(p.sources[0].film,original);assert.equal(p.clips.length,0);
  const validated=sequence.validateSequence(p);validated.sources[0].film.actors[0].cues[0].x=0;assert.deepEqual(p.sources[0].film,original);
});
test('later source shot starts at original 3s; camera and action phase use source time',()=>{
  const p=sequence.addSequenceClip(withAmber(),amberClip('later',1)),prepared=sequence.prepareSequence(p);
  const v=prepared.frameAt(1);
  assert.equal(v.sequenceTime,1);assert.equal(v.sourceGlobal,4);assert.equal(v.clipLocal,1);assert.equal(v.shotIndex,1);
  assert.equal(v.camera.fov,40);assert.deepEqual(v.camera.target,[0,1,0]);
  for(const [i,want] of [.8,2,6].entries())assert.ok(Math.abs(v.camera.eye[i]-want)<1e-12);
  assert.deepEqual(performerAt(v.sourceFilm,0,v.sourceGlobal),performerAt(fixture(),0,4));
  assert.equal(performerAt(v.sourceFilm,0,v.sourceGlobal).x,1);
  assert.equal(performerAt(v.sourceFilm,0,v.sourceGlobal).visible,true);
  assert.equal(prepared.frameAt(2).sourceGlobal,5);
  assert.equal(performerAt(v.sourceFilm,0,5).visible,false);
});
test('repeat resets original shot clock and exact hard cut selects the next source',()=>{
  let p=sequence.addSequenceClip(withAmber(),amberClip('first_repeat',1));p=sequence.addSequenceClip(p,amberClip('second_repeat',1));
  const blue=createProject();blue.title='Blue';blue.light=1.8;blue.shots[0].duration=2;
  p=sequence.addSequenceSource(p,{id:'blue',label:'Blue',film:blue});p=sequence.addSequenceClip(p,{id:'blue_end',sourceId:'blue',shotIndex:0,label:'Blue first'});
  const prepared=sequence.prepareSequence(p);
  assert.equal(sequence.sequenceDuration(p),12);
  assert.equal(prepared.frameAt(4.999).clipIndex,0);
  assert.equal(prepared.frameAt(5).clipIndex,1);assert.equal(prepared.frameAt(5).sourceGlobal,3);
  const cut=prepared.frameAt(10);assert.equal(cut.sourceId,'blue');assert.equal(cut.sourceGlobal,0);assert.equal(cut.sourceFilm.light,1.8);
  const end=prepared.frameAt(12);assert.equal(end.clipIndex,2);assert.equal(end.sourceGlobal,2);assert.equal(end.clipLocal,2);
  assert.equal(prepared.frameAt(-5).sequenceTime,0);assert.equal(prepared.frameAt(100).sequenceTime,12);
});
test('fractional cut and source clocks use independently accumulated durations',()=>{
  const film=createProject();film.shots=[...Array(3)].map((_,i)=>({...structuredClone(film.shots[0]),name:`S${i}`,duration:1.1}));
  let p=sequence.addSequenceSource(sequence.createSequence(),{id:'f',label:'Fractional',film});
  for(const [index,shotIndex] of [2,1,2].entries())p=sequence.addSequenceClip(p,{id:`fractional_${index}`,sourceId:'f',shotIndex,label:`Fractional ${index}`});
  const prepared=sequence.prepareSequence(p);
  assert.equal(prepared.frameAt(1.1).clipIndex,1);assert.equal(prepared.frameAt(1.1).sourceGlobal,1.1);
  const end=prepared.frameAt(3.3000000000000003);assert.equal(end.clipLocal,1.1);assert.equal(end.sourceGlobal,3.3000000000000003);
});
test('prepared sequence frames freeze detached films and cameras without changing durable snapshots',()=>{
  const p=sequence.addSequenceClip(withAmber(),amberClip('later',1)),before=JSON.stringify(p),prepared=sequence.prepareSequence(p),v=prepared.frameAt(0);
  assert.throws(()=>{v.sourceFilm.title='Changed';},TypeError);assert.throws(()=>{v.camera.eye[0]=15;},TypeError);
  assert.throws(()=>{v.sourceFilm.actors[0].cues[0].x=4;},TypeError);assert.equal(JSON.stringify(p),before);
  p.sources[0].film.title='Caller edit';p.sources[0].film.actors[0].cues[0].x=4;
  assert.equal(prepared.frameAt(0).sourceFilm.title,'Amber scene');assert.equal(prepared.frameAt(0).sourceFilm.actors[0].cues[0].x,-3);
});
test('four sources admitted, fifth and duplicate id rejected atomically',()=>{
  let p=sequence.createSequence();for(let i=0;i<4;i++)p=sequence.addSequenceSource(p,{id:`s${i}`,label:`S${i}`,film:fixture()});
  const before=JSON.stringify(p);assert.throws(()=>sequence.addSequenceSource(p,{id:'s4',label:'Fifth',film:fixture()}));
  assert.throws(()=>sequence.addSequenceSource(p,{id:'s0',label:'Duplicate',film:fixture()}));assert.equal(JSON.stringify(p),before);
});
test('twenty clips and exact sixty seconds admitted; quotas refuse without mutation',()=>{
  const film=createProject();film.shots=[{...film.shots[0],duration:3}];
  let p=sequence.addSequenceSource(sequence.createSequence(),{id:'s',label:'S',film});
  for(let i=0;i<20;i++)p=sequence.addSequenceClip(p,{id:`clip_${i}`,sourceId:'s',shotIndex:0,label:`Clip ${i}`});
  assert.equal(sequence.sequenceDuration(p),60);const before=JSON.stringify(p);
  assert.throws(()=>sequence.addSequenceClip(p,{id:'clip_21',sourceId:'s',shotIndex:0,label:'Over'}));assert.equal(JSON.stringify(p),before);
  const long=createProject();long.shots[0].duration=15;
  let q=sequence.addSequenceSource(sequence.createSequence(),{id:'l',label:'L',film:long});for(let i=0;i<4;i++)q=sequence.addSequenceClip(q,{id:`long_${i}`,sourceId:'l',shotIndex:0,label:'Long'});
  const old=JSON.stringify(q);assert.throws(()=>sequence.addSequenceClip(q,{id:'too_long',sourceId:'l',shotIndex:0,label:'Over'}));assert.equal(q.clips.length,4);assert.equal(JSON.stringify(q),old);
});
test('stable-ID move and remove preserve sources and reject referenced source removal',()=>{
  let p=sequence.addSequenceClip(withAmber(),amberClip('first',0));p=sequence.addSequenceClip(p,amberClip('later',1));
  const sources=JSON.stringify(p.sources),q=sequence.moveSequenceClip(p,'later',-1);assert.deepEqual(q.clips.map(c=>c.shotIndex),[1,0]);assert.deepEqual(q.clips.map(c=>c.id),['later','first']);assert.equal(JSON.stringify(q.sources),sources);
  assert.throws(()=>sequence.removeSequenceSource(q,'amber'),/clip|used|referenc/i);
  let empty=sequence.removeSequenceClip(sequence.removeSequenceClip(q,'later'),'first');empty=sequence.removeSequenceSource(empty,'amber');assert.deepEqual(empty.sources,[]);
  for(const id of [-1,2,NaN,.5,'absent'])assert.throws(()=>sequence.removeSequenceClip(p,id));
  for(const direction of [-2,0,2,'1'])assert.throws(()=>sequence.moveSequenceClip(p,'first',direction));assert.throws(()=>sequence.moveSequenceClip(p,'first',-1));
});
test('current parser rejects films as sequences, future versions and extra keys',()=>{
  const p=withAmber();assert.deepEqual(sequence.importSequence(JSON.stringify(p)),p);
  for(const candidate of [fixture(),{...p,schemaVersion:3},{...p,kind:'other'},{...p,extra:true}])assert.throws(()=>sequence.importSequence(JSON.stringify(candidate)));
  for(const key of ['title','sources','clips','kind']){const q=structuredClone(p);delete q[key];assert.throws(()=>sequence.validateSequence(q));}
});
test('source and clip shapes, complete schema3 snapshots, indices and references are strict',()=>{
  const p=sequence.addSequenceClip(withAmber(),amberClip('first',0));
  const mutations=[q=>q.sources[0].extra=1,q=>q.clips[0].extra=1,q=>q.clips[0].sourceId='absent',q=>q.clips[0].shotIndex=2,
    q=>q.clips[0].shotIndex='0',q=>q.sources[0].film.schemaVersion=2,q=>q.sources[0].film.actors[0].cues[0].time=1,
    q=>q.sources[0].id='',q=>q.sources[0].label='',q=>q.title='\ud800',q=>q.sources[0].label='\udfff',q=>q.sources.push(structuredClone(q.sources[0]))];
  for(const mutate of mutations){const q=structuredClone(p);mutate(q);assert.throws(()=>sequence.validateSequence(q));}
  const sparse=structuredClone(p);sparse.clips.length=2;assert.throws(()=>sequence.validateSequence(sparse));
  let reads=0;const getter=structuredClone(p);Object.defineProperty(getter.sources[0],'label',{enumerable:true,get(){reads++;return 'X';}});
  assert.throws(()=>sequence.validateSequence(getter));assert.equal(reads,0);
});
test('bounded import and both prepared time APIs reject coercion and nonfinite values',()=>{
  const text=JSON.stringify(withAmber()),bounded=text+' '.repeat(327680-Buffer.byteLength(text));
  assert.equal(sequence.importSequence(bounded).schemaVersion,2);assert.throws(()=>sequence.importSequence(bounded+' '));
  assert.throws(()=>sequence.importSequence({}));assert.throws(()=>sequence.importSequence('{broken'));
  const p=sequence.addSequenceClip(withAmber(),amberClip('first',0)),prepared=sequence.prepareSequence(p);
  for(const time of [NaN,Infinity,-Infinity,'1',null,undefined]){assert.throws(()=>prepared.frameAt(time));assert.throws(()=>prepared.clipFrame(0,time));}
});
test('bounded separate history preserves redo after invalid or identical edits and detaches callers',()=>{
  const h=new SequenceHistory(withAmber());h.commit(sequence.addSequenceClip(h.current,amberClip('first',0)));h.undo();assert.equal(h.canRedo,true);
  h.commit(h.current);assert.equal(h.canRedo,true);assert.throws(()=>h.commit({...h.current,title:''}));assert.equal(h.canRedo,true);
  assert.equal(h.redo().clips.length,1);const out=h.current;out.sources[0].film.title='Alien';assert.equal(h.current.sources[0].film.title,'Amber scene');
  h.undo();h.commit({...h.current,title:'New'});assert.equal(h.canRedo,false);
  for(let i=0;i<35;i++)h.commit({...h.current,title:`Edit ${i}`});let n=0;while(h.canUndo){h.undo();n++;}assert.equal(n,30);
});

// Literal published-v1 envelope is admitted independently from canonical fixtures.
function remoteLegacy(){return {schemaVersion:1,kind:'shot-studio-sequence',title:'Published sequence',sources:[{id:'amber',name:'Amber source name',film:fixture()}],clips:[{sourceId:'amber',shotIndex:1},{sourceId:'amber',shotIndex:0},{sourceId:'amber',shotIndex:1}]};}
test('published v1 migrates complete films and deterministic clip identities with literal source clocks',()=>{
  const old=remoteLegacy(),raw=JSON.stringify(old),result=sequence.importSequence(raw);
  assert.deepEqual(result,{schemaVersion:2,kind:'shot-studio-sequence',title:'Published sequence',sources:[{id:'amber',label:'Amber source name',film:fixture()}],clips:[
    {id:'legacy-clip-1',sourceId:'amber',shotIndex:1,label:'Two-shot'},
    {id:'legacy-clip-2',sourceId:'amber',shotIndex:0,label:'Establishing'},
    {id:'legacy-clip-3',sourceId:'amber',shotIndex:1,label:'Two-shot'},
  ]});
  assert.equal(JSON.stringify(old),raw);const prepared=sequence.prepareSequence(result);
  assert.equal(prepared.frameAt(5).clipId,'legacy-clip-2');assert.equal(prepared.frameAt(5).sourceGlobal,0);
  assert.equal(prepared.frameAt(8).clipId,'legacy-clip-3');assert.equal(prepared.frameAt(8).sourceGlobal,3);
  assert.equal(prepared.clipFrame(0,5).camera.eye[0],4);assert.equal(prepared.clipFrame(0,5).sourceGlobal,8);
  const repeated=sequence.addSequenceClip(result,{id:'explicit_repeat',sourceId:'amber',shotIndex:1,label:'Repeated last'});
  assert.deepEqual(repeated.clips.slice(0,3),result.clips);assert.equal(sequence.prepareSequence(repeated).frameAt(13).sourceGlobal,3);
});
test('published v1 original byte ceiling and source name limit remain admitted without mutation',()=>{
  const old=remoteLegacy();old.sources[0].name='n'.repeat(80);
  const raw=JSON.stringify(old),padded=raw+' '.repeat(300*1024-Buffer.byteLength(raw));
  assert.equal(sequence.importSequence(padded).sources[0].label,'n'.repeat(80));assert.throws(()=>sequence.importSequence(padded+' '));
  const over=structuredClone(old);over.sources[0].name+='n';assert.throws(()=>sequence.validateSequence(over));assert.equal(old.sources[0].name.length,80);
});
test('published v1 disk text is retained across read-only migration then an explicit canonical2 save',()=>{
  const raw=JSON.stringify(remoteLegacy(),null,2),records=new Map([[SEQUENCE_DRAFT_KEY,raw],['shot-studio-v1','ordinary scene untouched']]),writes=[];
  const disk={getItem:key=>records.get(key)??null,setItem(key,value){writes.push([key,value]);records.set(key,value);}};
  const store=new SequenceDraftStore(()=>disk),loaded=store.sequence;
  assert.equal(loaded.schemaVersion,2);assert.equal(store.blocked,false);assert.deepEqual(writes,[]);assert.equal(records.get(SEQUENCE_DRAFT_KEY),raw);
  const history=new SequenceHistory(loaded),next=history.current;next.title='New branch';history.commit(next);assert.deepEqual(history.undo(),loaded);assert.deepEqual(history.redo(),next);
  assert.equal(records.get(SEQUENCE_DRAFT_KEY),raw);store.save(next);
  assert.deepEqual(JSON.parse(records.get(SEQUENCE_DRAFT_KEY)),next);assert.equal(writes.length,1);assert.equal(records.get('shot-studio-v1'),'ordinary scene untouched');
});
