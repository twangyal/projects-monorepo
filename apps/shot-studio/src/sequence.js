import {validateProject,cameraAt,totalDuration,MAX_BYTES,SCHEMA_VERSION} from './model.js';

export const SEQUENCE_LIMITS=Object.freeze({sources:4,clips:20,seconds:60,bytes:300*1024});
const size=value=>new TextEncoder().encode(value).length;
const error=()=>Error('Invalid sequence format or limits. Use a complete Shot Studio sequence backup.');
function shape(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw error();
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)||!Object.getOwnPropertyDescriptor(value,key).enumerable||!('value' in Object.getOwnPropertyDescriptor(value,key))))throw error();
}
function array(value,max){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>max||Reflect.ownKeys(value).length!==value.length+1)throw error();
  for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,i);if(!d?.enumerable||!('value' in d))throw error();}
}
function name(value,max){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value)||!value.isWellFormed())throw error();
}
function sourceId(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,40}$/.test(value))throw error();}
function index(value,length){if(!Number.isInteger(value)||value<0||value>=length)throw Error('Select an existing source shot or sequence clip.');}
export function createSequence(){return {schemaVersion:1,kind:'shot-studio-sequence',title:'New sequence',sources:[],clips:[]};}
export function validateSequence(value){
  shape(value,['schemaVersion','kind','title','sources','clips']);
  if(value.schemaVersion!==1||value.kind!=='shot-studio-sequence')throw error();
  name(value.title,80);array(value.sources,SEQUENCE_LIMITS.sources);array(value.clips,SEQUENCE_LIMITS.clips);
  const ids=new Set();
  const sources=value.sources.map(source=>{
    shape(source,['id','name','film']);sourceId(source.id);name(source.name,80);
    if(ids.has(source.id))throw Error('Sequence source IDs must be unique.');ids.add(source.id);
    // A sequence stores explicit canonical films. Migration belongs to scene import,
    // never silently to a sequence document or its detached source snapshots.
    const version=source.film&&typeof source.film==='object'?Object.getOwnPropertyDescriptor(source.film,'schemaVersion'):null;
    if(!version||!('value' in version)||version.value!==SCHEMA_VERSION)throw error();
    const film=validateProject(source.film);
    if(size(JSON.stringify(film))>MAX_BYTES)throw error();
    return {id:source.id,name:source.name,film};
  });
  const clips=value.clips.map(clip=>{
    shape(clip,['sourceId','shotIndex']);sourceId(clip.sourceId);
    const source=sources.find(s=>s.id===clip.sourceId);if(!source)throw Error('A clip references a missing sequence source.');
    index(clip.shotIndex,source.film.shots.length);
    return {sourceId:clip.sourceId,shotIndex:clip.shotIndex};
  });
  const result={schemaVersion:1,kind:'shot-studio-sequence',title:value.title,sources,clips};
  if(duration(result)>SEQUENCE_LIMITS.seconds)throw Error('Sequences are limited to 60 seconds.');
  if(size(JSON.stringify(result))>SEQUENCE_LIMITS.bytes)throw error();
  return result;
}
export function importSequence(text){
  if(typeof text!=='string'||!text.isWellFormed()||size(text)>SEQUENCE_LIMITS.bytes)throw Error('Sequence backup exceeds 300 KiB or contains invalid text.');
  try{return validateSequence(JSON.parse(text));}catch{throw error();}
}
export function captureSource(sequence,source){
  const next=validateSequence(sequence);next.sources.push(source);return validateSequence(next);
}
export function appendClip(sequence,sourceId,shotIndex){
  const next=validateSequence(sequence);next.clips.push({sourceId,shotIndex});return validateSequence(next);
}
export function removeClip(sequence,clipIndex){
  const next=validateSequence(sequence);index(clipIndex,next.clips.length);next.clips.splice(clipIndex,1);return next;
}
export function moveClip(sequence,clipIndex,direction){
  const next=validateSequence(sequence);index(clipIndex,next.clips.length);
  if(![-1,1].includes(direction))throw Error('Move a clip one place earlier or later.');
  index(clipIndex+direction,next.clips.length);
  [next.clips[clipIndex],next.clips[clipIndex+direction]]=[next.clips[clipIndex+direction],next.clips[clipIndex]];
  return validateSequence(next);
}
export function removeSource(sequence,id){
  const next=validateSequence(sequence),at=next.sources.findIndex(source=>source.id===id);index(at,next.sources.length);
  if(next.clips.some(clip=>clip.sourceId===id))throw Error('Remove this source’s clips before removing the source.');
  next.sources.splice(at,1);return next;
}
function duration(sequence){
  // Admission depends on the durations, not clip order. Sum a canonical order
  // with compensation so reordering cannot create or conceal a quota excess.
  // This uses the represented total without rounding durations or an epsilon.
  const values=sequence.clips.map(clip=>sequence.sources.find(s=>s.id===clip.sourceId).film.shots[clip.shotIndex].duration).sort((a,b)=>a-b);
  let sum=0,correction=0;
  for(const value of values){
    const next=sum+value;
    correction+=Math.abs(sum)>=Math.abs(value)?(sum-next)+value:(value-next)+sum;
    sum=next;
  }
  return sum+correction;
}
export function sequenceDuration(sequence){return duration(validateSequence(sequence));}
export function sequenceFrameAt(sequence,seconds){
  if(typeof seconds!=='number'||!Number.isFinite(seconds))throw Error('Sequence time must be a finite number.');
  const valid=validateSequence(sequence),total=duration(valid);
  if(!valid.clips.length)throw Error('Add a clip before previewing an empty sequence.');
  const bounded=Math.max(0,Math.min(total,seconds));let start=0;
  for(let i=0;i<valid.clips.length;i++){
    const clip=valid.clips[i],source=valid.sources.find(s=>s.id===clip.sourceId),shot=source.film.shots[clip.shotIndex],end=start+shot.duration;
    if(bounded<end||i===valid.clips.length-1){
      // Explicit final endpoint avoids subtraction drift for fractional durations.
      // Original source time is not the sequence clock: cues and action phase must
      // stay on the source film timeline, including when a shot is repeated.
      const local=bounded===total?shot.duration:Math.max(0,Math.min(shot.duration,bounded-start));
      const originalStart=source.film.shots.slice(0,clip.shotIndex).reduce((sum,item)=>sum+item.duration,0);
      const sourceTime=Math.min(totalDuration(source.film),originalStart+local);
      return {index:i,sourceId:source.id,shotIndex:clip.shotIndex,film:source.film,local,sourceTime,sequenceTime:bounded,camera:cameraAt(shot,local)};
    }
    start=end;
  }
}
export class SequenceHistory{
  #state;#past=[];#future=[];
  constructor(sequence){this.#state=validateSequence(sequence);}
  get current(){return structuredClone(this.#state);}
  get canUndo(){return this.#past.length>0;}
  get canRedo(){return this.#future.length>0;}
  commit(sequence){
    const next=validateSequence(sequence);
    if(JSON.stringify(next)===JSON.stringify(this.#state))return this.current;
    this.#past.push(this.#state);if(this.#past.length>30)this.#past.shift();
    this.#state=next;this.#future=[];return this.current;
  }
  undo(){if(this.canUndo){this.#future.push(this.#state);this.#state=this.#past.pop();}return this.current;}
  redo(){if(this.canRedo){this.#past.push(this.#state);this.#state=this.#future.pop();}return this.current;}
}
