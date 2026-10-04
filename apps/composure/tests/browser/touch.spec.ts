import {expect,test} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {Fingers,observeTouch,trustedOnly,position,prerequisites,escape,report} from './touch-helper.ts';
import {installBle,emit,stats,PRIVATE_IDENTITY} from './bluetooth-fixtures.ts';

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
test.beforeEach(async({page})=>{await observeTouch(page);const time=new Date('2030-01-01T00:00:00Z');await page.clock.install({time});await page.clock.pauseAt(time);});
async function evidence(name:string,text:string){await mkdir(test.info().outputDir,{recursive:true});const path=test.info().outputPath(name);await writeFile(path,text);await test.info().attach(name,{path,contentType:'application/json'});}
test.afterEach(async({page})=>{await evidence('trusted-touch-events.json',JSON.stringify(await page.evaluate(()=>(window as unknown as {touchObservations:unknown[]}).touchObservations),null,2));});
async function simulator(page:import('@playwright/test').Page){await page.goto('/');await page.locator('#scares').tap();await page.getByRole('button',{name:'Calibrate & start',exact:true}).tap();await page.clock.runFor(50);}

test('native390px touch alone completes fuse power key steady lock and exit with a genuine simulated win report and durable preferences',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await simulator(page);const fingers=await Fingers.create(page);
  try{await escape(page,fingers);const downloaded=await report(page);expect(downloaded.value).toMatchObject({schemaVersion:1,source:'simulated',outcome:'won',baselineBpm:70,objectives:{fuse:true,power:true,key:true,unlocked:true}});
    expect(downloaded.value.events.map(event=>event.kind)).toEqual(['start','fuse','power','key','unlock','win']);expect(downloaded.value.samples.length).toBeGreaterThan(5);await trustedOnly(page);
    const saved=await page.evaluate(()=>localStorage.getItem('composure-settings-v1'));expect(saved).not.toContain('samples');expect(saved).not.toContain('events');expect(JSON.parse(saved!).bestSeconds).toBeGreaterThan(4);
    await evidence('native-touch-simulated-win.json',downloaded.text);await evidence('winning-trusted-touch-events.json',JSON.stringify(await page.evaluate(()=>(window as unknown as {touchObservations:unknown[]}).touchObservations),null,2));await page.screenshot({path:test.info().outputPath('native-touch-win-390px.png'),fullPage:true});await page.reload();await expect(page.locator('#phase')).toHaveText('Ready to calibrate');await expect(page.locator('#best')).toContainText('Best completed run');expect(await page.evaluate(()=>localStorage.getItem('composure-settings-v1'))).toBe(saved);expect(errors).toEqual([]);
  }finally{await fingers.close();}
});

test('genuine multiple contacts retain movement ownership independently and touchCancel releases every held control',async({page})=>{
  await simulator(page);const fingers=await Fingers.create(page),right=page.getByRole('button',{name:'Move right',exact:true});
  try{await fingers.down(1,right,-8);await page.clock.runFor(100);await fingers.down(2,right,8);await page.clock.runFor(100);await fingers.up(2);const one=await position(page);await page.clock.runFor(300);expect((await position(page))[0]).toBeGreaterThan(one[0]!+20);
    await fingers.up(1);const stopped=await position(page);await page.clock.runFor(300);expect(await position(page)).toEqual(stopped);
    await fingers.down(1,right);await fingers.down(2,page.getByRole('button',{name:'Hold to interact',exact:true}));await page.clock.runFor(100);await fingers.up(2);const continued=await position(page);await page.clock.runFor(200);expect((await position(page))[0]).toBeGreaterThan(continued[0]!+10);await fingers.cancel();const cancelled=await position(page);await page.clock.runFor(500);expect(await position(page)).toEqual(cancelled);
    const observed=await page.evaluate(()=> (window as unknown as {touchObservations:{type:string;trusted:boolean}[]}).touchObservations);expect(observed.some(event=>event.type==='pointercancel'&&event.trusted)).toBe(true);await trustedOnly(page);
  }finally{await fingers.close();}
});

test('two genuine fingers on Hold to interact keep the older lock hold after the newer contact lifts',async({page})=>{
  await simulator(page);const fingers=await Fingers.create(page),hold=page.getByRole('button',{name:'Hold to interact',exact:true});
  try{await prerequisites(page,fingers);await page.getByRole('button',{name:'Steady: off',exact:true}).tap();await fingers.down(1,hold,-8);await page.clock.runFor(300);await fingers.down(2,hold,8);await page.clock.runFor(300);await fingers.up(2);
    const before=Number((await page.locator('#lock').innerText()).replace('%',''));await page.clock.runFor(800);const after=Number((await page.locator('#lock').innerText()).replace('%',''));expect(after).toBeGreaterThan(before+10);
    await fingers.up(1);const released=Number((await page.locator('#lock').innerText()).replace('%',''));await page.clock.runFor(300);expect(Number((await page.locator('#lock').innerText()).replace('%',''))).toBeLessThanOrEqual(released);await trustedOnly(page);
  }finally{await fingers.close();}
});

test('native slight finger travel keeps the held interaction usable instead of handing the gesture to page panning',async({page})=>{
  await simulator(page);const fingers=await Fingers.create(page);try{await prerequisites(page,fingers);await page.getByRole('button',{name:'Steady: off',exact:true}).tap();await fingers.down(1,page.getByRole('button',{name:'Hold to interact',exact:true}));await page.clock.runFor(200);await fingers.shift(1,0,24);await page.clock.runFor(4200);await expect(page.locator('#lock')).toHaveText('100%');await fingers.up(1);await trustedOnly(page);}finally{await fingers.close();}
});

test('touch Pause Resume and native touchCancel preserve paused time and do not replay old held movement',async({page})=>{
  await simulator(page);const fingers=await Fingers.create(page),right=page.getByRole('button',{name:'Move right',exact:true});
  try{await fingers.down(1,right);await page.clock.runFor(200);await fingers.up(1);await page.getByRole('button',{name:'Pause',exact:true}).tap();await expect(page.locator('#phase')).toHaveText('Paused');const paused=await position(page),timer=await page.locator('#timer').innerText();await page.clock.runFor(2000);expect(await position(page)).toEqual(paused);await expect(page.locator('#timer')).toHaveText(timer);
    await page.getByRole('button',{name:'Resume',exact:true}).tap();await page.clock.runFor(300);expect(await position(page)).toEqual(paused);
    // Real tab activation/window minimization remained visible in this headless
    // browser; controlled hide tests elsewhere are not relabelled native here.
    await fingers.down(1,right);await page.clock.runFor(200);await fingers.cancel();const cancelled=await position(page);await page.getByRole('button',{name:'Pause',exact:true}).tap();await page.clock.runFor(500);await page.getByRole('button',{name:'Resume',exact:true}).tap();await page.clock.runFor(500);expect(await position(page)).toEqual(cancelled);await trustedOnly(page);
  }finally{await fingers.close();}
});

test('controlled standardBLE packets support a complete native touch escape without mixing simulator data or claiming physical hardware',async({page})=>{
  await installBle(page);await page.goto('/');await page.locator('#scares').tap();await page.locator('#input-source').selectOption('bluetooth-hr');const saved=await page.evaluate(()=>localStorage.getItem('composure-settings-v1'));
  await page.locator('#ble-connect').tap();await expect(page.locator('#ble-calibrate')).toBeEnabled();await page.locator('#ble-calibrate').tap();for(let i=0;i<5;i++){if(i)await page.clock.runFor(1000);await emit(page,[2,70]);}await page.locator('#start').tap();expect((await report(page)).value.samples).toEqual([]);await page.clock.runFor(1);await emit(page,[2,70]);
  const fingers=await Fingers.create(page);try{await escape(page,fingers);const downloaded=await report(page);expect(downloaded.value).toMatchObject({schemaVersion:2,source:'bluetooth-hr',outcome:'won',baselineBpm:70});expect(downloaded.value.calibration?.samples).toHaveLength(5);expect(downloaded.value.samples).toHaveLength(1);expect(downloaded.text).not.toContain(PRIVATE_IDENTITY);expect((await stats(page)).identityReads).toBe(0);expect(await page.evaluate(()=>localStorage.getItem('composure-settings-v1'))).toBe(saved);await trustedOnly(page);await evidence('native-touch-controlled-bluetooth-win.json',downloaded.text);}finally{await fingers.close();}
});
