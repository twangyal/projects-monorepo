import {test,expect,chromium} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createProject} from '../../src/model.js';

const stored=page=>page.evaluate(()=>localStorage.getItem('shot-studio-sequence-v1'));
async function ready(page){await page.goto('/');await expect(page.locator('#status')).toContainText('Ready');await expect(page.locator('#sequence-capture-scene')).toBeVisible({timeout:1000});}
async function downloadText(page,button){const event=page.waitForEvent('download');await page.locator(button).click();return readFile(await (await event).path(),'utf8');}
test('capture scenes, sequence whole shots, repeat/reorder/undo and portable restore without scene changes',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
  await page.locator('#sequence-capture-scene').click();await expect(page.locator('#sequence-source')).toHaveCount(1);
  await expect(page.locator('#sequence-source option')).toHaveCount(1);
  await page.locator('#sequence-shot').selectOption('1');await page.locator('#sequence-add').click();
  const captured=JSON.parse(await stored(page));expect(captured.clips).toEqual([{sourceId:'s1',shotIndex:1}]);
  await page.locator('#title').fill('Changed scene');await page.locator('#title').press('Tab');
  const scene=await page.evaluate(()=>localStorage.getItem('shot-studio-v1'));
  await page.locator('#sequence-capture-scene').click();await page.locator('#sequence-shot').selectOption('0');await page.locator('#sequence-add').click();
  await page.locator('#sequence-repeat').click();await expect(page.locator('#sequence-clips button')).toHaveCount(3);
  await page.locator('#sequence-earlier').click();await page.locator('#sequence-remove').click();
  await expect(page.locator('#sequence-clips button')).toHaveCount(2);await page.locator('#sequence-undo').click();await expect(page.locator('#sequence-clips button')).toHaveCount(3);
  const backup=await downloadText(page,'#sequence-save');const p=JSON.parse(backup);
  expect(p.sources[0].film.title).toBe('The arrival');expect(p.sources[1].film.title).toBe('Changed scene');
  await page.locator('#sequence-title').fill('Temporary');await page.locator('#sequence-title').press('Tab');
  await page.locator('#sequence-open').setInputFiles({name:'cut.shot-sequence.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await expect(page.locator('#sequence-title')).toHaveValue(p.title);
  expect(await stored(page)).toBe(JSON.stringify(p));expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(scene);
  await page.reload();await expect(page.locator('#sequence-clips button')).toHaveCount(3);
  expect(JSON.parse(await stored(page))).toEqual(p);expect(errors).toEqual([]);
});
test('source shot preview uses original time and renders actual different source pixels at the exact cut',async({page})=>{
  await ready(page);const film=createProject();film.light=.4;film.shots[0].duration=2;
  film.shots[1].duration=2;film.actors[0]={name:'Timed',color:'#ff0000',performanceMode:'blocking',cues:[
    {time:0,x:-3,z:0,action:'idle',visible:true},{time:2,x:0,z:0,action:'wave',visible:true},{time:4,x:3,z:0,action:'idle',visible:false}]};
  await page.locator('#sequence-import-scene').setInputFiles({name:'red.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(film))});
  await expect(page.locator('#sequence-source option')).toHaveCount(1);
  await page.locator('#sequence-shot').selectOption('1');await page.locator('#sequence-add').click();
  await expect(page.locator('#sequence-clock')).toContainText('source 2.00');
  const first=await page.locator('#sequence-stage').screenshot();
  const blue=structuredClone(film);blue.title='Bright blue';blue.light=2;blue.actors[0].color='#0000ff';
  await page.locator('#sequence-import-scene').setInputFiles({name:'blue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(blue))});
  await expect(page.locator('#sequence-source option')).toHaveCount(2);
  await page.locator('#sequence-shot').selectOption('1');await page.locator('#sequence-add').click();
  await page.locator('#sequence-scrub').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#sequence-clock')).toContainText('source 2.00');await expect(page.locator('#sequence-clock')).toContainText('clip 2');
  expect(await page.locator('#sequence-stage').screenshot()).not.toEqual(first);
  await page.locator('#sequence-export').click();const event=page.waitForEvent('download');const file=await event;const path=await file.path();
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',path],{encoding:'utf8'}));
  expect(probe.streams[0].width).toBe(960);expect(probe.streams[0].height).toBe(540);expect(Number(probe.streams[0].nb_read_frames)).toBeGreaterThan(60);
  const pixelCounts=seconds=>{
    const bytes=execFileSync('ffmpeg',['-v','error','-ss',String(seconds),'-i',path,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:2*1024*1024});
    expect(bytes.length).toBe(960*540*3);let red=0,blue=0;
    for(let i=0;i<bytes.length;i+=3){const [r,g,b]=bytes.subarray(i,i+3);if(r>30&&r>2*g&&r>2*b)red++;if(b>30&&b>2*r&&b>2*g)blue++;}
    return {red,blue};
  };
  const a=pixelCounts(1),b=pixelCounts(3);
  expect(a.red).toBeGreaterThan(50);expect(a.blue).toBe(0);expect(b.blue).toBeGreaterThan(50);expect(b.red).toBe(0);
});
test('raw scene and sequence fields are preserved; stale sequence import cannot replace newer typing',async({page})=>{
  await page.addInitScript(()=>{const native=File.prototype.text;File.prototype.text=async function(){const text=await native.call(this);if(this.name==='delayed.json'){window.sequenceReadReady=true;await new Promise(r=>window.releaseSequenceRead=r);}return text;};});
  await ready(page);await page.locator('#sequence-capture-scene').click();await page.locator('#sequence-add').click();const before=await stored(page);
  await page.locator('#shotName').fill('Raw scene');
  await page.locator('#sequence-save').dispatchEvent('click');await expect(page.locator('#shotName')).toHaveValue('Raw scene');
  const incoming={...JSON.parse(before),title:'Incoming'};
  await page.locator('#sequence-open').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
  await expect.poll(()=>page.evaluate(()=>window.sequenceReadReady)).toBe(true);
  await page.locator('#sequence-title').fill('Raw sequence');await page.evaluate(()=>window.releaseSequenceRead());
  await expect(page.locator('#sequence-status')).toContainText('changed');await expect(page.locator('#sequence-title')).toHaveValue('Raw sequence');
  await expect(page.locator('#sequence-title')).toBeFocused();expect(await stored(page)).toBe(before);
});
test('protected unreadable sequence survives edits, failed writes and canceled replacement',async({page})=>{
  const raw='invalid sequence😺';await page.addInitScript(raw=>localStorage.setItem('shot-studio-sequence-v1',raw),raw);await ready(page);
  await expect(page.locator('#sequence-status')).toContainText('protected');await page.locator('#sequence-capture-scene').click();await page.locator('#sequence-add').click();expect(await stored(page)).toBe(raw);
  const recovery=JSON.parse(await downloadText(page,'#sequence-recovery'));expect(recovery.raw).toBe(raw);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#sequence-replace').click();expect(await stored(page)).toBe(raw);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#sequence-replace').click();expect(JSON.parse(await stored(page)).clips).toHaveLength(1);
});
test('narrow keyboard controls and canceled export keep the complete sequence',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page);await page.locator('#sequence-capture-scene').click();await page.locator('#sequence-add').focus();await page.keyboard.press('Enter');
  const before=await stored(page);await page.locator('#sequence-export').click();await expect(page.locator('#sequence-cancel')).toBeVisible();await page.locator('#sequence-cancel').click();await expect(page.locator('#sequence-status')).toContainText('cancelled');expect(await stored(page)).toBe(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('saved take film remains an independent sequence source after take deletion and scene edits',async({page})=>{
  await ready(page);const film=createProject();film.title='Captured take scene';film.shots=[{...film.shots[0],duration:1}];
  await page.locator('#import').setInputFiles({name:'take-scene.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(film))});
  await expect(page.locator('#title')).toHaveValue(film.title);
  await page.locator('#record-take').click();await expect(page.locator('#take-status')).toContainText('Saved take in this browser',{timeout:15000});
  await page.locator('#sequence-capture-take').click();await page.locator('#sequence-add').click();const before=await stored(page);
  await page.locator('#title').fill('New scene');await page.locator('#title').press('Tab');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#delete-take').click();await expect(page.locator('#take-list button')).toHaveCount(0);
  expect(await stored(page)).toBe(before);expect(JSON.parse(before).sources[0].film).toEqual(film);
  await page.locator('#sequence-play').click();await expect(page.locator('#sequence-clock')).toContainText('Captured take scene');
});
test('maximum four-source twenty-clip minute survives an entire browser restart and actual WebM decoding',async({},testInfo)=>{
  test.setTimeout(140000);const directory=await mkdtemp(join(tmpdir(),'shot-sequence-'));
  const launch=()=>chromium.launchPersistentContext(directory,{headless:true,baseURL:testInfo.project.use.baseURL,acceptDownloads:true,
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  let context;
  try{
    context=await launch();let page=await context.newPage();await ready(page);
    const sources=Array.from({length:4},(_,j)=>{
      const film=createProject();film.title=`Independent scene ${j}`;film.light=.4+j*.4;
      film.shots=Array.from({length:20},(_,i)=>({...structuredClone(film.shots[0]),name:`Shot ${i}`,duration:3}));
      film.actors=film.actors.map((actor,k)=>({name:actor.name,color:actor.color,performanceMode:'blocking',cues:Array.from({length:32},(_,i)=>({time:i*60/31,x:-3+(i%7),z:k,visible:i%3!==1,action:i%2?'wave':'idle'}))}));
      return {id:`s${j}`,name:`Scene ${j}`,film};
    });
    const cut={schemaVersion:1,kind:'shot-studio-sequence',title:'Full bounded cut',sources,clips:Array.from({length:20},(_,i)=>({sourceId:`s${i%4}`,shotIndex:i}))};
    await page.locator('#sequence-open').setInputFiles({name:'max.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(cut))});
    await expect(page.locator('#sequence-clips button')).toHaveCount(20);
    const backup=await downloadText(page,'#sequence-save');expect(JSON.parse(backup)).toEqual(cut);
    await expect(page.locator('#sequence-capture-scene')).toBeDisabled();await expect(page.locator('#sequence-add')).toBeDisabled();
    await context.close();context=await launch();page=await context.newPage();await ready(page);
    expect(await downloadText(page,'#sequence-save')).toBe(backup);await expect(page.locator('#sequence-clips button')).toHaveCount(20);
    const download=page.waitForEvent('download',{timeout:90000});await page.locator('#sequence-export').click();const file=await download,path=await file.path();
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',path],{encoding:'utf8'}));
    expect(probe.streams[0].width).toBe(960);expect(Number(probe.streams[0].nb_read_frames)).toBeGreaterThan(300);
    const frames=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v','-show_entries','frame=best_effort_timestamp_time','-of','json',path],{encoding:'utf8',maxBuffer:4*1024*1024})).frames;
    const span=Number(frames.at(-1).best_effort_timestamp_time)-Number(frames[0].best_effort_timestamp_time);expect(span).toBeGreaterThan(55);
    expect(await downloadText(page,'#sequence-save')).toBe(backup);
    console.log(JSON.stringify({verification:'maximum-sequence-restart-and-decoded-WebM',sources:4,clips:20,seconds:60,backupBytes:Buffer.byteLength(backup),decodedFrames:Number(probe.streams[0].nb_read_frames),decodedSpan:span}));
  }finally{await context?.close();await rm(directory,{recursive:true,force:true});}
});
