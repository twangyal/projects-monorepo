import {expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Original scenes and scalar expectations frozen before new sequence producer inspection.
// #114 compatibility changes only canonical version/full-range fields, not these pixel clocks.
// The selected shot starts at source second1 in BOTH scenes. A's complete duration4
// and late cue4 stay embedded, despite only its middle two-second shot being used.
export function sequenceSourceA(){return{schemaVersion:3,title:'Scarlet arrival <original>',light:1,actors:[
  {name:'Scarlet',color:'#ff0000',performanceMode:'blocking',cues:[
    {time:0,x:-2,z:0,action:'idle',visible:true},{time:1,x:-1,z:0,action:'idle',visible:true},
    {time:2,x:0,z:0,action:'wave',visible:true},{time:2.5,x:.5,z:0,action:'idle',visible:false},
    {time:4,x:2,z:0,action:'idle',visible:true}]},
  {name:'Green source control',color:'#00ff00',performanceMode:'blocking',cues:[{time:0,x:2,z:0,action:'idle',visible:true}]},
],shots:[
  {name:'Unselected opening',duration:1,cameraMode:'static',eye:[-3,2.2,8],target:[-3,1.15,0],fov:50},
  {name:'Middle tracking shot',duration:2,cameraMode:'linear',eye:[-1,2.2,8],target:[-1,1.15,0],endEye:[1,2.2,8],endTarget:[1,1.15,0],fov:50},
  {name:'Unselected following cut',duration:1,cameraMode:'static',eye:[3,2.2,8],target:[3,1.15,0],fov:50},
]};}
export function sequenceSourceB(){return{schemaVersion:3,title:'Blue looping alternative',light:.55,actors:[
  {name:'Blue loop',color:'#0000ff',performanceMode:'loop',x:-1,z:0,action:'walk'},
  {name:'Green source control',color:'#00ff00',performanceMode:'blocking',cues:[{time:0,x:2,z:0,action:'idle',visible:true}]},
],shots:[
  {name:'Unselected blue opening',duration:1,cameraMode:'static',eye:[-2,2.2,8],target:[-2,1.15,0],fov:50},
  {name:'Whole-clock blue loop',duration:2,cameraMode:'static',eye:[0,2.2,8],target:[0,1.15,0],fov:50},
]};}
export function originalSequence(){return{schemaVersion:3,kind:'shot-studio-sequence',title:'Arrival / blue / arrival',sources:[
  {id:'scarlet-original',label:'Scarlet source',film:sequenceSourceA()},
  {id:'blue-original',label:'Blue source',film:sequenceSourceB()},
],clips:[
  {id:'arrival-first',sourceId:'scarlet-original',shotIndex:1,label:'Arrival first',inTime:0,outTime:2},
  {id:'blue-middle',sourceId:'blue-original',shotIndex:1,label:'Blue contrast',inTime:0,outTime:2},
  {id:'arrival-repeat',sourceId:'scarlet-original',shotIndex:1,label:'Arrival repeated',inTime:0,outTime:2},
]};}
export const sequenceSha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function sequenceDownload(page,id='#sequence-save'){
  const pending=page.waitForEvent('download');await page.locator(id).click();const download=await pending,path=await download.path();if(!path)throw Error('Native sequence download unavailable');return{download,path,bytes:await readFile(path)};
}
export async function sequenceBackup(page){return JSON.parse((await sequenceDownload(page)).bytes.toString());}
export function sequenceClock(time){const clamped=Math.max(0,Math.min(6,time));const clip=clamped<2?0:clamped<4?1:2;const local=clamped-clip*2;return{clip,local,source:1+local,kind:clip===1?'blue':'scarlet',cameraX:clip===1?0:-1+local};}
// Scalar pinhole: parallel camera translations leave y/forward unchanged.
export function sequenceProjectedX(x,cameraX=0){return 480+540/(2*Math.tan(50*Math.PI/360))*(x-cameraX)/Math.hypot(8,1.05);}
export function sequenceCostume(pixels,channel){let count=0,sumX=0,sumY=0,intensity=0,minX=960,maxX=-1;for(let y=0;y<540;y++)for(let x=0;x<960;x++){
  const i=(y*960+x)*3,v=pixels[i+channel];if(v<=50||[0,1,2].some(c=>c!==channel&&v<=2*pixels[i+c]))continue;count++;sumX+=x;sumY+=y;intensity+=v;minX=Math.min(minX,x);maxX=Math.max(maxX,x);
}return{count,x:sumX/count,y:sumY/count,mean:intensity/count,minX,maxX};}
export function verifySequencePixels(pixels,time,{projection=16}={}){
  const clock=sequenceClock(time),red=sequenceCostume(pixels,0),green=sequenceCostume(pixels,1),blue=sequenceCostume(pixels,2);
  expect(green.count).toBeGreaterThan(350);expect(Math.abs(green.x-sequenceProjectedX(2,clock.cameraX))).toBeLessThan(projection);
  if(clock.kind==='blue'){
    expect(red.count).toBeLessThanOrEqual(20);expect(blue.count).toBeGreaterThan(350);const x=-1+.7*Math.sin(clock.source);expect(Math.abs(blue.x-sequenceProjectedX(x))).toBeLessThan(projection);
  }else{expect(blue.count).toBeLessThanOrEqual(20);if(clock.local>=1.5)expect(red.count).toBeLessThanOrEqual(20);else{expect(red.count).toBeGreaterThan(350);expect(Math.abs(red.x-sequenceProjectedX(-1+clock.local,clock.cameraX))).toBeLessThan(projection);if(clock.local>=1.05&&clock.local<=1.35)expect(red.maxX-red.minX).toBeGreaterThan(85);}}
  return{time,clock,red,green,blue};
}
export async function sequenceCanvas(page){const png=await page.locator('#sequence-stage').evaluate(canvas=>canvas.toDataURL('image/png').split(',')[1]);return execFileSync('ffmpeg',['-v','error','-threads','1','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:Buffer.from(png,'base64'),maxBuffer:4*1024**2,timeout:10000});}
export async function decodeSequenceVideo(bytes,path){
  await writeFile(path,bytes);const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=codec_name,width,height:frame=best_effort_timestamp_time','-of','json',path],{encoding:'utf8',timeout:15000,maxBuffer:4*1024**2}));expect(probe.streams).toHaveLength(1);expect(probe.streams[0]).toMatchObject({width:960,height:540});expect(['vp8','vp9']).toContain(probe.streams[0].codec_name);
  const pts=probe.frames.map(frame=>Number(frame.best_effort_timestamp_time));expect(pts.length).toBeGreaterThan(60);expect(pts.every((t,i)=>Number.isFinite(t)&&(!i||t>=pts[i-1]))).toBe(true);const times=pts.map(t=>t-pts[0]);expect(times.at(-1)).toBeGreaterThan(5.5);expect(times.at(-1)).toBeLessThan(7.5);
  const targets=[.25,1.2,1.8,2.25,3.6,4.25,5.8],selected=targets.map(target=>times.reduce((best,t,i)=>Math.abs(t-target)<Math.abs(times[best]-target)?i:best,0));expect(new Set(selected).size).toBe(targets.length);selected.forEach((index,i)=>expect(Math.abs(times[index]-targets[i])).toBeLessThan(.15));
  const filter=`select=${selected.map(i=>`eq(n\\,${i})`).join('+')}`,raw=execFileSync('ffmpeg',['-v','error','-threads','1','-i',path,'-vf',filter,'-vsync','0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:24*1024**2,timeout:20000});const size=960*540*3;expect(raw.length).toBe(size*targets.length);const samples=selected.map((index,i)=>verifySequencePixels(raw.subarray(i*size,(i+1)*size),times[index]));
  expect(samples[3].green.mean/samples[0].green.mean).toBeGreaterThan(.4);expect(samples[3].green.mean/samples[0].green.mean).toBeLessThan(.7);
  return{bytes:bytes.length,sha256:sequenceSha(bytes),codec:probe.streams[0].codec_name,decodedFrames:pts.length,span:times.at(-1),thresholds:{projection:16,hiddenPixels:20,nearbyPTS:.15,waveWidthMin:85},samples};
}

// Published external version1 was a different exact shape. Its names and order
// are retained literally; new clip IDs are the frozen one-based migration IDs.
export function remoteSequenceV1(){const current=originalSequence();return{schemaVersion:1,kind:current.kind,title:current.title,sources:current.sources.map((source,i)=>({id:source.id,name:i===0?'É'.repeat(80):source.label,film:source.film})),clips:current.clips.map(clip=>({sourceId:clip.sourceId,shotIndex:clip.shotIndex}))};}
export function migratedRemoteSequence(){const old=remoteSequenceV1();return{schemaVersion:3,kind:old.kind,title:old.title,sources:old.sources.map(source=>({id:source.id,label:source.name,film:source.film})),clips:old.clips.map((clip,index)=>({id:`legacy-clip-${index+1}`,sourceId:clip.sourceId,shotIndex:clip.shotIndex,label:old.sources.find(source=>source.id===clip.sourceId).film.shots[clip.shotIndex].name,inTime:0,outTime:old.sources.find(source=>source.id===clip.sourceId).film.shots[clip.shotIndex].duration}))};}
