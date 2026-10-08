import {expect,type CDPSession,type Locator,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import type {Report} from './bluetooth-fixtures.ts';

interface Point{id:number;x:number;y:number;radiusX:number;radiusY:number;force:number}
interface Observation{type:string;trusted:boolean;pointerType:string;pointerId:number;target:string}
type ObservedWindow=Window&{touchObservations:Observation[];movementKeys:number};

// Native browser input only: no production modules, game state or synthetic DOM input.
export class Fingers{
  private readonly points=new Map<number,Point>();
  private readonly nativeIds=new Map<number,number>();
  constructor(private readonly page:Page,private readonly cdp:CDPSession){}
  static async create(page:Page){return new Fingers(page,await page.context().newCDPSession(page));}
  private async dispatch(type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel'){
    await this.cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[...this.points.values()]});
  }
  async down(id:number,control:Locator,offset=0){
    if(!this.points.size)await control.scrollIntoViewIfNeeded();
    const box=await control.boundingBox();if(!box)throw Error('Touch target is not visible.');
    const viewport=this.page.viewportSize()!;const x=box.x+box.width/2+offset,y=box.y+box.height/2;
    expect(x).toBeGreaterThan(0);expect(x).toBeLessThan(viewport.width);expect(y).toBeGreaterThan(0);expect(y).toBeLessThan(viewport.height);
    this.points.set(id,{id,x,y,radiusX:2,radiusY:2,force:1});await this.dispatch('touchStart');
    const native=await this.page.evaluate(()=>(window as unknown as ObservedWindow).touchObservations.filter(event=>event.type==='pointerdown').at(-1));if(!native)throw Error('No native pointerdown receipt.');this.nativeIds.set(id,native.pointerId);
  }
  async shift(id:number,dx:number,dy:number){const point=this.points.get(id);if(!point)throw Error('No held finger.');point.x+=dx;point.y+=dy;await this.dispatch('touchMove');}
  async up(id:number){
    const point=this.points.get(id),nativeId=this.nativeIds.get(id);if(!point||nativeId===undefined)throw Error('No held finger.');
    const before=await this.page.evaluate(()=>(window as unknown as ObservedWindow).touchObservations.length);
    this.points.delete(id);this.nativeIds.delete(id);
    // This Chromium supports selective native touchEnd with the lifted point.
    // Verify its real pointerup receipt instead of assuming partial-lift semantics.
    await this.cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[point]});
    await expect.poll(()=>this.page.evaluate(({before,nativeId})=>(window as unknown as ObservedWindow).touchObservations.slice(before).some(event=>event.type==='pointerup'&&event.pointerId===nativeId&&event.trusted),{before,nativeId})).toBe(true);
  }
  async cancel(){this.points.clear();this.nativeIds.clear();await this.dispatch('touchCancel');}
  async close(){if(this.points.size)await this.cancel();await this.cdp.detach();}
}
export async function observeTouch(page:Page){
  await page.addInitScript(()=>{
    const view=window as unknown as ObservedWindow;view.touchObservations=[];view.movementKeys=0;
    for(const type of['pointerdown','pointerup','pointercancel'])document.addEventListener(type,event=>{
      const pointer=event as PointerEvent,target=pointer.target as HTMLElement;
      view.touchObservations.push({type,trusted:pointer.isTrusted,pointerType:pointer.pointerType,pointerId:pointer.pointerId,target:target.id||target.getAttribute('aria-label')||target.tagName});
    },true);
    document.addEventListener('keydown',event=>{if(['w','a','s','d','e','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Shift'].includes(event.key))view.movementKeys++;},true);
  });
}
export async function trustedOnly(page:Page){
  const data=await page.evaluate(()=>{const view=window as unknown as ObservedWindow;return{events:view.touchObservations,keys:view.movementKeys};});
  expect(data.keys).toBe(0);expect(data.events.filter(event=>event.type==='pointerdown').length).toBeGreaterThan(5);
  expect(data.events.every(event=>event.trusted&&event.pointerType==='touch')).toBe(true);
}
export async function position(page:Page){return(await page.locator('#position').innerText()).split(',').map(Number);}
export async function move(page:Page,fingers:Fingers,x:number,y:number){
  for(const axis of[0,1]){
    const from=await position(page),target=axis===0?x:y,delta=target-from[axis]!;if(Math.abs(delta)<3)continue;
    const name=axis===0?(delta>0?'Move right':'Move left'):(delta>0?'Move down':'Move up');
    await fingers.down(1,page.getByRole('button',{name,exact:true}));await page.clock.runFor(Math.abs(delta)/130*1000+16);await fingers.up(1);
  }
  const actual=await position(page);expect(Math.abs(actual[0]!-x)).toBeLessThan(5);expect(Math.abs(actual[1]!-y)).toBeLessThan(5);
}
export async function interact(page:Page,fingers:Fingers,ms=100){await fingers.down(1,page.getByRole('button',{name:'Hold to interact',exact:true}));await page.clock.runFor(ms);await fingers.up(1);}
export async function prerequisites(page:Page,fingers:Fingers){
  await move(page,fingers,250,110);await interact(page,fingers);await expect(page.locator('#goal-fuse')).toHaveClass('done');
  await move(page,fingers,520,230);await interact(page,fingers);await expect(page.locator('#goal-power')).toHaveClass('done');
  await move(page,fingers,740,110);await interact(page,fingers);await expect(page.locator('#goal-key')).toHaveClass('done');
  await move(page,fingers,1030,160);
}
export async function escape(page:Page,fingers:Fingers){
  await prerequisites(page,fingers);await page.getByRole('button',{name:'Steady: off',exact:true}).tap();await interact(page,fingers,4200);await expect(page.locator('#lock')).toHaveText('100%');
  await page.getByRole('button',{name:'Steady: on',exact:true}).tap();await move(page,fingers,1160,160);await interact(page,fingers);await expect(page.locator('#phase')).toHaveText('Escaped');
}
export async function report(page:Page){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download run report',exact:true}).tap();const file=await pending,text=await readFile((await file.path())!,'utf8');return{value:JSON.parse(text) as Report,text,name:file.suggestedFilename()};}
