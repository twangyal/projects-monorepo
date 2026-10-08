import {expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Original literal films and scalar clocks: authored before reading trimming implementation.
// The selected A shot starts at 1.1+1.2 source seconds. Its original four-second
// translation -2→2 is NOT rescaled: In1 / Out3 gives camera X -1→1.
export function trimFilmA(){return{schemaVersion:3,title:'Amber source <literal> Ω',light:1,actors:[
 {name:'Red timed visibility',color:'#ff0000',performanceMode:'blocking',cues:[
  {time:0,x:-.5,z:0,action:'idle',visible:true},{time:3.8,x:-.5,z:0,action:'wave',visible:true},
  {time:4.8,x:-.5,z:0,action:'idle',visible:false},{time:7.3,x:-.5,z:0,action:'idle',visible:true}]},
 {name:'Green fixed landmark',color:'#00ff00',performanceMode:'blocking',cues:[{time:0,x:2,z:0,action:'idle',visible:true}]}
],shots:[
 {name:'Opening A',duration:1.1,cameraMode:'static',eye:[-3,2.2,8],target:[-3,1.15,0],fov:50},
 {name:'Opening B',duration:1.2,cameraMode:'static',eye:[3,2.2,8],target:[3,1.15,0],fov:50},
 {name:'Original four-second travel',duration:4,cameraMode:'linear',eye:[-2,2.2,8],target:[-2,1.15,0],endEye:[2,2.2,8],endTarget:[2,1.15,0],fov:50},
 {name:'Unseen late cut retained',duration:1,cameraMode:'static',eye:[4,2.2,8],target:[4,1.15,0],fov:50}
]};}
export function trimFilmB(){return{schemaVersion:3,title:'Blue original loop',light:.55,actors:[
 {name:'Blue looping clock',color:'#0000ff',performanceMode:'loop',x:-.8,z:0,action:'walk'},
 {name:'Green fixed landmark',color:'#00ff00',performanceMode:'blocking',cues:[{time:0,x:2,z:0,action:'idle',visible:true}]}
],shots:[
 {name:'Blue opening retained',duration:1,cameraMode:'static',eye:[-2,2.2,8],target:[-2,1.15,0],fov:50},
 {name:'Blue original three-second shot',duration:3,cameraMode:'static',eye:[0,2.2,8],target:[0,1.15,0],fov:50}
]};}
export function trimSequence(){return{schemaVersion:3,kind:'shot-studio-sequence',title:'Original source excerpts Ω',sources:[{id:'source-amber',label:'Amber complete source',film:trimFilmA()},{id:'source-blue',label:'Blue complete source',film:trimFilmB()}],clips:[
 {id:'excerpt-a',sourceId:'source-amber',shotIndex:2,label:'Amber In1 Out3',inTime:1,outTime:3},
 {id:'excerpt-b',sourceId:'source-blue',shotIndex:1,label:'Blue In.5 Out2.5',inTime:.5,outTime:2.5},
 {id:'excerpt-repeat',sourceId:'source-amber',shotIndex:2,label:'Amber repeated',inTime:1,outTime:3}
]};}
export function legacyTrimSequence(version,form='rich'){
 const next=trimSequence();const clips=next.clips.map(({id,sourceId,shotIndex,label})=>form==='name'?{sourceId,shotIndex}:{id,sourceId,shotIndex,label});
 return{...next,schemaVersion:version,sources:form==='name'?next.sources.map(({id,label,film})=>({id,name:label,film})):next.sources,clips};
}
export function migratedTrimSequence(old){return{...old,schemaVersion:3,sources:old.sources.map(source=>({id:source.id,label:source.label??source.name,film:source.film})),clips:old.clips.map((clip,index)=>{const source=old.sources.find(s=>s.id===clip.sourceId),shot=source.film.shots[clip.shotIndex];return{id:clip.id??`legacy-clip-${index+1}`,sourceId:clip.sourceId,shotIndex:clip.shotIndex,label:clip.label??shot.name,inTime:0,outTime:shot.duration};})};}
export const trimSha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function trimDownload(page,id='#sequence-save'){const event=page.waitForEvent('download');await page.locator(id).click();const download=await event,path=await download.path();if(!path)throw Error('Missing actual sequence download');return{bytes:await readFile(path),name:download.suggestedFilename()};}
export async function trimBackup(page){return JSON.parse((await trimDownload(page)).bytes.toString());}
export async function settleTrim(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
export async function seekTrim(page,time){await page.locator('#sequence-scrub').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},time);await settleTrim(page);}
export async function trimCanvas(page){const base64=await page.locator('#sequence-stage').evaluate(canvas=>canvas.toDataURL('image/png').split(',')[1]);return execFileSync('ffmpeg',['-v','error','-threads','1','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:Buffer.from(base64,'base64'),maxBuffer:4*1024**2,timeout:10000});}
export function trimClock(time){const t=Math.max(0,Math.min(6,time)),index=t<2?0:t<4?1:2,local=t-index*2;return{index,local,shotLocal:(index===1?.5:1)+local,sourceGlobal:(index===1?1.5:3.3)+local,cameraX:index===1?0:-1+local,kind:index===1?'blue':'red'};}
export const trimProjectedX=(x,cameraX)=>480+540/(2*Math.tan(50*Math.PI/360))*(x-cameraX)/Math.hypot(8,1.05);
export function trimColor(bytes,channel){let count=0,sum=0,minX=960,maxX=-1,intensity=0;for(let y=0;y<540;y++)for(let x=0;x<960;x++){const i=(y*960+x)*3,v=bytes[i+channel];if(v<=50||[0,1,2].some(c=>c!==channel&&v<=2*bytes[i+c]))continue;count++;sum+=x;minX=Math.min(minX,x);maxX=Math.max(maxX,x);intensity+=v;}return{count,x:sum/count,minX,maxX,mean:intensity/count};}
export function verifyTrimPixels(bytes,time,override){const clock=override??trimClock(time),red=trimColor(bytes,0),green=trimColor(bytes,1),blue=trimColor(bytes,2);expect(green.count).toBeGreaterThan(350);expect(Math.abs(green.x-trimProjectedX(2,clock.cameraX))).toBeLessThan(16);
 if(clock.kind==='blue'){expect(red.count).toBeLessThanOrEqual(20);expect(blue.count).toBeGreaterThan(350);expect(Math.abs(blue.x-trimProjectedX(-.8+.7*Math.sin(clock.sourceGlobal),0))).toBeLessThan(16);}else{expect(blue.count).toBeLessThanOrEqual(20);if(clock.sourceGlobal>=4.8)expect(red.count).toBeLessThanOrEqual(20);else{expect(red.count).toBeGreaterThan(350);expect(Math.abs(red.x-trimProjectedX(-.5,clock.cameraX))).toBeLessThan(16);}}
 return{time,clock,red,green,blue};}
export async function decodeTrimVideo(bytes,path){await writeFile(path,bytes);const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=codec_name,width,height:frame=best_effort_timestamp_time','-of','json',path],{encoding:'utf8',maxBuffer:4*1024**2,timeout:15000}));expect(meta.streams).toHaveLength(1);expect(meta.streams[0]).toMatchObject({width:960,height:540});expect(['vp8','vp9']).toContain(meta.streams[0].codec_name);const pts=meta.frames.map(frame=>Number(frame.best_effort_timestamp_time));expect(pts.length).toBeGreaterThan(60);expect(pts.every((time,index)=>Number.isFinite(time)&&(!index||time>=pts[index-1]))).toBe(true);const times=pts.map(time=>time-pts[0]);expect(times.at(-1)).toBeGreaterThan(5.5);expect(times.at(-1)).toBeLessThan(7.5);
 const targets=[.2,1.1,1.8,2.3,3.6,4.2,5.8],indices=targets.map(target=>times.reduce((best,t,i)=>Math.abs(t-target)<Math.abs(times[best]-target)?i:best,0));expect(new Set(indices).size).toBe(targets.length);indices.forEach((index,i)=>expect(Math.abs(times[index]-targets[i])).toBeLessThan(.15));const filter=`select=${indices.map(i=>`eq(n\\,${i})`).join('+')}`,raw=execFileSync('ffmpeg',['-v','error','-threads','1','-i',path,'-vf',filter,'-vsync','0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:24*1024**2,timeout:20000}),size=960*540*3;expect(raw.length).toBe(size*targets.length);const samples=indices.map((index,i)=>verifyTrimPixels(raw.subarray(i*size,(i+1)*size),times[index]));expect(samples[3].green.mean/samples[0].green.mean).toBeGreaterThan(.4);expect(samples[3].green.mean/samples[0].green.mean).toBeLessThan(.7);return{bytes:bytes.length,sha256:trimSha(bytes),codec:meta.streams[0].codec_name,decodedFrames:pts.length,span:times.at(-1),thresholds:{projection:16,hiddenPixels:20,nearbyPTS:.15},samples};}
