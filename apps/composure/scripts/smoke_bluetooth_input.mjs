/* global window, document, navigator, EventTarget, Event, isSecureContext, innerWidth, localStorage, sessionStorage, structuredClone */
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import process from 'node:process';
import {URL} from 'node:url';
import console from 'node:console';
import {chromium} from '@playwright/test';

if(!process.env.COMPOSURE_BLE_BASE_URL)throw Error('Set COMPOSURE_BLE_BASE_URL to an existing Composure preview; this script does not build or start a server.');
const base=new URL(process.env.COMPOSURE_BLE_BASE_URL);
if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/') {
  throw Error('COMPOSURE_BLE_BASE_URL must be an HTTP(S) root URL without credentials, query or fragment.');
}
const origin=base.href;
const output=process.env.COMPOSURE_BLE_OUTPUT ? resolve(process.env.COMPOSURE_BLE_OUTPUT) : await mkdtemp(join(tmpdir(),'composure-bluetooth-'));
if(process.env.COMPOSURE_BLE_OUTPUT){
  try{await mkdir(output);}catch(error){
    throw new Error('COMPOSURE_BLE_OUTPUT must be a new directory with a writable parent; existing evidence is never overwritten.',{cause:error});
  }
}
const profiles=join(output,'profiles');
await mkdir(profiles);
const wallStartedAt=new Date().toISOString(),wallStarted=performance.now();
const verification={
  schemaVersion:1,origin,executablePath:process.env.CHROMIUM_PATH??'Playwright bundled Chromium',output,profiles,wallStartedAt,
  claims:{physicalDevice:false,deviceCompatibility:false,measurementAccuracy:false},
  method:{productionApp:true,productionImports:false,gameStateInjection:false,appStorageInjection:false,
    controlledBoundary:'Only navigator.bluetooth uses independent EventTarget/DataView packets.',
    cleanupTelemetry:'One unique sessionStorage probe key is incremented synchronously inside controlled GATT disconnect; no app preference or reading key is written.',
    controlledTime:'Playwright page.clock pauses and advances performance.now, timers and native animation frames; no wall-time or hardware timing claim.',
    keyboard:'Native Playwright keyboard events and displayed coordinates control all escape movement.'},
  unmodified:[],controlled:[],artifacts:[],errors:[],
};
const contexts=[];
let interrupted=false;
function errorRecord(error){return error instanceof Error ? {name:error.name,message:error.message,stack:error.stack} : {name:'Error',message:String(error)};}
function interrupt(signal){
  if(interrupted)return;
  interrupted=true;verification.passed=false;process.exitCode=1;
  verification.errors.push({name:'Interrupted',message:`Received ${signal}; closing owned browser contexts.`});
  void Promise.allSettled(contexts.map(browser=>browser.close()));
}
const onSigint=()=>interrupt('SIGINT'),onSigterm=()=>interrupt('SIGTERM');
process.once('SIGINT',onSigint);process.once('SIGTERM',onSigterm);

async function context(name,mobile=false){
  if(interrupted)throw Error('Smoke interrupted before browser launch.');
  const result=await chromium.launchPersistentContext(`${profiles}/${name}`,{
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,
    viewport:mobile ? {width:390,height:844} : {width:1440,height:1080},
    isMobile:mobile,hasTouch:mobile,acceptDownloads:true,
  });
  contexts.push(result);
  if(interrupted)throw Error('Smoke interrupted during browser launch.');
  return result;
}
async function screenshot(page,name){
  const path=`${output}/${name}.png`;
  await page.screenshot({path,fullPage:true});verification.artifacts.push(path);
  return path;
}
async function download(page,name){
  const pending=page.waitForEvent('download');
  await page.locator('#report').click();
  const native=await pending;
  assert.equal(native.suggestedFilename(),'composure-bluetooth-hr-run.json');
  const path=`${output}/${name}.json`;
  await native.saveAs(path);
  assert.equal(await native.failure(),null);
  const text=await readFile(path,'utf8');
  verification.artifacts.push(path);
  return {path,text,value:JSON.parse(text)};
}

// This initializer owns only the browser-facing provider and observations of it.
function installProvider({telemetryKey}){
  const stats={requests:[],calls:[],disconnects:0,identityReads:0,packets:[],listeners:0};
  class TrackedTarget extends EventTarget{
    owned=new Map();
    addEventListener(type,listener,options){
      if(listener){let list=this.owned.get(type);if(!list){list=new Set();this.owned.set(type,list);}if(!list.has(listener)){list.add(listener);stats.listeners++;}}
      super.addEventListener(type,listener,options);
    }
    removeEventListener(type,listener,options){
      if(this.owned.get(type)?.delete(listener))stats.listeners--;
      super.removeEventListener(type,listener,options);
    }
  }
  const characteristic=new TrackedTarget();
  characteristic.properties={notify:true,indicate:false};
  characteristic.value=new DataView(Uint8Array.of(2,70).buffer);
  characteristic.startNotifications=async()=>{stats.calls.push('start');return characteristic;};
  characteristic.stopNotifications=async()=>{stats.calls.push('stop');return characteristic;};
  const device=new TrackedTarget();
  for(const field of ['name','id'])Object.defineProperty(device,field,{get(){stats.identityReads++;return 'PRIVATE_PROBE_IDENTITY';}});
  const service={async getCharacteristic(uuid){assertUuid(uuid,'heart_rate_measurement');stats.calls.push('characteristic');return characteristic;}};
  const gatt={connected:false,async connect(){stats.calls.push('connect');this.connected=true;return this;},
    disconnect(){stats.calls.push('disconnect');stats.disconnects++;this.connected=false;
      sessionStorage.setItem(telemetryKey,String(Number(sessionStorage.getItem(telemetryKey)??0)+1));},
    async getPrimaryService(uuid){assertUuid(uuid,'heart_rate');stats.calls.push('service');return service;}};
  device.gatt=gatt;
  function assertUuid(actual,expected){if(actual!==expected)throw Error('Unexpected probe service request.');}
  Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{async requestDevice(options){
    stats.requests.push(structuredClone(options));stats.calls.push('chooser');return device;
  }}});
  window.__composureProbe={stats,emit(bytes){
    // Deliberately offset view with unrelated guard bytes on both sides.
    const backing=Uint8Array.from([0xff,...bytes,0xff]);
    characteristic.value=new DataView(backing.buffer,1,bytes.length);
    stats.packets.push({bytes:[...bytes],at:performance.now()});
    characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
  }};
}

async function unmodified(mobile){
  const name=mobile?'unmodified-mobile':'unmodified-desktop';
  const browser=await context(name,mobile),page=browser.pages()[0]??await browser.newPage();
  await page.goto(origin);await page.locator('#input-source').waitFor();
  const native=await page.evaluate(()=>({secureContext:isSecureContext,bluetoothPresent:'bluetooth' in navigator,
    requestDeviceType:typeof navigator.bluetooth?.requestDevice,userAgent:navigator.userAgent,platform:navigator.platform}));
  await page.locator('#input-source').selectOption('bluetooth-hr');
  const controls={connectEnabled:await page.locator('#ble-connect').isEnabled(),startEnabled:await page.locator('#start').isEnabled(),
    status:await page.locator('#ble-status').innerText(),calibration:await page.locator('#ble-calibration').innerText()};
  assert.equal(controls.startEnabled,false);
  if(!native.secureContext||native.requestDeviceType!=='function')assert.equal(controls.connectEnabled,false);
  const image=await screenshot(page,name);
  await page.locator('#input-source').selectOption('simulated');
  await page.locator('#start').click();assert.equal(await page.locator('#phase').innerText(),'In the corridor');
  verification.unmodified.push({name,browserVersion:browser.browser()?.version(),...native,controls,simulatorStarted:true,image});
  await browser.close();contexts.splice(contexts.indexOf(browser),1);
}

async function position(page){return (await page.locator('#position').innerText()).split(',').map(Number);}
async function moveTo(page,x,y){
  await page.locator('canvas').focus();
  await page.keyboard.down('Shift');
  for(const [axis,target,negative,positive] of [[0,x,'ArrowLeft','ArrowRight'],[1,y,'ArrowUp','ArrowDown']]){
    let rounds=0;
    while(Math.abs((await position(page))[axis]-target)>7){
      if(++rounds>180)throw Error('Keyboard movement failed to approach displayed objective.');
      const key=(await position(page))[axis]<target?positive:negative;
      await page.keyboard.down(key);await page.clock.runFor(80);await page.keyboard.up(key);
      assert.equal(await page.locator('#phase').innerText(),'In the corridor');
    }
  }
  await page.keyboard.up('Shift');
}
async function interact(page,milliseconds=200){
  await page.locator('canvas').focus();await page.keyboard.down('Shift');await page.keyboard.down('e');
  await page.clock.runFor(milliseconds);await page.keyboard.up('e');await page.keyboard.up('Shift');
}
async function controlled(mobile){
  const name=mobile?'controlled-mobile':'controlled-desktop';
  const browser=await context(name,mobile),page=browser.pages()[0]??await browser.newPage();
  const localErrors=[];
  page.on('pageerror',error=>localErrors.push(error.message));
  const telemetryKey=`composure-native-probe-cleanup-${randomUUID()}`;
  await page.addInitScript(installProvider,{telemetryKey});
  const fixed=new Date('2026-10-04T12:00:00Z');
  await page.clock.install({time:fixed});await page.clock.pauseAt(fixed);
  await page.goto(origin);await page.locator('#input-source').waitFor();
  await page.locator('#scares').uncheck();await page.locator('#reduced').check();await page.locator('#muted').check();
  await page.locator('#save').click();
  const settingsBefore=await page.evaluate(()=>localStorage.getItem('composure-settings-v1'));
  const preference=JSON.parse(settingsBefore);
  assert.deepEqual(preference,{schemaVersion:1,baseline:70,scares:false,reducedMotion:true,muted:true,bestSeconds:null});
  await page.locator('#input-source').selectOption('bluetooth-hr');
  await page.locator('#ble-connect').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#ble-calibrate').disabled);
  await page.locator('#ble-calibrate').click();
  const calibrationStartedAt=await page.evaluate(()=>performance.now());
  assert.match(await page.locator('#ble-calibration').innerText(),/0\/5/);
  for(let i=0;i<5;i++){
    if(i)await page.clock.runFor(1000);
    await page.evaluate(bytes=>window.__composureProbe.emit(bytes),[2,68+i]);
    assert.match(await page.locator('#ble-calibration').innerText(),new RegExp(`${i+1}/5`));
  }
  assert.match(await page.locator('#ble-calibration').innerText(),/Baseline 70 BPM/);
  assert.equal(await page.locator('#start').isEnabled(),true);
  const readyImage=await screenshot(page,`${name}-baseline`);
  await page.locator('#start').click();
  const startedAt=await page.evaluate(()=>performance.now());
  const initial=await download(page,`${name}-empty-run`);
  assert.equal(initial.value.source,'bluetooth-hr');assert.deepEqual(initial.value.samples,[]);
  await page.clock.runFor(100);
  await page.evaluate(()=>window.__composureProbe.emit([2,70]));
  await page.clock.runFor(20);
  assert.match(await page.locator('#sensor').innerText(),/70 BPM.*Bluetooth notification/);
  const image=await screenshot(page,`${name}-running`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(!mobile){
    await moveTo(page,250,110);await interact(page);assert.match(await page.locator('#goal-fuse').getAttribute('class'),/done/);
    await moveTo(page,520,230);await interact(page);assert.match(await page.locator('#goal-power').getAttribute('class'),/done/);
    await moveTo(page,740,110);await interact(page);assert.match(await page.locator('#goal-key').getAttribute('class'),/done/);
    await moveTo(page,1030,160);await interact(page,4300);assert.equal(await page.locator('#lock').innerText(),'100%');
    await moveTo(page,1160,160);await interact(page);assert.equal(await page.locator('#phase').innerText(),'Escaped');
  }
  const final=await download(page,`${name}-run`);
  const result=final.value,stats=await page.evaluate(()=>structuredClone(window.__composureProbe.stats));
  assert.equal(result.schemaVersion,2);assert.equal(result.source,'bluetooth-hr');assert.equal(result.baselineBpm,70);
  assert.deepEqual(Object.keys(result).sort(),['schemaVersion','source','scenario','baselineBpm','scares','outcome','loss','activeSeconds',
    'objectives','samples','events','truncatedSamples','truncatedEvents','limitations','calibration'].sort());
  assert.equal(result.scenario,'observatory-escape-v1');assert.equal(result.scares,false);
  assert.ok(Number.isFinite(result.activeSeconds)&&result.activeSeconds>=0&&result.activeSeconds<=180);
  assert.deepEqual(result.calibration,{baselineBpm:70,samples:[68,69,70,71,72].map((bpm,i)=>({bpm,receivedSeconds:i})),spanSeconds:4,runStartedSeconds:(startedAt-calibrationStartedAt)/1000});
  assert.equal(result.samples.length,1);assert.equal(result.samples[0].bpm,70);
  assert.equal(result.samples[0].receivedSeconds,(stats.packets[5].at-calibrationStartedAt)/1000);
  assert.ok(result.samples[0].receivedSeconds>result.calibration.runStartedSeconds);
  assert.ok(result.samples[0].time>=0&&result.samples[0].time<1);
  assert.ok(result.events.length<=256);assert.ok(result.samples.length<=256);
  assert.deepEqual(Object.keys(result.samples[0]).sort(),['time','bpm','receivedSeconds'].sort());
  for(const event of result.events){
    assert.deepEqual(Object.keys(event).sort(),['time','kind','text'].sort());
    assert.ok(Number.isFinite(event.time)&&event.time>=0&&event.time<=result.activeSeconds);
    assert.equal(typeof event.kind,'string');assert.equal(typeof event.text,'string');
    assert.ok(event.kind.length<100&&event.text.length<1000);
  }
  assert.equal(result.truncatedSamples,false);assert.equal(result.truncatedEvents,false);
  if(!mobile){assert.equal(result.outcome,'won');assert.deepEqual(result.objectives,{fuse:true,power:true,key:true,unlocked:true});}
  for(const key of ['connectionId','receivedAtMs','startedAtMs','completedAtMs','energy','rrCount','deviceId','deviceName'])assert.ok(!final.text.includes(`"${key}"`));
  assert.ok(!final.text.includes('PRIVATE_PROBE_IDENTITY'));assert.ok(final.text.length<100000);
  assert.match(result.limitations,/compatibility and accuracy are unverified/);
  assert.equal(stats.identityReads,0);assert.deepEqual(stats.requests,[{filters:[{services:['heart_rate']}]}]);
  const settingsAfter=await page.evaluate(()=>localStorage.getItem('composure-settings-v1'));
  assert.equal(settingsAfter,settingsBefore);
  const savedKeys=await page.evaluate(()=>Object.keys(localStorage));assert.deepEqual(savedKeys,['composure-settings-v1']);
  const finalImage=await screenshot(page,`${name}-final`);
  const disconnectsBefore=await page.evaluate(key=>Number(sessionStorage.getItem(key)??0),telemetryKey);
  await page.goto(`${origin}?native-probe-after-pagehide`);
  await page.locator('#input-source').waitFor();
  const disconnectsAfter=await page.evaluate(key=>Number(sessionStorage.getItem(key)??0),telemetryKey);
  assert.ok(disconnectsAfter>disconnectsBefore,'A genuine navigation must synchronously disconnect the owned GATT.');
  assert.equal(await page.locator('#input-source').inputValue(),'simulated');
  assert.equal(await page.locator('#phase').innerText(),'Ready to calibrate');
  assert.equal(await page.evaluate(()=>window.__composureProbe.stats.requests.length),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('composure-settings-v1')),settingsBefore);
  assert.deepEqual(localErrors,[]);
  verification.controlled.push({name,browserVersion:browser.browser()?.version(),readyImage,image,finalImage,
    calibrationStartedAt,startedAt,stats,reportPath:final.path,initialReportPath:initial.path,
    outcome:result.outcome,preferencesExact:true,onlyPreferencesStored:true,noAutoReconnectAfterNavigation:true,
    genuinePagehideDisconnectSignals:disconnectsAfter-disconnectsBefore,cleanupTelemetryKey:telemetryKey,pageErrors:localErrors});
  await browser.close();contexts.splice(contexts.indexOf(browser),1);
}

try{
  await unmodified(false);await unmodified(true);
  await controlled(false);await controlled(true);
  verification.passed=!interrupted;
}catch(error){verification.passed=false;verification.errors.push(errorRecord(error));process.exitCode=1;}
finally{
  const cleanup=await Promise.allSettled(contexts.map(browser=>browser.close()));
  for(const result of cleanup){
    if(result.status==='rejected'){verification.passed=false;process.exitCode=1;verification.errors.push(errorRecord(result.reason));}
  }
  verification.ownedBrowserCleanupSucceeded=cleanup.every(result=>result.status==='fulfilled');
  verification.wallCompletedAt=new Date().toISOString();
  verification.wallElapsedSeconds=(performance.now()-wallStarted)/1000;
  verification.artifactDetails=[];
  for(const path of verification.artifacts){
    try{const data=await readFile(path);verification.artifactDetails.push({path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
    catch(error){verification.passed=false;process.exitCode=1;verification.errors.push(errorRecord(error));}
  }
  await writeFile(`${output}/verification.json`,JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
  process.removeListener('SIGINT',onSigint);process.removeListener('SIGTERM',onSigterm);
  console.log(JSON.stringify({passed:verification.passed,verification:`${output}/verification.json`,artifacts:verification.artifacts},null,2));
}
