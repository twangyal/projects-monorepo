import {expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Independent, originally authored films: a red performer travels between two
// marks while a green control stays fixed; the alternative travels oppositely.
export function takeFilm(alternative=false){return{schemaVersion:3,title:alternative?'Westward alternative':'Eastward original',light:1,
  actors:[{name:'Scarlet',color:'#ff0000',performanceMode:'blocking',cues:[
    {time:0,x:alternative?1:-1,z:0,action:'idle',visible:true},
    {time:2,x:alternative?-1:1,z:0,action:'idle',visible:true}]},
  {name:'Green fixed control',color:'#00ff00',performanceMode:'blocking',cues:[{time:0,x:2,z:0,action:'idle',visible:true}]}],
  shots:[{name:'Original fixed view',duration:2,cameraMode:'static',eye:[0,2.2,8],target:[0,1.15,0],fov:50}]};}
export async function openTakeFilm(page,film=takeFilm()){
  await page.goto('/');await expect(page.locator('#stage')).toBeVisible();
  await page.locator('#import').setInputFiles({name:'independent-film.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(film))});
  await expect(page.locator('#title')).toHaveValue(film.title);
}
export async function recordTake(page,name){
  const before=await page.locator('#take-list [data-take-id]').count();
  await page.locator('#take-name').fill(name);await page.locator('#record-take').click();
  await expect(page.locator('#take-list [data-take-id]')).toHaveCount(before+1,{timeout:20000});
  await expect(page.locator('#take-status')).toContainText(/saved/i);
  await page.locator('#take-list [data-take-id]').last().click();
}
export async function downloadTake(page){
  const pending=page.waitForEvent('download');await page.locator('#download-take').click();
  const download=await pending,path=await download.path();if(!path)throw Error('Native download has no bytes');
  return{download,path,bytes:await readFile(path)};
}
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function parseTake(bytes){
  expect(bytes.subarray(0,8).toString('ascii')).toBe('SHOTTAK1');
  const manifestBytes=bytes.readUInt32LE(8),videoBytes=bytes.readUInt32LE(12);
  expect(manifestBytes).toBeGreaterThan(0);expect(manifestBytes).toBeLessThanOrEqual(80*1024);
  expect(videoBytes).toBeGreaterThan(0);expect(videoBytes).toBeLessThanOrEqual(32*1024**2);
  expect(bytes.length).toBe(16+manifestBytes+videoBytes);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(16,16+manifestBytes)));
  const video=bytes.subarray(16+manifestBytes);
  expect(manifest.video.bytes).toBe(video.length);expect(manifest.video.sha256).toBe(sha(video));
  return{manifest,video};
}
export function frameTake(manifest,video){
  const encoded=Buffer.from(JSON.stringify(manifest));const header=Buffer.alloc(16);
  header.write('SHOTTAK1',0,'ascii');header.writeUInt32LE(encoded.length,8);header.writeUInt32LE(video.length,12);
  return Buffer.concat([header,encoded,video]);
}
export async function libraryReceipt(page){return page.evaluate(async()=>{
  const data=await new Promise((resolve,reject)=>{const r=indexedDB.open('shot-studio-takes',1);r.onerror=()=>reject(Error('open'));r.onsuccess=()=>{const db=r.result,tx=db.transaction('state','readonly'),get=tx.objectStore('state').get('library');tx.oncomplete=()=>{db.close();resolve(get.result);};tx.onabort=()=>{db.close();reject(Error('abort'));};};});
  if(!data)return null;
  const records=[];for(const record of data.records){const bytes=await record.video.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');records.push({metadata:record.metadata,bytes:bytes.byteLength,sha256:hash});}
  return{schemaVersion:data.schemaVersion,revision:data.revision,records};
});}
export async function abortNextWrite(page){await page.evaluate(()=>{
  const native=IDBObjectStore.prototype.put;
  window.takeAbort={fired:false};
  IDBObjectStore.prototype.put=function(...args){const request=native.apply(this,args);
    if(this.transaction.db.name==='shot-studio-takes'&&!window.takeAbort.fired){window.takeAbort.fired=true;request.addEventListener('success',()=>this.transaction.abort(),{once:true});}
    return request;};
});}
export function costume(pixels,channel){let count=0,sumX=0,sumY=0;for(let y=0;y<540;y++)for(let x=0;x<960;x++){
  const i=(y*960+x)*3,value=pixels[i+channel];if(value<=80||[0,1,2].some(c=>c!==channel&&value<=2*pixels[i+c]))continue;count++;sumX+=x;sumY+=y;
}return{count,x:sumX/count,y:sumY/count};}
// Scalar pinhole projection, independent of production model/renderer helpers.
export function projectedX(x){return 480+(540/(2*Math.tan(50*Math.PI/360)))*x/Math.hypot(8,1.05);}
export async function inspectRecording(video,path,alternative=false){
  await writeFile(path,video);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=codec_name,width,height:frame=best_effort_timestamp_time','-of','json',path],{encoding:'utf8',timeout:15000,maxBuffer:2*1024**2}));
  expect(probe.streams).toHaveLength(1);expect(probe.streams[0]).toMatchObject({width:960,height:540});expect(['vp8','vp9']).toContain(probe.streams[0].codec_name);
  const pts=probe.frames.map(frame=>Number(frame.best_effort_timestamp_time));expect(pts.length).toBeGreaterThan(20);expect(pts.every((t,i)=>Number.isFinite(t)&&(!i||t>=pts[i-1]))).toBe(true);
  const times=pts.map(t=>t-pts[0]);expect(times.at(-1)).toBeGreaterThan(1.7);expect(times.at(-1)).toBeLessThan(3.5);
  const selected=[.3,1,1.7].map(t=>times.reduce((best,value,i)=>Math.abs(value-t)<Math.abs(times[best]-t)?i:best,0));
  const filter=`select=${selected.map(i=>`eq(n\\,${i})`).join('+')}`;
  const pixels=execFileSync('ffmpeg',['-v','error','-threads','1','-i',path,'-vf',filter,'-vsync','0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{timeout:15000,maxBuffer:6*1024**2});
  const size=960*540*3;expect(pixels.length).toBe(size*3);
  const samples=selected.map((index,i)=>{expect(Math.abs(times[index]-[.3,1,1.7][i])).toBeLessThan(.15);const frame=pixels.subarray(i*size,(i+1)*size),red=costume(frame,0),green=costume(frame,1);
    expect(red.count).toBeGreaterThan(400);expect(green.count).toBeGreaterThan(400);
    const x=alternative?1-times[index]:-1+times[index];expect(Math.abs(red.x-projectedX(x))).toBeLessThan(16);expect(Math.abs(green.x-projectedX(2))).toBeLessThan(16);return{time:times[index],red,green};});
  expect((samples[2].red.x-samples[0].red.x)*(alternative?-1:1)).toBeGreaterThan(65);
  expect(Math.max(...samples.map(s=>s.green.x))-Math.min(...samples.map(s=>s.green.x))).toBeLessThan(4);
  return{codec:probe.streams[0].codec_name,frames:pts.length,span:times.at(-1),samples,sha256:sha(video),bytes:video.length};
}
