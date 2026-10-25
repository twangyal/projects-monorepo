import {expect} from '@playwright/test';
import {test,PRACTICE_CUES,openPractice,media,selectPractice,startPractice,atLeast,idlePractice,
  loadedTrack,rawEditor,fromServer,settleNative,observePractice,observations,repeatJumps,audioHashes} from './practice-fixtures';

// Original media-clock acceptance: no production rate/controller imports. The
// clock window bounds (.35..65 for half speed) are fixed before native runs.
test('half-speed rehearsal advances the native clock slowly across two repeat boundaries and keeps saved/editor bytes',async({page,request,timingClips})=>{
  await observePractice(page);
  const project=await timingClips.create(PRACTICE_CUES);
  await openPractice(page,project);
  await expect(page.getByLabel('Playback speed',{exact:true})).toBeVisible();
  await page.getByLabel('Start line 1',{exact:true}).fill('0.3500');
  await page.locator('#lyric-draft').fill('  Unapplied Ω paste  ');
  await page.getByLabel('Lyric line 1',{exact:true}).fill('Temporary redo');
  await page.locator('#undo-lyrics').click();
  const before=await rawEditor(page),hashes=await audioHashes(request,project.id);
  const srt=await(await request.get(`/api/projects/${project.id}/lyrics`)).body();
  await page.getByLabel('Playback speed',{exact:true}).selectOption('0.5');
  await expect.poll(async()=>(await media(page)).rate).toBe(.5);
  expect(await page.locator('#audio').evaluate(n=>(n as HTMLAudioElement).preservesPitch)).toBe(true);
  expect((await media(page)).paused).toBe(true);
  await selectPractice(page,0,1);await startPractice(page,true);
  await atLeast(page,.55);
  const clocks=await page.locator('#audio').evaluate(async n=>{const a=n as HTMLAudioElement,start=a.currentTime,wall=performance.now();await new Promise(r=>setTimeout(r,1000));return{delta:a.currentTime-start,wall:(performance.now()-wall)/1000};});
  expect(clocks.delta/clocks.wall).toBeGreaterThan(.35);expect(clocks.delta/clocks.wall).toBeLessThan(.65);
  await expect(page.locator('#practice-status')).toContainText('0.5×');
  await expect.poll(async()=>repeatJumps(await observations(page)).length,{timeout:11000,intervals:[50,50]}).toBeGreaterThanOrEqual(2);
  await page.locator('#practice-stop').click();
  const samples=await observations(page),jumps=repeatJumps(samples);
  for(const jump of jumps.slice(0,2)){expect(Math.abs(jump.before.time-2.25)).toBeLessThanOrEqual(.15);expect(Math.abs(jump.after.time-.35)).toBeLessThanOrEqual(.15);}
  expect(samples.some(s=>!s.paused&&!s.seeking&&s.time>1.15&&s.time<1.5&&s.active==='-1')).toBe(true);
  expect(samples.filter(s=>!s.paused).every(s=>s.rate===.5)).toBe(true);
  expect(await rawEditor(page)).toEqual(before);expect(await fromServer(request,project.id)).toEqual(project);
  expect(await audioHashes(request,project.id)).toEqual(hashes);
  expect(await(await request.get(`/api/projects/${project.id}/lyrics`)).body()).toEqual(srt);
  await page.locator('#redo-lyrics').click();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('Temporary redo');
});

test('speed choice retires practice, retains paused position and track speed, and timing capture stays normal-only',async({page,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);await openPractice(page,project);
  const speed=page.getByLabel('Playback speed',{exact:true});await speed.selectOption('0.75');
  for(const track of ['Vocals','Backing','Original'] as const){
    await loadedTrack(page,track);expect((await media(page)).rate).toBe(.75);
    await selectPractice(page,0,0);await startPractice(page);
    await expect.poll(async()=>(await media(page)).paused,{timeout:4000}).toBe(true);
    expect((await media(page)).time).toBe(1.05);
  }
  await startPractice(page,true);await atLeast(page,.6);await page.locator('#practice-pause').click();
  const before=await media(page);await speed.selectOption('0.5');await idlePractice(page);
  expect(await media(page)).toMatchObject({time:before.time,paused:true,rate:.5});
  await settleNative(page);expect((await media(page)).time).toBe(before.time);
  await page.locator('#timing-begin').click();await expect(page.locator('#timing-status')).toContainText('normal 1×');
  await expect(page.locator('#timing-mark')).toBeHidden();
  await speed.selectOption('1');await page.locator('#timing-begin').click();await expect(page.locator('#timing-mark')).toBeVisible();
  await speed.selectOption('0.75');await expect(page.locator('#timing-mark')).toBeHidden();
  await page.locator('#audio').evaluate(n=>{(n as HTMLAudioElement).playbackRate=1.5;});
  await expect(page.locator('#practice-once')).toBeDisabled();await expect(speed).toHaveValue('');
  await speed.selectOption('1');await expect(page.locator('#practice-once')).toBeEnabled();
});

test('phone keyboard speed utility resets on another clip without automatic playback',async({page,timingClips})=>{
  const one=await timingClips.create(PRACTICE_CUES),two=await timingClips.create(PRACTICE_CUES);
  await page.setViewportSize({width:390,height:844});await openPractice(page,one);
  const speed=page.getByLabel('Playback speed',{exact:true});await speed.focus();await speed.press('Home');await speed.press('ArrowDown');
  await expect(speed).toHaveValue('0.5');await expect(speed).toBeFocused();
  const box=await speed.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);
  await page.locator('#projects').selectOption(two.id);await expect(page.locator('#title')).toHaveValue(two.title);
  await expect(speed).toHaveValue('1');await expect.poll(async()=>(await media(page)).rate).toBe(1);
  expect((await media(page)).paused).toBe(true);await settleNative(page);expect((await media(page)).paused).toBe(true);
});


test('a delayed native play completion cannot revive rehearsal retired by a speed change',async({page,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);await openPractice(page,project);
  await page.locator('#audio').evaluate(n=>{
    const audio=n as HTMLAudioElement,original=audio.play.bind(audio);
    const delayed=window as unknown as {releaseSpeedPlay:()=>void;speedPlayPending:boolean};
    audio.play=async()=>{await original();delayed.speedPlayPending=true;await new Promise<void>(resolve=>{delayed.releaseSpeedPlay=resolve;});};
  });
  await page.locator('#practice-repeat').click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {speedPlayPending:boolean}).speedPlayPending)).toBe(true);
  await page.getByLabel('Playback speed',{exact:true}).selectOption('0.5');
  await idlePractice(page);const paused=await media(page);expect(paused.paused).toBe(true);
  await page.evaluate(()=>(window as unknown as {releaseSpeedPlay:()=>void}).releaseSpeedPlay());
  await settleNative(page);expect(await media(page)).toMatchObject({time:paused.time,paused:true,rate:.5});
});


test('native player speed changes remain the selected speed across same-clip track loads',async({page,timingClips})=>{
  const project=await timingClips.create(PRACTICE_CUES);await openPractice(page,project);
  const select=page.getByLabel('Playback speed',{exact:true});await select.selectOption('0.5');
  await page.locator('#audio').evaluate(n=>{(n as HTMLAudioElement).playbackRate=1;});
  await expect(select).toHaveValue('1');
  await loadedTrack(page,'Vocals');expect((await media(page)).rate).toBe(1);
  await page.locator('#audio').evaluate(n=>{(n as HTMLAudioElement).playbackRate=.75;});
  await expect(select).toHaveValue('0.75');
  await loadedTrack(page,'Backing');expect((await media(page)).rate).toBe(.75);
  await expect(select).toHaveValue('0.75');expect((await media(page)).paused).toBe(true);
});
