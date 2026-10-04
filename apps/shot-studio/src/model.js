import {performerPose} from './performer.js';

export const MAX_BYTES=65536;
export const MAX_PERFORMER_CUES=32;
export const SCHEMA_VERSION=3;
export const ACTIONS=['idle','wave','walk'];
export function createProject(){return {
  schemaVersion:SCHEMA_VERSION,title:'The arrival',light:1,
  actors:[{name:'Mika',x:-1.2,z:0,color:'#db825c',action:'wave',performanceMode:'loop'},
    {name:'Noor',x:1.2,z:-1,color:'#6cb1ba',action:'walk',performanceMode:'loop'}],
  shots:[{name:'Establishing',duration:4,eye:[5,3,7],target:[0,1,0],fov:45,cameraMode:'static'},
    {name:'Two-shot',duration:4,eye:[0,1.8,5],target:[0,1,0],fov:40,cameraMode:'static'}],
};}
const finite=(n,lo,hi)=>typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi;
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
function exactKeys(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return false;
  const own=Reflect.ownKeys(value);
  return own.length===keys.length&&own.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return typeof key==='string'&&keys.includes(key)&&descriptor.enumerable&&'value' in descriptor;
  });
}
function denseArray(value,min,max=min){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length<min||value.length>max
    ||Reflect.ownKeys(value).length!==value.length+1)return false;
  for(let index=0;index<value.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,index);
    if(!descriptor||!descriptor.enumerable||!('value' in descriptor))return false;
  }
  return true;
}
const vector=v=>denseArray(v,3)&&v.every(x=>finite(x,-15,15));
const relative=(eye,target)=>eye.map((value,index)=>value-target[index]);
const cameraError=()=>Error('Invalid camera or shot settings. Keep the camera and target separated and away from a vertical view throughout the path.');
function validDirection(direction){return Math.hypot(...direction)>=.3&&Math.hypot(direction[0],direction[2])>=.1;}
function minimumDistance(start,end,dimensions){
  const from=dimensions.map(index=>start[index]),to=dimensions.map(index=>end[index]),delta=to.map((value,index)=>value-from[index]);
  const square=delta.reduce((sum,value)=>sum+value*value,0);
  const u=square===0?0:Math.max(0,Math.min(1,-from.reduce((sum,value,index)=>sum+value*delta[index],0)/square));
  // Preserve exact endpoint differences at clamped minima. Inclusive boundary
  // decisions use represented numbers, without an epsilon widening the limits.
  return Math.hypot(...(u===0?from:u===1?to:from.map((value,index)=>value+u*delta[index])));
}
function validateShot(value,legacy=false){
  const baseKeys=['name','duration','eye','target','fov'];
  const mode=legacy?'static':value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'cameraMode')?.value:undefined;
  if(mode!=='static'&&mode!=='linear')throw cameraError();
  const keys=legacy?baseKeys:[...baseKeys,'cameraMode',...(mode==='linear'?['endEye','endTarget']:[])];
  if(!exactKeys(value,keys)||!text(value.name,40)||!finite(value.duration,1,15)||!finite(value.fov,25,80)
    ||!vector(value.eye)||!vector(value.target)||value.eye[1]<.3||value.target[1]<.3)throw cameraError();
  const start=relative(value.eye,value.target);
  if(!validDirection(start))throw cameraError();
  const shot={name:value.name,duration:value.duration,eye:[...value.eye],target:[...value.target],fov:value.fov,cameraMode:mode};
  if(mode==='linear'){
    if(!vector(value.endEye)||!vector(value.endTarget)||value.endEye[1]<.3||value.endTarget[1]<.3)throw cameraError();
    const end=relative(value.endEye,value.endTarget);
    if(!validDirection(end)||minimumDistance(start,end,[0,1,2])<.3||minimumDistance(start,end,[0,2])<.1)throw cameraError();
    shot.endEye=[...value.endEye];shot.endTarget=[...value.endTarget];
  }
  return shot;
}
function validateCue(value,duration){
  if(!exactKeys(value,['time','x','z','action','visible'])||!finite(value.time,0,duration)||!finite(value.x,-4,4)||!finite(value.z,-4,4)
    ||!ACTIONS.includes(value.action)||typeof value.visible!=='boolean')throw Error('Invalid blocking cue. Keep its time within the film and coordinates within the stage; move or delete later cues before shortening the film.');
  return {time:value.time,x:value.x,z:value.z,action:value.action,visible:value.visible};
}
function validateActor(value,duration,legacy=false){
  const mode=legacy?'loop':value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'performanceMode')?.value:undefined;
  const keys=mode==='loop'?['name','x','z','color','action',...(legacy?[]:['performanceMode'])]:['name','color','performanceMode','cues'];
  if(!['loop','blocking'].includes(mode)||!exactKeys(value,keys)||!text(value.name,30)||typeof value.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value.color))throw Error('Invalid performer settings.');
  if(mode==='loop'){
    if(!finite(value.x,-4,4)||!finite(value.z,-4,4)||!ACTIONS.includes(value.action))throw Error('Invalid performer settings.');
    return {name:value.name,x:value.x,z:value.z,color:value.color,action:value.action,performanceMode:'loop'};
  }
  if(!denseArray(value.cues,1,MAX_PERFORMER_CUES))throw Error('Authored blocking needs 1–32 complete cues.');
  const cues=value.cues.map(cue=>validateCue(cue,duration));
  if(cues[0].time!==0||cues.some((cue,index)=>index>0&&cue.time<=cues[index-1].time))throw Error('Blocking cues must begin at 0 and have strictly increasing unique times.');
  return {name:value.name,color:value.color,performanceMode:'blocking',cues};
}
export function validateProject(p){
  if(!exactKeys(p,['schemaVersion','title','light','actors','shots'])||![1,2,SCHEMA_VERSION].includes(p.schemaVersion)
    ||!text(p.title,80)||!finite(p.light,.2,2)||!denseArray(p.actors,2)||!denseArray(p.shots,1,20))throw Error('Invalid project format or limits.');
  const shots=p.shots.map(s=>validateShot(s,p.schemaVersion===1));
  const duration=shots.reduce((s,x)=>s+x.duration,0);
  if(duration>60) throw Error('Films are limited to 60 seconds.');
  const actors=p.actors.map(a=>validateActor(a,duration,p.schemaVersion!==SCHEMA_VERSION));
  return {schemaVersion:SCHEMA_VERSION,title:p.title,light:p.light,actors,shots};
}
export function importProject(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES) throw Error('Project backup exceeds 64 KiB.');
  try{return validateProject(JSON.parse(text));}catch{throw Error('Invalid project backup. Check version, camera and limits.');}
}
export function cameraFromPose(matrix){
  if(!matrix||matrix.length!==16||!Array.from(matrix).every(Number.isFinite))throw Error('Headset tracking is unavailable.');
  const eye=[matrix[12],matrix[13],matrix[14]],direction=[-matrix[8],-matrix[9],-matrix[10]],length=Math.hypot(...direction);
  if(length<.001)throw Error('Invalid headset camera direction.');
  const target=eye.map((v,i)=>v+3*direction[i]/length),p=createProject();
  Object.assign(p.shots[0],{eye,target});
  try{const shot=validateProject(p).shots[0];return {eye:shot.eye,target:shot.target};}
  catch{throw Error('Headset camera exceeds the scene limits. Stay above the floor, within the set bounds, and look away from straight up/down.');}
}
export const totalDuration=p=>p.shots.reduce((sum,s)=>sum+s.duration,0);
function validTime(time){if(typeof time!=='number'||!Number.isFinite(time))throw Error('Time must be a finite number.');}
export function shotAt(p,time){
  validTime(time);const total=totalDuration(p),bounded=Math.max(0,Math.min(total,time));let start=0;
  for(let index=0;index<p.shots.length;index++){
    const shot=p.shots[index],end=start+shot.duration;
    if(index===p.shots.length-1&&bounded===total)return {shot,index,local:shot.duration};
    if(bounded<end||index===p.shots.length-1)return {shot,index,local:Math.max(0,Math.min(shot.duration,bounded-start))};
    start=end;
  }
}
export function actorPose(a,time){
  validTime(time);
  const mode=a&&typeof a==='object'?Object.getOwnPropertyDescriptor(a,'performanceMode')?.value:undefined;
  if(mode==='blocking')throw Error('Use performerAt with a full film to evaluate blocking.');
  const actor=validateActor(a,60,mode===undefined),pose=performerPose(actor,time,60);
  return {x:pose.x,z:pose.z,arm:pose.arm,leg:pose.leg};
}
export function cameraAt(shot,localSeconds){
  validTime(localSeconds);const valid=validateShot(shot),u=Math.max(0,Math.min(valid.duration,localSeconds))/valid.duration;
  if(valid.cameraMode==='static'||u===0)return {eye:valid.eye,target:valid.target,fov:valid.fov};
  if(u===1)return {eye:valid.endEye,target:valid.endTarget,fov:valid.fov};
  const interpolate=(start,end)=>start.map((value,index)=>(1-u)*value+u*end[index]);
  return {eye:interpolate(valid.eye,valid.endEye),target:interpolate(valid.target,valid.endTarget),fov:valid.fov};
}
export function frameAt(project,filmSeconds){
  const valid=validateProject(project),selected=shotAt(valid,filmSeconds);
  return {...selected,camera:cameraAt(selected.shot,selected.local)};
}

export function performerAt(project,actorIndex,filmSeconds){
  const valid=validateProject(project);validActorIndex(valid,actorIndex);validTime(filmSeconds);
  return performerPose(valid.actors[actorIndex],filmSeconds,totalDuration(valid));
}
export function setPerformanceMode(project,actorIndex,mode){
  const valid=validateProject(project);validActorIndex(valid,actorIndex);
  if(mode!=='loop'&&mode!=='blocking')throw Error('Choose Looping performance or Authored blocking.');
  const actor=valid.actors[actorIndex];
  if(actor.performanceMode===mode)return valid;
  if(mode==='blocking')valid.actors[actorIndex]={name:actor.name,color:actor.color,performanceMode:'blocking',cues:[{time:0,x:actor.x,z:actor.z,action:actor.action,visible:true}]};
  else{
    const first=actor.cues[0];
    valid.actors[actorIndex]={name:actor.name,x:first.x,z:first.z,color:actor.color,action:first.action,performanceMode:'loop'};
  }
  return validateProject(valid);
}
export function insertCue(project,actorIndex,cue){
  const valid=validateProject(project),actor=blockingActor(valid,actorIndex),next=validateCue(cue,totalDuration(valid));
  if(actor.cues.length>=MAX_PERFORMER_CUES)throw Error('Each performer is limited to 32 cues. Remove a cue first.');
  if(actor.cues.some(item=>item.time===next.time))throw Error('A cue already exists at this exact time. Select it to edit.');
  const following=actor.cues.findIndex(item=>item.time>next.time),cueIndex=following<0?actor.cues.length:following;
  actor.cues.splice(cueIndex,0,next);
  return {project:validateProject(valid),cueIndex};
}
export function updateCue(project,actorIndex,cueIndex,cue){
  const valid=validateProject(project),actor=blockingActor(valid,actorIndex);validCueIndex(actor,cueIndex);
  const next=validateCue(cue,totalDuration(valid));
  if(cueIndex===0&&next.time!==0)throw Error('The first cue must stay at 0 seconds.');
  if(actor.cues.some((item,index)=>index!==cueIndex&&item.time===next.time))throw Error('A cue already exists at this exact time. Select it to edit.');
  actor.cues.splice(cueIndex,1);
  const following=actor.cues.findIndex(item=>item.time>next.time),selected=following<0?actor.cues.length:following;
  actor.cues.splice(selected,0,next);
  return {project:validateProject(valid),cueIndex:selected};
}
export function removeCue(project,actorIndex,cueIndex){
  const valid=validateProject(project),actor=blockingActor(valid,actorIndex);validCueIndex(actor,cueIndex);
  if(cueIndex===0)throw Error('Keep the first cue at 0 seconds.');
  actor.cues.splice(cueIndex,1);
  return {project:validateProject(valid),cueIndex:Math.min(cueIndex,actor.cues.length-1)};
}

function validActorIndex(project,index){
  if(!Number.isInteger(index)||index<0||index>=project.actors.length)throw Error('Select an existing performer.');
}
function blockingActor(project,index){
  validActorIndex(project,index);
  const actor=project.actors[index];
  if(actor.performanceMode!=='blocking')throw Error('Switch this performer to Authored blocking before editing cues.');
  return actor;
}
function validCueIndex(actor,index){
  if(!Number.isInteger(index)||index<0||index>=actor.cues.length)throw Error('Select an existing blocking cue.');
}
