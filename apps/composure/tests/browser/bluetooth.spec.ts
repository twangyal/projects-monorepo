import {test,expect,chromium,type Page} from '@playwright/test';
import {PRIVATE_IDENTITY,installBle,setup,connect,calibrate,startBle,emit,stats,releaseStage,holdStage,connectionEvent,report,move,interact,position,type Stage} from './bluetooth-fixtures.ts';

const errors=new WeakMap<Page,string[]>();
test.beforeEach(({page})=>{const collected:string[]=[];errors.set(page,collected);page.on('pageerror',error=>collected.push(error.message));});
test.afterEach(({page})=>{expect(errors.get(page)).toEqual([]);});

test('Bluetooth source requires explicit native connection and received calibration',async({page})=>{
  await setup(page);await expect(page.getByRole('combobox',{name:'Next run source',exact:true})).toBeVisible({timeout:2000});
  await expect(page.getByRole('button',{name:'Connect heart-rate sensor',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Start Bluetooth run',exact:true})).toBeDisabled();
  await connect(page);expect((await stats(page)).options).toEqual([{filters:[{services:['heart_rate']}]}]);
  await page.locator('#ble-calibrate').click();await expect(page.locator('#ble-calibration')).toContainText(/0\s*\/\s*5/);
  // The characteristic begins with cached value [0x02,70]; it must not count.
  await page.clock.runFor(1000);await expect(page.locator('#start')).toBeDisabled();
  await emit(page,[2,70]);await expect(page.locator('#ble-calibration')).toContainText(/1\s*\/\s*5/);
  expect((await stats(page)).identityReads).toBe(0);
});

test('five actual spaced packets drive a real keyboard escape and private source-labeled JSON without changing simulated best',async({page},testInfo)=>{
  await setup(page);await page.locator('#save').click();const before=await page.evaluate(()=>localStorage.getItem('composure-settings-v1'));
  await startBle(page);await expect(page.locator('#run-source')).toContainText(/bluetooth/i);await expect(page.locator('#baseline')).toHaveValue('70');
  expect((await report(page)).value.samples).toEqual([]);await page.clock.runFor(1);await emit(page,[2,80]);
  await page.screenshot({path:testInfo.outputPath('desktop-bluetooth-run.png'),fullPage:true});
  await page.locator('canvas').focus();await move(page,250,110);await interact(page);await expect(page.locator('#goal-fuse')).toHaveClass('done');
  await move(page,520,230);await interact(page);await expect(page.locator('#goal-power')).toHaveClass('done');
  await move(page,740,110);await interact(page);await expect(page.locator('#goal-key')).toHaveClass('done');
  await move(page,1030,160);await page.locator('#steady').click();await interact(page,4200);await expect(page.locator('#lock')).toHaveText('100%');
  await page.locator('#steady').click();await page.locator('canvas').focus();await move(page,1160,160);await interact(page);await expect(page.locator('#phase')).toHaveText('Escaped');
  const result=await report(page);expect(result.filename).toMatch(/bluetooth/);expect(result.value).toMatchObject({schemaVersion:2,source:'bluetooth-hr',baselineBpm:80,outcome:'won'});
  expect(result.value.calibration?.samples.map(sample=>sample.bpm)).toEqual([78,80,82,80,80]);expect(result.value.calibration?.spanSeconds).toBe(4);
  expect(result.value.calibration?.samples.map(sample=>sample.receivedSeconds)).toEqual([0,1,2,3,4]);expect(result.value.samples).toHaveLength(1);expect(result.value.samples[0].bpm).toBe(80);
  for(const key of ['connectionId','receivedAtMs','deviceId','energy','rrCount'])expect(result.text).not.toContain(`"${key}"`);
  expect(result.text).not.toContain(PRIVATE_IDENTITY);expect(await page.evaluate(()=>localStorage.getItem('composure-settings-v1'))).toBe(before);
  expect((await stats(page)).identityReads).toBe(0);await page.reload();await expect(page.locator('#input-source')).toHaveValue('simulated');await expect(page.locator('#phase')).toHaveText('Ready to calibrate');
  expect((await stats(page)).calls).toEqual([]);expect(await page.evaluate(()=>localStorage.getItem('composure-settings-v1'))).not.toContain('samples');
});

test('calibration ignores bursts and malformed offset packets and contact loss invalidates ready data before BPM filtering',async({page})=>{
  await setup(page);await connect(page);await page.locator('#ble-calibrate').click();
  for(const packet of [[32,80],[1,80],[16,80,1],[8,80,0],[0,80,1],[1,255,255],[2,39],[2,121],Array(513).fill(0)])await emit(page,packet);
  await expect(page.locator('#ble-calibration')).toContainText(/0\s*\/\s*5/);
  await emit(page,[2,80]);for(let i=0;i<7;i++)await emit(page,[2,81]);await expect(page.locator('#ble-calibration')).toContainText(/1\s*\/\s*5/);
  for(let i=0;i<4;i++){await page.clock.runFor(1000);await emit(page,[27,80,0,12,0,0,4,128,3]);}
  await expect(page.locator('#start')).toBeEnabled();await emit(page,[4,0]);await expect(page.locator('#start')).toBeDisabled();
  await emit(page,[6,80]);await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#ble-calibrate')).toBeEnabled();await calibrate(page);await expect(page.locator('#start')).toBeEnabled();
});

test('collection timeout and ready expiry require deliberate fresh collection',async({page})=>{
  await setup(page);await connect(page);await page.locator('#ble-calibrate').click();await emit(page,[2,80]);await page.clock.runFor(30001);
  await expect(page.locator('#start')).toBeDisabled();await emit(page,[2,80]);await expect(page.locator('#start')).toBeDisabled();
  await calibrate(page);await page.clock.runFor(10001);await emit(page,[2,80]);await expect(page.locator('#start')).toBeDisabled();
  await calibrate(page);await expect(page.locator('#start')).toBeEnabled();
});

test('Bluetooth pause drops notifications and resume requires new packets while wall freshness returns tension to neutral',async({page})=>{
  await setup(page);await startBle(page);await page.clock.runFor(1);await emit(page,[6,160]);await page.clock.runFor(3000);await expect(page.locator('#tension')).not.toHaveText('0%');
  const before=(await report(page)).value;await page.locator('#pause').click();const positionBefore=await position(page);await page.clock.runFor(30000);await emit(page,[2,100]);
  expect((await report(page)).value.samples).toEqual(before.samples);expect(await position(page)).toEqual(positionBefore);
  await page.locator('#pause').click();await page.clock.runFor(16000);await expect(page.locator('#tension')).toHaveText('0%');
  expect((await report(page)).value.samples).toEqual(before.samples);await emit(page,[2,90]);await page.clock.runFor(20);
  const after=(await report(page)).value;expect(after.samples).toHaveLength(2);expect(after.samples[1].bpm).toBe(90);expect(after.samples[1].receivedSeconds!-after.samples[0].receivedSeconds!).toBeGreaterThan(40);
  expect((await stats(page)).options).toHaveLength(1);
});

test('simulator controls cannot contaminate a pinned Bluetooth run and source changes preserve its report until confirmed replacement',async({page})=>{
  await setup(page);await startBle(page);await page.clock.runFor(1);await emit(page,[2,80]);const before=(await report(page)).value;
  await page.locator('#reading').evaluate(node=>{const input=node as HTMLInputElement;input.value='220';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#send').evaluate(node=>(node as HTMLButtonElement).click());await page.clock.runFor(2500);expect((await report(page)).value.samples).toEqual(before.samples);
  await page.locator('#input-source').selectOption('simulated');await expect(page.locator('#run-source')).toContainText(/bluetooth/i);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#start').click();expect((await report(page)).value.source).toBe('bluetooth-hr');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#start').click();const simulated=await report(page);expect(simulated.value.schemaVersion).toBe(1);expect(simulated.value.source).toBe('simulated');expect(simulated.value).not.toHaveProperty('calibration');
  expect((await stats(page)).disconnects).toBeGreaterThan(0);
});

for(const stage of ['chooser','connect','service','characteristic','start'] as Stage[]){
  test(`cancel during ${stage} drains one native operation and cannot publish a late connection`,async({page})=>{
    await setup(page,[stage]);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toContain(stage);
    if(stage==='start'){await emit(page,[2,80]);await expect(page.locator('#start')).toBeDisabled();}
    await page.locator('#ble-cancel').click();await expect(page.locator('#ble-status')).toContainText(/wait|drain|pending|cleanup/i);await expect(page.locator('#ble-connect')).toBeDisabled();
    if(stage!=='chooser')expect((await stats(page)).disconnects).toBeGreaterThan(0);
    await page.locator('#ble-connect').evaluate(node=>(node as HTMLButtonElement).click());expect((await stats(page)).options).toHaveLength(1);
    await releaseStage(page,stage);await expect(page.locator('#ble-connect')).toBeEnabled();await expect(page.locator('#ble-calibrate')).toBeDisabled();
    expect((await stats(page)).listeners).toBe(0);expect((await stats(page)).maxConcurrent).toBe(1);
    if(stage==='chooser')expect((await stats(page)).disconnects).toBe(0);
    await holdStage(page,stage,false);await connect(page);await calibrate(page);await expect(page.locator('#start')).toBeEnabled();
  });
}

test('pending notification start disconnects synchronously and serialized rejected cleanup cannot affect the next connection',async({page})=>{
  await setup(page,['start','stop']);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toEqual(['start']);
  await page.locator('#ble-cancel').click();expect((await stats(page)).disconnects).toBeGreaterThan(0);expect((await stats(page)).calls).not.toContain('stop');
  await releaseStage(page,'start');await expect.poll(async()=>(await stats(page)).pending).toEqual(['stop']);await expect(page.locator('#ble-connect')).toBeDisabled();
  await releaseStage(page,'stop',true);await expect(page.locator('#ble-connect')).toBeEnabled();expect((await stats(page)).maxConcurrent).toBe(1);
  await holdStage(page,'start',false);await holdStage(page,'stop',false);await connect(page);await calibrate(page);await page.locator('#start').click();expect((await report(page)).value.samples).toEqual([]);
});

test('one aggregate startup deadline retires a late connect with immediate physical cleanup and no automatic retry',async({page})=>{
  await setup(page,['connect']);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toEqual(['connect']);
  await page.clock.runFor(15000);await expect(page.locator('#ble-status')).toContainText(/time|wait|drain/i);expect((await stats(page)).disconnects).toBeGreaterThan(0);
  await expect(page.locator('#ble-connect')).toBeDisabled();await releaseStage(page,'connect');await expect(page.locator('#ble-connect')).toBeEnabled();
  await expect(page.locator('#ble-calibrate')).toBeDisabled();expect((await stats(page)).options).toHaveLength(1);expect((await stats(page)).maxConcurrent).toBe(1);
});

test('native chooser is not cancelled by blur, queued connected disconnect events are ignored, actual disconnection invalidates readiness',async({page})=>{
  await setup(page,['chooser']);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toEqual(['chooser']);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await releaseStage(page,'chooser');await expect(page.locator('#ble-calibrate')).toBeEnabled();
  await calibrate(page);await connectionEvent(page,true);await expect(page.locator('#start')).toBeEnabled();
  await connectionEvent(page,false);await expect(page.locator('#start')).toBeDisabled();await expect(page.locator('#ble-connect')).toBeEnabled();
  await page.clock.runFor(30000);expect((await stats(page)).options).toHaveLength(1);await emit(page,[2,80]);await expect(page.locator('#start')).toBeDisabled();
});

test('changing next-source intent retires pending work and genuine pagehide disconnects without retaining identity',async({page})=>{
  await setup(page,['chooser']);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toEqual(['chooser']);
  await page.locator('#input-source').selectOption('simulated');await releaseStage(page,'chooser');await expect(page.getByRole('button',{name:'Calibrate & start',exact:true})).toBeEnabled();
  await page.locator('#input-source').selectOption('bluetooth-hr');await holdStage(page,'chooser',false);await connect(page);
  const before=await page.evaluate(()=>Number(sessionStorage.getItem('ble-fixture-disconnect-count')??0));
  await page.goto('/?after-native-pagehide');
  expect(await page.evaluate(()=>Number(sessionStorage.getItem('ble-fixture-disconnect-count')??0))).toBeGreaterThan(before);
  expect((await stats(page)).calls).toEqual([]);
});

test('fixed native failure messages and mobile keyboard connection never expose device identity or provider errors',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await setup(page,[],['service']);await page.locator('#ble-connect').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#ble-connect')).toBeEnabled();await expect(page.locator('#ble-calibrate')).toBeDisabled();
  expect(await page.locator('body').innerText()).not.toContain(PRIVATE_IDENTITY);expect(await page.locator('body').innerText()).not.toContain('RAW NATIVE');
  expect((await stats(page)).calls).toContain('service');expect((await stats(page)).identityReads).toBe(0);expect((await stats(page)).disconnects).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('mobile-bluetooth-failure.png'),fullPage:true});
  await page.locator('#input-source').selectOption('simulated');await page.locator('#start').click();await expect(page.locator('#phase')).toHaveText('In the corridor');
});

test('missing Bluetooth provider leaves the genuine simulator available with clear unsupported guidance',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'bluetooth',{configurable:true,value:undefined}));await page.goto('/');await page.locator('#input-source').selectOption('bluetooth-hr');
  await expect(page.locator('#ble-connect')).toBeDisabled();await expect(page.locator('#ble-status')).toContainText(/unavailable|support|secure/i);
  await page.locator('#input-source').selectOption('simulated');await page.locator('#start').click();await expect(page.locator('#phase')).toHaveText('In the corridor');
});

for(const pending of [false,true]){
  test(`cached page suspension preserves the run and ${pending?'draining connection ownership':'explicit reconnection'}`,async({page})=>{
    await setup(page,pending?['connect']:[]);
    if(pending){
      await page.locator('#input-source').selectOption('simulated');await page.locator('#start').click();
      await page.locator('#input-source').selectOption('bluetooth-hr');await page.locator('#ble-connect').click();
      await expect.poll(async()=>(await stats(page)).pending).toContain('connect');
    }else{await startBle(page);await page.clock.runFor(1);await emit(page,[2,80]);}
    const before=(await report(page)).value;
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await expect(page.locator('#phase')).toHaveText('Paused');
    expect((await report(page)).value.samples).toEqual(before.samples);
    expect((await report(page)).value.source).toBe(before.source);
    if(pending){
      await expect(page.locator('#ble-connect')).toBeDisabled();
      await page.locator('#ble-connect').evaluate(node=>(node as HTMLButtonElement).click());
      expect((await stats(page)).options).toHaveLength(1);
      await holdStage(page,'connect',false);await releaseStage(page,'connect');
    }
    await expect(page.locator('#ble-connect')).toBeEnabled();
    await expect(page.locator('#start')).toBeDisabled();
    expect((await stats(page)).options).toHaveLength(1);
    expect((await stats(page)).listeners).toBe(0);
    await connect(page);await expect(page.locator('#start')).toBeDisabled();
    expect((await stats(page)).options).toHaveLength(2);
    expect((await stats(page)).maxConcurrent).toBe(1);
    expect((await stats(page)).identityReads).toBe(0);
  });
}

test('real cached history return retains the heap and allows deliberate sensor connection',async()=>{
  const browser=await chromium.launch({channel:'chromium',ignoreDefaultArgs:['--disable-back-forward-cache'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  try{
    const context=await browser.newContext();const page=await context.newPage();const pageErrors:string[]=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    // No native Bluetooth device is used: this tests Chromium page lifecycle,
    // then the existing controlled provider's explicit chooser boundary.
    await installBle(page);await page.goto('http://127.0.0.1:4281/');
    await page.locator('#input-source').selectOption('bluetooth-hr');await page.evaluate(()=>{
      const state={shown:false};Object.defineProperty(window,'cachedVisit',{value:state});
      window.addEventListener('pageshow',event=>{if(event.persisted)state.shown=true;});
    });
    await page.goto('http://127.0.0.1:4281/?away');
    // Cached restoration does not fire a new document load event.
    await page.goBack({waitUntil:'commit',timeout:10000});
    await expect.poll(()=>page.evaluate(()=>(window as Window&{cachedVisit?:{shown:boolean}}).cachedVisit?.shown),{timeout:10000}).toBe(true);
    await expect(page.locator('#input-source')).toHaveValue('bluetooth-hr');
    expect((await stats(page)).options).toHaveLength(0);
    await expect(page.locator('#ble-connect')).toBeEnabled();await connect(page);
    expect((await stats(page)).options).toHaveLength(1);expect((await stats(page)).identityReads).toBe(0);
    expect(pageErrors).toEqual([]);
  }finally{await browser.close();}
});
