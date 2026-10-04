/** Original maximum/direct-edit artifact oracle. No producer imports or storage injection.
 * --fixtures-only creates original complete files and literal expectations, no browser.
 */
/* global process, Buffer, URL, document, innerWidth, console, structuredClone */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium, expect } from '@playwright/test';

const RATE=22050, FRAMES=441000;
const SELECTED='original-fractional-note';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoded=value=>Buffer.from(JSON.stringify(value));
const uuid=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const FROZEN={tracks:8,notesPerTrack:256,notes:2048,references:8,referenceFrames:441000,referenceSeconds:20,rawPcmBytes:7056000,tempo:240,endBeat:128,
  original:{id:SELECTED,pitch:69,start:.13,duration:.25,velocity:.75},
  moved:{id:SELECTED,pitch:72,start:.63,duration:.25,velocity:.75},
  resized:{id:SELECTED,pitch:72,start:.63,duration:.5,velocity:.75},
  midi:{division:480,tempos:[250000],notes:[{tick:302,pitch:72,velocity:95}],noteOffs:[{tick:542,pitch:72}]},
  audio:{sampleRate:22050,channels:1,bits:16,frames:707364,onsetFrame:3473,firstNonzeroFrame:3474,tailEndExclusive:7994,
    plateauStart:3985,plateauEnd:6129,frequencyHz:523.2511306011972,frequencyToleranceHz:3,rms:.24/Math.sqrt(2),relativeRmsTolerance:.02},
  geometry:{rowHeight:22,moveBeats:.5,moveSemitones:3,resizeBeats:.25,cssTolerance:.6},
};
function originalAsset(n){
  // Original modular integer ramp spans both PCM signs; encode explicitly little-endian.
  const pcm=Buffer.alloc(FRAMES*2);
  for(let i=0;i<FRAMES;i++)pcm.writeInt16LE(((i*97+n*503)%65536)-32768,i*2);
  return{id:uuid(n),kind:'audio-file',captureTempo:40,decodedSampleRate:44100,decodedChannels:2,decodedFrames:882000,analyzedFrames:882000,frameCount:FRAMES,sha256:hash(pcm),pcmBase64:pcm.toString('base64')};
}
function originalProject(){
  const tracks=Array.from({length:8},(_,i)=>({id:`original-track-${i}`,name:`Original maximum track ${i+1}`,instrument:'sine',volume:.8,muted:i!==0,
    notes:Array.from({length:256},(_,n)=>i===0&&n===0?{...FROZEN.original}:{id:`original-note-${i}-${n}`,pitch:60+n%5,start:n*.5,duration:.5,velocity:i===0?0:.75})}));
  const assets=Array.from({length:8},(_,i)=>originalAsset(i+1));
  return{format:'melody-studio-project',version:1,document:{schemaVersion:1,composition:{version:1,title:'Original maximum direct piano-roll correction',tempo:240,tracks},references:assets.map((a,i)=>({trackId:tracks[i].id,assetId:a.id}))},assets};
}
function expectedProject(original,note){const value=structuredClone(original);value.document.composition.tracks[0].notes[0]={...note};return value;}
function pcmReceipt(project){
  assert.equal(project.assets.length,8);let bytes=0;
  const assets=project.assets.map(a=>{const pcm=Buffer.from(a.pcmBase64,'base64');assert.equal(pcm.length,882000);assert.equal(hash(pcm),a.sha256);bytes+=pcm.length;return{id:a.id,bytes:pcm.length,sha256:hash(pcm)};});
  assert.equal(bytes,FROZEN.rawPcmBytes);return assets;
}
function decodedWav(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let at = 12, format, data;
  while (at + 8 <= bytes.length) {
    const name = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4);
    assert.ok(at + 8 + size <= bytes.length);
    if (name === 'fmt ') format = { type: bytes.readUInt16LE(at + 8), channels: bytes.readUInt16LE(at + 10),
      rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
    if (name === 'data') data = bytes.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  assert.deepEqual(format, { type: 1, channels: 1, rate: RATE, bits: 16 }); assert.ok(data);
  return Float32Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768);
}
function decodedMidi(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'MThd');
  const division = bytes.readUInt16BE(12); assert.equal(division, 480);
  const notes = [], noteOffs = [], tempos = []; let at = 8 + bytes.readUInt32BE(4);
  while (at < bytes.length) {
    assert.equal(bytes.toString('ascii', at, at + 4), 'MTrk');
    const end = at + 8 + bytes.readUInt32BE(at + 4); at += 8; let tick = 0, running;
    const vlq = () => { let value = 0, count = 0, byte;
      do { assert.ok(at < end && count++ < 4); byte = bytes[at++]; value = value * 128 + (byte & 127); } while (byte & 128);
      return value; };
    while (at < end) {
      tick += vlq(); let status = bytes[at];
      if (status & 128) { at++; running = status; } else { status = running; }
      if (status === 255) { const type = bytes[at++], length = vlq();
        if (type === 81) tempos.push(bytes.readUIntBE(at, length)); at += length; continue; }
      if (status === 240 || status === 247) { at += vlq(); continue; }
      const code = status >> 4, first = bytes[at++], second = code === 12 || code === 13 ? 0 : bytes[at++];
      if (code === 9 && second > 0) notes.push({ tick, pitch: first, velocity: second });
      if (code === 8 || (code === 9 && second === 0)) noteOffs.push({ tick, pitch: first });
    }
    assert.equal(at, end);
  }
  return { division, tempos, notes, noteOffs };
}
function inspectAudio(bytes){
  const samples=decodedWav(bytes),a=FROZEN.audio;assert.equal(samples.length,a.frames);
  assert(samples.subarray(0,a.onsetFrame).every(x=>x===0),'No reference audio or unrelated notes before onset');
  assert.equal(samples.findIndex(x=>x!==0),a.firstNonzeroFrame);
  assert(samples.subarray(a.tailEndExclusive).every(x=>x===0),'All muted/zero-velocity notes and retained references remain inaudible');
  const interior=samples.subarray(a.plateauStart,a.plateauEnd),crossings=[];
  for(let i=1;i<interior.length;i++)if(interior[i-1]<=0&&interior[i]>0)crossings.push(i-1-interior[i-1]/(interior[i]-interior[i-1]));
  assert(crossings.length>30);const hz=(crossings.length-1)*RATE/(crossings.at(-1)-crossings[0]);
  const rms=Math.sqrt(interior.reduce((s,x)=>s+x*x,0)/interior.length);
  assert(Math.abs(hz-a.frequencyHz)<=a.frequencyToleranceHz);
  assert(Math.abs(rms/a.rms-1)<=a.relativeRmsTolerance);
  return{frames:samples.length,frequencyHz:hz,rms,firstNonzeroFrame:samples.findIndex(x=>x!==0),beforeAndAfterSilenceExact:true};
}
async function pid(context){const session=await context.browser().newBrowserCDPSession();try{return(await session.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='browser').map(p=>p.id);}finally{await session.detach();}}
async function main(){
  const out=process.env.MELODY_ROLL_OUTPUT?resolve(process.env.MELODY_ROLL_OUTPUT):await mkdtemp(join(tmpdir(),'melody-direct-roll-'));
  if(process.env.MELODY_ROLL_OUTPUT)await mkdir(out,{recursive:false});
  const original=originalProject(),moved=expectedProject(original,FROZEN.moved),final=expectedProject(original,FROZEN.resized),errors=[],external=[];
  const evidence={schemaVersion:1,issue:99,status:'fixtures-only',output:out,expected:FROZEN,assets:pcmReceipt(original),fixtures:[],checks:[],artifacts:[],limits:[
    'Synthetic original PCM tests exact retained references; no vocal or physical microphone accuracy claim.',
    'All2048 notes remain authored, but unrelated tracks are muted and track0 unrelated notes have zero velocity to isolate the corrected oscillator.',
    'Actual WAV allocation spans128beats at240BPM; this is not a maximum-duration40BPM synthesis benchmark.',
    'Pointer coordinates use native current grid geometry; expected musical deltas, ticks, samples and tolerances were frozen before producer inspection.',
    'No producer imports, direct storage writes, model downloads, external services or browser API mocks.',
  ]};
  const artifact=async(name,bytes)=>{await writeFile(join(out,name),bytes);const record={name,bytes:bytes.length,sha256:hash(bytes)};evidence.artifacts.push(record);return bytes;};
  for(const[name,project]of[['original-maximum.melody.json',original],['expected-moved.melody.json',moved],['expected-final.melody.json',final]]){const b=encoded(project);await writeFile(join(out,name),b);evidence.fixtures.push({name,bytes:b.length,sha256:hash(b)});}
  assert.equal(original.document.composition.tracks.reduce((n,t)=>n+t.notes.length,0),2048);
  assert(original.document.composition.tracks.every(t=>t.notes.length===256&&t.notes.every(n=>n.start+n.duration<=128)));
  const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(evidence,null,2)+'\n');await save();
  if(process.argv.includes('--fixtures-only')){console.log(JSON.stringify({status:evidence.status,out,fixtures:evidence.fixtures,rawPcmBytes:7056000},null,2));return;}
  const base=process.env.MELODY_ROLL_BASE_URL;assert(base,'Set MELODY_ROLL_BASE_URL after root releases the browser slot.');const url=new URL(base);
  assert(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  let context,page;const begun=performance.now();
  const launch=async()=>{context=await chromium.launchPersistentContext(join(out,'profile'),{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,acceptDownloads:true,viewport:{width:1440,height:1000}});page=context.pages()[0];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(/^https?:$/.test(u.protocol)&&u.origin!==url.origin)external.push(u.origin);});await page.goto(base);await expect(page.getByRole('button',{name:'Save project file',exact:true})).toBeEnabled();};
  const download=async(label,name)=>{const ready=page.waitForEvent('download',{timeout:60000});await page.getByRole('button',{name:label,exact:true}).click();const d=await ready;await d.saveAs(join(out,name));const b=await readFile(join(out,name));evidence.artifacts.push({name,bytes:b.length,sha256:hash(b)});return b;};
  const verify=async(name,expected)=>{const b=await download('Save project file',name);const p=JSON.parse(b);assert.deepEqual(p,expected);assert.deepEqual(pcmReceipt(p),evidence.assets);return b;};
  const selected=()=>page.locator(`[data-note="${SELECTED}"]`);
  const geometry=async(expected)=>{const g=await page.locator('.roll-grid').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,beats:Number(e.dataset.beats),top:Number(e.dataset.top)};});const n=await selected().boundingBox();assert(n);assert.equal(g.beats,128);assert(Math.abs(n.x-(g.x+g.width*expected.start/128))<=.6);assert(Math.abs(n.y-(g.y+(g.top-expected.pitch)*22+2))<=.6);return{grid:g,note:n};};
  try{
    await launch();evidence.browserVersion=context.browser().version();evidence.origin=url.origin;evidence.scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>new URL(n.src).pathname));
    await page.getByLabel('Open project file',{exact:true}).setInputFiles(join(out,'original-maximum.melody.json'));
    await expect(page.getByLabel('Project title')).toHaveValue(original.document.composition.title);await expect(page.locator('#save-status')).toHaveText('Saved in this browser',{timeout:30000});
    await expect(page.locator('[data-track]')).toHaveCount(8);await expect(page.locator('[data-note]')).toHaveCount(256);
    await verify('before-edit.melody.json',original);
    await page.locator('#roll-tool').selectOption('move');
    const quarter=await page.locator('#roll-snap option').evaluateAll(nodes=>nodes.find(n=>/quarter/i.test(n.textContent))?.value);assert(quarter);await page.locator('#roll-snap').selectOption(quarter);
    await selected().scrollIntoViewIfNeeded();await selected().click({position:{x:2,y:8}});
    let {grid,note}=await geometry(FROZEN.original);const x=note.x+2,y=note.y+8;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+grid.width/128*.5,y-66,{steps:10});
    await expect(page.locator('.roll-preview[data-kind="move"]')).toBeVisible();await page.mouse.up();
    await geometry(FROZEN.moved);await verify('after-move.melody.json',moved);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await verify('move-one-undo.melody.json',original);
    await page.getByRole('button',{name:'Redo',exact:true}).click();await verify('move-one-redo.melody.json',moved);
    await selected().scrollIntoViewIfNeeded();
    ({grid,note}=await geometry(FROZEN.moved));const handle=await selected().locator('[data-roll-resize]').boundingBox();assert(handle);const hx=handle.x+handle.width/2,hy=handle.y+handle.height/2;
    await page.mouse.move(hx,hy);await page.mouse.down();await page.mouse.move(hx+grid.width/128*.25,hy,{steps:10});await expect(page.locator('.roll-preview[data-kind="resize"]')).toBeVisible();await page.mouse.up();
    await geometry(FROZEN.resized);const committed=await verify('after-resize.melody.json',final);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await verify('resize-one-undo.melody.json',moved);
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert(committed.equals(await verify('resize-one-redo.melody.json',final)));
    evidence.checks.push('Native pointer move and resize preserve off-grid start; each gesture adds exactly one Undo/Redo state; all2048notes and8PCMassets compared in complete backups.');
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser',{timeout:30000});evidence.firstBrowserProcess=await pid(context);await context.close();context=undefined;
    await launch();evidence.secondBrowserProcess=await pid(context);assert.notDeepEqual(evidence.firstBrowserProcess,evidence.secondBrowserProcess);
    await expect(page.getByLabel('Project title')).toHaveValue(original.document.composition.title);await expect(page.locator('#save-status')).toHaveText('Restored from this browser',{timeout:30000});
    const restarted=await verify('after-process-restart.melody.json',final);assert(restarted.equals(committed));evidence.restart={bytes:restarted.length,sha256:hash(restarted),byteExact:true};
    evidence.midi=decodedMidi(await download('Export MIDI','corrected-notes-only.mid'));assert.deepEqual(evidence.midi,FROZEN.midi);
    const wavStarted=performance.now();evidence.wav=inspectAudio(await download('Export WAV','corrected-notes-only.wav'));evidence.wav.renderDownloadAndDecodeWallMs=performance.now()-wavStarted;
    evidence.checks.push('Independent SMF decoder confirms480ticks/beat and sole corrected note302..542; RIFF/PCM decoder confirms full128beat render, native onset,523Hz pitch/amplitude and exact long-tail silence.');
    await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,'390px.png'),fullPage:true});
    for(const name of ['desktop.png','390px.png'])await artifact(name,await readFile(join(out,name)));
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);evidence.pageErrors=errors;evidence.externalRequests=external;evidence.status='passed';evidence.totalWallMs=performance.now()-begun;
  }catch(e){evidence.status='failed';evidence.failure={name:e.name,message:e.message,stack:e.stack};throw e;}finally{await context?.close();await save();}
  console.log(JSON.stringify({status:evidence.status,out,restart:evidence.restart,wav:evidence.wav},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
