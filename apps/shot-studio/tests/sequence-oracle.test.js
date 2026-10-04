// Independent #90 oracle. Literal films, clocks and scalar expectations were
// authored from the frozen contract before reading the sequence implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sequence from '../src/sequence.js';
import {performerPose} from '../src/performer.js';

const copy=value=>structuredClone(value);
const cue=(time,x,z,action='idle',visible=true)=>({time,x,z,action,visible});
const shot=(name,duration,x=0)=>({name,duration,cameraMode:'static',
  eye:[x,2,8],target:[x,1,0],fov:50});
function sourceA(){return {schemaVersion:3,title:'Arrival original',light:1,actors:[
  {name:'Red arrival',color:'#ff0000',performanceMode:'blocking',cues:[
    cue(0,-3,0,'idle',false),cue(1,-3,0,'walk'),cue(3,0,2,'wave'),
    cue(5,0,2),cue(6,0,2,'walk'),cue(8,4,2,'idle',false),cue(9,4,2)]},
  {name:'Green witness',color:'#00ff00',performanceMode:'loop',x:1,z:-1,action:'idle'}],
  shots:[shot('Unselected introduction',1.1,-3),shot('Unselected lead-in',1.2,-1),
    {name:'Selected travel',duration:4,cameraMode:'linear',eye:[-2,2,8],target:[-2,1,0],
      endEye:[2,4,6],endTarget:[1,2,-2],fov:37},shot('Distinct following camera',3,4)]};}
function sourceB(){return {schemaVersion:3,title:'Other cast original',light:.8,actors:[
  {name:'Blue pacer',color:'#0000ff',performanceMode:'loop',x:1,z:-1,action:'walk'},
  {name:'Yellow witness',color:'#ffff00',performanceMode:'loop',x:-1,z:1,action:'wave'}],
  shots:[shot('Other introduction',3,2),shot('Other selected view',2,-2)]};}
function document(){return {schemaVersion:2,kind:'shot-studio-sequence',title:'Literal reordered cut',
  sources:[{id:'arrival',label:'Original arrival',film:sourceA()},
    {id:'other',label:'Other complete scene',film:sourceB()}],
  clips:[{id:'travel',sourceId:'arrival',shotIndex:2,label:'Arrival first'},
    {id:'other-cut',sourceId:'other',shotIndex:1,label:'Other cast'},
    {id:'repeat',sourceId:'arrival',shotIndex:2,label:'Arrival repeated'},
    {id:'intro-last',sourceId:'arrival',shotIndex:0,label:'Introduction last'}]};}
function fractional(){const film=sourceB();film.shots=[shot('One',1.1),shot('Two',1.2,1),shot('Three',1.3,2)];
  return {schemaVersion:2,kind:'shot-studio-sequence',title:'Fractional boundaries',
    sources:[{id:'fractional',label:'Fractional source',film}],
    clips:film.shots.map((_,shotIndex)=>({id:`clip-${shotIndex}`,sourceId:'fractional',shotIndex,label:`Cut ${shotIndex}`}))};}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<=1e-12,`${actual} differs from ${expected}`);}
function vector(actual,expected){assert.equal(actual.length,expected.length);actual.forEach((value,index)=>near(value,expected[index]));}
function frozen(value){if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);
  for(const child of Object.values(value))frozen(child);}}

test('independent sequence oracle: exact limits and legal empty editable document',()=>{
  assert.deepEqual(sequence.SEQUENCE_LIMITS,{sources:4,clips:20,seconds:60,
    sourceBytes:65536,sourceTotalBytes:262144,bytes:327680});
  assert.equal(Object.isFrozen(sequence.SEQUENCE_LIMITS),true);
  const empty=sequence.createSequence();assert.equal(empty.kind,'shot-studio-sequence');
  assert.equal(empty.schemaVersion,2);assert.deepEqual(empty.sources,[]);assert.deepEqual(empty.clips,[]);
  assert.equal(sequence.sequenceDuration(empty),0);
  const prepared=sequence.prepareSequence(empty);assert.equal(prepared.duration,0);
  assert.throws(()=>prepared.frameAt(0));assert.throws(()=>prepared.clipFrame(0,0));
});

test('independent prefix oracle: reordered/repeated clips retain original source starts and complete films',()=>{
  const input=document(),before=JSON.stringify(input),prepared=sequence.prepareSequence(input);
  assert.equal(JSON.stringify(input),before);assert.equal(prepared.duration,11.1);
  assert.deepEqual(prepared.clips,[
    {id:'travel',label:'Arrival first',sourceId:'arrival',sourceLabel:'Original arrival',shotIndex:2,
      shotName:'Selected travel',sequenceStart:0,sourceStart:1.1+1.2,duration:4},
    {id:'other-cut',label:'Other cast',sourceId:'other',sourceLabel:'Other complete scene',shotIndex:1,
      shotName:'Other selected view',sequenceStart:4,sourceStart:3,duration:2},
    {id:'repeat',label:'Arrival repeated',sourceId:'arrival',sourceLabel:'Original arrival',shotIndex:2,
      shotName:'Selected travel',sequenceStart:6,sourceStart:1.1+1.2,duration:4},
    {id:'intro-last',label:'Introduction last',sourceId:'arrival',sourceLabel:'Original arrival',shotIndex:0,
      shotName:'Unselected introduction',sequenceStart:10,sourceStart:0,duration:1.1}]);
  assert.deepEqual(prepared.document,input);
  assert.equal(prepared.document.sources[0].film.shots.length,4);
  assert.equal(prepared.document.sources[0].film.actors[0].cues.at(-1).time,9);
});

test('independent camera oracle: selected local start/mid/end never takes the following source camera',()=>{
  const prepared=sequence.prepareSequence(document());
  const start=prepared.clipFrame(0,0),middle=prepared.clipFrame(0,2),end=prepared.clipFrame(0,4);
  vector(start.camera.eye,[-2,2,8]);vector(start.camera.target,[-2,1,0]);
  vector(middle.camera.eye,[0,3,7]);vector(middle.camera.target,[-.5,1.5,-1]);
  vector(end.camera.eye,[2,4,6]);vector(end.camera.target,[1,2,-2]);
  for(const result of [start,middle,end])assert.equal(result.camera.fov,37);
  assert.equal(end.clipIndex,0);assert.equal(end.shotIndex,2);assert.equal(end.clipLocal,4);
  assert.equal(end.sequenceTime,4);assert.equal(end.sourceGlobal,(1.1+1.2)+4);
  const ordinaryCut=prepared.frameAt(4);assert.equal(ordinaryCut.clipIndex,1);
  vector(ordinaryCut.camera.eye,[-2,2,8]);assert.equal(ordinaryCut.camera.fov,50);
});

test('independent actor clock oracle: source-global cues and full source duration survive destination rearrangement',()=>{
  const prepared=sequence.prepareSequence(document()),view=prepared.clipFrame(0,1.7);
  near(view.sourceGlobal,4);assert.equal(view.sequenceTime,1.7);
  const film=view.sourceFilm;near(film.shots.reduce((sum,item)=>sum+item.duration,0),9.3);
  const pose=performerPose(film.actors[0],view.sourceGlobal,9.3);
  near(pose.x,0);near(pose.z,2);near(pose.arm,.6602922509005371);
  assert.equal(pose.action,'wave');assert.equal(pose.visible,true);
  const later=prepared.clipFrame(0,4);
  const departure=performerPose(later.sourceFilm.actors[0],later.sourceGlobal,9.3);
  near(departure.x,.6);assert.equal(departure.action,'walk');assert.equal(departure.visible,true);
  assert.equal(later.sourceFilm.actors[0].cues.at(-1).time,9);
});

test('independent looping oracle: different cast, light and original nonzero phase belong to selected source',()=>{
  const prepared=sequence.prepareSequence(document()),view=prepared.frameAt(4.5);
  assert.equal(view.sourceId,'other');assert.equal(view.clipLocal,.5);assert.equal(view.sourceGlobal,3.5);
  assert.equal(view.sourceFilm.light,.8);assert.equal(view.sourceFilm.actors[0].name,'Blue pacer');
  const pose=performerPose(view.sourceFilm.actors[0],view.sourceGlobal,5);
  near(pose.x,.7544517406172661);near(pose.z,-1);
  near(pose.arm,-.4878130027340788);near(pose.leg,-.34146910191385514);
});

test('independent repeat oracle: same source frame repeats without accumulating destination phase',()=>{
  const prepared=sequence.prepareSequence(document()),first=prepared.frameAt(1.7),again=prepared.frameAt(7.7);
  assert.equal(first.clipIndex,0);assert.equal(again.clipIndex,2);
  near(first.clipLocal,again.clipLocal);near(first.sourceGlobal,again.sourceGlobal);
  vector(first.camera.eye,again.camera.eye);vector(first.camera.target,again.camera.target);
  assert.deepEqual(first.sourceFilm,again.sourceFilm);
});

test('independent fractional-cut oracle: exact represented prefixes select next local zero and final authored endpoint',()=>{
  // Public duration is compensated; original source/cut prefixes stay ordered.
  const prepared=sequence.prepareSequence(fractional()),cut=1.1+1.2,total=3.6;
  assert.equal(prepared.duration,total);
  assert.deepEqual(prepared.clips.map(item=>item.sequenceStart),[0,1.1,cut]);
  assert.deepEqual(prepared.clips.map(item=>item.sourceStart),[0,1.1,cut]);
  const first=prepared.frameAt(1.1);assert.equal(first.clipIndex,1);assert.equal(first.clipLocal,0);
  const next=prepared.frameAt(cut);assert.equal(next.clipIndex,2);assert.equal(next.clipLocal,0);
  assert.equal(next.sourceGlobal,cut);
  assert.equal(prepared.frameAt(cut-Number.EPSILON*2).clipIndex,1);
  const final=prepared.frameAt(total);assert.equal(final.clipIndex,2);assert.equal(final.clipLocal,1.3);
  assert.equal(final.sequenceTime,total);assert.equal(final.sourceGlobal,cut+1.3);
});

test('independent clamping oracle: finite times clamp, nonfinite times and bad indices refuse',()=>{
  const prepared=sequence.prepareSequence(document());
  assert.equal(prepared.frameAt(-100).sequenceTime,0);assert.equal(prepared.frameAt(-100).clipLocal,0);
  const final=prepared.frameAt(100);assert.equal(final.clipIndex,3);assert.equal(final.clipLocal,1.1);
  assert.equal(final.sequenceTime,11.1);assert.equal(final.sourceGlobal,1.1);
  assert.equal(prepared.clipFrame(0,-100).clipLocal,0);assert.equal(prepared.clipFrame(0,100).clipLocal,4);
  for(const time of [NaN,Infinity,-Infinity]){
    assert.throws(()=>prepared.frameAt(time));assert.throws(()=>prepared.clipFrame(0,time));}
  for(const index of [-1,4,.5,NaN,'0'])assert.throws(()=>prepared.clipFrame(index,0));
});

test('independent immutable snapshot oracle: subsequent live edits and returned cameras cannot alter preparation',()=>{
  const input=document(),prepared=sequence.prepareSequence(input),before=JSON.stringify(prepared.document);
  input.sources[0].film.shots[2].endEye[0]=3;input.sources[0].film.actors[0].cues[2].x=2;
  input.clips.reverse();input.title='Changed live title';
  assert.equal(JSON.stringify(prepared.document),before);
  assert.notEqual(prepared.document.sources[0].film,input.sources[0].film);
  frozen(prepared.document);frozen(prepared.clips);
  const result=prepared.clipFrame(0,4);frozen(result);
  assert.throws(()=>{result.camera.eye[0]=9;});assert.throws(()=>{result.sourceFilm.title='Mutated';});
  vector(prepared.clipFrame(0,4).camera.eye,[2,4,6]);
});

test('independent edit oracle: reorder/repeat/remove and labels preserve source snapshots and caller',()=>{
  const input=document(),before=JSON.stringify(input);
  const moved=sequence.moveSequenceClip(input,'other-cut',-1);
  assert.deepEqual(moved.clips.map(item=>item.id),['other-cut','travel','repeat','intro-last']);
  const repeated=sequence.addSequenceClip(moved,{id:'fresh-repeat',sourceId:'arrival',shotIndex:2,label:'Repeat explicitly'});
  assert.deepEqual(repeated.clips.map(item=>item.id),['other-cut','travel','repeat','intro-last','fresh-repeat']);
  const renamed=sequence.renameSequenceSource(sequence.renameSequenceClip(repeated,'travel',' New clip '),'arrival',' New source ');
  assert.equal(renamed.clips[1].label,' New clip ');assert.equal(renamed.sources[0].label,' New source ');
  assert.deepEqual(renamed.sources[0].film,input.sources[0].film);
  const removed=sequence.removeSequenceClip(renamed,'fresh-repeat');assert.equal(removed.clips.length,4);
  assert.equal(JSON.stringify(input),before);
  renamed.sources[0].film.actors[0].cues[0].x=0;assert.equal(input.sources[0].film.actors[0].cues[0].x,-3);
});

test('independent source removal oracle: unreferenced retained scenes need deliberate removal, referenced refuse',()=>{
  const input=document(),before=JSON.stringify(input);
  assert.throws(()=>sequence.removeSequenceSource(input,'arrival'));assert.equal(JSON.stringify(input),before);
  const added=sequence.addSequenceSource(input,{id:'unused',label:'Unused retained',film:sourceB()});
  assert.equal(added.sources.length,3);assert.equal(sequence.sequenceDuration(added),11.1);
  const removed=sequence.removeSequenceSource(added,'unused');assert.deepEqual(removed,input);
  assert.throws(()=>sequence.removeSequenceSource(input,'missing'));
});

test('independent quota oracle: four sources/twenty clips/exact sixty are legal and overage refuses atomically',()=>{
  const film=sourceB();film.shots=[shot('Three-second full shot',3)];
  const value={schemaVersion:2,kind:'shot-studio-sequence',title:'Exact topology bound',
    sources:Array.from({length:4},(_,index)=>({id:`source-${index}`,label:`Source ${index}`,film:copy(film)})),
    clips:Array.from({length:20},(_,index)=>({id:`clip-${index}`,sourceId:`source-${index%4}`,shotIndex:0,label:`Clip ${index}`}))};
  const before=JSON.stringify(value);assert.equal(sequence.sequenceDuration(value),60);
  assert.equal(sequence.prepareSequence(value).clipFrame(19,3).sequenceTime,60);
  assert.throws(()=>sequence.addSequenceSource(value,{id:'fifth',label:'Fifth',film}));
  assert.throws(()=>sequence.addSequenceClip(value,{id:'twenty-first',sourceId:'source-0',shotIndex:0,label:'Extra'}));
  const over=copy(value);over.sources[0].film.shots[0].duration=3.01;
  assert.throws(()=>sequence.validateSequence(over));assert.equal(JSON.stringify(value),before);
});

test('independent exact file bound oracle: legal UTF8 whitespace padding reaches 320 KiB, plus one refuses',()=>{
  const text=JSON.stringify(document()),remaining=327680-Buffer.byteLength(text,'utf8');
  const exact=text+' '.repeat(remaining);assert.equal(Buffer.byteLength(exact,'utf8'),327680);
  assert.deepEqual(sequence.importSequence(exact),document());
  assert.throws(()=>sequence.importSequence(exact+' '));
  const nonAscii=copy(document());nonAscii.title='🎬'.repeat(40);
  assert.equal(sequence.validateSequence(nonAscii).title,nonAscii.title);
  nonAscii.title+='🎬';assert.throws(()=>sequence.validateSequence(nonAscii));
  const sourceLabel=copy(document());sourceLabel.sources[0].label='🎬'.repeat(40);
  assert.equal(sequence.validateSequence(sourceLabel).sources[0].label,sourceLabel.sources[0].label);
  sourceLabel.sources[0].label+='x';assert.throws(()=>sequence.validateSequence(sourceLabel));
});

test('independent legacy migration oracle: original name-form v1 gains stable clip identities without changing complete sources',()=>{
  const film=sourceA(),input={schemaVersion:1,kind:'shot-studio-sequence',title:' Original private cut ',
    sources:[{id:'old',name:' Original source label ',film}],
    clips:[{sourceId:'old',shotIndex:2},{sourceId:'old',shotIndex:0},{sourceId:'old',shotIndex:2}]};
  const before=JSON.stringify(input),expected={schemaVersion:2,kind:'shot-studio-sequence',title:input.title,
    sources:[{id:'old',label:input.sources[0].name,film:copy(film)}],clips:[
      {id:'legacy-clip-1',sourceId:'old',shotIndex:2,label:'Selected travel'},
      {id:'legacy-clip-2',sourceId:'old',shotIndex:0,label:'Unselected introduction'},
      {id:'legacy-clip-3',sourceId:'old',shotIndex:2,label:'Selected travel'}]};
  assert.deepEqual(sequence.validateSequence(input),expected);
  assert.deepEqual(sequence.importSequence(before),expected);assert.equal(JSON.stringify(input),before);
  const exact=before+' '.repeat(300*1024-Buffer.byteLength(before,'utf8'));
  assert.deepEqual(sequence.importSequence(exact),expected);assert.throws(()=>sequence.importSequence(exact+' '));
  const frame=sequence.prepareSequence(input).clipFrame(0,4);
  vector(frame.camera.eye,[2,4,6]);assert.equal(frame.sourceGlobal,(1.1+1.2)+4);
});

test('independent legacy migration oracle: in-session rich v1 keeps identities/labels and migrates once to canonical v2',()=>{
  const input=document();input.schemaVersion=1;input.sources[0].label='x'.repeat(80);
  const before=JSON.stringify(input),expected=copy(input);expected.schemaVersion=2;
  assert.deepEqual(sequence.validateSequence(input),expected);
  assert.deepEqual(sequence.importSequence(before),expected);
  assert.deepEqual(sequence.importSequence(JSON.stringify(expected)),expected);
  assert.equal(JSON.stringify(input),before);
  const padded=before+' '.repeat(327680-Buffer.byteLength(before,'utf8'));
  assert.deepEqual(sequence.importSequence(padded),expected);
  const mixed=copy(input);mixed.sources[0].name=mixed.sources[0].label;delete mixed.sources[0].label;
  assert.throws(()=>sequence.validateSequence(mixed));
  const wrongVersion=copy(input);wrongVersion.schemaVersion=2;
  wrongVersion.sources=wrongVersion.sources.map(({id,label,film})=>({id,name:label,film}));
  assert.throws(()=>sequence.validateSequence(wrongVersion));
});

test('independent legacy label oracle: invalid derived Unicode uses deterministic display fallback, exact source stays intact',()=>{
  const film=sourceA();film.shots[2].name='Original\ud800name';
  const input={schemaVersion:1,kind:'shot-studio-sequence',title:'Preserve old scene',
    sources:[{id:'old',name:'Original source',film}],clips:[{sourceId:'old',shotIndex:2},{sourceId:'old',shotIndex:2}]};
  const before=JSON.stringify(input),output=sequence.importSequence(before);
  assert.deepEqual(output.clips.map(item=>[item.id,item.label]),[['legacy-clip-1','Shot 3'],['legacy-clip-2','Shot 3']]);
  assert.deepEqual(output.sources[0].film,film);assert.equal(JSON.stringify(input),before);
  assert.equal(output.sources[0].film.shots[2].name,'Original\ud800name');
  assert.deepEqual(sequence.importSequence(JSON.stringify(output)),output);
});

test('independent strict origin oracle: embedded legacy films and recovery/future kinds never become sequences',()=>{
  for(const version of [1,2]){const value=document(),film=value.sources[0].film;film.schemaVersion=version;
    film.actors=sourceB().actors.map(({performanceMode,...actor})=>actor);
    if(version===1)film.shots=film.shots.map(({cameraMode,endEye,endTarget,...item})=>item);
    const before=JSON.stringify(value);assert.throws(()=>sequence.validateSequence(value));assert.equal(JSON.stringify(value),before);}
  for(const value of [{kind:'shot-studio-sequence-recovery',raw:JSON.stringify(document())},
    {...document(),schemaVersion:3},{...document(),kind:'film'}])assert.throws(()=>sequence.importSequence(JSON.stringify(value)));
});

test('independent plain-data oracle: malformed references/shapes/Unicode reject with no getter execution',()=>{
  for(const mutate of [
    value=>value.clips[0].sourceId='absent',value=>value.clips[0].shotIndex=4,
    value=>value.clips[0].shotIndex=.5,value=>value.clips[1].id=value.clips[0].id,
    value=>value.sources[1].id=value.sources[0].id,value=>value.clips[0].extra=true,
    value=>value.sources[0].id='../source',value=>value.title='bad\u0000title',
    value=>value.title='bad\ud800title',value=>value.sources[0].label='x'.repeat(81),
    value=>value.clips=new Array(2),value=>Object.setPrototypeOf(value,{inherited:true}),
    value=>value[Symbol('extra')]=true]){const value=document();mutate(value);assert.throws(()=>sequence.validateSequence(value));}
  let reads=0;const value=document();Object.defineProperty(value,'title',{enumerable:true,get(){reads++;return 'Getter title';}});
  assert.throws(()=>sequence.validateSequence(value));assert.equal(reads,0);
});

test('independent operation atomicity oracle: invalid edits preserve exact input and every full source cue',()=>{
  const input=document(),before=JSON.stringify(input);
  for(const operation of [
    ()=>sequence.moveSequenceClip(input,'travel',0),()=>sequence.moveSequenceClip(input,'missing',1),
    ()=>sequence.removeSequenceClip(input,'missing'),()=>sequence.renameSequenceClip(input,'missing','Name'),
    ()=>sequence.renameSequenceSource(input,'arrival','x'.repeat(81)),
    ()=>sequence.addSequenceClip(input,{id:'travel',sourceId:'arrival',shotIndex:2,label:'Duplicate'}),
    ()=>sequence.addSequenceSource(input,{id:'arrival',label:'Duplicate',film:sourceB()})]){
    assert.throws(operation);assert.equal(JSON.stringify(input),before);}
  const admitted=sequence.validateSequence(input);assert.deepEqual(admitted,input);
  assert.notEqual(admitted.sources[0].film.actors[0].cues,input.sources[0].film.actors[0].cues);
});
