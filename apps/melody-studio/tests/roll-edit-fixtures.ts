import {createHash} from 'node:crypto';
import {expect,type Page} from '@playwright/test';
import type {Composition} from '../src/types.ts';
import {downloadedBytes,decodeMidi,decodeWav} from './browser/continuation-fixtures.ts';

// Original authored fractional/polyphonic data. No roll/model/render producer
// helper constructs these fixtures or computes their expected edited values.
export function rollComposition():Composition{return{version:1,title:'Original fractional overlap',tempo:120,tracks:[
  {id:'fractional-track',name:'Fractional sine',instrument:'sine',volume:.4,muted:false,notes:[
    {id:'fractional-low',pitch:60,start:1/3,duration:2/3,velocity:.5},
    {id:'polyphonic-high',pitch:67,start:.5,duration:.75,velocity:.25},
    {id:'later-accent',pitch:64,start:2.125,duration:.375,velocity:.75},
  ]},
  {id:'untouched-track',name:'Muted independent part',instrument:'sine',volume:.3,muted:true,notes:[{id:'untouched-note',pitch:72,start:3,duration:.5,velocity:.6}]},
]};}
export function rollBackup(){
  const frameCount=22050,pcm=Buffer.alloc(frameCount*2);
  for(let i=0;i<frameCount;i++)pcm.writeInt16LE(i%441<110?7000:i%441<220?-7000:0,i*2);
  const id='99000000-0000-4000-8000-000000000001';
  return{format:'melody-studio-project',version:1,document:{schemaVersion:1,composition:rollComposition(),references:[{trackId:'fractional-track',assetId:id}]},assets:[{id,kind:'audio-file',captureTempo:120,decodedSampleRate:22050,decodedChannels:1,decodedFrames:frameCount,analyzedFrames:frameCount,frameCount,sha256:createHash('sha256').update(pcm).digest('hex'),pcmBase64:pcm.toString('base64')}]};
}
export type RollBackup=ReturnType<typeof rollBackup>;
export async function openRoll(page:Page,project=rollBackup()){
  await page.goto('/');await expect(page.getByLabel('Open project file',{exact:true})).toBeEnabled();
  page.once('dialog',dialog=>dialog.accept());await page.getByLabel('Open project file',{exact:true}).setInputFiles({name:'original-fractional-reference.melody.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.getByLabel('Project title')).toHaveValue(project.document.composition.title);
  await expect(page.locator('[data-note="fractional-low"]')).toBeVisible();
}
export async function rollDownload(page:Page,name='Save project file'){
  const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return downloadedBytes(await pending);
}
export async function readRoll(page:Page):Promise<RollBackup>{return JSON.parse((await rollDownload(page)).toString()) as RollBackup;}
export async function geometry(page:Page){
  const grid=page.locator('.roll-grid');await grid.scrollIntoViewIfNeeded();const box=await grid.boundingBox();if(!box)throw Error('Visible roll grid expected');
  return{...box,beats:Number(await grid.getAttribute('data-beats')),top:Number(await grid.getAttribute('data-top'))};
}
export async function dragNote(page:Page,id:string,deltaBeats:number,deltaPitch=0,resize=false,release=true){
  const grid=await geometry(page),note=page.locator(`[data-note="${id}"]`);const target=resize?note.locator('[data-roll-resize]'):note;const box=await target.boundingBox();if(!box)throw Error('Visible note target expected');
  const x=resize?box.x+box.width/2:box.x+Math.min(box.width/3,8),y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+deltaBeats*grid.width/grid.beats,y-deltaPitch*22,{steps:4});if(release)await page.mouse.up();
}
export async function gridPoint(page:Page,beat:number,pitch:number){const g=await geometry(page);return{x:g.x+beat*g.width/g.beats,y:g.y+(g.top-pitch+.5)*22};}
export function assertMidi(bytes:Buffer,project:Composition){
  const midi=decodeMidi(bytes);expect(midi.ticksPerBeat).toBe(480);expect(midi.microsecondsPerBeat).toBe(500000);
  project.tracks.forEach((track,index)=>expect(midi.tracks[index+1].notes).toEqual((track.muted?[]:track.notes).map(n=>{const start=Math.round(n.start*480),end=Math.round((n.start+n.duration)*480);return{pitch:n.pitch,start:start/480,duration:(end-start)/480,velocity:Math.max(1,Math.round(n.velocity*127))};}).sort((a,b)=>a.start-b.start||a.pitch-b.pitch)));
}
// Direct sine/envelope oracle (not the product's oscillator lookup or mixer).
// Fixture's quiet voices never trigger peak normalization. PCM quantization and
// lookup interpolation are allowed at most two signed16 sample units.
export function assertWav(bytes:Buffer,project:Composition){
  const wav=decodeWav(bytes),rate=wav.sampleRate;expect(rate).toBe(22050);const seconds=60/project.tempo;
  const end=Math.max(...project.tracks.flatMap(t=>t.notes.map(n=>n.start+n.duration)));expect(wav.samples.length).toBe(Math.ceil((end*seconds+.08)*rate));
  let maximum=0;
  for(let index=0;index<wav.samples.length;index+=37){let value=0;
    for(const track of project.tracks)if(!track.muted)for(const note of track.notes){const i=index-Math.round(note.start*seconds*rate),duration=note.duration*seconds*rate;if(i<0||i>=Math.ceil(duration+.08*rate))continue;
      const envelope=i<.01*rate?i/(.01*rate):i<=duration?1:Math.max(0,1-(i-duration)/(.08*rate));value+=Math.sin(2*Math.PI*(440*2**((note.pitch-69)/12))*i/rate)*envelope*track.volume*note.velocity*.4;
    }
    const expected=Math.round(value*(value<0?32768:32767));maximum=Math.max(maximum,Math.abs(wav.samples[index]-expected));
  }
  expect(maximum).toBeLessThanOrEqual(2);return{samples:wav.samples.length,sampleRate:rate,maximumPcmError:maximum};
}

export async function storedRoll(page:Page):Promise<unknown>{return page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('melody-studio.projects',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise<unknown>((resolve,reject)=>{const tx=db.transaction(['projects','assets'],'readonly'),project=tx.objectStore('projects').get('current'),assets=tx.objectStore('assets').getAll();tx.oncomplete=()=>resolve({project:project.result,assets:assets.result.map((asset:{id:string;sha256:string;pcm:Blob})=>({id:asset.id,sha256:asset.sha256,bytes:asset.pcm.size}))});tx.onabort=()=>reject(tx.error);});}finally{db.close();}
});}
