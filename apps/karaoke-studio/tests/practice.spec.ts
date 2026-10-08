import {expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {test,PRACTICE_CUES,PRACTICE_BOUNDARY_TOLERANCE,openPractice,media,observePractice,observations,repeatJumps,
  selectPractice,startPractice,atLeast,idlePractice,loadedTrack,rawEditor,audioHashes,settleNative,nativeToggle,
  fromServer,timingSha} from './practice-fixtures';

test('original WAV reaches loaded native audio and exposes an explicit single-cue practice range',async({page,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  expect(await media(page)).toMatchObject({duration:6,paused:true,rate:1});
  await expect(page.locator('#practice-first')).toHaveValue('0');
  await expect(page.locator('#practice-last')).toHaveValue('0');
  await expect(page.locator('#practice-once')).toBeEnabled();
  await expect(page.locator('#practice-repeat')).toBeEnabled();
  await expect(page.locator('#practice-pause')).toBeDisabled();
  await expect(page.locator('#practice-stop')).toBeDisabled();
});

test('actual original playback crosses two repeat boundaries and the literal gap without saving or changing audio',async({page,request,timingClips},info)=>{
  await observePractice(page);
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  const before=await audioHashes(request,project.id),editor=await rawEditor(page);
  await selectPractice(page,0,1);
  await startPractice(page,true);
  await expect(page.locator('#practice-range-summary').or(page.locator('#practice-status')).filter({hasText:/seek|gap/i}).first()).toBeVisible();
  await expect.poll(async()=>repeatJumps(await observations(page)).length,{intervals:[50,50,50],timeout:7000}).toBeGreaterThanOrEqual(2);
  await page.locator('#practice-stop').click();
  const samples=await observations(page),jumps=repeatJumps(samples);
  expect(jumps.length).toBeGreaterThanOrEqual(2);
  for(const jump of jumps.slice(0,2)){
    expect(Math.abs(jump.before.time-2.25)).toBeLessThanOrEqual(PRACTICE_BOUNDARY_TOLERANCE);
    expect(Math.abs(jump.after.time-.35)).toBeLessThanOrEqual(PRACTICE_BOUNDARY_TOLERANCE);
  }
  expect(samples.some(sample=>!sample.paused&&!sample.seeking&&sample.time>1.15&&sample.time<1.5&&sample.active==='-1')).toBe(true);
  expect(samples.filter(sample=>!sample.paused).every(sample=>sample.rate===1)).toBe(true);
  await expect(page.locator('#practice-status')).toContainText(/stop|idle|retir/i);
  expect(await rawEditor(page)).toEqual(editor);
  expect(await fromServer(request,project.id)).toEqual(project);
  expect(await audioHashes(request,project.id)).toEqual(before);
  await writeFile(info.outputPath('native-repeat-observations.json'),JSON.stringify({tolerance:PRACTICE_BOUNDARY_TOLERANCE,
    range:{start:.35,end:2.25},observedRepeatJumps:jumps.slice(0,2),samples,audioHashes:before,physicalSynchronizationMeasured:false},null,2));
});

test('once on Backing reaches the final cue at the exact six-second song endpoint and stays retired',async({page,request,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await loadedTrack(page,'Backing');
  await selectPractice(page,2,2);
  await startPractice(page);
  await expect.poll(async()=>({time:(await media(page)).time,paused:(await media(page)).paused}),{timeout:5000}).toEqual({time:6,paused:true});
  await idlePractice(page);
  await settleNative(page);
  expect(await media(page)).toMatchObject({time:6,paused:true,rate:1});
  expect(await fromServer(request,project.id)).toEqual(project);
});

test('Vocals pause holds actual time, explicit Resume continues, Stop retains position and native controls remain usable',async({page,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await loadedTrack(page,'Vocals');
  await selectPractice(page,0,1);
  await startPractice(page,true);
  await atLeast(page,.6);
  await expect(page.locator('#practice-pause')).toHaveText('Pause practice');
  await page.locator('#practice-pause').click();
  await expect(page.locator('#practice-pause')).toHaveText('Resume practice');
  const paused=await media(page);
  expect(paused.paused).toBe(true);
  await settleNative(page);
  expect((await media(page)).time).toBe(paused.time);
  await page.locator('#practice-pause').click();
  await atLeast(page,paused.time+.2);
  await page.locator('#practice-stop').click();
  const stopped=await media(page);
  expect(stopped.paused).toBe(true);
  await idlePractice(page);
  await settleNative(page);
  expect((await media(page)).time).toBe(stopped.time);
  await nativeToggle(page,false);
  await atLeast(page,stopped.time+.2);
  await idlePractice(page);
  await nativeToggle(page,true);
});

test('Play line uses one cue only and preserves exact unsaved raw spelling paste caret Redo saved SRT and original bytes',async({page,request,timingClips},info)=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await page.getByLabel('Start line 1',{exact:true}).fill('0.3500');
  await page.getByLabel('End line 1',{exact:true}).fill('1.0500');
  await page.getByLabel('Start line 2',{exact:true}).fill('1.6250');
  await page.getByLabel('End line 2',{exact:true}).fill('2.3250');
  await page.locator('#lyric-draft').fill('Unapplied paste\n  preserve Ω and whitespace  ');
  await page.getByLabel('Lyric line 1',{exact:true}).fill('Temporary redo item');
  await page.locator('#undo-lyrics').click();
  await expect(page.locator('#redo-lyrics')).toBeEnabled();
  await selectPractice(page,0,2);
  const editor=await rawEditor(page),audio=await audioHashes(request,project.id);
  const savedSrt=async(path:string)=>{
    const response=await request.get(`/api/projects/${project.id}/lyrics`);
    expect(response.status()).toBe(200);
    const bytes=await response.body();await writeFile(path,bytes);return bytes;
  };
  const srtBefore=await savedSrt(info.outputPath('saved-before-practice.srt'));
  const lyric=page.getByLabel('Lyric line 1',{exact:true});
  await lyric.focus();
  await lyric.evaluate(node=>{const field=node as HTMLTextAreaElement;field.dataset.practiceIdentity='original';field.setSelectionRange(2,7);});
  const play=page.getByRole('button',{name:'Play line 2',exact:true});
  await expect(play).toBeEnabled();
  // A native DOM click preserves the deliberately focused textarea/caret for this ownership assertion.
  await play.evaluate(node=>(node as HTMLButtonElement).click());
  await expect.poll(async()=>(await media(page)).paused).toBe(false);
  await expect.poll(async()=>({time:(await media(page)).time,paused:(await media(page)).paused}),{timeout:5000}).toEqual({time:2.325,paused:true});
  await expect(lyric).toBeFocused();
  await expect(lyric).toHaveAttribute('data-practice-identity','original');
  expect(await lyric.evaluate(node=>[(node as HTMLTextAreaElement).selectionStart,(node as HTMLTextAreaElement).selectionEnd])).toEqual([2,7]);
  expect(await rawEditor(page)).toEqual(editor);
  expect(await fromServer(request,project.id)).toEqual(project);
  expect(await audioHashes(request,project.id)).toEqual(audio);
  expect(await savedSrt(info.outputPath('saved-after-practice.srt'))).toEqual(srtBefore);
  await page.locator('#redo-lyrics').click();
  await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('Temporary redo item');
  await writeFile(info.outputPath('immutable-practice-receipt.json'),JSON.stringify({savedRevision:project.revision,audio,savedSrtSha256:timingSha(srtBefore),editor},null,2));
});

test('reversed and invalid ranges refuse while changed-back input retires the previous repetition',async({page,request,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await selectPractice(page,2,0);
  await expect(page.locator('#practice-once')).toBeDisabled();
  await expect(page.locator('#practice-repeat')).toBeDisabled();
  expect((await media(page)).paused).toBe(true);
  await selectPractice(page,0,1);
  await page.getByLabel('End line 1',{exact:true}).fill('');
  await expect(page.locator('#practice-once')).toBeDisabled();
  await page.getByLabel('End line 1',{exact:true}).fill('1.05');
  await startPractice(page,true);
  await atLeast(page,.55);
  await page.locator('#practice-last').selectOption('2');
  await idlePractice(page);expect((await media(page)).paused).toBe(true);
  await page.locator('#practice-last').selectOption('1');
  await startPractice(page,true);await atLeast(page,.55);
  await page.locator('#title').evaluate(node=>{
    const input=node as HTMLInputElement,original=input.value;
    input.value=original+' changed';input.dispatchEvent(new Event('input',{bubbles:true}));
    input.value=original;input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await idlePractice(page);
  expect((await media(page)).paused).toBe(true);
  const stopped=(await media(page)).time;
  await settleNative(page);
  expect((await media(page)).time).toBe(stopped);
  await expect(page.locator('#practice-once')).toBeEnabled();
  expect(await fromServer(request,project.id)).toEqual(project);
});

test('actual external seek and playback-rate change each retire ownership without forcing the old endpoint',async({page,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await selectPractice(page,0,1);
  await startPractice(page,true);
  await atLeast(page,.55);
  await page.locator('#audio').evaluate(node=>{(node as HTMLAudioElement).currentTime=3.125;});
  await idlePractice(page);
  await expect.poll(async()=>(await media(page)).time).toBe(3.125);
  expect((await media(page)).paused).toBe(true);
  await startPractice(page,true);
  await atLeast(page,.55);
  await page.locator('#audio').evaluate(node=>{(node as HTMLAudioElement).playbackRate=1.5;});
  await idlePractice(page);
  const retired=await media(page);
  expect(retired.paused).toBe(true);
  expect(retired.rate).toBe(1.5);
  await settleNative(page);
  expect((await media(page)).time).toBe(retired.time);
  await expect(page.locator('#practice-once')).toBeDisabled();
  await page.locator('#audio').evaluate(node=>{(node as HTMLAudioElement).playbackRate=1;});
  await expect(page.locator('#practice-once')).toBeEnabled();
});

test('a held genuine Backing HTTP response cannot revive practice after switching back to Original',async({page,request,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await selectPractice(page,0,1);
  await startPractice(page,true);
  let held=false;let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route(`**/api/projects/${project.id}/audio/backing`,async route=>{
    const response=await route.fetch();held=true;await gate;await route.fulfill({response});
  });
  try{
    await page.getByRole('button',{name:'Backing',exact:true}).click();
    await expect.poll(()=>held).toBe(true);
    await idlePractice(page);
    await page.getByRole('button',{name:'Original',exact:true}).click();
    release();
    await expect.poll(()=>page.locator('#audio').evaluate(node=>{
      const audio=node as HTMLAudioElement;return audio.currentSrc.endsWith('/audio/original')&&audio.readyState>=2&&!audio.seeking;
    })).toBe(true);
    await settleNative(page);
    await idlePractice(page);
    expect((await media(page)).paused).toBe(true);
    expect(await fromServer(request,project.id)).toEqual(project);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('controlled hidden pagehide and media-error lifecycle events retire practice and never restart it',async({page,request,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await selectPractice(page,0,1);
  for(const kind of ['hidden','pagehide','error']as const){
    await startPractice(page,true);
    await atLeast(page,.55);
    await page.evaluate(kind=>{
      if(kind==='hidden'){
        Object.defineProperty(document,'hidden',{configurable:true,value:true});
        Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
        document.dispatchEvent(new Event('visibilitychange'));
      }else if(kind==='pagehide')window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
      else document.querySelector('#audio')!.dispatchEvent(new Event('error'));
    },kind);
    await idlePractice(page);
    const stopped=await media(page);expect(stopped.paused).toBe(true);
    await settleNative(page);
    expect((await media(page)).time).toBe(stopped.time);
    if(kind==='hidden'){
      await expect(page.locator('#practice-once')).toBeDisabled();
      await expect(page.locator('#practice-repeat')).toBeDisabled();
      await page.evaluate(()=>{
        Reflect.deleteProperty(document,'hidden');Reflect.deleteProperty(document,'visibilityState');
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.locator('#practice-once')).toBeEnabled();
      await expect(page.locator('#practice-repeat')).toBeEnabled();
      expect((await media(page)).paused).toBe(true);
    }
  }
  expect(await fromServer(request,project.id)).toEqual(project);
});

test('390px keyboard range choice and explicit practice controls work with readiness and focus gates',async({page,timingClips},info)=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  const last=page.locator('#practice-last');
  await expect(last).toBeEnabled();await last.focus();await expect(last).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(last).toHaveValue('1');
  const repeat=page.locator('#practice-repeat');
  await expect(repeat).toBeEnabled();await repeat.focus();await expect(repeat).toBeFocused();
  await page.keyboard.press('Enter');await expect.poll(async()=>(await media(page)).paused).toBe(false);
  const pause=page.locator('#practice-pause');
  await expect(pause).toBeEnabled();await pause.focus();await expect(pause).toBeFocused();
  await page.keyboard.press('Space');await expect(pause).toHaveText('Resume practice');
  const stop=page.locator('#practice-stop');
  await expect(stop).toBeEnabled();await stop.focus();await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');await idlePractice(page);
  await page.locator('#practice-first').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('practice-controls-390.png'),fullPage:false});
  expect(errors).toEqual([]);
});

test('Undo explicit Save timing capture project switch and failed import each retire existing practice',async({page,request,timingClips})=>{
  const first=await timingClips.create(PRACTICE_CUES),second=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,first);
  await page.locator('#title').fill('Unsaved practice title');
  await selectPractice(page,0,1);await startPractice(page,true);
  await page.locator('#undo-lyrics').click();await idlePractice(page);expect((await media(page)).paused).toBe(true);
  await page.locator('#title').fill('Deliberately saved practice title');
  await startPractice(page,true);await expect(page.locator('#save')).toBeEnabled();await page.locator('#save').click();
  await idlePractice(page);await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  expect((await fromServer(request,first.id)).revision).toBe(first.revision+1);
  await startPractice(page,true);await expect(page.locator('#timing-begin')).toBeEnabled();await page.locator('#timing-begin').click();
  await idlePractice(page);expect((await media(page)).paused).toBe(true);
  await page.locator('#timing-cancel').click();
  await startPractice(page,true);await page.getByRole('combobox',{name:'Saved clips',exact:true}).selectOption(second.id);
  await expect(page).toHaveURL(new RegExp(`project=${second.id}`));
  await expect.poll(()=>page.locator('#audio').evaluate(node=>(node as HTMLAudioElement).readyState>=2)).toBe(true);
  await idlePractice(page);expect((await media(page)).paused).toBe(true);
  await selectPractice(page,0,1);await startPractice(page,true);
  await page.getByLabel('Upload song clip').setInputFiles({name:'deliberately-invalid-practice.wav',mimeType:'audio/wav',buffer:Buffer.from('not a WAV')});
  await idlePractice(page);expect((await media(page)).paused).toBe(true);
  await expect(page.locator('#job-panel')).toBeHidden({timeout:10000});
  await expect(page.locator('#message')).toHaveClass(/error/);
  expect(await fromServer(request,second.id)).toEqual(second);
});

test('controlled play-admission rejection and held genuine play completion cannot revive or pause a newer ordinary playback owner',async({page,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await selectPractice(page,0,1);
  await page.evaluate(()=>{
    const audio=document.querySelector<HTMLAudioElement>('#audio')!,original=audio.play.bind(audio);
    const state={rejection:'',release:()=>{},resolved:false};
    Object.defineProperty(window,'practice125PlayGate',{configurable:true,value:state});
    audio.play=()=>{
      audio.play=original;
      // Explicit fault injection at admission. The loaded original WAV, native
      // pause method and actual media clock remain unchanged. This does not
      // claim to reproduce a browser autoplay-policy or decoder rejection.
      return Promise.reject(new DOMException('Controlled play-admission refusal.','NotAllowedError'))
        .catch((error:unknown)=>{state.rejection=error instanceof DOMException?error.name:String(error);throw error;});
    };
  });
  await page.locator('#practice-repeat').click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {practice125PlayGate:{rejection:string}}).practice125PlayGate.rejection)).toBe('NotAllowedError');
  await idlePractice(page);expect((await media(page)).paused).toBe(true);
  await page.evaluate(()=>{
    const audio=document.querySelector<HTMLAudioElement>('#audio')!,original=audio.play.bind(audio);
    const state=(window as unknown as {practice125PlayGate:{rejection:string;release:()=>void;resolved:boolean}}).practice125PlayGate;
    const gate=new Promise<void>(resolve=>state.release=resolve);
    audio.play=()=>{
      audio.play=original;
      return original().then(async()=>{state.resolved=true;await gate;});
    };
  });
  await page.locator('#practice-repeat').click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {practice125PlayGate:{resolved:boolean}}).practice125PlayGate.resolved)).toBe(true);
  await page.locator('#title').fill('Newer ordinary playback draft');
  await idlePractice(page);expect((await media(page)).paused).toBe(true);
  await nativeToggle(page,false);
  const before=await media(page),message=await page.locator('#message').textContent(),status=await page.locator('#practice-status').textContent();
  await page.evaluate(()=>(window as unknown as {practice125PlayGate:{release:()=>void}}).practice125PlayGate.release());
  await atLeast(page,before.time+.25);
  expect((await media(page)).paused).toBe(false);
  await expect(page.locator('#message')).toHaveText(message??'');
  await expect(page.locator('#practice-status')).toHaveText(status??'');
  await idlePractice(page);
  await nativeToggle(page,true);
});
