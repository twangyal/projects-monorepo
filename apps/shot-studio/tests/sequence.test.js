import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,importProject} from '../src/model.js';
import * as sequence from '../src/sequence.js';

function source(id='source-a'){
  const film=createProject();film.title=' Literal <scene> ';
  film.shots[0].duration=1.1;film.shots[1].duration=1.2;
  film.shots.push({...structuredClone(film.shots[1]),name:'Tail',duration:1.3});
  film.shots[1]={...film.shots[1],cameraMode:'linear',eye:[0,2,8],target:[0,1,0],endEye:[2,2,8],endTarget:[2,1,0]};
  film.actors[0]={name:'Authored',color:'#00ff00',performanceMode:'blocking',cues:[
    {time:0,x:-1,z:0,action:'idle',visible:true},{time:2.3,x:2,z:1,action:'wave',visible:false},
  ]};
  return {id,label:' Original copy ',film};
}
function fixture(){
  return {schemaVersion:2,kind:'shot-studio-sequence',title:' Literal cut ',sources:[source()],clips:[
    {id:'c1',sourceId:'source-a',shotIndex:1,label:'Middle'},
    {id:'c2',sourceId:'source-a',shotIndex:0,label:'Opening'},
    {id:'c3',sourceId:'source-a',shotIndex:1,label:'Middle again'},
  ]};
}
function unchanged(input,action){const before=JSON.stringify(input);assert.throws(action);assert.equal(JSON.stringify(input),before);}

test('new sequence is empty and detached; empty evaluation explains how to add a clip',()=>{
  const a=sequence.createSequence(),b=sequence.createSequence();
  assert.deepEqual(a,{schemaVersion:2,kind:'shot-studio-sequence',title:'Scene sequence',sources:[],clips:[]});
  a.sources.push(source());assert.deepEqual(b.sources,[]);
  assert.equal(sequence.sequenceDuration(b),0);
  const prepared=sequence.prepareSequence(b);assert.equal(prepared.duration,0);assert.ok(Object.isFrozen(prepared.document));
  assert.throws(()=>prepared.frameAt(0),/clip|shot|empty/i);assert.throws(()=>prepared.clipFrame(0,0));
});

test('admission retains exact complete source films, labels, cues and unselected shots without aliases',()=>{
  const input=fixture(),before=JSON.stringify(input),copy=sequence.validateSequence(input);
  assert.deepEqual(copy,input);assert.equal(JSON.stringify(input),before);
  copy.sources[0].film.shots[2].eye[0]=10;copy.sources[0].film.actors[0].cues[1].x=0;copy.clips[0].label='Edit';
  assert.equal(input.sources[0].film.shots[2].eye[0],0);assert.equal(input.sources[0].film.actors[0].cues[1].x,2);assert.equal(input.clips[0].label,'Middle');
  assert.equal(sequence.sequenceDuration(input),1.2+1.1+1.2);
});

test('sequence records are exact data shapes with no sparse/inherited/accessor fields',()=>{
  for(const mutate of [v=>v.extra=1,v=>v.sources[0].extra=true,v=>v.clips[0].extra=true,
    v=>delete v.title,v=>v.sources=new Array(1),v=>Object.setPrototypeOf(v.clips,{}),
    v=>Object.defineProperty(v.clips[0],'label',{value:'Middle',enumerable:false}),
    v=>v[Symbol('hidden')]=1,v=>v.sources[0].film.shots[0].extra=1]){
    const input=fixture();mutate(input);assert.throws(()=>sequence.validateSequence(input));
  }
  let reads=0;const input=fixture();Object.defineProperty(input.sources[0],'film',{get(){reads++;return source().film;},enumerable:true});
  assert.throws(()=>sequence.validateSequence(input));assert.equal(reads,0);
  const nullRoot=Object.assign(Object.create(null),fixture());assert.deepEqual(sequence.validateSequence(nullRoot),fixture());
});

test('new text is literal well-formed Unicode with UTF16 limits and no controls',()=>{
  for(const text of ['', '  ','x'.repeat(81),'\ud800','\udc00','a\n','a\x7f']){
    const input=fixture();input.title=text;assert.throws(()=>sequence.validateSequence(input));
  }
  const input=fixture();input.title='😀'.repeat(40);input.sources[0].label='😀'.repeat(20);
  assert.equal(sequence.validateSequence(input).title,input.title);
  input.clips[0].label='😀'.repeat(21);assert.throws(()=>sequence.validateSequence(input));
});

test('IDs, references, indices, duplicate identity and schema3 embedded admission are strict',()=>{
  for(const mutate of [v=>v.sources[0].id='a/b',v=>v.clips[0].id='',v=>v.clips[0].sourceId='gone',
    v=>v.clips[0].shotIndex=1.5,v=>v.clips[0].shotIndex=3,v=>v.clips[0].shotIndex=true,
    v=>v.sources.push(structuredClone(v.sources[0])),v=>v.clips[1].id='c1',v=>v.schemaVersion=3,
    v=>v.sources[0].film.schemaVersion=2]){
    const input=fixture();mutate(input);unchanged(input,()=>sequence.validateSequence(input));
  }
  const input=fixture();input.clips[0].id='source-a';assert.equal(sequence.validateSequence(input).clips[0].id,'source-a');
  const legacy=createProject();legacy.schemaVersion=2;legacy.actors=legacy.actors.map(({performanceMode,...actor})=>{void performanceMode;return actor;});
  const migrated=importProject(JSON.stringify(legacy));assert.equal(sequence.addSequenceSource(sequence.createSequence(),{id:'old',label:'Migrated',film:migrated}).sources[0].film.schemaVersion,3);
});

test('source add/rename/remove are detached and referenced removal refuses atomically',()=>{
  const base=fixture(),original=JSON.stringify(base),incoming=source('source-b');
  const added=sequence.addSequenceSource(base,incoming);incoming.film.title='Caller edit';
  assert.equal(added.sources[1].film.title,' Literal <scene> ');assert.equal(JSON.stringify(base),original);
  const renamed=sequence.renameSequenceSource(added,'source-b',' Literal new label ');assert.equal(renamed.sources[1].label,' Literal new label ');
  assert.deepEqual(sequence.removeSequenceSource(renamed,'source-b'),base);
  unchanged(base,()=>sequence.removeSequenceSource(base,'source-a'));
  unchanged(base,()=>sequence.renameSequenceSource(base,'missing','Label'));
  unchanged(base,()=>sequence.addSequenceSource(base,base.sources[0]));
});

test('clip add/repeat/rename/move/remove preserve sources and unrelated ordering',()=>{
  const base=fixture(),original=JSON.stringify(base);
  const added=sequence.addSequenceClip(base,{id:'repeat',sourceId:'source-a',shotIndex:1,label:' New repeat '});
  const renamed=sequence.renameSequenceClip(added,'repeat','Copy');
  const moved=sequence.moveSequenceClip(renamed,'repeat',-1);assert.deepEqual(moved.clips.map(c=>c.id),['c1','c2','repeat','c3']);
  const restored=sequence.moveSequenceClip(moved,'repeat',1);assert.deepEqual(sequence.removeSequenceClip(restored,'repeat'),base);
  assert.equal(JSON.stringify(base),original);
  for(const action of [()=>sequence.moveSequenceClip(base,'c1',-1),()=>sequence.moveSequenceClip(base,'c3',1),
    ()=>sequence.moveSequenceClip(base,'c2',0),()=>sequence.moveSequenceClip(base,'c2','1'),
    ()=>sequence.removeSequenceClip(base,'missing'),()=>sequence.addSequenceClip(base,{...base.clips[0]})])unchanged(base,action);
});

test('four sources and twenty clips at exactly60 seconds fit; plus-one count/time refuse',()=>{
  const film=createProject();film.shots[0].duration=3;
  const max={...sequence.createSequence(),sources:Array.from({length:4},(_,i)=>({id:`s${i}`,label:`Source ${i}`,film:structuredClone(film)})),
    clips:Array.from({length:20},(_,i)=>({id:`c${i}`,sourceId:`s${i%4}`,shotIndex:0,label:`Clip ${i}`}))};
  assert.equal(sequence.sequenceDuration(max),60);assert.equal(sequence.prepareSequence(max).clips.length,20);
  unchanged(max,()=>sequence.addSequenceSource(max,{id:'fifth',label:'Extra',film}));
  unchanged(max,()=>sequence.addSequenceClip(max,{id:'extra',sourceId:'s0',shotIndex:0,label:'Extra'}));
  const longer=structuredClone(max);longer.sources[0].film.shots[0].duration=3.0001;
  assert.throws(()=>sequence.validateSequence(longer));
});

test('sequence imports admit actual320KiB input and reject one extra byte without dropping values',()=>{
  const input=fixture(),json=JSON.stringify(input),size=new TextEncoder().encode(json).length;
  assert.deepEqual(sequence.importSequence(json+' '.repeat(sequence.SEQUENCE_LIMITS.bytes-size)),input);
  assert.throws(()=>sequence.importSequence(json+' '.repeat(sequence.SEQUENCE_LIMITS.bytes-size+1)),/320|byte|KiB|limit/i);
  assert.throws(()=>sequence.importSequence(123));assert.throws(()=>sequence.importSequence('{'));
  assert.throws(()=>sequence.importSequence(JSON.stringify({...input,extra:1})));
});

test('prepared original source clock repeats and clip endpoints keep the selected shot camera',()=>{
  const prepared=sequence.prepareSequence(fixture());
  assert.deepEqual(prepared.clips[0],{id:'c1',label:'Middle',sourceId:'source-a',sourceLabel:' Original copy ',shotIndex:1,shotName:prepared.document.sources[0].film.shots[1].name,sequenceStart:0,sourceStart:1.1,duration:1.2});
  const first=prepared.clipFrame(0,0),middle=prepared.clipFrame(0,.6),end=prepared.clipFrame(0,1.2),repeat=prepared.clipFrame(2,.6);
  assert.equal(first.sourceGlobal,1.1);assert.equal(middle.sourceGlobal,1.1+.6);assert.equal(end.sourceGlobal,1.1+1.2);
  assert.deepEqual(first.camera.eye,[0,2,8]);assert.deepEqual(middle.camera.eye,[1,2,8]);assert.deepEqual(end.camera.eye,[2,2,8]);
  assert.equal(end.shotIndex,1);assert.deepEqual(repeat.camera,middle.camera);assert.equal(repeat.sourceGlobal,middle.sourceGlobal);
  assert.equal(first.sourceFilm.shots.length,3);assert.equal(first.sourceFilm.actors[0].cues[1].time,2.3);
});

test('ordered fractional prefixes pick exact next cuts and exact final authored endpoint',()=>{
  const input=fixture();input.clips=[0,1,2].map((shotIndex,i)=>({id:`cut${i}`,sourceId:'source-a',shotIndex,label:`Shot ${i}`}));
  const prepared=sequence.prepareSequence(input),cut=1.1+1.2,total=cut+1.3;
  assert.equal(prepared.frameAt(cut).clipIndex,2);assert.equal(prepared.frameAt(cut).clipLocal,0);
  assert.equal(prepared.frameAt(total).clipIndex,2);assert.equal(prepared.frameAt(total).clipLocal,1.3);
  assert.equal(prepared.frameAt(-10).sequenceTime,0);assert.equal(prepared.duration,3.6);assert.equal(prepared.frameAt(100).sequenceTime,3.6);
  assert.equal(prepared.clipFrame(1,100).clipLocal,1.2);assert.equal(prepared.clipFrame(1,-100).clipLocal,0);
  for(const time of [NaN,Infinity,-Infinity,'1']){assert.throws(()=>prepared.frameAt(time));assert.throws(()=>prepared.clipFrame(0,time));}
  for(const index of [-1,3,.5,'0',NaN])assert.throws(()=>prepared.clipFrame(index,0));
});

test('prepared snapshot, metadata and camera are frozen and input edits cannot change frames',()=>{
  const input=fixture(),prepared=sequence.prepareSequence(input),before=prepared.clipFrame(0,.4);
  input.sources[0].film.shots[1].eye[0]=10;input.sources[0].film.actors[0].cues[1].visible=true;input.clips.reverse();input.title='Edit';
  assert.deepEqual(prepared.clipFrame(0,.4),before);
  for(const value of [prepared,prepared.document,prepared.document.sources,prepared.document.sources[0].film.actors[0].cues,prepared.clips,prepared.clips[0],before,before.camera,before.camera.eye])assert.ok(Object.isFrozen(value));
  assert.throws(()=>{before.camera.eye[0]=0;},TypeError);assert.throws(()=>{before.sourceFilm.title='Change';},TypeError);
  assert.notEqual(prepared.clipFrame(0,.4).camera,before.camera);
});

function remoteLegacy(){
  const own=fixture();
  return {schemaVersion:1,kind:own.kind,title:own.title,sources:own.sources.map(({id,label,film})=>({id,name:label,film})),clips:own.clips.map(({sourceId,shotIndex})=>({sourceId,shotIndex}))};
}
test('published remote schema1 migrates exact source names and repeated shot order to deterministic rich schema2',()=>{
  const remote=remoteLegacy(),before=JSON.stringify(remote),expected=fixture();
  expected.sources[0].label=remote.sources[0].name;
  expected.clips=remote.clips.map((clip,index)=>({...clip,id:`legacy-clip-${index+1}`,label:remote.sources[0].film.shots[clip.shotIndex].name}));
  assert.deepEqual(sequence.validateSequence(remote),expected);
  assert.deepEqual(sequence.importSequence(before),expected);
  assert.equal(JSON.stringify(remote),before);
  const migrated=sequence.validateSequence(remote);migrated.sources[0].film.actors[0].cues[1].x=-2;
  assert.equal(remote.sources[0].film.actors[0].cues[1].x,2);
  assert.deepEqual(sequence.prepareSequence(remote).clipFrame(0,1.2).camera.eye,[2,2,8]);
});
test('our historical schema1 richshape preserves every exact ID label and film while migrating only version',()=>{
  const legacy=fixture();legacy.schemaVersion=1;
  const before=JSON.stringify(legacy),expected=fixture();
  assert.deepEqual(sequence.validateSequence(legacy),expected);assert.deepEqual(sequence.importSequence(before),expected);assert.equal(JSON.stringify(legacy),before);
  const empty=sequence.createSequence();empty.schemaVersion=1;assert.equal(sequence.validateSequence(empty).schemaVersion,2);
});
test('mixed legacy shapes and remote v1-only fields in canonical2 cannot be silently guessed away',()=>{
  for(const mutate of [v=>v.clips[0].id='unexpected',v=>v.clips[0].label='unexpected',
    v=>v.sources[0].label='unexpected',v=>v.schemaVersion=2,
    v=>v.sources.push({...source('other')}),v=>v.clips[0].extra=true]){
    const input=remoteLegacy();mutate(input);unchanged(input,()=>sequence.validateSequence(input));
  }
});
test('source labels80 are exact but clip labels remain40 through edits and new canonical backups',()=>{
  const input=fixture();input.sources[0].label='😀'.repeat(40);
  assert.equal(sequence.validateSequence(input).sources[0].label,input.sources[0].label);
  assert.equal(sequence.renameSequenceSource(input,'source-a','n'.repeat(80)).sources[0].label.length,80);
  unchanged(input,()=>sequence.renameSequenceSource(input,'source-a','n'.repeat(81)));
  unchanged(input,()=>sequence.renameSequenceClip(input,'c1','n'.repeat(41)));
});
test('identifiable remote name-form v1 has its original300KiB rawfile limit and canonical2 keeps320KiB',()=>{
  const legacy=remoteLegacy(),text=JSON.stringify(legacy),size=new TextEncoder().encode(text).length;
  assert.equal(sequence.importSequence(text+' '.repeat(300*1024-size)).schemaVersion,2);
  assert.throws(()=>sequence.importSequence(text+' '.repeat(300*1024-size+1)),/300|byte|KiB|limit/i);
  const current=JSON.stringify(fixture()),currentSize=new TextEncoder().encode(current).length;
  assert.equal(sequence.importSequence(current+' '.repeat(320*1024-currentSize)).schemaVersion,2);
});

test('remote generated clip labels use bounded well-formed fallback without changing original shot names',()=>{
  const legacy=remoteLegacy();legacy.sources[0].name='n'.repeat(80);
  legacy.sources[0].film.shots[1].name='Original \ud800 shot';
  legacy.sources[0].film.shots[0].name='😀'.repeat(20);
  const before=JSON.stringify(legacy),result=sequence.importSequence(before);
  assert.equal(result.sources[0].label,'n'.repeat(80));
  assert.equal(result.sources[0].film.shots[1].name,'Original \ud800 shot');
  assert.equal(result.sources[0].film.shots[0].name,'😀'.repeat(20));
  assert.deepEqual(result.clips.map(clip=>clip.label),['Shot 2','😀'.repeat(20),'Shot 2']);
  assert.equal(JSON.stringify(legacy),before);
  assert.deepEqual(sequence.validateSequence(result),result);
  assert.equal(sequence.prepareSequence(result).clips[0].shotName,'Original \ud800 shot');
  const tooLong=remoteLegacy();tooLong.sources[0].film.shots[1].name='x'.repeat(41);
  unchanged(tooLong,()=>sequence.validateSequence(tooLong));
});

test('duration quota is order-independent at60 while chronological fractional cuts remain ordered',()=>{
  const film=createProject();film.shots[0].duration=1.3;film.shots[1].duration=4.7;
  const input={...sequence.createSequence(),sources:[{id:'exact',label:'Alternating',film}],
    clips:Array.from({length:20},(_,i)=>({id:`c${i}`,sourceId:'exact',shotIndex:i%2,label:`Clip ${i}`}))};
  const before=JSON.stringify(input),moved=sequence.moveSequenceClip(input,'c11',1),prepared=sequence.prepareSequence(moved);
  assert.equal(sequence.sequenceDuration(moved),60);assert.equal(prepared.duration,60);assert.equal(JSON.stringify(input),before);
  assert.equal(prepared.clips[12].id,'c11');
  const prefix=prepared.clips.slice(0,12).reduce((sum,clip)=>sum+clip.duration,0);
  assert.equal(prepared.frameAt(prefix).clipIndex,12);assert.equal(prepared.frameAt(prefix).clipLocal,0);
  assert.equal(prepared.frameAt(60).clipIndex,19);assert.equal(prepared.frameAt(60).clipLocal,4.7);
  assert.equal(prepared.frameAt(60).sequenceTime,60);assert.equal(prepared.clipFrame(19,4.7).sequenceTime,60);
  const excessive=structuredClone(input);excessive.sources[0].film.shots[1].duration=4.700000000000001;
  unchanged(excessive,()=>sequence.validateSequence(excessive));
});
