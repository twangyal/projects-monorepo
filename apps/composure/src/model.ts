export interface Controls { x:number; y:number; interact:boolean; steady:boolean; aim?:{x:number;y:number} }
export interface RunEvent { time:number; kind:string; text:string }
export interface Reading { time:number; bpm:number }
export interface Run {
  baseline:number; scares:boolean; phase:'running'|'paused'|'won'|'lost'; loss:string|null;
  time:number; remainder:number; x:number; y:number; tension:number; shock:number; noise:number;
  fuse:boolean; power:boolean; key:boolean; lock:number; unlocked:boolean; scareSeen:boolean;
  sensor:'missing'|'fresh'|'stale'; samples:Reading[]; events:RunEvent[];
  truncatedSamples:boolean; truncatedEvents:boolean; fumbleAt:number; message:string;
}
export const WORLD={width:1200,height:320,step:1/60,timeLimit:180} as const;
const clamp=(value:number,min:number,max:number):number=>Math.max(min,Math.min(max,value));
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function calibrate(readings:number[]):number {
  if(!Array.isArray(readings)||readings.length!==5||!readings.every(n=>finite(n)&&n>=40&&n<=120)||Math.max(...readings)-Math.min(...readings)>12) throw new Error('Use five simulated baseline readings from 40–120 BPM with at most 12 BPM spread.');
  return readings.reduce((a,b)=>a+b,0)/5;
}
function event(run:Run,kind:string,text:string):void {
  run.events.push({time:run.time,kind,text});if(run.events.length>256){run.events.shift();run.truncatedEvents=true;}run.message=text;
}
export function newRun(baseline:number,scares:boolean):Run {
  if(!finite(baseline)||baseline<40||baseline>120||typeof scares!=='boolean')throw new Error('Invalid simulated calibration.');
  return {baseline,scares,phase:'running',loss:null,time:0,remainder:0,x:80,y:160,tension:0,shock:0,noise:0,fuse:false,power:false,key:false,lock:0,unlocked:false,scareSeen:false,sensor:'missing',samples:[],events:[{time:0,kind:'start',text:'Find a fuse and key; restore power, steady the lock and escape.'}],truncatedSamples:false,truncatedEvents:false,fumbleAt:0,message:'Find the fuse on the upper shelf.'};
}
export function sample(run:Run,bpm:number):boolean {
  if(run.phase!=='running'||!finite(bpm)||bpm<35||bpm>220)return false;
  run.samples.push({time:run.time,bpm});if(run.samples.length>256){run.samples.shift();run.truncatedSamples=true;}run.sensor='fresh';return true;
}
export function pause(run:Run):void { if(run.phase==='running'){run.phase='paused';event(run,'pause','Paused. Controls and simulated readings are suspended.');} }
export function resume(run:Run):void {if(run.phase==='paused'){run.phase='running';event(run,'resume','Resumed. Find the next objective.');} }
export function objects(run:Run):{id:string;x:number;y:number;label:string}[] {
  return [{id:'fuse',x:250,y:110,label:'Fuse'},{id:'power',x:520,y:230,label:'Power panel'},{id:'key',x:740,y:110,label:'Key'},{id:'lock',x:1030,y:160,label:'Exit lock'},{id:'exit',x:1160,y:160,label:'Exit'}]
    .filter(o=>o.id==='fuse'?!run.fuse:o.id==='power'?!run.power:o.id==='key'?!run.key:o.id==='lock'?!run.unlocked:run.unlocked);
}
export function nearby(run:Run):ReturnType<typeof objects>[number]|null {
  const list=objects(run).map(o=>({...o,distance:Math.hypot(run.x-o.x,run.y-o.y)})).filter(o=>o.distance<=70).sort((a,b)=>a.distance-b.distance);
  return list[0]??null;
}
export function aimPoint(run:Run,controls:Controls):{x:number;y:number;error:number} {
  const target=nearby(run); const base=controls.aim??target??{x:run.x+30,y:run.y};
  const amplitude=32*run.tension*(controls.steady?.25:1);
  const x=base.x+amplitude*Math.sin(run.time*11),y=base.y+amplitude*.6*Math.cos(run.time*7);
  return {x,y,error:target?Math.hypot(x-target.x,y-target.y):0};
}
function tick(run:Run,dt:number,c:Controls):void {
  if(run.phase!=='running')return;
  if(run.noise>=100){run.phase='lost';run.loss='noise';event(run,'loss','The watcher heard you. Try moving and working steadily.');return;}
  run.time=Math.min(WORLD.timeLimit,run.time+dt);
  const last=run.samples.at(-1),fresh=last!==undefined&&run.time-last.time<=10+1e-8;
  run.sensor=!last?'missing':fresh?'fresh':'stale';
  run.shock*=Math.exp(-dt/5);
  const target=clamp((fresh?Math.max(0,(last.bpm-run.baseline)/(run.baseline*.75)):0)+run.shock,0,1);
  run.tension=target+(run.tension-target)*Math.exp(-dt/2);
  const magnitude=Math.hypot(c.x,c.y),speed=130*(1-.35*run.tension)*(c.steady?.65:1);
  if(magnitude>0){run.x=clamp(run.x+c.x/Math.max(1,magnitude)*speed*dt,25,run.unlocked?1175:1060);run.y=clamp(run.y+c.y/Math.max(1,magnitude)*speed*dt,35,285);}
  run.noise=clamp(run.noise+(magnitude>0?(1+18*run.tension)*(c.steady?.35:1):-3)*dt,0,100);
  if(run.scares&&!run.scareSeen&&run.x>=430){run.scareSeen=true;run.shock=.65;event(run,'scare','A shape crossed the window. A temporary authored shock adds tension.');}
  const object=nearby(run);
  if(c.interact&&object){
    if(object.id==='fuse'&&!run.fuse){run.fuse=true;event(run,'fuse','Fuse collected. Restore the lower power panel.');}
    else if(object.id==='key'&&!run.key){run.key=true;event(run,'key','Key collected. Use it at the exit lock once power is restored.');}
    else if(object.id==='power'&&!run.power&&run.fuse){run.power=true;event(run,'power','Power restored. Find the key on the upper shelf.');}
    else if(object.id==='lock'&&run.power&&run.key){
      if(aimPoint(run,c).error<=18){run.lock=clamp(run.lock+dt/4,0,1);if(run.lock>=1-1e-9){run.lock=1;run.unlocked=true;event(run,'unlock','Lock opened. Reach the right-hand exit.');}}
      else {run.lock=Math.max(0,run.lock-dt*.15);if(run.time>=run.fumbleAt){run.noise=clamp(run.noise+6,0,100);run.fumbleAt=run.time+1;event(run,'fumble','Aim slipped. Hold Steady or adjust the pointer to keep the crosshair on the lock.');}}
    }else if(object.id==='exit'&&run.unlocked){run.phase='won';event(run,'win','You escaped the observatory.');}
  }else if(!run.unlocked)run.lock=Math.max(0,run.lock-dt*.06);
  if(run.phase==='running'&&run.time>=WORLD.timeLimit){run.phase='lost';run.loss='timeout';event(run,'loss','The corridor sealed before you escaped.');}
  if(run.phase==='running'&&run.noise>=100){run.phase='lost';run.loss='noise';event(run,'loss','The watcher heard you. Try moving and working steadily.');}
}
export function advance(run:Run,elapsed:number,controls:Controls):void {
  if(!finite(elapsed)||elapsed<0||!finite(controls.x)||!finite(controls.y)||typeof controls.interact!=='boolean'||typeof controls.steady!=='boolean'||controls.aim&&(!finite(controls.aim.x)||!finite(controls.aim.y)))throw new Error('Invalid game input.');
  if(run.phase!=='running')return;
  run.remainder+=Math.min(elapsed,.25);const c={...controls,x:clamp(controls.x,-1,1),y:clamp(controls.y,-1,1)};
  while(run.remainder+1e-10>=WORLD.step&&run.phase==='running'){run.remainder=Math.max(0,run.remainder-WORLD.step);tick(run,WORLD.step,c);}
}
export function runReport(run:Run) {
  return {schemaVersion:1,source:'simulated',scenario:'observatory-escape-v1',baselineBpm:run.baseline,scares:run.scares,outcome:run.phase,loss:run.loss,activeSeconds:run.time,
    objectives:{fuse:run.fuse,power:run.power,key:run.key,unlocked:run.unlocked},samples:run.samples.map(s=>({...s})),events:run.events.map(e=>({...e})),truncatedSamples:run.truncatedSamples,truncatedEvents:run.truncatedEvents,
    limitations:'Declared simulated game inputs only; not measured physiology, emotion inference, medical information or a deterministic replay file.'};
}
