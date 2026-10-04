import test from 'node:test';
import assert from 'node:assert/strict';
import {SEQUENCE_DRAFT_KEY,SequenceDraftStore,SequenceHistory} from '../src/sequence-store.js';

function fixture(){
  return {schemaVersion:2,kind:'shot-studio-sequence',title:'Separate cut 🎬',sources:[{id:'scene_A',label:'Copied film',film:{
    schemaVersion:3,title:'Original film',light:.7,
    actors:[{name:'Red',color:'#ff0000',performanceMode:'blocking',cues:[
      {time:0,x:-2,z:0,action:'idle',visible:false},{time:2,x:0,z:1,action:'wave',visible:true},{time:5,x:2,z:1,action:'idle',visible:true},
    ]},{name:'Blue',color:'#0000ff',performanceMode:'loop',x:1,z:-1,action:'walk'}],
    shots:[{name:'First',duration:2,eye:[0,2,7],target:[0,1,0],fov:45,cameraMode:'static'},
      {name:'Travelling',duration:3,eye:[-2,2,7],target:[-2,1,0],fov:45,cameraMode:'linear',endEye:[2,2,7],endTarget:[2,1,0]}],
  }}],clips:[{id:'second_then_first',sourceId:'scene_A',shotIndex:1,label:'Travel'},
    {id:'first_again',sourceId:'scene_A',shotIndex:0,label:'Arrival'}]};
}

function storage(initial=null){
  const records=new Map([['shot-studio-v1','untouched ordinary scene'],['other-app','unrelated saved work']]);
  if(initial!==null)records.set(SEQUENCE_DRAFT_KEY,initial);
  return {records,reads:[],writes:[],
    getItem(key){this.reads.push(key);assert.equal(key,SEQUENCE_DRAFT_KEY);return records.has(key)?records.get(key):null;},
    setItem(key,value){assert.equal(key,SEQUENCE_DRAFT_KEY);assert.equal(typeof value,'string');this.writes.push([key,value]);records.set(key,value);},
  };
}

function empty(store){
  assert.equal(store.sequence.schemaVersion,2);assert.equal(store.sequence.kind,'shot-studio-sequence');
  assert.deepEqual(store.sequence.sources,[]);assert.deepEqual(store.sequence.clips,[]);
}

test('absent sequence is proven empty without creating or accessing any other draft',()=>{
  assert.equal(SEQUENCE_DRAFT_KEY,'shot-studio-sequence-v1');
  const disk=storage(),store=new SequenceDraftStore(()=>disk);
  empty(store);assert.equal(store.blocked,false);assert.equal(store.raw,null);
  assert.deepEqual(disk.reads,[SEQUENCE_DRAFT_KEY]);assert.deepEqual(disk.writes,[]);
  assert.throws(()=>store.recoveryJson(),/raw|read|available|known/i);
  store.save(fixture());assert.deepEqual(JSON.parse(disk.records.get(SEQUENCE_DRAFT_KEY)),fixture());
  assert.equal(disk.records.get('shot-studio-v1'),'untouched ordinary scene');assert.equal(disk.records.get('other-app'),'unrelated saved work');
});

test('valid pretty saved sequence loads complete detached sources without an implicit rewrite',()=>{
  const value=fixture(),legacy={...value,schemaVersion:1},raw=JSON.stringify(legacy,null,2),disk=storage(raw),store=new SequenceDraftStore(()=>disk);
  assert.deepEqual(store.sequence,value);assert.equal(store.blocked,false);assert.equal(store.raw,null);assert.equal(disk.writes.length,0);
  store.sequence.sources[0].film.actors[0].cues[1].x=3;
  store.sequence.sources[0].film.shots[1].endEye[0]=-10;store.sequence.clips[0].label='Memory edit';
  assert.equal(disk.records.get(SEQUENCE_DRAFT_KEY),raw);
  assert.deepEqual(new SequenceDraftStore(()=>disk).sequence,value);assert.equal(disk.writes.length,0);
});

test('malformed, unsupported, overbound and invalid-source records stay byte-exact and protected',()=>{
  const invalid=fixture();invalid.sources[0].film.schemaVersion=2;
  const unknown=fixture();unknown.sources[0].unexpected=true;
  for(const raw of ['','{broken\r\n☃','\ud800',JSON.stringify({...fixture(),schemaVersion:99}),JSON.stringify(invalid),JSON.stringify(unknown),' '.repeat(327681)]){
    const disk=storage(raw),store=new SequenceDraftStore(()=>disk);empty(store);
    assert.equal(store.blocked,true);assert.equal(store.raw,raw);
    assert.throws(()=>store.save(fixture()),/protected/i);
    assert.equal(disk.records.get(SEQUENCE_DRAFT_KEY),raw);assert.equal(disk.writes.length,0);
  }
});

test('failed or non-text storage reads cannot authorize an automatic overwrite or fake recovery',()=>{
  for(const getStorage of [()=>{throw Error('Storage getter denied');},()=>({getItem(){throw Error('Read denied');},setItem(){assert.fail('No automatic write');}}),()=>({getItem(){return undefined;},setItem(){assert.fail('No automatic write');}})]){
    const store=new SequenceDraftStore(getStorage);empty(store);
    assert.equal(store.blocked,true);assert.equal(store.raw,null);
    assert.throws(()=>store.save(fixture()),/protected/i);assert.throws(()=>store.recoveryJson(),/raw|read|available|known/i);
    assert.equal(store.blocked,true);
  }
});

test('explicit replacement admits before any write and clears protection only after successful setItem',()=>{
  const raw='{original\ncorrupt}',disk=storage(raw),store=new SequenceDraftStore(()=>disk),write=disk.setItem;
  const invalid=fixture();invalid.clips[0].sourceId='missing';
  assert.throws(()=>store.replace(invalid));assert.equal(disk.writes.length,0);assert.equal(store.raw,raw);assert.equal(store.blocked,true);
  disk.setItem=function(){assert.equal(store.blocked,true);assert.equal(store.raw,raw);throw Error('Quota denied');};
  assert.throws(()=>store.replace(fixture()),/Quota denied/);assert.equal(store.raw,raw);assert.equal(store.blocked,true);
  assert.equal(disk.records.get(SEQUENCE_DRAFT_KEY),raw);empty(store);
  disk.setItem=function(key,value){assert.equal(store.blocked,true);assert.equal(store.raw,raw);write.call(this,key,value);};
  const candidate=fixture();store.replace(candidate);candidate.sources[0].film.title='Later caller mutation';
  assert.equal(store.blocked,false);assert.equal(store.raw,null);assert.deepEqual(JSON.parse(disk.records.get(SEQUENCE_DRAFT_KEY)),fixture());
  assert.deepEqual(store.sequence,fixture());
  assert.deepEqual(new SequenceDraftStore(()=>disk).sequence,fixture());
});

test('ordinary failed saves preserve actual prior data and the caller\'s in-memory work',()=>{
  const original=fixture(),disk=storage(JSON.stringify(original)),store=new SequenceDraftStore(()=>disk),before=disk.records.get(SEQUENCE_DRAFT_KEY);
  const next=fixture();next.title='Unsaved memory cut';
  disk.setItem=()=>{throw Error('Write failed');};
  assert.throws(()=>store.save(next),/Write failed/);assert.equal(disk.records.get(SEQUENCE_DRAFT_KEY),before);
  assert.equal(store.blocked,false);assert.equal(store.raw,null);assert.deepEqual(store.sequence,original);assert.deepEqual(next,{...fixture(),title:'Unsaved memory cut'});
  assert.equal(disk.records.get('shot-studio-v1'),'untouched ordinary scene');
});

test('replacement after unreadable startup first observes storage and requires another deliberate action',()=>{
  const disk=storage('unreadable'),read=disk.getItem;
  disk.getItem=()=>{throw Error('Read denied');};const store=new SequenceDraftStore(()=>disk);
  assert.equal(store.blocked,true);assert.equal(store.raw,null);assert.equal(disk.writes.length,0);
  assert.throws(()=>store.replace(fixture()),/read|storage|protected/i);assert.equal(disk.writes.length,0);
  disk.getItem=read;assert.throws(()=>store.replace(fixture()),/changed|review/i);
  assert.equal(store.raw,'unreadable');assert.equal(store.blocked,true);assert.equal(disk.writes.length,0);
  store.replace(fixture());assert.equal(store.blocked,false);assert.equal(store.raw,null);
  assert.deepEqual(new SequenceDraftStore(()=>disk).sequence,fixture());
});

test('known recovery envelope retains literal raw Unicode, line endings and malformed text without reads or writes',()=>{
  const raw='{unfinished\r\n🎬\ud800\u0000}',disk=storage(raw),store=new SequenceDraftStore(()=>disk);
  disk.getItem=()=>{assert.fail('Recovery must not reread storage');};
  const recovery=store.recoveryJson();
  assert.equal(recovery,JSON.stringify({kind:'shot-studio-sequence-recovery',raw}));
  assert.deepEqual(JSON.parse(recovery),{kind:'shot-studio-sequence-recovery',raw});
  assert.equal(store.raw,raw);assert.equal(store.blocked,true);assert.equal(disk.writes.length,0);
});

test('recovery caps actual UTF8 raw bytes at 1MiB and escaped envelope bytes at 2MiB',()=>{
  const encoder=new TextEncoder(),rawLimit=1024*1024,envelopeLimit=2*1024*1024;
  for(const raw of ['A'.repeat(rawLimit),'é'.repeat(rawLimit/2)]){
    const store=new SequenceDraftStore(()=>storage(raw));assert.equal(encoder.encode(raw).length,rawLimit);
    assert.equal(JSON.parse(store.recoveryJson()).raw,raw);assert.equal(store.blocked,true);
  }
  for(const raw of ['A'.repeat(rawLimit+1),'é'.repeat(rawLimit/2)+'A']){
    const disk=storage(raw),store=new SequenceDraftStore(()=>disk);assert.throws(()=>store.recoveryJson(),/limit|MiB|large|byte/i);
    assert.equal(store.raw,raw);assert.equal(store.blocked,true);assert.equal(disk.writes.length,0);
  }
  const overhead=encoder.encode(JSON.stringify({kind:'shot-studio-sequence-recovery',raw:''})).length;
  const escaped=Math.floor((envelopeLimit-overhead)/6),padding=envelopeLimit-overhead-escaped*6;
  const raw='\u0000'.repeat(escaped)+'A'.repeat(padding),store=new SequenceDraftStore(()=>storage(raw));
  const recovery=store.recoveryJson();assert.equal(encoder.encode(recovery).length,envelopeLimit);assert.equal(JSON.parse(recovery).raw,raw);
  const over=new SequenceDraftStore(()=>storage(raw+'A'));assert.throws(()=>over.recoveryJson(),/limit|MiB|large|byte/i);
  assert.equal(over.raw,raw+'A');assert.equal(over.blocked,true);
});

test('history snapshots and every returned document isolate source films, camera paths, cues and ordering',()=>{
  const original=fixture(),before=structuredClone(original),history=new SequenceHistory(original);
  original.sources[0].film.actors[0].cues[1].x=3;original.sources[0].film.shots[1].endEye[0]=9;original.clips.reverse();
  assert.deepEqual(history.current,before);assert.equal(history.canUndo,false);assert.equal(history.canRedo,false);
  const candidate=history.current;candidate.title='Reordered';candidate.clips.reverse();
  const expected=structuredClone(candidate),result=history.commit(candidate);
  candidate.sources[0].film.light=2;result.clips[0].label='Outside mutation';history.current.sources[0].film.shots[1].endTarget[0]=10;
  assert.deepEqual(history.current,expected);const undone=history.undo();assert.deepEqual(undone,before);undone.sources.length=0;
  assert.deepEqual(history.redo(),expected);assert.deepEqual(history.undo(),before);
});

test('invalid and identical commits retain redo and a new admitted branch replaces it atomically',()=>{
  const history=new SequenceHistory(fixture()),edited=history.current;edited.title='Later title';history.commit(edited);history.undo();
  const before=history.current,invalid=history.current;invalid.clips[0].shotIndex=999;
  assert.throws(()=>history.commit(invalid));assert.deepEqual(history.current,before);assert.equal(history.canRedo,true);assert.equal(history.canUndo,false);
  assert.deepEqual(history.commit(history.current),before);assert.equal(history.canRedo,true);assert.equal(history.canUndo,false);
  const branch=history.current;branch.title='A different branch';history.commit(branch);
  assert.equal(history.canRedo,false);assert.deepEqual(history.undo(),before);assert.deepEqual(history.redo(),branch);
});

test('history retains 30 prior snapshots and moves their exact existing states through undo/redo',()=>{
  const history=new SequenceHistory(fixture());
  for(let index=1;index<=40;index++){const next=history.current;next.title=`Edit ${index}`;history.commit(next);}
  let steps=0;while(history.canUndo){history.undo();steps++;}assert.equal(steps,30);assert.equal(history.current.title,'Edit 10');
  const earliest=history.undo();assert.equal(earliest.title,'Edit 10');
  let redone=0;while(history.canRedo){history.redo();redone++;}assert.equal(redone,30);assert.equal(history.current.title,'Edit 40');
  assert.equal(history.redo().title,'Edit 40');history.undo();
  const invalid=history.current;invalid.sources[0].film.light=100;assert.throws(()=>history.commit(invalid));assert.equal(history.canRedo,true);
  assert.equal(history.redo().title,'Edit 40');
});

test('two stores refuse stale ordinary writes and expose exact foreign bytes for review',()=>{
  const disk=storage(),first=new SequenceDraftStore(()=>disk),second=new SequenceDraftStore(()=>disk);
  const a=fixture();a.title='First tab published';first.save(a);
  const foreign=disk.records.get(SEQUENCE_DRAFT_KEY),b=fixture();b.title='Second tab unsaved';
  assert.throws(()=>second.save(b),/changed|review/i);
  assert.equal(disk.records.get(SEQUENCE_DRAFT_KEY),foreign);assert.equal(disk.writes.length,1);
  assert.equal(second.blocked,true);assert.equal(second.raw,foreign);empty(second);
  assert.equal(JSON.parse(second.recoveryJson()).raw,foreign);assert.equal(b.title,'Second tab unsaved');
  assert.throws(()=>second.save(b),/protected/i);
  second.replace(b);assert.equal(second.blocked,false);assert.equal(second.raw,null);
  assert.deepEqual(JSON.parse(disk.records.get(SEQUENCE_DRAFT_KEY)),b);
  assert.throws(()=>first.save(a),/changed|review/i);assert.equal(first.raw,disk.records.get(SEQUENCE_DRAFT_KEY));
});

test('explicit replacement refuses newer foreign bytes before accepting a reviewed replacement',()=>{
  const disk=storage('initial corrupt record'),store=new SequenceDraftStore(()=>disk);
  const foreign='changed corrupt record\r\n🎬';disk.records.set(SEQUENCE_DRAFT_KEY,foreign);
  assert.throws(()=>store.replace(fixture()),/changed|review/i);
  assert.equal(store.raw,foreign);assert.equal(store.blocked,true);assert.equal(disk.writes.length,0);
  disk.records.set(SEQUENCE_DRAFT_KEY,'changed again');
  assert.throws(()=>store.replace(fixture()),/changed|review/i);assert.equal(store.raw,'changed again');
  assert.equal(disk.writes.length,0);store.replace(fixture());assert.equal(disk.writes.length,1);
});

test('foreign deletion is protected proven absence without a fabricated recovery download',()=>{
  const disk=storage(JSON.stringify(fixture())),store=new SequenceDraftStore(()=>disk);
  disk.records.delete(SEQUENCE_DRAFT_KEY);
  assert.throws(()=>store.save(fixture()),/changed|review/i);
  assert.equal(store.blocked,true);assert.equal(store.raw,null);assert.equal(disk.writes.length,0);
  assert.throws(()=>store.recoveryJson(),/available|known/i);
  store.replace(fixture());assert.equal(store.blocked,false);assert.equal(disk.writes.length,1);
});

test('invalid candidate cannot change observed foreign receipts or recovery authority',()=>{
  const disk=storage('known corrupt'),store=new SequenceDraftStore(()=>disk),readCount=disk.reads.length;
  disk.records.set(SEQUENCE_DRAFT_KEY,'foreign corrupt');const invalid=fixture();invalid.clips[0].sourceId='absent';
  assert.throws(()=>store.replace(invalid));assert.equal(disk.reads.length,readCount);
  assert.equal(store.raw,'known corrupt');assert.equal(disk.writes.length,0);
  assert.throws(()=>store.replace(fixture()),/changed|review/i);assert.equal(store.raw,'foreign corrupt');
});

test('failed replacement retains its receipt and checks foreign changes before retry',()=>{
  const disk=storage('protected corrupt'),store=new SequenceDraftStore(()=>disk),write=disk.setItem;
  disk.setItem=()=>{throw Error('Quota denied');};
  assert.throws(()=>store.replace(fixture()),/Quota denied/);assert.equal(store.raw,'protected corrupt');
  disk.records.set(SEQUENCE_DRAFT_KEY,'foreign after failed write');disk.setItem=write;
  assert.throws(()=>store.replace(fixture()),/changed|review/i);assert.equal(disk.writes.length,0);
  assert.equal(store.raw,'foreign after failed write');store.replace(fixture());assert.equal(disk.writes.length,1);
});

test('new read failure protects memory and invalidates older receipts until fresh review',()=>{
  const disk=storage('known corrupt'),store=new SequenceDraftStore(()=>disk),read=disk.getItem;
  disk.getItem=()=>{throw Error('Read denied');};
  assert.throws(()=>store.replace(fixture()),/read|storage|protected/i);
  assert.equal(store.blocked,true);assert.equal(store.raw,null);assert.equal(disk.writes.length,0);
  disk.getItem=read;assert.throws(()=>store.replace(fixture()),/changed|review/i);
  assert.equal(store.raw,'known corrupt');store.replace(fixture());assert.equal(store.blocked,false);
});

test('remote name-form schema1 loads as detached schema2 without rewriting actual saved bytes',()=>{
  const expected=fixture(),remote={...fixture(),schemaVersion:1};
  remote.sources=remote.sources.map(({id,label,film})=>({id,name:label,film}));
  remote.clips=remote.clips.map(({sourceId,shotIndex})=>({sourceId,shotIndex}));
  expected.clips=[{id:'legacy-clip-1',sourceId:'scene_A',shotIndex:1,label:'Travelling'},
    {id:'legacy-clip-2',sourceId:'scene_A',shotIndex:0,label:'First'}];
  const raw=JSON.stringify(remote,null,2),disk=storage(raw),store=new SequenceDraftStore(()=>disk);
  assert.equal(store.blocked,false);assert.deepEqual(store.sequence,expected);
  assert.equal(disk.records.get(SEQUENCE_DRAFT_KEY),raw);assert.equal(disk.writes.length,0);
  const next=structuredClone(expected);next.title='Deliberately saved migration';store.save(next);
  assert.deepEqual(JSON.parse(disk.records.get(SEQUENCE_DRAFT_KEY)),next);
});

test('ordinary save read failure protects the prior working document without touching disk',()=>{
  const original=fixture(),raw=JSON.stringify(original),disk=storage(raw),store=new SequenceDraftStore(()=>disk),read=disk.getItem;
  const next=fixture();next.title='Memory survives read failure';disk.getItem=()=>{throw Error('Denied');};
  assert.throws(()=>store.save(next),/read|protected/i);
  assert.equal(store.blocked,true);assert.equal(store.raw,null);assert.deepEqual(store.sequence,original);
  assert.equal(disk.records.get(SEQUENCE_DRAFT_KEY),raw);assert.equal(disk.writes.length,0);
  disk.getItem=read;assert.throws(()=>store.replace(next),/changed|review/i);
  assert.equal(store.raw,raw);store.replace(next);assert.deepEqual(store.sequence,next);
});

test('failed ordinary write does not advance expected bytes and can be retried against untouched storage',()=>{
  const original=fixture(),disk=storage(JSON.stringify(original)),store=new SequenceDraftStore(()=>disk),write=disk.setItem;
  const next=fixture();next.title='First quota failure then saved';disk.setItem=()=>{throw Error('Quota');};
  assert.throws(()=>store.save(next),/Quota/);assert.deepEqual(store.sequence,original);assert.equal(store.blocked,false);
  disk.setItem=write;store.save(next);assert.deepEqual(store.sequence,next);assert.equal(disk.writes.length,1);
  next.title='Subsequent owner write';store.save(next);assert.equal(disk.writes.length,2);
});
