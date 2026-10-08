import {expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

export type Stage='chooser'|'connect'|'service'|'characteristic'|'start'|'stop';
interface Deferred {stage:Stage;resolve():void;reject(reason:Error):void}
export interface BleStats {calls:Stage[];options:unknown[];disconnects:number;identityReads:number;pending:Stage[];maxConcurrent:number;notifications:number;listeners:number}
interface Harness {
  calls:Stage[];options:unknown[];disconnects:number;identityReads:number;pending:Deferred[];
  held:Stage[];fail:Stage[];concurrent:number;maxConcurrent:number;notifications:number;listeners:number;
  emit(bytes:number[],offset:number):void; disconnectEvent(connected:boolean):void;
}
type BleWindow=Window&typeof globalThis&{bleFixture:Harness};
export const PRIVATE_IDENTITY='PRIVATE_DEVICE_IDENTITY_MUST_NOT_ESCAPE';

// Only the browser Bluetooth boundary is controlled. Real DOM EventTarget and
// offset DataViews deliver hand-authored packets; no game/model globals exist.
export async function installBle(page:Page,held:Stage[]=[],fail:Stage[]=[]):Promise<void>{
  await page.addInitScript(({held,fail,identity})=>{
    const state:Harness={calls:[],options:[],disconnects:0,identityReads:0,pending:[],held,fail,concurrent:0,maxConcurrent:0,notifications:0,listeners:0,
      emit(){throw Error('not mounted');},disconnectEvent(){throw Error('not mounted');}};
    (window as BleWindow).bleFixture=state;
    async function step(stage:Stage):Promise<void>{
      state.calls.push(stage);state.concurrent++;state.maxConcurrent=Math.max(state.maxConcurrent,state.concurrent);
      try{if(state.held.includes(stage))await new Promise<void>((resolve,reject)=>state.pending.push({stage,resolve,reject}));
        if(state.fail.includes(stage))throw new Error(`${identity}: RAW NATIVE ${stage} ERROR`);
      }finally{state.concurrent--;}
    }
    class Characteristic extends EventTarget {
      private active=new Set<EventListenerOrEventListenerObject>();
      properties={notify:true,indicate:false};value:DataView|null=new DataView(Uint8Array.from([2,70]).buffer);
      override addEventListener(type:string,listener:EventListenerOrEventListenerObject|null,options?:AddEventListenerOptions|boolean){if(type==='characteristicvaluechanged'&&listener&&!this.active.has(listener)){this.active.add(listener);state.listeners++;}super.addEventListener(type,listener,options);}
      override removeEventListener(type:string,listener:EventListenerOrEventListenerObject|null,options?:EventListenerOptions|boolean){if(type==='characteristicvaluechanged'&&listener&&this.active.delete(listener))state.listeners--;super.removeEventListener(type,listener,options);}
      async startNotifications(){await step('start');return this;}
      async stopNotifications(){await step('stop');return this;}
      readValue(){throw new Error('Forbidden reading polling');}
      writeValue(){throw new Error('Forbidden control point write');}
    }
    const characteristic=new Characteristic();
    const service={async getCharacteristic(uuid:string){if(uuid!=='heart_rate_measurement')throw Error('Wrong characteristic');await step('characteristic');return characteristic;}};
    class Device extends EventTarget {
      get name(){state.identityReads++;return identity;}get id(){state.identityReads++;return identity;}
      gatt={connected:false,
        async connect(){await step('connect');this.connected=true;return this;},
        disconnect(){state.disconnects++;this.connected=false;console.debug('BLE_FIXTURE_DISCONNECT');sessionStorage.setItem('ble-fixture-disconnect-count',String(Number(sessionStorage.getItem('ble-fixture-disconnect-count')??0)+1));device.dispatchEvent(new Event('gattserverdisconnected'));},
        async getPrimaryService(uuid:string){if(uuid!=='heart_rate')throw Error('Wrong service');await step('service');return service;},
      };
    }
    const device=new Device();
    const provider={async requestDevice(options:unknown){state.options.push(structuredClone(options));await step('chooser');return device;}};
    Object.defineProperty(navigator,'bluetooth',{configurable:true,value:provider});
    state.emit=(bytes,offset)=>{const storage=new Uint8Array(offset+bytes.length+3).fill(255);storage.set(bytes,offset);characteristic.value=new DataView(storage.buffer,offset,bytes.length);state.notifications++;characteristic.dispatchEvent(new Event('characteristicvaluechanged'));storage.fill(0);};
    state.disconnectEvent=connected=>{device.gatt.connected=connected;device.dispatchEvent(new Event('gattserverdisconnected'));};
  },{held,fail,identity:PRIVATE_IDENTITY});
}
export async function stats(page:Page):Promise<BleStats>{return page.evaluate(()=>{const s=(window as BleWindow).bleFixture;return{calls:s.calls,options:s.options,disconnects:s.disconnects,identityReads:s.identityReads,pending:s.pending.map(p=>p.stage),maxConcurrent:s.maxConcurrent,notifications:s.notifications,listeners:s.listeners};});}
export async function emit(page:Page,bytes:number[],offset=5){await page.evaluate(({bytes,offset})=>(window as BleWindow).bleFixture.emit(bytes,offset),{bytes,offset});}
export async function releaseStage(page:Page,stage:Stage,reject=false){await page.evaluate(({stage,reject})=>{const s=(window as BleWindow).bleFixture,index=s.pending.findIndex(item=>item.stage===stage);if(index<0)throw Error(`No pending ${stage}`);const item=s.pending.splice(index,1)[0];if(reject)item.reject(new Error('RAW PRIVATE CLEANUP ERROR'));else item.resolve();}, {stage,reject});}
export async function holdStage(page:Page,stage:Stage,held=true){await page.evaluate(({stage,held})=>{const s=(window as BleWindow).bleFixture;s.held=s.held.filter(value=>value!==stage);if(held)s.held.push(stage);},{stage,held});}
export async function connectionEvent(page:Page,connected:boolean){await page.evaluate(connected=>(window as BleWindow).bleFixture.disconnectEvent(connected),connected);}
export async function setup(page:Page,held:Stage[]=[],fail:Stage[]=[]){await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2030-01-01T00:00:00Z'));await installBle(page,held,fail);await page.goto('/');await page.locator('#scares').uncheck();await page.locator('#input-source').selectOption('bluetooth-hr');}
export async function connect(page:Page){await page.locator('#ble-connect').click();await expect(page.locator('#ble-calibrate')).toBeEnabled();}
export async function calibrate(page:Page,values=[78,80,82,80,80]){await page.locator('#ble-calibrate').click();for(let i=0;i<values.length;i++){if(i)await page.clock.runFor(1000);await emit(page,[2,values[i]]);}await expect(page.locator('#start')).toBeEnabled();}
export async function startBle(page:Page){await connect(page);await calibrate(page);await page.locator('#start').click();await expect(page.locator('#phase')).toHaveText('In the corridor');}
export interface Report {schemaVersion:number;source:string;baselineBpm:number;outcome:string;activeSeconds:number;samples:{time:number;bpm:number;receivedSeconds?:number}[];events:{kind:string}[];calibration?:{baselineBpm:number;samples:{bpm:number;receivedSeconds:number}[];spanSeconds:number;runStartedSeconds:number};truncatedSamples:boolean;[key:string]:unknown}
export async function report(page:Page):Promise<{value:Report;filename:string;text:string}>{const pending=page.waitForEvent('download');await page.locator('#report').click();const file=await pending;const text=await readFile((await file.path())!,'utf8');return{value:JSON.parse(text) as Report,filename:file.suggestedFilename(),text};}
export async function position(page:Page):Promise<number[]>{return(await page.locator('#position').innerText()).split(',').map(Number);}
export async function move(page:Page,x:number,y:number){for(const axis of [0,1]){const p=await position(page),target=axis===0?x:y,delta=target-p[axis];if(Math.abs(delta)<3)continue;const key=axis===0?(delta>0?'d':'a'):(delta>0?'s':'w');await page.keyboard.down(key);await page.clock.runFor(Math.abs(delta)/130*1000+16);await page.keyboard.up(key);}}
export async function interact(page:Page,ms=100){await page.keyboard.down('e');await page.clock.runFor(ms);await page.keyboard.up('e');}
