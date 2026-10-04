const finite=(value,lo,hi)=>typeof value==='number'&&Number.isFinite(value)&&value>=lo&&value<=hi;
const name=value=>typeof value==='string'&&value.trim().length>0&&value.length<=30&&!/[\x00-\x1f\x7f]/.test(value);
const action=value=>value==='idle'||value==='wave'||value==='walk';
const invalid=()=>Error('Invalid performer settings. Check motion, coordinates and ordered cue times within the film.');

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
function denseCues(value){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length<1||value.length>32
    ||Reflect.ownKeys(value).length!==value.length+1)return false;
  for(let index=0;index<value.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,index);
    if(!descriptor||!descriptor.enumerable||!('value' in descriptor))return false;
  }
  return true;
}
function validateActor(actor,duration){
  const mode=actor&&typeof actor==='object'?Object.getOwnPropertyDescriptor(actor,'performanceMode')?.value:undefined;
  const keys=mode==='loop'?['name','color','performanceMode','x','z','action']
    :mode==='blocking'?['name','color','performanceMode','cues']:[];
  if(!exactKeys(actor,keys)||!name(actor.name)||typeof actor.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(actor.color))throw invalid();
  if(mode==='loop'){
    if(!finite(actor.x,-4,4)||!finite(actor.z,-4,4)||!action(actor.action))throw invalid();
    return;
  }
  if(mode!=='blocking'||!denseCues(actor.cues))throw invalid();
  let previous=-1;
  for(const cue of actor.cues){
    if(!exactKeys(cue,['time','x','z','action','visible'])||!finite(cue.time,0,duration)
      ||cue.time<=previous||!finite(cue.x,-4,4)||!finite(cue.z,-4,4)||!action(cue.action)||typeof cue.visible!=='boolean')throw invalid();
    previous=cue.time;
  }
  if(actor.cues[0].time!==0)throw invalid();
}
function limbs(action,phase){
  return {
    arm:action==='wave'?.8+.5*Math.sin(phase*6):action==='walk'?.5*Math.sin(phase*5):0,
    leg:action==='walk'?.35*Math.sin(phase*5):0,
  };
}

/** Pure canonical performer evaluation on the global film clock, never a shot clock. */
export function performerPose(actor,filmSeconds,filmDuration){
  if(typeof filmSeconds!=='number'||!Number.isFinite(filmSeconds)
    ||!finite(filmDuration,Number.MIN_VALUE,60))throw Error('Performer time must be finite and film duration must be greater than zero and at most 60 seconds.');
  validateActor(actor,filmDuration);
  let result;
  if(actor.performanceMode==='loop'){
    result={x:actor.x+(actor.action==='walk'?.7*Math.sin(filmSeconds):0),z:actor.z,
      ...limbs(actor.action,filmSeconds),visible:true,action:actor.action};
  }else{
    const bounded=Math.max(0,Math.min(filmDuration,filmSeconds));
    let index=0;
    while(index+1<actor.cues.length&&actor.cues[index+1].time<=bounded)index++;
    const left=actor.cues[index],right=actor.cues[index+1];
    const u=right?(bounded-left.time)/(right.time-left.time):0;
    result={x:right?left.x+(right.x-left.x)*u:left.x,z:right?left.z+(right.z-left.z)*u:left.z,
      ...limbs(left.action,bounded-left.time),visible:left.visible,action:left.action};
  }
  // Keep the exact legacy formulas. Extremely large finite loop clocks may
  // overflow their frequency multiplication; reject instead of returning NaN.
  if(![result.x,result.z,result.arm,result.leg].every(Number.isFinite))throw Error('Performer time exceeds the finite animation range.');
  return result;
}
