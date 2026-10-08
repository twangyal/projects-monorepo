/** Independent literal fixtures frozen before reading the trimming implementation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as sequence from '../src/sequence.js';
import {performerAt} from '../src/model.js';
import {SequenceHistory,SequenceDraftStore,SEQUENCE_DRAFT_KEY} from '../src/sequence-store.js';

function film(){return {schemaVersion:3,title:'Original full film 🌿',light:1,actors:[
  {name:'Cued',color:'#00ff00',performanceMode:'blocking',cues:[
    {time:0,x:-2,z:0,action:'idle',visible:true},
    {time:2,x:0,z:0,action:'wave',visible:true},
    {time:4,x:2,z:0,action:'idle',visible:false},
    {time:6,x:2,z:2,action:'walk',visible:true},
  ]},
  {name:'Loop',x:0,z:1,color:'#ff0000',action:'walk',performanceMode:'loop'},
],shots:[
  {name:'Prefix',duration:2,eye:[4,2,8],target:[0,1,0],fov:45,cameraMode:'static'},
  {name:'Travel',duration:4,eye:[-2,2,8],target:[0,1,0],fov:45,cameraMode:'linear',endEye:[2,2,8],endTarget:[0,1,0]},
  {name:'Unselected tail',duration:2,eye:[-4,2,8],target:[0,1,0],fov:45,cameraMode:'static'},
]};}
function document(){return {schemaVersion:3,kind:'shot-studio-sequence',title:'Independent excerpts',sources:[{id:'original',label:'Complete source',film:film()}],clips:[
  {id:'excerpt',sourceId:'original',shotIndex:1,label:'Middle',inTime:1,outTime:3},
  {id:'repeat',sourceId:'original',shotIndex:1,label:'Repeat',inTime:1,outTime:3},
]};}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unchanged=(input,fn)=>{const before=JSON.stringify(input);assert.throws(fn);assert.equal(JSON.stringify(input),before);};
function legacy(version=2){const old=document();old.schemaVersion=version;old.clips=old.clips.map(({inTime,outTime,...clip})=>{void inTime;void outTime;return clip;});return old;}

test('oracle trimmed camera uses original shot local time and preserves complete source bytes',()=>{
  const input=document(),before=hash(input.sources[0].film),p=sequence.prepareSequence(input);
  assert.equal(p.duration,4);
  assert.deepEqual(p.clips[0],{id:'excerpt',label:'Middle',sourceId:'original',sourceLabel:'Complete source',shotIndex:1,shotName:'Travel',sequenceStart:0,sourceStart:2,duration:2,inTime:1,outTime:3,sourceDuration:4});
  for(const [local,shotLocal,global,x] of [[0,1,3,-1],[1,2,4,0],[2,3,5,1]]){
    const frame=p.clipFrame(0,local);assert.equal(frame.clipLocal,local);assert.equal(frame.shotLocal,shotLocal);assert.equal(frame.sourceGlobal,global);assert.deepEqual(frame.camera.eye,[x,2,8]);
  }
  assert.equal(hash(p.document.sources[0].film),before);assert.equal(hash(input.sources[0].film),before);
  assert.ok(Object.isFrozen(p.document.sources[0].film.actors[0].cues[0]));
  input.sources[0].film.shots[1].eye[0]=12;assert.deepEqual(p.clipFrame(0,0).camera.eye,[-1,2,8]);
});

test('oracle original performer phase and visibility survive trimming and repetition',()=>{
  const p=sequence.prepareSequence(document()),a=p.frameAt(0),b=p.frameAt(2);
  for(const frame of [a,b]){
    const cue=performerAt(frame.sourceFilm,0,frame.sourceGlobal);
    assert.equal(cue.x,1);assert.equal(cue.z,0);assert.equal(cue.visible,true);assert.equal(cue.action,'wave');assert.equal(cue.arm,.8+.5*Math.sin(6));
    const loop=performerAt(frame.sourceFilm,1,frame.sourceGlobal);assert.equal(loop.x,.7*Math.sin(3));assert.equal(loop.arm,.5*Math.sin(15));
  }
  assert.equal(a.sourceGlobal,b.sourceGlobal);assert.equal(b.clipIndex,1);assert.equal(b.clipLocal,0);
  const hidden=p.frameAt(1);assert.equal(hidden.sourceGlobal,4);assert.equal(performerAt(hidden.sourceFilm,0,hidden.sourceGlobal).visible,false);
  assert.equal(p.clipFrame(0,2).sourceGlobal,5);assert.equal(p.frameAt(2).sourceGlobal,3);
});

test('oracle explicit endpoint preserves literal Out despite subtraction/addition ULP drift',()=>{
  const d=document();d.clips=[{...d.clips[0],inTime:.03,outTime:.29}];
  assert.notEqual(.03+(.29-.03),.29);
  const p=sequence.prepareSequence(d);assert.equal(p.duration,.26);
  for(const frame of [p.clipFrame(0,.26),p.clipFrame(0,100),p.frameAt(.26),p.frameAt(100)]){
    assert.equal(frame.shotLocal,.29);assert.equal(frame.sourceGlobal,2.29);assert.equal(frame.clipLocal,.26);
  }
  assert.equal(p.clipFrame(0,-1).shotLocal,.03);assert.throws(()=>p.frameAt(Infinity));assert.throws(()=>p.clipFrame(0,NaN));
});

test('oracle fractional source prefixes and exact destination cuts keep clocks distinct',()=>{
  const d=document();d.sources[0].film.shots[0].duration=1.1;d.sources[0].film.shots[1].duration=1.2;
  d.sources[0].film.shots[2].duration=4;
  d.clips=[{...d.clips[0],shotIndex:2,inTime:.2,outTime:.5},{...d.clips[1],shotIndex:0,inTime:.1,outTime:.3}];
  const p=sequence.prepareSequence(d),cut=.5-.2;
  assert.equal(p.clips[0].sourceStart,1.1+1.2);assert.equal(p.frameAt(0).sourceGlobal,1.1+1.2+.2);
  assert.equal(p.frameAt(cut).clipIndex,1);assert.equal(p.frameAt(cut).shotLocal,.1);assert.equal(p.frameAt(cut).clipLocal,0);
  assert.equal(p.clipFrame(0,cut).shotLocal,.5);assert.equal(p.clipFrame(0,cut).shotIndex,2);
  assert.equal(p.frameAt(p.duration).shotLocal,.3);
});

test('oracle literal schema2 and both schema1 forms migrate full shots without source mutation',()=>{
  for(const version of [1,2]){
    const old=legacy(version),raw=JSON.stringify(old),expected=structuredClone(old);expected.schemaVersion=3;expected.clips=expected.clips.map(c=>({...c,inTime:0,outTime:4}));
    assert.deepEqual(sequence.validateSequence(old),expected);assert.deepEqual(sequence.importSequence(raw),expected);assert.equal(JSON.stringify(old),raw);
    for(const field of ['inTime','outTime']){const corrupt=structuredClone(old);corrupt.clips[0][field]=0;unchanged(corrupt,()=>sequence.validateSequence(corrupt));}
  }
  const old=legacy(1);old.sources=old.sources.map(({label,...s})=>({...s,name:label}));old.clips=old.clips.map(({sourceId,shotIndex})=>({sourceId,shotIndex}));
  const result=sequence.importSequence(JSON.stringify(old));assert.equal(result.schemaVersion,3);
  assert.deepEqual(result.clips,[1,2].map(n=>({id:`legacy-clip-${n}`,sourceId:'original',shotIndex:1,label:'Travel',inTime:0,outTime:4})));
  assert.deepEqual(result.sources,[{id:'original',label:'Complete source',film:film()}]);
});

test('oracle exact represented minimum and invalid ranges reject atomically without rounding',()=>{
  assert.equal(sequence.MIN_SEQUENCE_CLIP_SECONDS,.1);
  const d=document();assert.equal(sequence.setSequenceClipRange(d,'excerpt',0,.1).clips[0].outTime,.1);
  for(const [start,end] of [[0,.09999999999999999],[.2,.3],[1,1],[2,1],[-.1,1],[0,4.000000000000001],[NaN,2],[0,Infinity],['0',1]])unchanged(d,()=>sequence.setSequenceClipRange(d,'excerpt',start,end));
  const zero=sequence.setSequenceClipRange(d,'excerpt',-0,1);assert.equal(Object.is(zero.clips[0].inTime,-0),false);
});

test('oracle compensated60-second span quota is permutation invariant and refuses represented excess',()=>{
  const d=document();d.sources[0].film.shots[1].duration=6;
  d.clips=Array.from({length:20},(_,i)=>({id:`c${i}`,sourceId:'original',shotIndex:1,label:'Range',inTime:0,outTime:i%2?4.7:1.3}));
  for(const clips of [d.clips,[...d.clips].reverse(),[...d.clips.filter((_,i)=>i%2),...d.clips.filter((_,i)=>!(i%2))]]){
    const q={...d,clips};assert.equal(sequence.sequenceDuration(q),60);const p=sequence.prepareSequence(q);assert.equal(p.frameAt(60).shotLocal,clips.at(-1).outTime);assert.equal(p.frameAt(60).sequenceTime,60);
  }
  const over=structuredClone(d);for(const c of over.clips)if(c.outTime===4.7)c.outTime=4.700000000000001;unchanged(over,()=>sequence.validateSequence(over));
  const extra=structuredClone(d);extra.clips.push({...extra.clips[0],id:'extra'});unchanged(extra,()=>sequence.validateSequence(extra));
});

test('oracle range mutation reset repeat and no-op history preserve source and redo',()=>{
  const d=document(),sourceHash=hash(d.sources),h=new SequenceHistory(d);
  const changed=sequence.setSequenceClipRange(d,'excerpt',.5,3.5);h.commit(changed);assert.equal(h.canUndo,true);h.undo();assert.equal(h.canRedo,true);
  h.commit(sequence.setSequenceClipRange(h.current,'excerpt',1,3));assert.equal(h.canRedo,true);
  unchanged(h.current,()=>h.commit(sequence.setSequenceClipRange(h.current,'excerpt',2,2)));assert.equal(h.canRedo,true);assert.deepEqual(h.redo(),changed);
  const repeated=sequence.addSequenceClip(changed,{...changed.clips[0],id:'third'});assert.deepEqual(repeated.clips[2],{id:'third',sourceId:'original',shotIndex:1,label:'Middle',inTime:.5,outTime:3.5});
  const reset=sequence.resetSequenceClipRange(changed,'excerpt');assert.equal(reset.clips[0].inTime,0);assert.equal(reset.clips[0].outTime,4);assert.equal(hash(reset.sources),sourceHash);
  assert.deepEqual(d,document());
});

test('oracle strict canonical fields and getters are refused without running getters',()=>{
  for(const mutate of [d=>d.schemaVersion=4,d=>d.clips[0].extra=true,d=>delete d.clips[0].outTime,d=>d.clips[0].sourceId='missing',d=>d.clips[0].shotIndex=8,d=>d.clips=new Array(2)]){const d=document();mutate(d);assert.throws(()=>sequence.validateSequence(d));}
  const d=document();let reads=0;Object.defineProperty(d.clips[0],'inTime',{enumerable:true,get(){reads++;return 1;}});assert.throws(()=>sequence.validateSequence(d));assert.equal(reads,0);
});

test('oracle old raw draft is untouched on load and foreign raw text remains recoverable',()=>{
  let raw=' '+JSON.stringify(legacy(2))+'\n',writes=0;const original=raw;
  const storage={getItem:key=>{assert.equal(key,SEQUENCE_DRAFT_KEY);return raw;},setItem:(key,value)=>{assert.equal(key,SEQUENCE_DRAFT_KEY);writes++;raw=value;}};
  const store=new SequenceDraftStore(()=>storage);assert.equal(store.sequence.schemaVersion,3);assert.equal(writes,0);assert.equal(raw,original);
  const next=sequence.setSequenceClipRange(store.sequence,'excerpt',1,3);raw='foreign unreadable <🌿>';
  assert.throws(()=>store.save(next));assert.equal(raw,'foreign unreadable <🌿>');assert.equal(writes,0);assert.equal(JSON.parse(store.recoveryJson()).raw,raw);
});

test('oracle exact raw file budgets retain old300KiB and current320KiB boundaries',()=>{
  const d=document(),raw=JSON.stringify(d),bytes=Buffer.byteLength(raw);assert.deepEqual(sequence.importSequence(raw+' '.repeat(327680-bytes)),d);assert.throws(()=>sequence.importSequence(raw+' '.repeat(327681-bytes)));
  const old=legacy(1);old.sources=old.sources.map(({label,...s})=>({...s,name:label}));old.clips=old.clips.map(({sourceId,shotIndex})=>({sourceId,shotIndex}));
  const legacyRaw=JSON.stringify(old),size=Buffer.byteLength(legacyRaw);assert.equal(sequence.importSequence(legacyRaw+' '.repeat(307200-size)).schemaVersion,3);assert.throws(()=>sequence.importSequence(legacyRaw+' '.repeat(307201-size)));
});
