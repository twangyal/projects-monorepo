import {test,expect} from '@playwright/test';
import {writeFile,stat} from 'node:fs/promises';
import {blockingFilm,legacyFilm,openFilm,backup,downloaded,raw,edit,seek,frames,canvasFrame,costume,verifyCostume,holdReads,pendingImport,releaseRead,decodeBlockingVideo,KEY} from './blocking-fixtures.js';
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const cue=(page,time)=>page.locator(`#performerCues [data-cue-time="${time}"]`);
const failures=new WeakMap();
test.beforeEach(({page,baseURL})=>{const errors=[],external=[];failures.set(page,{errors,external});page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==new URL(baseURL).origin)external.push(request.url());});});
test.afterEach(({page})=>{expect(failures.get(page)).toEqual({errors:[],external:[]});});

test('performer blocking is an explicit editable mode with native arrival hold wave departure authoring and history',async({page})=>{
  await openFilm(page,legacyFilm());await expect(page.getByRole('combobox',{name:'Performer motion',exact:true})).toHaveValue('loop');
  await page.locator('#performanceMode').selectOption('blocking');await expect(cue(page,0)).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#cueTime')).toHaveValue('0');await expect(page.locator('#removeCue')).toBeDisabled();
  for(const [time,x,action,visible] of [[1.5,-.4,'idle',true],[3,-.4,'wave',true],[4.5,-.4,'idle',true],[5.5,.8,'idle',false]]){
    await seek(page,time);const before=await backup(page);await button(page,'Add cue at preview').click();
    let current=await backup(page);expect(current.actors[0].cues).toHaveLength(before.actors[0].cues.length+1);await expect(cue(page,time)).toHaveAttribute('aria-pressed','true');
    await button(page,'Undo scene').click();expect(await backup(page)).toEqual(before);await button(page,'Redo scene').click();await cue(page,time).click();
    await edit(page,'actorX',x);await page.locator('#action').selectOption(action);await page.locator('#cueVisible').setChecked(visible);
    current=await backup(page);expect(current.actors[0].cues.at(-1)).toEqual({time,x,z:0,action,visible});
  }
  const film=await backup(page);expect(film.schemaVersion).toBe(3);expect(film.actors[0]).toEqual(blockingFilm().actors[0]);
  const exportFile=await downloaded(page);await page.locator('#import').setInputFiles(exportFile.path);expect(await backup(page)).toEqual(film);
  await page.reload();expect(await backup(page)).toEqual(film);await expect(page.locator('#performerCues button')).toHaveCount(5);
});

test('cue editing selection is separate from global preview and exact hard cuts',async({page})=>{
  const film=blockingFilm();film.shots=[{...film.shots[0],name:'First global half',duration:3,cameraMode:'linear',endEye:[0,2.2,8],endTarget:[0,1.15,0]},{...film.shots[0],name:'Second global half',duration:3}];
  await openFilm(page,film);await seek(page,4.8);await cue(page,1.5).click();await expect(page.locator('#time')).toHaveText('4.80 / 6.00s');await expect(page.locator('#cueLabel')).toContainText(/1\.5/);
  await button(page,'Preview cue').click();await expect(page.locator('#time')).toHaveText('1.50 / 6.00s');
  await cue(page,3).click();await button(page,'Preview cue').click();await expect(page.locator('#time')).toHaveText('3.00 / 6.00s');await expect(page.locator('#shotLabel')).toContainText('CAMERA 02');
  await page.locator('#cameraEndpoint').selectOption('end');await button(page,'Preview endpoint').click();await expect(page.locator('#time')).toHaveText('3.00 / 6.00s');await expect(page.locator('#shotLabel')).toContainText(/endpoint/i);
  await page.locator('#shots button').nth(1).click();await button(page,'Move earlier').click();expect((await backup(page)).actors).toEqual(film.actors);
  await button(page,'Undo scene').click();expect(await backup(page)).toEqual(film);
});

test('literal wave phase produces distinct real WebGL limb envelopes while held root and stationary control stay fixed',async({page},info)=>{
  await openFilm(page);const measurements=[];
  // sin(pi/2)=1 -> arm1.3; sin(3pi/2)=-1 -> arm.3, both at the same root.
  for(const [time,angle] of [[3+Math.PI/12,1.3],[3+Math.PI/4,.3]]){
    await seek(page,time);const frame=await canvasFrame(page);const red=costume(frame.pixels,frame.width,frame.height,'red'),green=costume(frame.pixels,frame.width,frame.height,'green');
    verifyCostume(red,-.4,{arm:angle,tolerance:5,centroid:false});verifyCostume(green,1.8,{tolerance:5});measurements.push({time,angle,red,green});
  }
  expect((measurements[0].red.maxX-measurements[0].red.minX)-(measurements[1].red.maxX-measurements[1].red.minX)).toBeGreaterThanOrEqual(16);
  expect(Math.abs(measurements[0].green.x-measurements[1].green.x)).toBeLessThanOrEqual(1);
  await seek(page,5.5);const hidden=await canvasFrame(page);expect(costume(hidden.pixels,960,540,'red').count).toBeLessThanOrEqual(20);verifyCostume(costume(hidden.pixels,960,540,'green'),1.8,{tolerance:5});
  await writeFile(info.outputPath('independent-wave-pixels.json'),JSON.stringify(measurements,null,2));
});

test('mode conversion explicitly retains first cue and cancellation plus Undo retain the whole scheduled performance',async({page})=>{
  await openFilm(page);const original=await backup(page);await cue(page,5.5).click();
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#performanceMode').selectOption('loop');expect(await backup(page)).toEqual(original);await expect(page.locator('#performanceMode')).toHaveValue('blocking');await expect(cue(page,5.5)).toHaveAttribute('aria-pressed','true');
  page.once('dialog',async dialog=>{expect(dialog.message()).toMatch(/first/i);expect(dialog.message()).toMatch(/undo/i);await dialog.accept();});await page.locator('#performanceMode').selectOption('loop');
  expect((await backup(page)).actors[0]).toEqual({name:'Scarlet performer',color:'#ff0000',performanceMode:'loop',x:-1.6,z:0,action:'idle'});
  await button(page,'Undo scene').click();expect(await backup(page)).toEqual(original);await button(page,'Redo scene').click();await page.locator('#performanceMode').selectOption('blocking');
  expect((await backup(page)).actors[0].cues).toEqual([{time:0,x:-1.6,z:0,action:'idle',visible:true}]);
});

test('invalid cue drafts protect selection history preview export and shortening until explicit discard',async({page})=>{
  await openFilm(page);await edit(page,'title','Preserved redo title');await button(page,'Undo scene').click();const before=await backup(page),durable=await raw(page);
  await cue(page,1.5).click();await edit(page,'cueTime','');await expect(page.locator('#cueTime')).toHaveValue('');
  for(const name of ['Add cue at preview','Remove cue','Preview cue','Undo scene','Export WebM']){const control=button(page,name);if(await control.isEnabled())await control.click();await expect(page.locator('#cueTime')).toHaveValue('');expect(await raw(page)).toBe(durable);}
  await page.locator('#actor').selectOption('1');await expect(page.locator('#actor')).toHaveValue('0');await expect(page.locator('#cueTime')).toHaveValue('');
  await seek(page,4);await expect(page.locator('#time')).toHaveText('4.00 / 6.00s');await expect(page.locator('#cueTime')).toHaveValue('');expect(await backup(page)).toEqual(before);
  page.once('dialog',dialog=>dialog.accept());await button(page,'Discard unsent edits').click();await expect(button(page,'Redo scene')).toBeEnabled();
  await page.locator('#performanceMode').selectOption('blocking');await expect(button(page,'Redo scene')).toBeEnabled();await button(page,'Redo scene').click();await expect(page.locator('#title')).toHaveValue('Preserved redo title');
  const full=await backup(page);await edit(page,'duration',5);await expect(page.locator('#duration')).toHaveValue('5');expect(await backup(page)).toEqual(full);
  page.once('dialog',dialog=>dialog.accept());await button(page,'Discard unsent edits').click();await cue(page,5.5).click();await button(page,'Remove cue').click();await edit(page,'duration',5);
  expect((await backup(page)).shots[0].duration).toBe(5);expect((await backup(page)).actors[0].cues.map(c=>c.time)).toEqual([0,1.5,3,4.5]);
});

for(const [field,value] of [['cueTime','1.750'],['actorX','0.250']]){
  test(`pending genuine File completion cannot replace focused ${field} input before blur`,async({page})=>{
    await holdReads(page);await openFilm(page);await cue(page,1.5).click();const durable=await raw(page);await pendingImport(page);await page.locator(`#${field}`).fill(value);
    expect(await page.evaluate(()=>window.blockingRead.changes)).toBe(0);await releaseRead(page);await expect(page.locator('#status')).toContainText(/scene changed while opening/i);
    await expect(page.locator(`#${field}`)).toHaveValue(value);await expect(page.locator(`#${field}`)).toBeFocused();expect(await raw(page)).toBe(durable);
    expect(await page.evaluate(()=>window.blockingRead.inputs)).toBe(1);expect(await page.evaluate(()=>window.blockingRead.changes)).toBe(0);
    await page.locator(`#${field}`).press('Tab');const saved=await backup(page);expect(saved.actors[0].cues.some(c=>field==='cueTime'?c.time===1.75:c.time===1.5&&c.x===.25)).toBe(true);
  });
}

for(const version of [1,2]){
  test(`literal schema${version} draft migrates actors only in memory and the next cue edit writes schema3`,async({page})=>{
    const old=legacyFilm(version),text=JSON.stringify(old,null,2)+'\n';await page.addInitScript(({key,text})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,text);},{key:KEY,text});await page.goto('/');
    const migrated=await backup(page);expect(migrated.schemaVersion).toBe(3);expect(migrated.actors).toEqual(old.actors.map(actor=>({...actor,performanceMode:'loop'})));expect(await raw(page)).toBe(text);
    await page.locator('#performanceMode').selectOption('blocking');expect(JSON.parse(await raw(page)).schemaVersion).toBe(3);await page.reload();await expect(page.locator('#performanceMode')).toHaveValue('blocking');
  });
}

test('controlled XR repeatedly places only the captured editing cue rather than playhead or another performer',async({page})=>{
  await page.addInitScript(()=>{WebGLRenderingContext.prototype.makeXRCompatible=async()=>{};window.XRWebGLLayer=class{};
    Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:async()=>true,requestSession:async()=>{const session=new EventTarget();session.end=async()=>session.dispatchEvent(new Event('end'));session.updateRenderState=()=>{};session.requestReferenceSpace=async type=>({type});session.requestAnimationFrame=()=>{};window.blockingXR=session;return session;}}});
    window.placeBlocking=(x,z,hit=true)=>{const event=new Event('select');event.inputSource={targetRaySpace:{type:'ray'}};event.frame={getPose:()=>hit?{transform:{matrix:[1,0,0,0,0,0,1,0,0,1,0,0,x,2,z,1]}}:null};window.blockingXR.dispatchEvent(event);};});
  await openFilm(page);await cue(page,1.5).click();await seek(page,4.8);const original=await backup(page);await button(page,'Enter VR').click();await expect(page.locator('#status')).toContainText('VR active');
  for(const id of ['performanceMode','actor','cueTime','addCue','removeCue','previewCue','undo','import'])await expect(page.locator(`#${id}`)).toBeDisabled();
  const durable=await raw(page);await page.evaluate(()=>window.placeBlocking(1,1,false));expect(await raw(page)).toBe(durable);
  await page.evaluate(()=>window.placeBlocking(.2,-.5));await page.evaluate(()=>window.placeBlocking(.7,-.8));await button(page,'Exit VR').click();
  const placed=await backup(page),expected=structuredClone(original);Object.assign(expected.actors[0].cues[1],{x:.7,z:-.8});expect(placed).toEqual(expected);
  await button(page,'Undo scene').click();expect((await backup(page)).actors[0].cues[1]).toMatchObject({x:.2,z:-.5,time:1.5,action:'idle',visible:true});await button(page,'Undo scene').click();expect(await backup(page)).toEqual(original);
});

test('native export cancellation locks authored controls and releases capture without changing film or downloading',async({page})=>{
  await openFilm(page);const original=await backup(page),durable=await raw(page),downloads=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
  await button(page,'Export WebM').click();for(const id of ['performanceMode','cueTime','cueVisible','addCue','removeCue','previewCue','actorX','import'])await expect(page.locator(`#${id}`)).toBeDisabled();
  await button(page,'Cancel export').click();await expect(button(page,'Rehearse')).toBeEnabled();await frames(page);expect(downloads).toEqual([]);expect(await raw(page)).toBe(durable);expect(await backup(page)).toEqual(original);
});

test('actual decoded WebM follows frozen independent arrival hold departure visibility and control projections',async({page},info)=>{
  await openFilm(page);await cue(page,3).click();await button(page,'Preview cue').click();const original=await backup(page),durable=await raw(page);
  const pending=page.waitForEvent('download');await button(page,'Export WebM').click();await expect(page.locator('#performanceMode')).toBeDisabled();const file=await pending,path=info.outputPath('original-blocking.webm');await file.saveAs(path);
  const bytes=(await stat(path)).size;expect(bytes).toBeGreaterThan(8192);expect(bytes).toBeLessThan(8*1024**2);const measurements=decodeBlockingVideo(path);
  await writeFile(info.outputPath('decoded-blocking-measurements.json'),JSON.stringify({...measurements,bytes},null,2));await expect(button(page,'Rehearse')).toBeEnabled();expect(await backup(page)).toEqual(original);expect(await raw(page)).toBe(durable);
});

test('mobile keyboard cue selection and exact off-step coordinate edits stay usable without changing preview time',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await openFilm(page);await seek(page,2.4);await cue(page,1.5).focus();await page.keyboard.press('Enter');await expect(page.locator('#time')).toHaveText('2.40 / 6.00s');
  await edit(page,'actorX','0.125');expect((await backup(page)).actors[0].cues[1].x).toBe(.125);await button(page,'Preview cue').focus();await page.keyboard.press('Enter');await expect(page.locator('#time')).toHaveText('1.50 / 6.00s');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('blocking-mobile.png'),fullPage:true});
});

test('legacy actor records containing new performer fields remain protected raw recovery bytes',async({page})=>{
  const malformed=legacyFilm(2);malformed.actors[0].performanceMode='loop';const text=JSON.stringify(malformed,null,2)+'\n';
  await page.addInitScript(({key,text})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,text);},{key:KEY,text});
  await page.goto('/');await expect(page.locator('#status')).toContainText(/preserved|blocked/i);expect(await raw(page)).toBe(text);
  expect(JSON.parse((await downloaded(page,'Download unreadable draft')).bytes.toString())).toEqual({schemaVersion:1,kind:'unreadable-shot-studio-draft',storageKey:KEY,raw:text});
  await page.locator('#import').setInputFiles({name:'canonical-blocking.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(blockingFilm()))});await expect(page.locator('#title')).toHaveValue(blockingFilm().title);
  await seek(page,2.25);await button(page,'Add cue at preview').click();expect((await backup(page)).actors[0].cues.map(c=>c.time)).toEqual([0,1.5,2.25,3,4.5,5.5]);expect(await raw(page)).toBe(text);
  page.once('dialog',dialog=>dialog.dismiss());await button(page,'Replace browser draft').click();expect(await raw(page)).toBe(text);
});
