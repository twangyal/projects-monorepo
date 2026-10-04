/* global Buffer, console, process, indexedDB, window, requestAnimationFrame, URL */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {deflateSync,inflateSync} from 'node:zlib';
import {chromium,expect} from '@playwright/test';
import {parseGIF,decompressFrames} from 'gifuct-js';

// Literal fixture construction and byte/pixel expectations import no producer modules.
const LEGACY_BYTES=6*1024*1024,CANONICAL_BYTES=LEGACY_BYTES+168;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytesOf=value=>Buffer.from(JSON.stringify(value));
const clone=value=>JSON.parse(JSON.stringify(value));
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
function chunk(type,data){const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);result.write(type,4);data.copy(result,8);result.writeUInt32BE(crc(result.subarray(4,-4)),result.length-4);return result;}
function originalPng(padding=0){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(800);ihdr.writeUInt32BE(800,4);ihdr[8]=8;ihdr[9]=6;
  const raw=Buffer.alloc(800*(800*4+1));for(let y=0;y<800;y++)raw.fill(255,y*3201+1,(y+1)*3201);
  const parts=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw))];
  // CRC-correct private ancillary capacity data, not hidden artwork or compression tricks.
  if(padding)parts.push(chunk('paDd',Buffer.alloc(padding,63)));parts.push(chunk('IEND',Buffer.alloc(0)));return Buffer.concat(parts);
}
const pose=(frame=0,x=0,y=0)=>({frame,x,y,scale:1,rotation:0,opacity:1,easing:'linear'});
const dot=color=>({color,width:32,points:[{x:0,y:0}]});
function fillers(count,totalPoints){
  assert(count>1&&totalPoints>=1000+count-1);const rest=totalPoints-1000,base=Math.floor(rest/(count-1)),extra=rest%(count-1);
  return Array.from({length:count},(_,i)=>({color:'#000000',width:1,points:Array.from({length:i===0?1000:base+(i<=extra?1:0)},(_,p)=>({x:-600+(p%2),y:-300}))}));
}
const drawing=(id,name,cels,keys=[pose()])=>({id,name,kind:'drawing',cels,keys});
function drawingGraph(allCels=false){
  const cels=Array.from({length:24},(_,i)=>({frame:i*4,strokes:i>=12&&i<18?[]:[dot(i<6||i>=18?'#FF0000':'#0000FF')]}));
  const visible=[drawing('held','Held primary artwork',cels,[pose(0,180,140)]),drawing('moving','Moving green control',allCels?Array.from({length:24},(_,i)=>({frame:i*4,strokes:[dot('#00FF00')]})):[{frame:0,strokes:[dot('#00FF00')]}],[pose(0,400,250),pose(95,500,250)]),drawing('fixed','Static green control',allCels?Array.from({length:24},(_,i)=>({frame:i*4,strokes:[dot('#00FF00')]})):[{frame:0,strokes:[dot('#00FF00')]}],[pose(0,50,50)])];
  const significant=allCels?66:20,extra=fillers(100-significant,10000-significant);
  const count=allCels?8:4;
  for(let i=3;i<count;i++)visible.push(drawing(`budget${i}`,`Offstage budget ${i}`,allCels?Array.from({length:24},(_,f)=>({frame:f*4,strokes:f===0&&i===3?extra:[]})):[{frame:0,strokes:extra}]));
  return{schemaVersion:2,title:allCels?'All 192 held drawing boundaries':'Maximum mixed held drawing graph',background:'#FFFFFF',frameCount:96,layers:visible};
}
function withImages(project){
  const image=originalPng();project.layers.unshift(...Array.from({length:4},(_,i)=>({id:`image${i}`,name:`Offstage original PNG ${i}`,kind:'image',image:{dataUrl:'data:image/png;base64,'+image.toString('base64'),width:800,height:800},keys:[pose(0,-640,-360)]})));return project;
}
function legacyGraph(){
  const project={schemaVersion:1,title:'Maximum genuine static legacy graph',background:'#FFFFFF',frameCount:96,layers:[
    {id:'held',name:'Legacy primary artwork',kind:'drawing',strokes:[dot('#FF0000')],keys:[pose(0,180,140)]},
    {id:'moving',name:'Legacy moving green control',kind:'drawing',strokes:[dot('#00FF00')],keys:[pose(0,400,250),pose(95,500,250)]},
    {id:'fixed',name:'Legacy static green control',kind:'drawing',strokes:[dot('#00FF00')],keys:[pose(0,50,50)]},
    {id:'budget',name:'Legacy offstage budget',kind:'drawing',strokes:fillers(97,9997),keys:[pose()]}]};return withImages(project);
}
function tune(project,target){
  const images=project.layers.filter(layer=>layer.kind==='image');assert.equal(images.length,4);let missing=target-bytesOf(project).length;assert(missing>0);
  project.title+='q'.repeat(missing%4);missing=target-bytesOf(project).length;assert.equal(missing%4,0);
  for(const layer of images){
    const oldLength=layer.image.dataUrl.length,capacity=Math.floor((1.5*1024*1024-oldLength)/4)*4,add=Math.min(missing,capacity);
    if(add){const expected=oldLength+add;let size=Math.floor((expected-22)/4)*3-originalPng(1).length+1;
      let png=originalPng(size);while(22+4*Math.ceil(png.length/3)>expected)png=originalPng(--size);while(22+4*Math.ceil(png.length/3)<expected)png=originalPng(++size);
      layer.image.dataUrl='data:image/png;base64,'+png.toString('base64');assert.equal(layer.image.dataUrl.length,expected);assert(layer.image.dataUrl.length<=1.5*1024*1024);missing-=add;}
  }
  assert.equal(missing,0);assert.equal(bytesOf(project).length,target);return project;
}
function counts(project){const drawing=project.layers.filter(layer=>layer.kind==='drawing'),strokes=drawing.flatMap(layer=>project.schemaVersion===1?layer.strokes:layer.cels.flatMap(cel=>cel.strokes));return{layers:project.layers.length,images:project.layers.filter(layer=>layer.kind==='image').length,cels:drawing.reduce((n,layer)=>n+(layer.cels?.length??1),0),strokes:strokes.length,points:strokes.reduce((n,stroke)=>n+stroke.points.length,0),longestStroke:Math.max(...strokes.map(stroke=>stroke.points.length))};}
function migrateLiteral(project){const result=clone(project);result.schemaVersion=2;for(const layer of result.layers)if(layer.kind==='drawing'){layer.cels=[{frame:0,strokes:layer.strokes}];delete layer.strokes;}return result;}
function decodePng(bytes){
  assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));let at=8,width,height,channels;const parts=[];
  while(at<bytes.length){const size=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),end=at+size+12;assert(end<=bytes.length);assert.equal(crc(bytes.subarray(at+4,end-4)),bytes.readUInt32BE(end-4));
    if(type==='IHDR'){width=bytes.readUInt32BE(at+8);height=bytes.readUInt32BE(at+12);assert.equal(bytes[at+16],8);channels=bytes[at+17]===6?4:bytes[at+17]===2?3:0;assert(channels);assert.equal(bytes[at+20],0);}if(type==='IDAT')parts.push(bytes.subarray(at+8,end-4));at=end;if(type==='IEND'){assert.equal(at,bytes.length);break;}}
  const raw=inflateSync(Buffer.concat(parts)),stride=width*channels;assert.equal(raw.length,height*(stride+1));const decoded=Buffer.alloc(width*height*channels);
  const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert(filter<=4);for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?decoded[i-channels]:0,b=y?decoded[i-stride]:0,c=y&&x>=channels?decoded[i-stride-channels]:0;decoded[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
  const rgba=Buffer.alloc(width*height*4);for(let p=0;p<width*height;p++){decoded.copy(rgba,p*4,p*channels,p*channels+3);rgba[p*4+3]=channels===4?decoded[p*channels+3]:255;}return{width,height,rgba};
}
function inspectFrame(raster,frame){
  assert.equal(raster.width,640);assert.equal(raster.height,360);const color=frame<24||frame>=72?[255,0,0,255]:frame<48?[0,0,255,255]:[255,255,255,255];
  const patch=(x,y,wanted)=>{for(let yy=y-2;yy<=y+2;yy++)for(let xx=x-2;xx<=x+2;xx++)assert.deepEqual([...raster.rgba.subarray((yy*640+xx)*4,(yy*640+xx)*4+4)],wanted,`frame${frame} patch${x},${y}`);};
  patch(180,140,color);patch(50,50,[0,255,0,255]);patch(Math.floor(400+100*frame/95),250,[0,255,0,255]);patch(220,140,[255,255,255,255]);
}
function inspectGif(bytes){
  const parsed=parseGIF(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),frames=decompressFrames(parsed,true);assert.equal(frames.length,96);let duration=0;
  for(let f=0;f<96;f++){const frame=frames[f];assert.deepEqual(frame.dims,{top:0,left:0,width:640,height:360});assert.equal(frame.delay,10*(Math.round((f+1)*100/12)-Math.round(f*100/12)));duration+=frame.delay;for(let i=3;i<frame.patch.length;i+=4)assert.equal(frame.patch[i],255);inspectFrame({width:640,height:360,rgba:frame.patch},f);}
  assert.equal(duration,8000);const loop=bytes.indexOf(Buffer.from('NETSCAPE2.0'));assert(loop>=0);assert.deepEqual([...bytes.subarray(loop+11,loop+16)],[3,1,0,0,0]);return{frames:96,durationMs:duration,frameHashes:frames.map(frame=>sha(frame.patch))};
}
async function outputFile(path,bytes){await writeFile(path,bytes);return{path,bytes:bytes.length,sha256:sha(bytes)};}
async function download(page,selector,path){const wait=page.waitForEvent('download',{timeout:35000});await page.locator(selector).click();const file=await wait;await file.saveAs(path);return readFile(path);}
async function backup(page,path){return download(page,'#backup',path);}
async function open(page,project){await expect(page.getByLabel('Open project file',{exact:true})).toBeEnabled();await page.getByLabel('Open project file',{exact:true}).setInputFiles({name:'original-capacity.motion.json',mimeType:'application/json',buffer:bytesOf(project)});await expect(page.locator('#message')).toContainText('Project opened');await expect(page.locator('#project-title')).toHaveValue(project.title);await expect(page.locator('#stage')).toHaveAttribute('aria-disabled','false');}
async function seek(page,frame){await page.locator('#frame').focus();await page.keyboard.press('Home');for(let i=0;i<frame;i++)await page.keyboard.press('ArrowRight');await expect(page.locator('#stage')).toHaveAttribute('data-frame',String(frame));}
async function record(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('motion-studio',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('project','readonly'),read=tx.objectStore('project').get('current');let value;read.onsuccess=()=>{value=read.result;};tx.oncomplete=()=>{db.close();resolve(value);};tx.onabort=()=>{db.close();reject(tx.error);};};}));}
async function processIdentity(context){const session=await context.browser().newBrowserCDPSession();try{const info=await session.send('SystemInfo.getProcessInfo');return info.processInfo.filter(item=>item.type==='browser').map(item=>item.id);}finally{await session.detach();}}

async function main(){
  const out=process.env.MOTION_CELS_OUTPUT?resolve(process.env.MOTION_CELS_OUTPUT):await mkdtemp(join(tmpdir(),'motion-cels-'));if(process.env.MOTION_CELS_OUTPUT)await mkdir(out,{recursive:false});
  const legacy=tune(legacyGraph(),LEGACY_BYTES),maximum=tune(withImages(drawingGraph()),CANONICAL_BYTES),allCels=drawingGraph(true),migrated=migrateLiteral(legacy);
  assert.equal(bytesOf(migrated).length,LEGACY_BYTES+84);assert.deepEqual(counts(legacy),{layers:8,images:4,cels:4,strokes:100,points:10000,longestStroke:1000});assert.deepEqual(counts(maximum),{layers:8,images:4,cels:27,strokes:100,points:10000,longestStroke:1000});assert.deepEqual(counts(allCels),{layers:8,images:0,cels:192,strokes:100,points:10000,longestStroke:1000});
  for(const project of[legacy,maximum])for(const layer of project.layers.filter(layer=>layer.kind==='image')){const image=decodePng(Buffer.from(layer.image.dataUrl.split(',')[1],'base64'));assert.equal(image.width,800);assert.equal(image.height,800);assert.deepEqual([...image.rgba.subarray(0,4)],[255,255,255,255]);}
  const evidence={schemaVersion:1,scope:'Original bounded fixture and native UI acceptance; no producer oracle imports.',outputDirectory:out,fixtures:{legacy:await outputFile(join(out,'legacy-exact-6MiB.motion.json'),bytesOf(legacy)),maximum:await outputFile(join(out,'canonical-exact-6MiB-plus168.motion.json'),bytesOf(maximum)),allCels:await outputFile(join(out,'eight-drawings-192-cels.motion.json'),bytesOf(allCels))},counts:{legacy:counts(legacy),maximum:counts(maximum),allCels:counts(allCels)},legacyMigrationExpectedBytes:LEGACY_BYTES+84,limits:['Four images plus four drawings migrate with84 bytes, not168.','The192-cel fixture has eight drawings and zero images.','No browser memory peak is inferred from file sizes.'],checks:[],artifacts:[]};
  const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(evidence,null,2)+'\n');await save();console.log('Original fixtures ready:',out);
  if(process.argv.includes('--fixtures-only'))return;
  const baseURL=process.env.MOTION_CELS_BASE_URL;if(!baseURL)throw Error('Set MOTION_CELS_BASE_URL to a separately started production preview. This script never builds or starts a server.');
  const origin=new URL(baseURL).origin,profile=join(out,'profile'),errors=[],external=[];let context,page;const launch={headless:true,acceptDownloads:true,viewport:{width:1280,height:1000},...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})};
  const mount=async()=>{context=await chromium.launchPersistentContext(profile,launch);page=context.pages()[0];page.on('dialog',dialog=>dialog.accept());page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)external.push(request.url());});await page.addInitScript(()=>{const Native=window.Worker;window.motionWorkerObservations={started:0,terminated:0};window.Worker=class extends Native{constructor(...args){super(...args);window.motionWorkerObservations.started++;}terminate(){window.motionWorkerObservations.terminated++;super.terminate();}};});await page.goto(baseURL);};
  try{
    await mount();evidence.browserVersion=context.browser().version();evidence.firstBrowserProcess=await processIdentity(context);
    await open(page,legacy);const actualLegacy=JSON.parse((await backup(page,join(out,'actual-legacy-migrated.motion.json'))).toString('utf8'));assert.deepEqual(actualLegacy,migrated);assert.equal(bytesOf(actualLegacy).length,LEGACY_BYTES+84);evidence.checks.push('Exact6MiB original schema1 imports and migrates without changing artwork; four drawing wrappers add84 bytes.');
    await open(page,maximum);await expect(page.locator('#save-status')).toHaveText('Saved in this browser',{timeout:15000});const first=await backup(page,join(out,'maximum-before-restart.motion.json'));assert.deepEqual(JSON.parse(first),maximum);assert.equal(first.length,CANONICAL_BYTES);const originalRecord=await record(page);assert.deepEqual(originalRecord,maximum);evidence.nativeSavedRecord={bytes:bytesOf(originalRecord).length,sha256:sha(bytesOf(originalRecord))};
    await context.close();context=undefined;await mount();evidence.secondBrowserProcess=await processIdentity(context);assert.notDeepEqual(evidence.firstBrowserProcess,evidence.secondBrowserProcess);await expect(page.locator('#project-title')).toHaveValue(maximum.title);await expect(page.locator('#stage')).toHaveAttribute('aria-disabled','false');const restored=await backup(page,join(out,'maximum-after-restart.motion.json'));assert(first.equals(restored));assert.deepEqual(await record(page),originalRecord);evidence.checks.push('Exact6MiB+168 canonical graph and all embedded PNG bytes survive full persistent Chromium process restart; actual before/after backups are byte-identical.');
    const beforeOverflow=restored;await page.getByLabel('Open project file',{exact:true}).setInputFiles({name:'raw-limit-plus-one.motion.json',mimeType:'application/json',buffer:Buffer.concat([bytesOf(maximum),Buffer.from(' ')])});await expect(page.locator('#message')).toContainText(/unchanged|large|limit/i);assert((await backup(page,join(out,'after-oversize.motion.json'))).equals(beforeOverflow));assert.deepEqual(await record(page),originalRecord);evidence.checks.push('Raw whole-file capacity+1 refuses atomically, preserving complete saved graph.');
    await page.locator('#project-title').fill(maximum.title+'X');await expect(page.locator('#project-title')).toHaveValue(maximum.title+'X');assert((await backup(page,join(out,'after-canonical-plus-one.motion.json'))).equals(beforeOverflow));assert.deepEqual(await record(page),originalRecord);await page.locator('#project-title').fill(maximum.title);await expect(page.locator('#stage')).toHaveAttribute('aria-disabled','false');evidence.checks.push('A native title edit making canonical JSON exactly one byte too large retains the editable draft but cannot replace committed backup or native saved record; correcting it restores admission.');
    for(const frame of[23,24,47,48,71,72,95]){await seek(page,frame);const png=await download(page,'#png',join(out,`frame-${frame}.png`));inspectFrame(decodePng(png),frame);evidence.artifacts.push({kind:'frame-png',frame,bytes:png.length,sha256:sha(png)});}
    const beforeWorkers=await page.evaluate(()=>window.motionWorkerObservations);let unexpectedDownload=false;const observe=()=>{unexpectedDownload=true;};page.on('download',observe);const cancelledAt=performance.now();await page.locator('#gif').click();await expect(page.locator('#cancel-export')).toBeVisible();await page.waitForFunction(()=>{const node=window.document.querySelector('#export-progress');return node.value>0&&node.value<1;},undefined,{polling:'raf',timeout:25000});const progressFractionAtCancel=await page.locator('#export-progress').evaluate(node=>node.value);assert(progressFractionAtCancel>0&&progressFractionAtCancel<1);await page.locator('#cancel-export').click();await expect(page.locator('#message')).toContainText(/cancel/i);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));page.off('download',observe);assert.equal(unexpectedDownload,false);const afterWorkers=await page.evaluate(()=>window.motionWorkerObservations);assert(afterWorkers.started>beforeWorkers.started);assert(afterWorkers.terminated>beforeWorkers.terminated);assert((await backup(page,join(out,'after-cancel.motion.json'))).equals(beforeOverflow));evidence.cancellation={endToEndWallMs:performance.now()-cancelledAt,progressFractionAtCancel,partialDownload:false,nativeWorkerStarted:afterWorkers.started-beforeWorkers.started,nativeWorkerTerminated:afterWorkers.terminated-beforeWorkers.terminated};
    const start=performance.now(),gif=await download(page,'#gif',join(out,'maximum-96-frames.gif')),encodeAndDownloadWallMs=performance.now()-start;assert(gif.length<=32*1024*1024);const decodeStart=performance.now(),decodedGif=inspectGif(gif),independentDecodeWallMs=performance.now()-decodeStart;evidence.gif={...decodedGif,bytes:gif.length,sha256:sha(gif),encodeAndDownloadWallMs,independentDecodeWallMs};evidence.checks.push('All96 actual GIF frames, exact abrupt held cuts, static/moving controls, opaque patches, infinite loop and8second cumulative delays independently decoded.');
    const titles=Array.from({length:5},(_,i)=>(`Maximum state ${i}`).padEnd(maximum.title.length,'q'));for(let i=1;i<=4;i++)await page.locator('#project-title').fill(titles[i]);await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#project-title')).toHaveValue(titles[2]);await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#project-title')).toHaveValue(titles[3]);
    await page.locator('#layers button').filter({hasText:'Moving green control'}).click();await seek(page,1);const beforeDuplicate=await backup(page,join(out,'before-budget-duplicate.motion.json'));await page.locator('#duplicate-cel').click();await expect(page.locator('#message')).toContainText(/stroke|budget|100|limit/i);assert((await backup(page,join(out,'after-budget-duplicate.motion.json'))).equals(beforeDuplicate));await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();evidence.history={retainedStates:3,undoSteps:2,serializedBytesPerState:CANONICAL_BYTES,retainedSerializedBytes:3*CANONICAL_BYTES,budgetBytes:20*1024*1024,failedFullBudgetDuplicateKeepsRedo:true};
    await open(page,allCels);assert.deepEqual(JSON.parse(await backup(page,join(out,'actual-192-cels.motion.json'))),allCels);await expect(page.locator('#drawing-cels button')).toHaveCount(24);evidence.checks.push('Separate eight-drawing graph admits all192 boundaries and aggregate100strokes/10kpoints, without claiming simultaneous four images.');
    await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>window.document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:join(out,'390px.png'),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);evidence.pageErrors=errors;evidence.externalRequests=external;evidence.status='passed';await save();console.log(JSON.stringify({status:evidence.status,outputDirectory:out,gif:evidence.gif.bytes,frames:evidence.gif.frames,restartByteExact:true},null,2));
  }catch(error){evidence.status='failed';evidence.failure={name:error.name,message:error.message,stack:error.stack};throw error;}finally{await context?.close();await save();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
