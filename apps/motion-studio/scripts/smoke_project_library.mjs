/* global Buffer, console, process, window, URL */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {chromium,expect} from '@playwright/test';
import {join,resolve} from 'node:path';
import {deflateSync,inflateSync} from 'node:zlib';
import {parseGIF,decompressFrames} from 'gifuct-js';

// Independent #104 originals frozen before any library implementation read.
// The only app facts used are the existing schema2 contract and public stage
// dimensions. No production validator, serializer, evaluator or renderer import.
const PROJECT_BYTES=6291624,IMAGE_URL_CHARS=1572864;
const PALETTE=['#FF0000','#00FF00','#0000FF','#00FFFF','#FF00FF','#FFFF00','#000000','#FFFFFF'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytesOf=value=>Buffer.from(JSON.stringify(value));
const rgba=color=>[...color.slice(1).match(/../g).map(x=>parseInt(x,16)),255];
const pose=(frame,x,y,scale=1)=>({x,y,scale,rotation:0,opacity:1,frame,easing:'linear'});
function crc(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(type,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;}
function originalPng(color,padding=0,tag=0){
  const header=Buffer.alloc(13);header.writeUInt32BE(800);header.writeUInt32BE(800,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc(800*3201),pixel=Buffer.from(rgba(color));
  for(let y=0;y<800;y++)for(let x=0;x<800;x++)pixel.copy(raw,y*3201+1+x*4);
  const parts=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw))];
  // Declared capacity padding: valid CRC, private ancillary, safe to copy.
  if(padding)parts.push(chunk('paDd',Buffer.alloc(padding,tag)));
  parts.push(chunk('IEND',Buffer.alloc(0)));return Buffer.concat(parts);
}
function line(color){return{color,width:24,points:[{x:-24,y:0},{x:0,y:0},{x:24,y:0}]};}
function filler(){
  const remaining=9940-1000,base=Math.floor(remaining/79),extra=remaining%79;
  return Array.from({length:80},(_,stroke)=>({color:'#000000',width:1,
    points:Array.from({length:stroke===0?1000:base+(stroke<=extra?1:0)},(_,point)=>({x:-600+point%2,y:-300}))}));
}
function literalProject(index){
  const primary=PALETTE[index],secondary=index===6?'#FF0000':index===7?'#00FF00':PALETTE[(index+3)%6];
  const prefix=`original-${index+1}`,layers=[];
  for(let image=0;image<4;image++){
    const color=PALETTE[(index+image)%6];
    layers.push({id:`${prefix}-png-${image+1}`,name:`Panel ${index+1}.${image+1}`,
      keys:[pose(0,70+90*image,300,.2)],kind:'image',
      image:{dataUrl:'data:image/png;base64,'+originalPng(color).toString('base64'),width:800,height:800}});
  }
  layers.push({id:`${prefix}-held`,name:`Held original ${index+1}`,keys:[pose(0,150+12*index,140)],kind:'drawing',
    cels:Array.from({length:24},(_,cel)=>({frame:cel*4,strokes:cel>=12&&cel<18?[]:[line(cel<6||cel>=18?primary:secondary)]}))});
  layers.push({id:`${prefix}-moving`,name:`Moving original ${index+1}`,keys:[pose(0,400,230),pose(95,500,230)],kind:'drawing',cels:[{frame:0,strokes:[line(PALETTE[(index+1)%6])]}]});
  layers.push({id:`${prefix}-control`,name:`Stationary original ${index+1}`,keys:[pose(0,50,50)],kind:'drawing',cels:[{frame:0,strokes:[line(PALETTE[(index+2)%6])]}]});
  layers.push({id:`${prefix}-budget`,name:`Offstage point budget ${index+1}`,keys:[pose(0,0,0)],kind:'drawing',cels:[{frame:0,strokes:filler()}]});
  return{schemaVersion:2,title:`Original library artwork ${index+1}`.padEnd(48,'.'),background:index===7?'#000000':'#FFFFFF',frameCount:96,layers};
}
function tune(project,index){
  let missing=PROJECT_BYTES-bytesOf(project).length;
  project.title+='q'.repeat(missing%4);missing=PROJECT_BYTES-bytesOf(project).length;
  for(let image=0;image<4;image++){
    const asset=project.layers[image].image,old=asset.dataUrl.length;
    const add=Math.min(missing,Math.floor((IMAGE_URL_CHARS-old)/4)*4);
    if(!add)continue;
    const desired=old+add,color=PALETTE[(index+image)%6];
    // Base64 output length is in four-character increments; choose the first
    // original padded PNG length that gives exactly the desired data URL size.
    let padding=Math.floor((desired-22)/4)*3-originalPng(color,1).length+1;
    let png=originalPng(color,padding,31*index+image);
    while(22+4*Math.ceil(png.length/3)>desired)png=originalPng(color,--padding,31*index+image);
    while(22+4*Math.ceil(png.length/3)<desired)png=originalPng(color,++padding,31*index+image);
    asset.dataUrl='data:image/png;base64,'+png.toString('base64');
    assert.equal(asset.dataUrl.length,desired);assert(desired<=IMAGE_URL_CHARS);missing-=add;
  }
  assert.equal(missing,0);assert.equal(bytesOf(project).length,PROJECT_BYTES);assert(project.title.length<=80);return project;
}
function counts(project){
  const drawings=project.layers.filter(x=>x.kind==='drawing'),strokes=drawings.flatMap(x=>x.cels.flatMap(c=>c.strokes));
  return{layers:project.layers.length,images:project.layers.filter(x=>x.kind==='image').length,cels:drawings.reduce((n,x)=>n+x.cels.length,0),strokes:strokes.length,points:strokes.reduce((n,s)=>n+s.points.length,0),longestStroke:Math.max(...strokes.map(s=>s.points.length))};
}
// Standalone PNG decode including filters0..4 for later actual native exports.
function decodePng(bytes){
  assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  let at=8,width,height,channels;const pieces=[];
  while(at<bytes.length){
    const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),end=at+length+12;assert(end<=bytes.length);
    assert.equal(crc(bytes.subarray(at+4,end-4)),bytes.readUInt32BE(end-4));
    if(type==='IHDR'){width=bytes.readUInt32BE(at+8);height=bytes.readUInt32BE(at+12);assert.equal(bytes[at+16],8);channels=bytes[at+17]===6?4:bytes[at+17]===2?3:0;assert(channels);assert.equal(bytes[at+20],0);}
    if(type==='IDAT')pieces.push(bytes.subarray(at+8,end-4));at=end;
    if(type==='IEND'){assert.equal(at,bytes.length);break;}
  }
  const raw=inflateSync(Buffer.concat(pieces)),stride=width*channels,decoded=Buffer.alloc(width*height*channels);assert.equal(raw.length,height*(stride+1));
  const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert(filter<=4);for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?decoded[i-channels]:0,b=y?decoded[i-stride]:0,c=y&&x>=channels?decoded[i-stride-channels]:0;decoded[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
  const output=Buffer.alloc(width*height*4);for(let p=0;p<width*height;p++){decoded.copy(output,p*4,p*channels,p*channels+3);output[p*4+3]=channels===4?decoded[p*channels+3]:255;}return{width,height,rgba:output};
}
function expectedPatches(index,frame){
  const primary=PALETTE[index],secondary=index===6?'#FF0000':index===7?'#00FF00':PALETTE[(index+3)%6],background=index===7?'#000000':'#FFFFFF';
  const held=frame<24||frame>=72?primary:frame<48?secondary:background;
  return[
    {x:150+12*index,y:140,color:rgba(held),label:'held artwork'},
    {x:Math.floor(400+100*frame/95),y:230,color:rgba(PALETTE[(index+1)%6]),label:'linear moving stroke'},
    {x:50,y:50,color:rgba(PALETTE[(index+2)%6]),label:'stationary control'},
    {x:600,y:40,color:rgba(background),label:'untouched background'},
    ...Array.from({length:4},(_,i)=>({x:70+90*i,y:300,color:rgba(PALETTE[(index+i)%6]),label:`original PNG ${i+1}`})),
  ];
}
function inspectFrame(raster,index,frame){
  assert.equal(raster.width,640);assert.equal(raster.height,360);
  for(const patch of expectedPatches(index,frame))for(let y=patch.y-2;y<=patch.y+2;y++)for(let x=patch.x-2;x<=patch.x+2;x++)
    assert.deepEqual([...raster.rgba.subarray((y*640+x)*4,(y*640+x)*4+4)],patch.color,`project${index+1} frame${frame}: ${patch.label}`);
}
function inspectGif(bytes,index){
  const frames=decompressFrames(parseGIF(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),true);assert.equal(frames.length,96);
  let duration=0;for(let f=0;f<96;f++){
    const frame=frames[f];assert.deepEqual(frame.dims,{top:0,left:0,width:640,height:360});
    assert.equal(frame.delay,10*(Math.round((f+1)*100/12)-Math.round(f*100/12)));duration+=frame.delay;
    inspectFrame({width:640,height:360,rgba:frame.patch},index,f);
  }
  assert.equal(duration,8000);const loop=bytes.indexOf(Buffer.from('NETSCAPE2.0'));assert(loop>=0);assert.deepEqual([...bytes.subarray(loop+11,loop+16)],[3,1,0,0,0]);
  return{frames:96,durationMs:duration,frameHashes:frames.map(frame=>sha(frame.patch))};
}
async function main(){
  if(!process.argv.includes('--fixtures-only')){await runLibrary();return;}
  const out=resolve(process.env.MOTION_LIBRARY_OUTPUT||'/workspace/motion104-frozen-fixtures');await mkdir(out,{recursive:false});
  const receipt={schemaVersion:1,status:'fixtures-frozen',projectCount:8,bytesPerProject:PROJECT_BYTES,totalProjectBytes:8*PROJECT_BYTES,
    expectedCountsPerProject:{layers:8,images:4,cels:27,strokes:100,points:10000,longestStroke:1000},
    rasterOracle:{size:[640,360],patchSize:[5,5],exactRGBA:true,heldCuts:[24,48,72],movingCenterFormula:'400+100*frame/95',pngFrames:[0,23,24,47,48,71,72,95],gifFrames:96,gifDurationMs:8000,repeat:'infinite'},
    projects:[],limitations:['Ancillary PNG padding exercises admitted byte capacity; it is not complex high-detail artwork.','Eight independent per-project exports are required; a combined single-project image does not prove library retention.','No storage/main/library producer code or expected-value imports were read.','No browser, build, model admission or runtime export has been executed by fixtures-only.','No RSS or disk quota guarantee is inferred from serialized totals.']};
  for(let index=0;index<8;index++){
    const project=tune(literalProject(index),index),bytes=bytesOf(project),name=`original-${index+1}.motion.json`;
    assert.deepEqual(counts(project),receipt.expectedCountsPerProject);await writeFile(join(out,name),bytes);
    const images=project.layers.filter(x=>x.kind==='image').map((layer,image)=>{
      const png=Buffer.from(layer.image.dataUrl.split(',')[1],'base64'),raster=decodePng(png);assert.equal(raster.width,800);assert.equal(raster.height,800);
      const wanted=rgba(PALETTE[(index+image)%6]);for(const offset of[0,(400*800+400)*4,(800*800-1)*4])assert.deepEqual([...raster.rgba.subarray(offset,offset+4)],wanted);
      return{id:layer.id,bytes:png.length,sha256:sha(png),color:wanted};
    });
    receipt.projects.push({index,file:name,title:project.title,renameTitle:project.title.replace('Original','Retained'),bytes:bytes.length,sha256:sha(bytes),images,expectedFrames:receipt.rasterOracle.pngFrames.map(frame=>({frame,patches:expectedPatches(index,frame)}))});
  }
  assert.equal(new Set(receipt.projects.map(x=>x.sha256)).size,8);assert.equal(receipt.totalProjectBytes,50332992);
  await writeFile(join(out,'frozen-expectations.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,out,projectCount:8,bytesPerProject:PROJECT_BYTES,totalProjectBytes:receipt.totalProjectBytes}));
}
// Keep the original decode/pixel oracle available to the later coordinated UI
// runner without executing it against producer output during fixture generation.
export {decodePng,inspectFrame,inspectGif};
main().catch(error=>{console.error(error);process.exitCode=1;});

// Runtime consumes frozen original files and the literal independent raster
// oracle above. Native UI only: no direct IDB reads/writes or application imports.
async function download(page,selector,path){
  const pending=page.waitForEvent('download',{timeout:60000});await page.locator(selector).click();
  const file=await pending;await file.saveAs(path);return readFile(path);
}
async function seek(page,frame){
  await page.locator('#frame').focus();await page.keyboard.press('Home');
  for(let i=0;i<frame;i++)await page.keyboard.press('ArrowRight');
  await expect(page.locator('#stage')).toHaveAttribute('data-frame',String(frame));
}
async function processIdentity(context){
  const session=await context.browser().newBrowserCDPSession();
  try{return(await session.send('SystemInfo.getProcessInfo')).processInfo.filter(item=>item.type==='browser').map(item=>item.id);}finally{await session.detach();}
}
async function runLibrary(){
  assert(process.argv.includes('--run-existing'),'Use --fixtures-only first, then --run-existing for the authorized native gate.');
  const fixtureRoot=resolve(process.env.MOTION_LIBRARY_FIXTURES||'/workspace/motion104-frozen-fixtures');
  const frozenBytes=await readFile(join(fixtureRoot,'frozen-expectations.json'));
  assert.equal(sha(frozenBytes),'824ae972accd8a076c43f911f88a24e432e592c0005e5b801337b1850d535f75','Frozen expectations changed.');
  const frozen=JSON.parse(frozenBytes),originals=[];
  for(const item of frozen.projects){const bytes=await readFile(join(fixtureRoot,item.file));assert.equal(bytes.length,PROJECT_BYTES);assert.equal(sha(bytes),item.sha256);originals.push(bytes);}
  const baseURL=process.env.MOTION_LIBRARY_BASE_URL;assert(baseURL,'Set MOTION_LIBRARY_BASE_URL to the root-owned production preview. This runner never starts a server/build.');
  const origin=new URL(baseURL).origin;assert(['127.0.0.1','localhost'].includes(new URL(baseURL).hostname));
  const out=resolve(process.env.MOTION_LIBRARY_OUTPUT||'/workspace/motion104-maximum-final');await mkdir(out,{recursive:false});
  const evidence={schemaVersion:1,status:'running',fixtureRoot,frozenExpectationsSha256:sha(frozenBytes),scriptSha256:sha(await readFile(new URL(import.meta.url))),
    totalProjectBytes:frozen.totalProjectBytes,entries:[],checks:[],artifacts:[],browserProcesses:[],pageErrors:[],externalRequests:[],
    limitations:['50,332,992 serialized payload bytes is not an RSS/quota guarantee.','Original large PNGs contain declared ancillary capacity padding.','No producer expected-value imports or storage injection; all raster checks use original coordinates/colors.']};
  const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(evidence,null,2)+'\n');
  const began=performance.now();let context,page;
  const launch={headless:true,acceptDownloads:true,viewport:{width:1280,height:1000},...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})};
  const mount=async()=>{
    context=await chromium.launchPersistentContext(join(out,'profile'),launch);page=context.pages()[0];
    page.on('pageerror',error=>evidence.pageErrors.push(error.message));
    page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)evidence.externalRequests.push(request.url());});
    page.on('dialog',dialog=>dialog.accept());evidence.browserVersion=context.browser().version();
    evidence.browserProcesses.push(...await processIdentity(context));await page.goto(baseURL);await expect(page.locator('#project-library')).toBeVisible();
  };
  const rows=()=>page.locator('#project-library-list [data-project-id]');
  const row=id=>page.locator(`#project-library-list [data-project-id="${id}"]`);
  const settled=async title=>{
    await expect(page.locator('#project-title')).toHaveValue(title);await expect(page.locator('#stage')).toHaveAttribute('aria-disabled','false');
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser',{timeout:20000});
  };
  const backup=async(name,expected)=>{
    const bytes=await download(page,'#backup',join(out,name));assert(bytes.equals(expected),`Native portable backup differs: ${name}`);
    evidence.artifacts.push({kind:'editable-backup',file:name,bytes:bytes.length,sha256:sha(bytes)});return bytes;
  };
  const openEntry=async(entry,title=entry.title)=>{
    await row(entry.id).locator('[data-library-action="open"]').click();await expect(row(entry.id)).toHaveAttribute('aria-current','true');await settled(title);
    await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
  };
  try{
    await mount();
    for(let index=0;index<8;index++){
      await page.locator('#project-file-action').selectOption('new');await expect(page.locator('#project-file')).toBeEnabled();
      await page.locator('#project-file').setInputFiles({name:frozen.projects[index].file,mimeType:'application/json',buffer:originals[index]});
      await expect(rows()).toHaveCount(index+1);await settled(frozen.projects[index].title);
      const current=page.locator('#project-library-list [data-project-id][aria-current="true"]');await expect(current).toHaveCount(1);
      const id=await current.getAttribute('data-project-id');assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id));
      evidence.entries.push({index,id,title:frozen.projects[index].title,bytes:PROJECT_BYTES,sha256:frozen.projects[index].sha256});
      await backup(`imported-${index+1}.motion.json`,originals[index]);
    }
    assert.equal(new Set(evidence.entries.map(x=>x.id)).size,8);evidence.checks.push('Eight exact-cap originals imported by native File input as separate editable entries.');
    const eighth=evidence.entries[7],renamed=JSON.parse(originals[7]);renamed.title=frozen.projects[7].renameTitle;
    const renamedBytes=bytesOf(renamed);assert.equal(renamedBytes.length,PROJECT_BYTES);
    await page.locator('#project-title').fill(renamed.title);await page.locator('#project-title').press('Tab');await settled(renamed.title);
    await expect(row(eighth.id).locator('[data-project-title]')).toHaveText(renamed.title);await backup('renamed-eighth.motion.json',renamedBytes);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await settled(eighth.title);await backup('rename-undo.motion.json',originals[7]);
    await page.getByRole('button',{name:'Redo',exact:true}).click();await settled(renamed.title);await backup('rename-redo.motion.json',renamedBytes);
    await openEntry(evidence.entries[0]);await backup('first-unaffected-by-eighth-edit.motion.json',originals[0]);
    await openEntry(eighth,renamed.title);await backup('reopened-renamed-eighth.motion.json',renamedBytes);
    await page.locator('#project-title').fill(eighth.title);await page.locator('#project-title').press('Tab');await settled(eighth.title);await backup('eighth-original-restored.motion.json',originals[7]);
    evidence.checks.push('Same-length rename is one Undo/Redo, persists only to its owner, and switching resets session history; original title restored before artwork exports.');
    const rejected=[];
    if(await page.locator('#duplicate-project').isEnabled()){
      await page.locator('#duplicate-project').click();await expect(page.locator('#message')).toContainText(/eight|8|full|limit|capacity/i);rejected.push('duplicate attempted and rejected');
    }else{await expect(page.locator('#duplicate-project')).toBeDisabled();rejected.push('duplicate blocked by disabled full-capacity control');}
    await expect(rows()).toHaveCount(8);await backup('after-full-duplicate.motion.json',originals[7]);
    if(await page.locator('#project-file').isEnabled()){
      await page.locator('#project-file').setInputFiles({name:'ninth-original.motion.json',mimeType:'application/json',buffer:originals[0]});
      await expect(page.locator('#message')).toContainText(/eight|8|full|limit|capacity/i);rejected.push('ninth File import attempted and rejected');
    }else{await expect(page.locator('#project-file')).toBeDisabled();rejected.push('ninth File import blocked by disabled full-capacity control');}
    await expect(rows()).toHaveCount(8);await backup('after-ninth-import.motion.json',originals[7]);evidence.capacity=rejected;
    const firstPid=evidence.browserProcesses[0];await context.close();context=undefined;await mount();assert.notEqual(evidence.browserProcesses.at(-1),firstPid);
    await expect(rows()).toHaveCount(8);await expect(row(eighth.id)).toHaveAttribute('aria-current','true');await settled(eighth.title);
    assert.deepEqual(await rows().evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-project-id'))),evidence.entries.map(x=>x.id));
    for(const entry of evidence.entries){
      await openEntry(entry);await backup(`restart-project-${entry.index+1}.motion.json`,originals[entry.index]);const exports=[];
      for(const frame of frozen.rasterOracle.pngFrames){
        await seek(page,frame);const name=`project-${entry.index+1}-frame-${frame}.png`,bytes=await download(page,'#png',join(out,name));
        inspectFrame(decodePng(bytes),entry.index,frame);exports.push({kind:'png',frame,file:name,bytes:bytes.length,sha256:sha(bytes)});
      }
      const started=performance.now(),name=`project-${entry.index+1}-96frames.gif`,bytes=await download(page,'#gif',join(out,name));
      const encodeAndDownloadMs=performance.now()-started,decodeStarted=performance.now(),decoded=inspectGif(bytes,entry.index);
      exports.push({kind:'gif',file:name,bytes:bytes.length,sha256:sha(bytes),encodeAndDownloadMs,independentDecodeMs:performance.now()-decodeStarted,...decoded});entry.exports=exports;await save();
    }
    evidence.checks.push('Full Chromium process restart preserves all eight IDs/order/active pointer and byte-exact original backups.');
    evidence.checks.push('All eight reopened projects produce eight independently checked PNG boundary frames and96 GIF frames with original artwork/pixels and8,000ms timing.');
    await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>window.document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:join(out,'mobile-390.png'),fullPage:true});
    assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.externalRequests,[]);evidence.status='passed';evidence.wallMs=performance.now()-began;await save();
    console.log(JSON.stringify({status:evidence.status,out,projectCount:8,totalProjectBytes:frozen.totalProjectBytes,pngExports:64,gifFrames:768,wallMs:evidence.wallMs}));
  }catch(error){evidence.status='failed';evidence.failure={name:error.name,message:error.message,stack:error.stack};throw error;}
  finally{await context?.close();evidence.allOwnedBrowserContextsClosed=true;await save();}
}
