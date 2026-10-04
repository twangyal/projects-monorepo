import {expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export const KEY='shot-studio-v1';
export const CAMERA={eye:[0,2.2,8],target:[0,1.15,0],fov:50};
// Frozen before any output: original six-second movement, hold, wave, departure.
// Green is a stationary control, not a producer-evaluated expected pose.
export function blockingFilm(){return{schemaVersion:3,title:'Original arrival and farewell',light:1,
  actors:[{name:'Scarlet performer',color:'#ff0000',performanceMode:'blocking',cues:[
    {time:0,x:-1.6,z:0,action:'idle',visible:true},{time:1.5,x:-.4,z:0,action:'idle',visible:true},
    {time:3,x:-.4,z:0,action:'wave',visible:true},{time:4.5,x:-.4,z:0,action:'idle',visible:true},
    {time:5.5,x:.8,z:0,action:'idle',visible:false}]},
  {name:'Green control',color:'#00ff00',performanceMode:'blocking',cues:[{time:0,x:1.8,z:0,action:'idle',visible:true}]}],
  shots:[{name:'Fixed whole performance',duration:6,cameraMode:'static',...structuredClone(CAMERA)}]};}
export function legacyFilm(version=2){return{schemaVersion:version,title:'Literal original-key legacy film',light:1,
  actors:[{name:'Scarlet performer',color:'#ff0000',x:-1.6,z:0,action:'idle'},{name:'Green control',color:'#00ff00',x:1.8,z:0,action:'idle'}],
  shots:[{name:'Static legacy camera',duration:6,...structuredClone(CAMERA),...(version===2?{cameraMode:'static'}:{})}]};}
export async function openFilm(page,film=blockingFilm()){
  await page.goto('/');await expect(page.locator('#stage')).toBeVisible();
  await page.locator('#import').setInputFiles({name:'original-blocking.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(film))});
  await expect(page.locator('#title')).toHaveValue(film.title);
}
export async function downloaded(page,label='Save project'){
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const file=await pending;const path=await file.path();if(!path)throw Error('Missing native download');return{file,path,bytes:await readFile(path)};
}
export async function backup(page){return JSON.parse((await downloaded(page)).bytes.toString());}
export async function raw(page){return page.evaluate(key=>localStorage.getItem(key),KEY);}
export async function edit(page,id,value){await page.locator(`#${id}`).fill(String(value));await page.locator(`#${id}`).press('Tab');}
export async function seek(page,time){await page.locator('#scrub').evaluate((node,time)=>{node.value=String(time);node.dispatchEvent(new Event('input',{bubbles:true}));},time);await frames(page);}
export async function frames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
export async function canvasFrame(page){const frame=await page.locator('#stage').evaluate(canvas=>({png:canvas.toDataURL('image/png').split(',')[1],width:canvas.width,height:canvas.height}));
  const pixels=execFileSync('ffmpeg',['-v','error','-threads','1','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:Buffer.from(frame.png,'base64'),maxBuffer:4*1024**2,timeout:10000});
  expect(pixels.length).toBe(frame.width*frame.height*3);return{...frame,pixels};}
export function costume(pixels,width,height,color){let count=0,sumX=0,sumY=0,minX=width,maxX=-1,minY=height,maxY=-1;const channel=color==='red'?0:1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3,value=pixels[i+channel];if(value<=80||[0,1,2].some(c=>c!==channel&&value<=2*pixels[i+c]))continue;count++;sumX+=x;sumY+=y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  return{count,x:sumX/count,y:sumY/count,minX,maxX,minY,maxY};}
// Independent scalar perspective, no renderer/model/math imports.
export function projectPoint(point,camera=CAMERA,width=960,height=540){const normalize=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);},dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const f=normalize(camera.target.map((x,i)=>x-camera.eye[i])),r=normalize([-f[2],0,f[0]]),u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]],v=point.map((x,i)=>x-camera.eye[i]),z=dot(v,f),scale=height/(2*Math.tan(camera.fov*Math.PI/360));
  return{x:width/2+scale*dot(v,r)/z,y:height/2-scale*dot(v,u)/z};}
export function envelope(x,arm=0,camera=CAMERA){const boxes=[[x,1.15,0,.5,.65,.32,0],[x-.4,1.13,0,.15,.65,.2,arm],[x+.4,1.13,0,.15,.65,.2,-arm]];
  const points=boxes.flatMap(([cx,cy,cz,sx,sy,sz,angle])=>[-1,1].flatMap(a=>[-1,1].flatMap(b=>[-1,1].map(c=>{const dx=a*sx/2,dy=b*sy/2;return projectPoint([cx+dx*Math.cos(angle)-dy*Math.sin(angle),cy+dx*Math.sin(angle)+dy*Math.cos(angle),cz+c*sz/2],camera);}))));
  return{...projectPoint([x,1.15,0],camera),minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};}
export function verifyCostume(observed,x,{tolerance=16,arm=0,centroid=true}={}){expect(observed.count).toBeGreaterThan(400);expect(observed.count).toBeLessThan(50000);const expected=envelope(x,arm);for(const key of [...(centroid?['x','y']:[]),'minX','maxX','minY','maxY'])expect(Math.abs(observed[key]-expected[key]),`${key}: measured${observed[key]} independent${expected[key]}`).toBeLessThanOrEqual(tolerance);return expected;}
export async function holdReads(page){await page.addInitScript(()=>{const native=File.prototype.text;window.blockingRead={pending:[],inputs:0,changes:0};
  document.addEventListener('input',event=>{if(['cueTime','actorX','actorZ'].includes(event.target.id))window.blockingRead.inputs++;});
  document.addEventListener('change',event=>{if(['cueTime','actorX','actorZ'].includes(event.target.id))window.blockingRead.changes++;});
  File.prototype.text=async function(){const text=await native.call(this);if(this.name==='held-blocking.json')await new Promise(resolve=>window.blockingRead.pending.push(resolve));return text;};});}
export async function pendingImport(page){const film=blockingFilm();film.title='Held replacement must not win';await page.locator('#import').setInputFiles({name:'held-blocking.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(film))});await expect.poll(()=>page.evaluate(()=>window.blockingRead.pending.length)).toBe(1);}
export async function releaseRead(page){await page.evaluate(()=>window.blockingRead.pending.splice(0).forEach(resolve=>resolve()));}

export function decodeBlockingVideo(path){const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=codec_name,width,height:frame=best_effort_timestamp_time','-of','json',path],{encoding:'utf8',timeout:15000,maxBuffer:3*1024**2}));
  expect(probe.streams).toHaveLength(1);expect(probe.streams[0]).toMatchObject({width:960,height:540});expect(['vp8','vp9']).toContain(probe.streams[0].codec_name);
  const pts=probe.frames.map(f=>Number(f.best_effort_timestamp_time));expect(pts.every(Number.isFinite)).toBe(true);expect(pts.length).toBeGreaterThan(45);expect(pts.every((t,i)=>!i||t>=pts[i-1])).toBe(true);
  const times=pts.map(t=>t-pts[0]);expect(times.at(-1)).toBeGreaterThan(5.5);expect(times.at(-1)).toBeLessThan(7.5);
  const targets=[.3,1.1,1.8,2.6,4.75,5.1,5.75],indices=targets.map(target=>times.reduce((best,t,i)=>Math.abs(t-target)<Math.abs(times[best]-target)?i:best,0));expect(new Set(indices).size).toBe(7);
  indices.forEach((index,i)=>expect(Math.abs(times[index]-targets[i])).toBeLessThan(.15));
  const filter=`select=${indices.map(i=>`eq(n\\,${i})`).join('+')}`;
  const pixels=execFileSync('ffmpeg',['-v','error','-threads','1','-i',path,'-vf',filter,'-vsync','0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{timeout:20000,maxBuffer:24*1024**2});const size=960*540*3;expect(pixels.length).toBe(size*7);
  const samples=indices.map((index,i)=>{const time=times[index],frame=pixels.subarray(i*size,(i+1)*size),red=costume(frame,960,540,'red'),green=costume(frame,960,540,'green');verifyCostume(green,1.8);let expectedRed=null;
    if(time>=5.5)expect(red.count).toBeLessThanOrEqual(20);else{const x=time<1.5?-1.6+.8*time:time<4.5?-.4:-.4+1.2*(time-4.5);expectedRed=verifyCostume(red,x);}
    return{pts:pts[index],elapsed:time,red,green,expectedRed};});
  expect(samples[1].red.x-samples[0].red.x).toBeGreaterThanOrEqual(32);expect(Math.abs(samples[3].red.x-samples[2].red.x)).toBeLessThanOrEqual(4);
  expect(samples[5].red.x-samples[4].red.x).toBeGreaterThanOrEqual(20);for(const key of ['x','y'])expect(Math.max(...samples.map(s=>s.green[key]))-Math.min(...samples.map(s=>s.green[key]))).toBeLessThanOrEqual(4);
  return{codec:probe.streams[0].codec_name,decodedFrames:pts.length,span:times.at(-1),thresholds:{projection:16,holdControlDrift:4,arrival:32,departure:20,hiddenPixels:20},samples};}
