import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';

async function holdProjectRead(page){
  await page.addInitScript(()=>{
    const nativeText=File.prototype.text;
    window.projectRead={ready:false,inputEvents:0,changeEvents:0};
    document.addEventListener('input',e=>{if(['shotName','eyeX'].includes(e.target.id))window.projectRead.inputEvents++;});
    document.addEventListener('change',e=>{if(['shotName','eyeX'].includes(e.target.id))window.projectRead.changeEvents++;});
    File.prototype.text=async function(){
      const text=await nativeText.call(this);
      if(this.name==='pending-film.json'&&!window.projectRead.ready){
        window.projectRead.text=text;window.projectRead.ready=true;
        await new Promise(resolve=>{window.releaseProjectRead=resolve;});
      }
      return text;
    };
  });
  await page.goto('/');await expect(page.locator('#status')).toContainText('Ready');
  await page.getByLabel('Film title').fill('Existing authored film');await page.getByLabel('Film title').press('Tab');
  const raw=await page.evaluate(()=>localStorage.getItem('shot-studio-v1'));
  const incoming=JSON.parse(raw);incoming.title='Incoming complete film';incoming.shots[0].name='Imported establishing';incoming.shots[0].eye[0]=8;
  const text=JSON.stringify(incoming);
  await page.locator('#import').setInputFiles({name:'pending-film.json',mimeType:'application/json',buffer:Buffer.from(text)});
  await expect.poll(()=>page.evaluate(()=>window.projectRead.ready)).toBe(true);
  expect(await page.evaluate(()=>window.projectRead.text)).toBe(text);
  return {raw,incoming,text};
}

for(const [field,value] of [['shotName','Unsent shot draft'],['eyeX','6.250']]){
  test(`pending project import preserves focused ${field} typing without a change event`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {raw,text}=await holdProjectRead(page);
    await page.locator(`#${field}`).fill(value);
    expect(await page.evaluate(()=>window.projectRead.changeEvents)).toBe(0);
    expect(await page.evaluate(()=>window.projectRead.inputEvents)).toBe(1);
    await expect(page.locator(`#${field}`)).toBeFocused();
    expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(raw);
    // Only native read completion is delayed; the real file bytes, parser,
    // WebGL editor, input events, history and browser storage remain genuine.
    await page.evaluate(()=>window.releaseProjectRead());
    await expect(page.locator('#status')).toContainText('scene changed while opening');
    await expect(page.locator(`#${field}`)).toHaveValue(value);
    await expect(page.locator(`#${field}`)).toBeFocused();
    expect(await page.evaluate(()=>window.projectRead.changeEvents)).toBe(0);
    expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(raw);
    await expect(page.getByLabel('Film title')).toHaveValue('Existing authored film');
    // Typing did not create a history entry: ordinary blur commits the draft,
    // and a later intentional import can still be undone to that edited film.
    await page.locator(`#${field}`).press('Tab');
    const edited=await page.evaluate(()=>localStorage.getItem('shot-studio-v1'));
    expect(edited).not.toBe(raw);
    await page.locator('#import').setInputFiles({name:'ordinary-film.json',mimeType:'application/json',buffer:Buffer.from(text)});
    await expect(page.getByLabel('Film title')).toHaveValue('Incoming complete film');
    await page.getByRole('button',{name:'Undo scene',exact:true}).click();
    expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(edited);
    expect(errors).toEqual([]);
  });
}

test('pending project import still rejects a committed scene edit',async({page})=>{
  await holdProjectRead(page);
  await page.locator('#shotName').fill('Committed while reading');await page.locator('#shotName').press('Tab');
  const edited=await page.evaluate(()=>localStorage.getItem('shot-studio-v1'));
  await page.evaluate(()=>window.releaseProjectRead());
  await expect(page.locator('#status')).toContainText('scene changed while opening');
  await expect(page.locator('#shotName')).toHaveValue('Committed while reading');
  expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(edited);
});

test('immersive camera capture persists selected shot and can be undone after exit',async({page},info)=>{
  await page.addInitScript(()=>{
    WebGLRenderingContext.prototype.makeXRCompatible=async()=>{};
    window.XRWebGLLayer=class{};
    Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:async()=>true,requestSession:async()=>{
      const s=new EventTarget();s.end=async()=>s.dispatchEvent(new Event('end'));
      s.updateRenderState=()=>{};s.requestReferenceSpace=async type=>({type});s.requestAnimationFrame=()=>{};
      window.testXR=s;return s;
    }}});
    window.captureView=(matrix)=>{const event=new Event('squeeze');event.frame={getViewerPose:()=>{throw new DOMException('Event frames cannot read viewer poses','InvalidStateError');},getPose:(viewer,floor)=>{if(viewer.type!=='viewer'||floor.type!=='local-floor')throw Error('Incorrect reference spaces');return matrix?{transform:{matrix}}:null;}};window.testXR.dispatchEvent(event);};
  });
  await page.goto('/');await page.locator('#shots button').nth(1).click();
  await page.getByRole('button',{name:'Enter VR',exact:true}).click();await expect(page.locator('#status')).toContainText('VR active');
  await page.evaluate(()=>window.captureView(null));await expect(page.locator('#status')).toContainText('tracking');
  await page.evaluate(()=>window.captureView([1,0,0,0,0,1,0,0,0,0,1,0,99,2,5,1]));
  await expect(page.locator('#status')).toContainText('limits');await expect(page.getByLabel('Camera X',{exact:true})).toHaveValue('0');
  await page.evaluate(()=>window.captureView([1,0,0,0,0,1,0,0,0,0,1,0,1,2,5,1]));
  await expect(page.getByLabel('Camera X',{exact:true})).toHaveValue('1');
  await page.getByRole('button',{name:'Exit VR',exact:true}).click();
  await expect(page.getByRole('button',{name:'Rehearse',exact:true})).toBeEnabled();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
  const file=await downloading,path=info.outputPath('headset-camera.json');await file.saveAs(path);
  const film=JSON.parse(execFileSync('cat',[path],{encoding:'utf8'}));
  expect(film.shots[1]).toMatchObject({name:'Two-shot',duration:4,fov:40,eye:[1,2,5],target:[1,2,2]});
  await page.getByRole('button',{name:'Undo scene',exact:true}).click();await expect(page.getByLabel('Camera X',{exact:true})).toHaveValue('0');
  await page.reload();await expect(page.getByLabel('Camera X',{exact:true})).toHaveValue('5');
  await page.locator('#shots button').nth(1).click();await expect(page.getByLabel('Camera X',{exact:true})).toHaveValue('0');
});

test('page teardown cancels pending VR and ends a subsequently accepted session',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.xrRequests=0;window.xrEnds=0;
    Object.defineProperty(navigator,'xr',{configurable:true,value:{
      isSessionSupported:async()=>true,
      requestSession:()=>{window.xrRequests++;return new Promise(resolve=>{
        window.acceptXR=()=>{const session=new EventTarget();session.end=async()=>{window.xrEnds++;session.dispatchEvent(new Event('end'));};resolve(session);};
      });}
    }});
  });
  await page.goto('/');await page.getByRole('button',{name:'Enter VR',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.xrRequests)).toBe(1);
  await expect(page.getByRole('button',{name:'Rehearse',exact:true})).toBeDisabled();
  await page.evaluate(()=>{
    dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    window.acceptXR();
  });
  await expect(page.locator('#status')).toContainText('cancelled');
  await expect.poll(()=>page.evaluate(()=>window.xrEnds)).toBe(1);
  await expect(page.getByRole('button',{name:'Rehearse',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Enter VR',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
});

test('real WebGL scene renders, edits survive reload, invalid import preserves film',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Ready');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:info.outputPath('desktop.png'),fullPage:true});
  const colors=await page.locator('#stage').evaluate(c=>{
    const copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;
    const ctx=copy.getContext('2d');ctx.drawImage(c,0,0);
    const pixels=ctx.getImageData(0,0,copy.width,copy.height).data,set=new Set();
    for(let i=0;i<pixels.length;i+=64)set.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
    return set.size;
  });
  expect(colors).toBeGreaterThan(8);
  await page.getByLabel('Film title').fill('My arrival');await page.getByLabel('Film title').press('Tab');
  await page.getByLabel('Performer X').fill('2');await page.getByLabel('Performer X').press('Tab');
  await page.getByRole('button',{name:'Add shot',exact:true}).click();
  await expect(page.locator('#shots button')).toHaveCount(3);
  await page.reload();await expect(page.getByLabel('Film title')).toHaveValue('My arrival');
  await expect(page.getByLabel('Performer X')).toHaveValue('2');
  await page.locator('#import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":99}')});
  await expect(page.locator('#status')).toContainText('Invalid');
  await expect(page.getByLabel('Film title')).toHaveValue('My arrival');
  await expect(page.locator('#shots button')).toHaveCount(3);expect(errors).toEqual([]);
});
test('rehearsal scrubs and exports an actually playable bounded video',async({page},info)=>{
  await page.goto('/');
  // Two one-second shots for a short real encoder test.
  for(let i=0;i<2;i++){
    await page.locator('#shots button').nth(i).click();
    await page.getByLabel('Shot duration').fill('1');await page.getByLabel('Shot duration').press('Tab');
  }
  await page.getByRole('button',{name:'Rehearse',exact:true}).click();
  await expect(page.locator('#time')).toContainText('2.00', {timeout:10000});
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export WebM',exact:true}).click();
  await expect(page.getByRole('button',{name:'Undo scene',exact:true})).toBeDisabled();
  const file=await download,path=info.outputPath('film.webm');await file.saveAs(path);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'}));
  expect(probe.streams.some(s=>s.codec_type==='video'&&s.width===960&&s.height===540)).toBeTruthy();
  // MediaRecorder WebM often lacks container duration; measure real decoded timestamps.
  const timestamps=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',path],{encoding:'utf8'})).frames.map(f=>Number(f.best_effort_timestamp_time));
  expect(timestamps.length).toBeGreaterThan(10);
  const span=Math.max(...timestamps)-Math.min(...timestamps);
  expect(span).toBeGreaterThan(1.4);expect(span).toBeLessThan(4);
  const frames=execFileSync('ffmpeg',['-v','error','-i',path,'-vf','fps=1','-frames:v','2','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:8*1024*1024});
  const frameBytes=960*540*3;expect(frames.length).toBe(frameBytes*2);
  expect(frames.subarray(0,frameBytes).equals(frames.subarray(frameBytes))).toBeFalsy();
  await expect(page.getByRole('button',{name:'Rehearse',exact:true})).toBeEnabled();
});
test('desktop/mobile controls work and lack of headset has an honest message',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.screenshot({path:info.outputPath('mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Enter VR',exact:true}).click();
  await expect(page.locator('#status')).toContainText(/VR|headset/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.getByRole('button',{name:'Save project',exact:true}).click();
  await page.getByRole('button',{name:'Remove shot',exact:true}).click();
  await expect(page.locator('#shots button')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Remove shot',exact:true})).toBeDisabled();
});

test('page lifecycle restoration resumes rehearsal and context loss retains backups',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  });
  await page.getByRole('button',{name:'Rehearse',exact:true}).click();
  await expect.poll(async()=>Number((await page.locator('#time').textContent()).split(' / ')[0])).toBeGreaterThan(.5);
  await page.locator('#stage').evaluate(c=>c.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await expect(page.getByRole('button',{name:'Export WebM',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Enter VR',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Save project',exact:true})).toBeEnabled();
});

test('scene undo and shot sequencing preserve camera snapshots and portable backups',async({page},info)=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Undo scene',exact:true})).toBeDisabled();
  await page.getByLabel('Film title').fill('Edited film');await page.getByLabel('Film title').press('Tab');
  await page.getByRole('button',{name:'Undo scene',exact:true}).click();
  await expect(page.getByLabel('Film title')).toHaveValue('The arrival');
  await page.getByRole('button',{name:'Redo scene',exact:true}).click();
  await expect(page.getByLabel('Film title')).toHaveValue('Edited film');
  await page.locator('#shots button').nth(1).click();
  await page.getByLabel('Camera X',{exact:true}).fill('1');await page.getByLabel('Camera X',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Undo scene',exact:true}).click();
  await expect(page.locator('#shotLabel')).toContainText('CAMERA 02');
  await expect(page.locator('#shots button').nth(1)).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Move earlier',exact:true}).click();
  await expect(page.locator('#shots button').first()).toContainText('Two-shot');
  await expect(page.locator('#shots button').first()).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Undo scene',exact:true}).click();
  await expect(page.locator('#shots button').first()).toContainText('Establishing');
  await page.getByRole('button',{name:'Redo scene',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();
  const file=await downloading,path=info.outputPath('film.json');await file.saveAs(path);
  await page.getByRole('button',{name:'Undo scene',exact:true}).click();
  await page.locator('#import').setInputFiles(path);
  await expect(page.locator('#shots button').first()).toContainText('Two-shot');
  await page.reload();await expect(page.locator('#shots button').first()).toContainText('Two-shot');
  await expect(page.getByRole('button',{name:'Undo scene',exact:true})).toBeDisabled();
  await page.locator('#shots button').nth(1).click();
  await page.getByRole('button',{name:'Add shot',exact:true}).click();
  await page.getByRole('button',{name:'Remove shot',exact:true}).click();
  await expect(page.locator('#shotLabel')).toContainText('CAMERA 02');
  await expect(page.locator('#shots button').nth(1)).toHaveAttribute('aria-pressed','true');
});

test('unreadable startup draft survives authoring and undo before explicit replacement',async({page})=>{
  await page.goto('/');await page.evaluate(()=>localStorage.setItem('shot-studio-v1','{broken original\n☃'));await page.reload();
  await expect(page.locator('#status')).toContainText('preserved');
  await page.getByLabel('Film title').fill('Recoverable new film');await page.getByLabel('Film title').press('Tab');
  expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe('{broken original\n☃');
  await page.getByRole('button',{name:'Undo scene',exact:true}).click();expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe('{broken original\n☃');
  await page.getByRole('button',{name:'Redo scene',exact:true}).click();
  const projectDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const projectFile=await projectDownload;const projectPath=await projectFile.path();
  const current=JSON.parse(execFileSync('cat',[projectPath],{encoding:'utf8'}));expect(current.title).toBe('Recoverable new film');
  await page.locator('#import').setInputFiles(projectPath);await expect(page.getByLabel('Film title')).toHaveValue('Recoverable new film');expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe('{broken original\n☃');
  const rawDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download unreadable draft',exact:true}).click();const rawFile=await rawDownload;const raw=JSON.parse(execFileSync('cat',[await rawFile.path()],{encoding:'utf8'}));expect(raw).toEqual({schemaVersion:1,kind:'unreadable-shot-studio-draft',storageKey:'shot-studio-v1',raw:'{broken original\n☃'});
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Replace browser draft',exact:true}).click();expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe('{broken original\n☃');
  page.once('dialog',d=>d.accept());await page.reload();await expect(page.getByLabel('Film title')).toHaveValue('The arrival');await expect(page.getByRole('button',{name:'Download unreadable draft',exact:true})).toBeVisible();
  await page.locator('#import').setInputFiles(projectPath);await expect(page.getByLabel('Film title')).toHaveValue('Recoverable new film');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Replace browser draft',exact:true}).click();await expect(page.locator('#status')).toContainText('explicitly replaced');await expect(page.getByRole('button',{name:'Download unreadable draft',exact:true})).toBeHidden();
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).title).toBe('Recoverable new film');
  await page.getByLabel('Film title').fill('Later saved edit');await page.getByLabel('Film title').press('Tab');await page.reload();await expect(page.getByLabel('Film title')).toHaveValue('Later saved edit');
});

test('failed startup read and replacement never silently overwrite an existing draft',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.evaluate(()=>localStorage.setItem('shot-studio-v1','{private original'));
  await page.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;window.readRawDraft=()=>get.call(localStorage,'shot-studio-v1');window.failReplacement=false;Storage.prototype.getItem=function(key){if(key==='shot-studio-v1')throw new DOMException('Read blocked','SecurityError');return get.call(this,key);};Storage.prototype.setItem=function(key,value){if(window.failReplacement&&key==='shot-studio-v1')throw new DOMException('Full','QuotaExceededError');return set.call(this,key,value);};});
  await page.reload();await expect(page.locator('#status')).toContainText('No recovery download is available');await expect(page.getByRole('button',{name:'Download unreadable draft',exact:true})).toBeHidden();
  await page.getByLabel('Film title').fill('New work in memory');await page.getByLabel('Film title').press('Tab');expect(await page.evaluate(()=>window.readRawDraft())).toBe('{private original');
  await page.evaluate(()=>window.failReplacement=true);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Replace browser draft',exact:true}).click();await expect(page.locator('#status')).toContainText('Could not replace');expect(await page.evaluate(()=>window.readRawDraft())).toBe('{private original');await expect(page.getByRole('button',{name:'Replace browser draft',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Undo scene',exact:true}).click();expect(await page.evaluate(()=>window.readRawDraft())).toBe('{private original');await page.getByRole('button',{name:'Redo scene',exact:true}).click();
  await page.evaluate(()=>window.failReplacement=false);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Replace browser draft',exact:true}).click();expect(JSON.parse(await page.evaluate(()=>window.readRawDraft())).title).toBe('New work in memory');expect(errors).toEqual([]);
});
