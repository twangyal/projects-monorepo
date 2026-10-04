// Independent original sequence capacity/artifact probe. No producer imports.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {chromium,expect} from '@playwright/test';

const LIMIT=327680,WIDTH=960,HEIGHT=540;
const encoded=value=>Buffer.from(JSON.stringify(value));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(prefix,length)=>{assert(prefix.length<=length);return prefix.padEnd(length,'x');};
const sourceId=index=>exact(`source-${index}-`,64);
const clipId=index=>exact(`clip-${index}-`,64);
const COLORS=['#ff0000','#0000ff','#ff00ff','#00ffff'];
const LIGHTS=[.65,.85,1.05,1.25];
const SHOTS=[5,13,9,17];
const CUE_TIMES=[...Array.from({length:30},(_,i)=>i*2),59,60];
const TARGETS=Array.from({length:20},(_,i)=>[i*3+.65,i*3+2.35]).flat();
const FOCAL=270/Math.tan(25*Math.PI/180);
const FRONT_SHADE=.28+.72*.6/Math.sqrt(.16+1+.36);
const TOLERANCES=Object.freeze({ptsSeconds:.2,codecChannelError:24,visibleMatches:23,patchSamples:27,invisibleChannelError:40,invisibleMatches:1,minimumVideoFrames:600,minVideoSpan:59,maxVideoSpan:62});

function originalFilm(index){
  return {schemaVersion:3,title:exact(`Original complete source ${index+1} - `,80),light:LIGHTS[index],actors:[
    {name:exact(`Moving ${index+1} `,30),color:COLORS[index],performanceMode:'blocking',cues:CUE_TIMES.map((time,i)=>({time,x:-1.5+time/40,z:0,action:['idle','wave','walk'][i%3],visible:i%6!==4}))},
    {name:exact(`Control ${index+1} `,30),color:'#00ff00',performanceMode:'blocking',cues:CUE_TIMES.map(time=>({time,x:1.4,z:0,action:'idle',visible:true}))},
  ],shots:Array.from({length:20},(_,i)=>{const x=(i%5-2)*.25;return{name:exact(`Authored source ${index+1} shot ${i+1} `,40),duration:3,eye:[x,1,8],target:[x,1,0],fov:50,cameraMode:'linear',endEye:[x+.6,1,8],endTarget:[x+.6,1,0]};})};
}
function originalSequence(){return {schemaVersion:2,kind:'shot-studio-sequence',title:exact('Four complete original scenes - twenty deliberate cuts - ',80),
  sources:Array.from({length:4},(_,i)=>({id:sourceId(i),label:exact(`Immutable original source ${i+1} `,80),film:originalFilm(i)})),
  clips:Array.from({length:20},(_,i)=>({id:clipId(i),sourceId:sourceId(i%4),shotIndex:SHOTS[i%4],label:exact(`Original sequence clip ${i+1} `,40)}))};}
function originalAt(sequenceTime){
  const bounded=Math.max(0,Math.min(60,sequenceTime)),clipIndex=bounded===60?19:Math.floor(bounded/3),clipLocal=bounded-clipIndex*3,sourceIndex=clipIndex%4,shotIndex=SHOTS[sourceIndex];
  const sourceGlobal=shotIndex*3+clipLocal,cueIndex=CUE_TIMES.findLastIndex(time=>time<=sourceGlobal),cameraX=(shotIndex%5-2)*.25+.2*clipLocal;
  return {clipIndex,clipLocal,sequenceTime:bounded,sourceIndex,shotIndex,sourceGlobal,cameraX,
    moving:{x:-1.5+sourceGlobal/40,visible:cueIndex%6!==4,color:COLORS[sourceIndex]},control:{x:1.4,visible:true,color:'#00ff00'},light:LIGHTS[sourceIndex]};
}
// Camera axes remain aligned: project original torso front-face points directly.
function patches(at,actor){
  const rgb=[1,3,5].map(i=>Math.round(parseInt(actor.color.slice(i,i+2),16)*FRONT_SHADE*at.light)),points=[];
  for(const offset of[-.17,0,.17]){
    const x=480+FOCAL*(actor.x+offset-at.cameraX)/7.84,y=270-FOCAL*.15/7.84;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)points.push({x:Math.floor(x)+dx,y:Math.floor(y)+dy});
  }
  return {points,rgb,visible:actor.visible};
}
function inspectPixels(rgb,at){
  const readings={};
  for(const name of['moving','control']){
    const expected=patches(at,at[name]);let visibleMatches=0,invisibleMatches=0,maxError=0;
    for(const p of expected.points){assert(p.x>=0&&p.x<WIDTH&&p.y>=0&&p.y<HEIGHT);const offset=(p.y*WIDTH+p.x)*3,actual=[...rgb.subarray(offset,offset+3)],error=Math.max(...actual.map((v,i)=>Math.abs(v-expected.rgb[i])));maxError=Math.max(error,maxError);if(error<=TOLERANCES.codecChannelError)visibleMatches++;if(error<=TOLERANCES.invisibleChannelError)invisibleMatches++;}
    if(expected.visible)assert(visibleMatches>=TOLERANCES.visibleMatches,`${name} clip ${at.clipIndex} source clock ${at.sourceGlobal}: ${visibleMatches}/27 torso pixels match ${expected.rgb}, max error ${maxError}`);
    else assert(invisibleMatches<=TOLERANCES.invisibleMatches,`${name} clip ${at.clipIndex} at ${at.sourceGlobal} must be hidden, but ${invisibleMatches}/27 pixels match its costume`);
    readings[name]={expectedColor:expected.rgb,visible:expected.visible,visibleMatches,invisibleMatches,maxError};
  }
  return readings;
}
function inspectVideo(path){
  const probe=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_frames','-show_entries','stream=codec_type,codec_name,width,height:frame=media_type,best_effort_timestamp_time','-of','json',path],{encoding:'utf8',timeout:60000,maxBuffer:5*1024**2}));
  assert.equal(probe.streams.length,1);const stream=probe.streams[0];assert.equal(stream.codec_type,'video');assert(['vp8','vp9'].includes(stream.codec_name));assert.equal(stream.width,WIDTH);assert.equal(stream.height,HEIGHT);
  const pts=probe.frames.filter(f=>f.media_type==='video').map(f=>Number(f.best_effort_timestamp_time));assert(pts.length>TOLERANCES.minimumVideoFrames);assert(pts.every((t,i)=>Number.isFinite(t)&&(!i||t>=pts[i-1])));
  const elapsed=pts.map(t=>t-pts[0]);assert(elapsed.at(-1)>TOLERANCES.minVideoSpan&&elapsed.at(-1)<TOLERANCES.maxVideoSpan);
  const indices=TARGETS.map(target=>elapsed.reduce((best,t,i)=>Math.abs(t-target)<Math.abs(elapsed[best]-target)?i:best,0));assert.equal(new Set(indices).size,TARGETS.length);indices.forEach((i,j)=>assert(Math.abs(elapsed[i]-TARGETS[j])<TOLERANCES.ptsSeconds));
  const filter=`select=${indices.map(i=>`eq(n\\,${i})`).join('+')}`;
  const pixels=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-threads','1','-i',path,'-vf',filter,'-vsync','0','-threads','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{timeout:90000,maxBuffer:70*1024**2});
  const size=WIDTH*HEIGHT*3;assert.equal(pixels.length,size*TARGETS.length);
  const samples=indices.map((frame,i)=>{const at=originalAt(elapsed[frame]);return{frame,pts:pts[frame],elapsed:elapsed[frame],target:TARGETS[i],...at,pixels:inspectPixels(pixels.subarray(i*size,(i+1)*size),at)};});
  return {codec:stream.codec_name,width:WIDTH,height:HEIGHT,audioStreams:0,decodedFrames:pts.length,firstPts:pts[0],spanSeconds:elapsed.at(-1),samples};
}
async function artifact(path,bytes){await writeFile(path,bytes);return{path,bytes:bytes.length,sha256:sha(bytes)};}
async function download(page,selector,path,timeout=15000){const pending=page.waitForEvent('download',{timeout});await page.locator(selector).click();const file=await pending;await file.saveAs(path);return readFile(path);}
async function processId(context){const session=await context.browser().newBrowserCDPSession();try{return(await session.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='browser').map(p=>p.id);}finally{await session.detach();}}
async function openSequence(page,bytes,name){await page.locator('#sequence-open').setInputFiles({name,mimeType:'application/json',buffer:bytes});await expect(page.locator('#sequence-clips [data-sequence-clip-id]')).toHaveCount(20);await expect(page.locator('#sequence-title')).toHaveValue(originalSequence().title);}
async function main(){
  const out=process.env.SHOT_SEQUENCES_OUTPUT?resolve(process.env.SHOT_SEQUENCES_OUTPUT):await mkdtemp(join(tmpdir(),'shot-sequences-'));if(process.env.SHOT_SEQUENCES_OUTPUT)await mkdir(out,{recursive:false});
  const sequence=originalSequence(),plain=encoded(sequence),padding=LIMIT-plain.length;assert(padding>0);const exactFile=Buffer.concat([plain,Buffer.alloc(padding,32)]),oversize=Buffer.concat([exactFile,Buffer.from(' ')]);
  assert.equal(exactFile.length,LIMIT);assert.equal(oversize.length,LIMIT+1);assert.deepEqual(JSON.parse(exactFile),sequence);
  const sourceBytes=sequence.sources.map(s=>encoded(s.film).length);assert(sourceBytes.every(n=>n<=65536));assert(sourceBytes.reduce((a,b)=>a+b,0)<=262144);assert.equal(sequence.clips.length,20);assert.equal(sequence.clips.reduce(n=>n+3,0),60);
  assert(sequence.sources.every(s=>s.film.shots.length===20&&s.film.shots.reduce((n,shot)=>n+shot.duration,0)===60&&s.film.actors.every(a=>a.cues.length===32)));
  const evidence={schemaVersion:1,issue:90,status:'fixtures-only',outputDirectory:out,fixtures:[],artifacts:[],
    frozenExpectations:{sources:4,shotsPerSource:20,performersPerSource:2,cuesPerPerformer:32,totalRetainedCues:256,clips:20,seconds:60,sourceBytes,canonicalSequenceBytes:plain.length,rawFileCeiling:LIMIT,sourceIndices:SHOTS,originalSourcePrefixes:SHOTS.map(i=>i*3),sampleTargets:TARGETS,tolerances:TOLERANCES,pinhole:{focalPixels:FOCAL,torsoFrontDepth:7.84,torsoWorldY:1.15,frontFaceLightFactor:FRONT_SHADE},expectedSamples:TARGETS.map(time=>{const at=originalAt(time);return{...at,movingPatches:patches(at,at.moving),controlPatches:patches(at,at.control)};})},
    limits:['This is maximal source/shot/cue/name/clip/duration topology, not a claim of maximal canonical bytes or encoded video bytes.','The raw320KiB file boundary uses legal trailing JSON whitespace; all complete original sources remain intact.','Forty decoded video samples cover all20 clips at actual native PTS; not every frame is pixel-checked and no exact30fps assumption is made.','All sources use32 authored blocking cues per performer. Looping phase has separate native/scalar coverage; this maximum does not claim simultaneous looping and blocking modes.','No producer model, evaluator, renderer, serializer or expected-output helper imports.','No server/build is started and no persistent browser storage is injected.'],checks:[]};
  for(const [name,bytes]of[['maximum-sequence.json',plain],['exact-320KiB-file.json',exactFile],['oversize-file.json',oversize]])evidence.fixtures.push(await artifact(join(out,name),bytes));
  for(let i=0;i<4;i++)evidence.fixtures.push(await artifact(join(out,`original-source-${i+1}.json`),encoded(sequence.sources[i].film)));
  const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(evidence,null,2)+'\n');await save();
  if(process.argv.includes('--fixtures-only')){console.log(JSON.stringify({status:evidence.status,out,sourceBytes,canonicalSequenceBytes:plain.length,rawFileBytes:exactFile.length,clips:20,seconds:60,retainedCues:256},null,2));return;}
  const base=process.env.SHOT_SEQUENCES_BASE_URL;if(!base)throw Error('Set SHOT_SEQUENCES_BASE_URL to a separately started coherent local app.');const origin=new URL(base).origin,profile=join(out,'profile'),errors=[],external=[];let context,page;
  const mount=async()=>{context=await chromium.launchPersistentContext(profile,{headless:true,acceptDownloads:true,viewport:{width:1440,height:1000},...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=context.pages()[0];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==origin)external.push(r.url());});await page.goto(base);await expect(page.locator('#sequence-panel')).toBeVisible();await expect(page.locator('#sequence-open')).toBeEnabled();};
  try{
    await mount();evidence.browserVersion=context.browser().version();const ordinaryTitle=await page.locator('#title').inputValue();
    const initial=JSON.parse(await download(page,'#sequence-save',join(out,'initial-empty-sequence.json')));assert.equal(initial.clips.length,0);
    await openSequence(page,exactFile,'exact-320KiB.shot-sequence.json');const committed=await download(page,'#sequence-save',join(out,'maximum-before-restart.shot-sequence.json'));assert.deepEqual(JSON.parse(committed),sequence);await expect(page.locator('#title')).toHaveValue(ordinaryTitle);
    await page.locator('#sequence-undo').click();assert.deepEqual(JSON.parse(await download(page,'#sequence-save',join(out,'after-one-undo.json'))),initial);await page.locator('#sequence-redo').click();assert(committed.equals(await download(page,'#sequence-save',join(out,'after-redo.json'))));
    await page.locator('#sequence-open').setInputFiles({name:'oversize.shot-sequence.json',mimeType:'application/json',buffer:oversize});await expect(page.locator('#sequence-status')).toContainText(/large|320|limit|bytes/i);assert(committed.equals(await download(page,'#sequence-save',join(out,'after-oversize.json'))));
    const invalid=structuredClone(sequence);invalid.clips.push({...invalid.clips[0],id:clipId(20)});await page.locator('#sequence-open').setInputFiles({name:'twenty-one-clips.json',mimeType:'application/json',buffer:encoded(invalid)});await expect(page.locator('#sequence-status')).toContainText(/clip|limit|20|invalid/i);assert(committed.equals(await download(page,'#sequence-save',join(out,'after-clip-overflow.json'))));
    evidence.checks.push('Actual whitespace-padded320KiB File imports exact original4-source/20-clip document; +1byte and21clips refuse without changing backup. One Undo/Redo restores exact prior/current documents; ordinary scene title unchanged.');
    await expect(page.locator('#sequence-save-status')).toContainText(/saved/i);evidence.firstBrowserProcess=await processId(context);await context.close();context=undefined;await mount();evidence.secondBrowserProcess=await processId(context);assert.notDeepEqual(evidence.firstBrowserProcess,evidence.secondBrowserProcess);
    await expect(page.locator('#sequence-title')).toHaveValue(sequence.title);const restored=await download(page,'#sequence-save',join(out,'maximum-after-restart.shot-sequence.json'));assert(committed.equals(restored));assert.deepEqual(JSON.parse(restored),sequence);await expect(page.locator('#title')).toHaveValue(ordinaryTitle);evidence.restart={bytes:restored.length,sha256:sha(restored),byteExact:true};
    const clockChecks=[];
    for(const clipIndex of[0,1,2,3,19]){
      await page.locator(`[data-sequence-clip-id="${clipId(clipIndex)}"]`).click();await page.locator('#sequence-preview-end').click();
      // Explicit clip-end retains original selected camera even at an internal cut.
      const at=originalAt(clipIndex*3+2.999999);at.clipLocal=3;at.sequenceTime=(clipIndex+1)*3;at.sourceGlobal=SHOTS[clipIndex%4]*3+3;at.cameraX=(SHOTS[clipIndex%4]%5-2)*.25+.6;const ci=CUE_TIMES.findLastIndex(t=>t<=at.sourceGlobal);at.moving.x=-1.5+at.sourceGlobal/40;at.moving.visible=ci%6!==4;
      const locations=[...patches(at,at.moving).points,...patches(at,at.control).points];
      const sampled=await page.locator('#sequence-stage').evaluate((canvas,points)=>{const gl=canvas.getContext('webgl');return points.map(p=>{const value=new Uint8Array(4);gl.readPixels(p.x,canvas.height-1-p.y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,value);return [...value];});},locations);
      const rgb=Buffer.alloc(WIDTH*HEIGHT*3);locations.forEach((p,i)=>{const dst=(p.y*WIDTH+p.x)*3;rgb[dst]=sampled[i][0];rgb[dst+1]=sampled[i][1];rgb[dst+2]=sampled[i][2];});
      clockChecks.push({...at,pixels:inspectPixels(rgb,at)});
    }
    evidence.endpointPreviewChecks=clockChecks;
    const began=performance.now(),webm=await download(page,'#sequence-export',join(out,'maximum-sequence-60s.webm'),95000);evidence.recordAndDownloadWallMs=performance.now()-began;assert(webm.length>0&&webm.length<=32*1024**2);
    const decodeStart=performance.now();evidence.video={bytes:webm.length,sha256:sha(webm),...inspectVideo(join(out,'maximum-sequence-60s.webm')),independentDecodeWallMs:performance.now()-decodeStart};evidence.checks.push('One actual full-minute silent WebM independently decoded; forty stable source-clock/light/costume/camera/visibility samples cover all20 clips and complete frame timestamps.');
    await page.locator('#sequence-panel').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,'390px.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);evidence.pageErrors=errors;evidence.externalRequests=external;evidence.status='passed';
    for(const name of['maximum-before-restart.shot-sequence.json','maximum-after-restart.shot-sequence.json','maximum-sequence-60s.webm','desktop.png','390px.png']){const bytes=await readFile(join(out,name));evidence.artifacts.push({name,bytes:bytes.length,sha256:sha(bytes)});}
  }catch(error){evidence.status='failed';evidence.failure={name:error.name,message:error.message,stack:error.stack};throw error;}finally{await context?.close();await save();}
  console.log(JSON.stringify({status:evidence.status,out,videoBytes:evidence.video.bytes,decodedFrames:evidence.video.decodedFrames,restart:evidence.restart},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
