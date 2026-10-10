import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderComposition} from '../src/audio.ts';
import {validateComposition,parseComposition,serializeComposition} from '../src/model.ts';
import type {Composition} from '../src/types.ts';
import {auditionComposition,suggestEnding} from '../src/continuation.ts';
import {isolatedTrack} from '../src/track-render.ts';
import {backingComposition} from '../src/backing.ts';
import {notesOnly,validateDocument} from '../src/reference-project.ts';

function fixture(): Composition {
  return {version:1,title:'Sustained fade',tempo:120,tracks:[{id:'voice',name:'Voice',instrument:'sine',volume:.3,muted:false,notes:[{id:'note',pitch:69,start:.125,duration:4,velocity:.5}]}]};
}
test('complete projects retain a fractional song-time volume ramp',()=>{
  const p=fixture();Object.assign(p.tracks[0],{volumeRamp:{start:1.25,end:4.5,from:.8,to:0}});
  assert.deepEqual(validateComposition(p),p);
  assert.deepEqual(parseComposition(serializeComposition(p)),p);
  assert.deepEqual(notesOnly(p).composition,p);
  assert.deepEqual(validateDocument({schemaVersion:1,composition:p,references:[]}).composition,p);
});
test('a sustained voice fades over absolute song time rather than at note onsets',()=>{
  const p=fixture(),rate=8000,dry=renderComposition(p,rate);
  Object.assign(p.tracks[0],{volumeRamp:{start:1,end:3,from:1,to:0}});
  const faded=renderComposition(p,rate);assert.equal(faded.length,dry.length);
  for(let i=0;i<dry.length;i+=13){
    const beat=i/rate*2,level=beat<=1?1:beat>=3?0:(3-beat)/2;
    assert.ok(Math.abs(faded[i]-dry[i]*level)<1e-7,`song frame ${i}`);
  }
  assert.ok(faded.subarray(12000).every(x=>x===0));
});
test('malformed ramp imports refuse rather than silently dropping automation',()=>{
  const valid={start:0,end:4,from:1,to:0};
  for(const volumeRamp of [null,undefined,{}, {...valid,start:-1},{...valid,end:513},{...valid,end:0},{...valid,from:1.01},{...valid,to:-.01},{...valid,start:NaN},{...valid,end:Infinity},{...valid,from:'1'},{...valid,extra:true},Object.assign(Object.create({}),valid)]){
    const p=fixture();Object.assign(p.tracks[0],{volumeRamp});assert.throws(()=>validateComposition(p),/Volume ramp/);
  }
  let reads=0;const p=fixture();Object.assign(p.tracks[0],{volumeRamp:{...valid,get start(){reads++;return 0;}}});
  assert.throws(()=>validateComposition(p));assert.equal(reads,0);
});
test('overlapping same-pitch tracks keep their independent automation and echo clock',()=>{
  const p=fixture();p.tracks[0].echo={beats:.5,decay:.5,repeats:3};
  const rate=8000,dry=renderComposition(p,rate);
  p.tracks[0].volumeRamp={start:.5,end:3,from:1,to:0};
  const other=structuredClone(p.tracks[0]);other.id='other';other.notes[0].id='other-note';other.volumeRamp={start:.5,end:3,from:0,to:1};
  const both={...p,tracks:[p.tracks[0],other]},mixed=renderComposition(both,rate);
  for(let i=0;i<dry.length;i+=17)assert.ok(Math.abs(mixed[i]-dry[i])<1e-7,`complementary ramps at ${i}`);
  assert.deepEqual(isolatedTrack(both,'voice').tracks[0].volumeRamp,p.tracks[0].volumeRamp);
  assert.deepEqual(backingComposition(both,'other').tracks[0].volumeRamp,p.tracks[0].volumeRamp);
});
test('flat unity ramps retain legacy PCM and muted ramps stay silent with full duration',()=>{
  const p=fixture(),dry=renderComposition(p,8000);p.tracks[0].volumeRamp={start:0,end:512,from:1,to:1};
  assert.deepEqual(renderComposition(p,8000),dry);p.tracks[0].muted=true;
  const muted=renderComposition(p,8000);assert.equal(muted.length,dry.length);assert.ok(muted.every(x=>x===0));
});
test('ending audition retains the original song-time level after shifting notes to zero',()=>{
  const p=fixture();p.tracks[0].notes=Array.from({length:8},(_,i)=>({id:`seed-${i}`,pitch:60+i%3,start:8+i,duration:.5,velocity:.5}));
  for(const ramp of [{start:0,end:16,from:1,to:0},{start:0,end:4,from:1,to:.2},{start:12,end:16,from:.2,to:1}]){
    p.tracks[0].volumeRamp=ramp;
    const audition=auditionComposition(suggestEnding(p,'voice',8,4,1));
    const dryProject=structuredClone(audition);delete dryProject.tracks[0].volumeRamp;
    const rate=8000,dry=renderComposition(dryProject,rate),wet=renderComposition(audition,rate);
    for(let i=0;i<wet.length;i+=13){
      const beat=8+i/rate*2,level=beat<=ramp.start?ramp.from:beat>=ramp.end?ramp.to:ramp.from+(ramp.to-ramp.from)*(beat-ramp.start)/(ramp.end-ramp.start);
      assert.ok(Math.abs(wet[i]-dry[i]*level)<1e-7,`shifted frame ${i}`);
    }
  }
});
