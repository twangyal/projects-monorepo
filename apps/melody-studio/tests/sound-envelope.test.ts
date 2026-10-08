import assert from 'node:assert/strict';
import test from 'node:test';
import { validateComposition } from '../src/model.ts';
import { renderComposition } from '../src/audio.ts';
import { notesOnly, validateDocument } from '../src/reference-project.ts';
import type { Composition } from '../src/types.ts';
const fixture = (): Composition => ({version:1,title:'Envelope study',tempo:120,tracks:[{id:'voice',name:'Voice',instrument:'sine',volume:.5,muted:false,notes:[{id:'note',pitch:69,start:0,duration:1,velocity:.5}]}]});
const shape = {attack:.1,decay:.2,sustain:.3,release:.4};
test('track envelopes validate, detach and survive complete documents without changing legacy records',()=>{
 const p=fixture();p.tracks[0].envelope={...shape};const v=validateComposition(p);assert.deepEqual(v.tracks[0].envelope,shape);p.tracks[0].envelope.attack=1;assert.equal(v.tracks[0].envelope!.attack,.1);const document=notesOnly(v);assert.deepEqual(validateDocument(document),document);assert.deepEqual(validateComposition(fixture()),fixture());
});
test('invalid envelope values and extra fields reject before sound publication',()=>{
 for(const bad of [null,undefined,{}, {...shape,attack:-.1},{...shape,release:2.1},{...shape,decay:NaN},{...shape,sustain:1.01},{...shape,attack:'1'},{...shape,unknown:1}]){const p=fixture();Object.assign(p.tracks[0],{envelope:bad});assert.throws(()=>validateComposition(p));}
 let reads=0;const p=fixture();Object.assign(p.tracks[0],{envelope:{...shape,get attack(){reads++;return .1;}}});assert.throws(()=>notesOnly(p));assert.equal(reads,0);
});
function expectedLevel(frame:number,duration:number,rate:number,e:typeof shape):number{
 const a=e.attack*rate,d=e.decay*rate,r=e.release*rate;const gate=(at:number)=>a>0&&at<a?at/a:d>0&&at<a+d?1-(1-e.sustain)*(at-a)/d:e.sustain;return frame<=duration?gate(frame):r>0?gate(duration)*Math.max(0,1-(frame-duration)/r):0;
}
function check(p:Composition){
 const rate=22050,actual=renderComposition(p,rate);let frames=0;for(const t of p.tracks)for(const n of t.notes)frames=Math.max(frames,Math.ceil(((n.start+n.duration)*.5+(t.envelope?.release??.08))*rate));assert.equal(actual.length,frames);
 for(let frame=0;frame<frames;frame+=37){let expected=0;for(const t of p.tracks)for(const n of t.notes){const offset=frame-Math.round(n.start*.5*rate);if(offset<0||t.muted)continue;const e=t.envelope??{attack:.01,decay:0,sustain:1,release:.08};expected+=.4*t.volume*n.velocity*Math.sin(2*Math.PI*440*2**((n.pitch-69)/12)*offset/rate)*expectedLevel(offset,n.duration*.5*rate,rate,e);}assert.ok(Math.abs(actual[frame]-expected)<.000001,`independent PCM at ${frame}: ${actual[frame]} versus ${expected}`);}
}
test('explicit legacy envelope remains byte-identical to the previous sound',()=>{const p=fixture(),old=renderComposition(p);p.tracks[0].envelope={attack:.01,decay:0,sustain:1,release:.08};assert.deepEqual(renderComposition(p),old);});
test('full ADSR and long release match an independent scalar PCM oracle',()=>{const p=fixture();p.tracks[0].envelope={...shape};check(p);});
test('note-off during attack releases from its actual level without jumping to full amplitude',()=>{const p=fixture();p.tracks[0].notes[0].duration=.25;p.tracks[0].envelope={attack:.4,decay:.2,sustain:.2,release:.2};check(p);});
test('note-off during decay and zero phases remain finite and exact',()=>{const p=fixture();p.tracks[0].envelope={attack:.05,decay:.6,sustain:.1,release:.25};check(p);p.tracks[0].envelope={attack:0,decay:0,sustain:.25,release:0};check(p);});
test('simultaneous same-pitch voices retain independent envelopes when grouped',()=>{const p=fixture();p.tracks[0].envelope={...shape};p.tracks.push({...p.tracks[0],id:'other',notes:[{...p.tracks[0].notes[0],id:'other-note'}],envelope:{attack:.4,decay:0,sustain:1,release:.1}});check(p);});
