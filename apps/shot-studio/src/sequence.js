import {cameraAt,validateProject} from './model.js';

export const SEQUENCE_LIMITS = Object.freeze({sources:4,clips:20,seconds:60,sourceBytes:65536,sourceTotalBytes:262144,bytes:327680});
export const MIN_SEQUENCE_CLIP_SECONDS = 0.1;
const encoder=new TextEncoder();
const bytes=value=>encoder.encode(JSON.stringify(value)).length;
function fail(message){throw Error(message);}
function record(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${label} must be a plain data record.`);
  const descriptors=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(descriptors);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))fail(`${label} has missing or unsupported fields.`);
  for(const key of keys){const field=descriptors[key];if(!field||!field.enumerable||!('value' in field))fail(`${label} cannot contain accessors.`);}
  return value;
}
function list(value,maximum,label){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum||Reflect.ownKeys(value).length!==value.length+1)fail(`${label} must be a bounded dense array.`);
  for(let i=0;i<value.length;i++){const field=Object.getOwnPropertyDescriptor(value,i);if(!field||!field.enumerable||!('value' in field))fail(`${label} must be a dense array without accessors.`);}
  return value;
}
function text(value,maximum,label){
  if(typeof value!=='string'||!value.trim()||value.length>maximum||/[\x00-\x1f\x7f]/.test(value))fail(`${label} must be nonblank text of at most ${maximum} UTF-16 units without controls.`);
  for(let i=0;i<value.length;i++){
    const unit=value.charCodeAt(i);
    if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail(`${label} must contain well-formed Unicode.`);}
    else if(unit>=0xdc00&&unit<=0xdfff)fail(`${label} must contain well-formed Unicode.`);
  }
  return value;
}
function id(value,label){if(typeof value!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(value))fail(`${label} must be an existing ASCII identifier of 1–64 characters.`);return value;}
function source(value,labelKey='label'){
  record(value,['id',labelKey,'film'],'Sequence source');
  const sourceId=id(value.id,'Source ID'),label=text(value[labelKey],80,'Source label');
  // Embedded sources are already canonical films; migration belongs to importProject.
  record(value.film,['schemaVersion','title','light','actors','shots'],'Source film');
  if(value.film.schemaVersion!==3)fail('Copy a canonical schema-3 source film. Import an older scene through the scene importer first.');
  const film=validateProject(value.film);
  if(bytes(film)>SEQUENCE_LIMITS.sourceBytes)fail('A copied source film exceeds 64 KiB.');
  return {id:sourceId,label,film};
}
function clip(value,sources,legacy=false){
  record(value,['id','sourceId','shotIndex','label',...(legacy?[]:['inTime','outTime'])],'Sequence clip');
  const clipId=id(value.id,'Clip ID'),sourceId=id(value.sourceId,'Source ID'),label=text(value.label,40,'Clip label');
  const target=sources.find(item=>item.id===sourceId);
  if(!target)fail('Choose an existing source for this clip.');
  if(!Number.isInteger(value.shotIndex)||value.shotIndex<0||value.shotIndex>=target.film.shots.length)fail('Choose an existing shot from the copied source.');
  const inTime=legacy?0:value.inTime,outTime=legacy?target.film.shots[value.shotIndex].duration:value.outTime;
  if(typeof inTime!=='number'||typeof outTime!=='number'||!Number.isFinite(inTime)||!Number.isFinite(outTime)
    ||inTime<0||outTime>target.film.shots[value.shotIndex].duration||outTime-inTime<MIN_SEQUENCE_CLIP_SECONDS){
    fail('Choose finite In/Out times within the original shot, with Out at least 0.1 seconds after In.');
  }
  return {id:clipId,sourceId,shotIndex:value.shotIndex===0?0:value.shotIndex,label,
    inTime:inTime===0?0:inTime,outTime:outTime===0?0:outTime};
}
function legacyClipLabel(shot,index){
  // Legacy films can retain UTF-16 strings that new UI labels cannot admit.
  // This generated label is display metadata, never a replacement film name.
  try{return text(shot.name,40,'Clip label');}catch{return `Shot ${index+1}`;}
}
function unique(values,label){const seen=new Set();for(const item of values){if(seen.has(item.id))fail(`${label} IDs must be unique.`);seen.add(item.id);}}
function duration(sequence){
  const values=sequence.clips.map(item=>item.outTime-item.inTime).sort((a,b)=>a-b);
  let sum=0,correction=0;
  for(const value of values){
    const next=sum+value;
    correction+=Math.abs(sum)>=Math.abs(value)?(sum-next)+value:(value-next)+sum;
    sum=next;
  }
  return sum+correction;
}
export function createSequence(){return {schemaVersion:3,kind:'shot-studio-sequence',title:'Scene sequence',sources:[],clips:[]};}
export function validateSequence(value){
  record(value,['schemaVersion','kind','title','sources','clips'],'Scene sequence');
  if(![1,2,3].includes(value.schemaVersion)||value.kind!=='shot-studio-sequence')fail('Open a supported scene sequence backup.');
  const title=text(value.title,80,'Sequence title');
  const sourceInputs=list(value.sources,SEQUENCE_LIMITS.sources,'Sequence sources');
  const firstSource=sourceInputs[0];
  const remoteLegacy=value.schemaVersion===1&&firstSource&&typeof firstSource==='object'&&Object.getOwnPropertyDescriptor(firstSource,'name')!==undefined;
  const sources=sourceInputs.map(value=>source(value,remoteLegacy?'name':'label'));unique(sources,'Source');
  if(sources.reduce((sum,item)=>sum+bytes(item.film),0)>SEQUENCE_LIMITS.sourceTotalBytes)fail('Copied source films exceed 256 KiB in total.');
  const legacyClips=value.schemaVersion!==3;
  const clips=list(value.clips,SEQUENCE_LIMITS.clips,'Sequence clips').map((value,index)=>{
    if(!remoteLegacy)return clip(value,sources,legacyClips);
    record(value,['sourceId','shotIndex'],'Legacy sequence clip');
    const target=sources.find(item=>item.id===value.sourceId);
    if(!target||!Number.isInteger(value.shotIndex)||value.shotIndex<0||value.shotIndex>=target.film.shots.length)fail('Choose an existing whole shot from the copied source.');
    return clip({id:`legacy-clip-${index+1}`,sourceId:value.sourceId,shotIndex:value.shotIndex,label:legacyClipLabel(target.film.shots[value.shotIndex],value.shotIndex)},sources,true);
  });unique(clips,'Clip');
  const canonical={schemaVersion:3,kind:'shot-studio-sequence',title,sources,clips};
  if(duration(canonical)>SEQUENCE_LIMITS.seconds)fail('Scene sequences are limited to 60 seconds. Remove a clip first.');
  if(bytes(canonical)>SEQUENCE_LIMITS.bytes)fail('The complete scene sequence exceeds 320 KiB.');
  return canonical;
}
export function importSequence(value){
  if(typeof value!=='string'||value.length>SEQUENCE_LIMITS.bytes||encoder.encode(value).length>SEQUENCE_LIMITS.bytes)fail('A sequence backup must be text of at most 320 KiB.');
  let parsed;try{parsed=JSON.parse(value);}catch{fail('The scene sequence backup is not valid JSON.');}
  if(parsed?.schemaVersion===1&&Array.isArray(parsed.sources)&&parsed.sources.length>0&&Object.hasOwn(parsed.sources[0]??{},'name')&&encoder.encode(value).length>300*1024)fail('An original name-form schema-1 sequence backup exceeds 300 KiB.');
  return validateSequence(parsed);
}
export function sequenceDuration(sequence){return duration(validateSequence(sequence));}
export function addSequenceSource(sequence,incoming){const copy=validateSequence(sequence);copy.sources.push(source(incoming));return validateSequence(copy);}
function sourceIndex(sequence,sourceId){id(sourceId,'Source ID');const index=sequence.sources.findIndex(value=>value.id===sourceId);if(index<0)fail('Select an existing sequence source.');return index;}
export function removeSequenceSource(sequence,sourceId){
  const copy=validateSequence(sequence),index=sourceIndex(copy,sourceId),used=copy.clips.filter(value=>value.sourceId===sourceId).length;
  if(used)fail(`This source is used by ${used} clip${used===1?'':'s'}. Remove those clips before removing the source.`);
  copy.sources.splice(index,1);return validateSequence(copy);
}
export function renameSequenceSource(sequence,sourceId,label){const copy=validateSequence(sequence);copy.sources[sourceIndex(copy,sourceId)].label=text(label,80,'Source label');return validateSequence(copy);}
export function addSequenceClip(sequence,incoming){const copy=validateSequence(sequence);copy.clips.push(clip(incoming,copy.sources));return validateSequence(copy);}
function clipIndex(sequence,clipId){id(clipId,'Clip ID');const index=sequence.clips.findIndex(value=>value.id===clipId);if(index<0)fail('Select an existing sequence clip.');return index;}
export function removeSequenceClip(sequence,clipId){const copy=validateSequence(sequence);copy.clips.splice(clipIndex(copy,clipId),1);return validateSequence(copy);}
export function renameSequenceClip(sequence,clipId,label){const copy=validateSequence(sequence);copy.clips[clipIndex(copy,clipId)].label=text(label,40,'Clip label');return validateSequence(copy);}
export function setSequenceClipRange(sequence,clipId,inTime,outTime){
  const copy=validateSequence(sequence),index=clipIndex(copy,clipId);
  copy.clips[index]={...copy.clips[index],inTime,outTime};return validateSequence(copy);
}
export function resetSequenceClipRange(sequence,clipId){
  const copy=validateSequence(sequence),index=clipIndex(copy,clipId),selected=copy.clips[index];
  const from=copy.sources.find(item=>item.id===selected.sourceId);
  copy.clips[index]={...selected,inTime:0,outTime:from.film.shots[selected.shotIndex].duration};
  return validateSequence(copy);
}
export function moveSequenceClip(sequence,clipId,direction){
  const copy=validateSequence(sequence),index=clipIndex(copy,clipId);
  if(direction!==-1&&direction!==1)fail('Move a clip one place earlier or later.');
  const next=index+direction;if(next<0||next>=copy.clips.length)fail('This clip is already at that end of the sequence.');
  [copy.clips[index],copy.clips[next]]=[copy.clips[next],copy.clips[index]];return validateSequence(copy);
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function time(value){if(typeof value!=='number'||!Number.isFinite(value))fail('Sequence time must be a finite number.');}
export function prepareSequence(sequence){
  const document=freeze(validateSequence(sequence)),sources=new Map();
  for(const item of document.sources){let prefix=0;const starts=item.film.shots.map(shot=>{const start=prefix;prefix+=shot.duration;return start;});sources.set(item.id,{...item,starts});}
  const total=duration(document);let prefix=0;
  const clips=freeze(document.clips.map(item=>{
    const from=sources.get(item.sourceId),shot=from.film.shots[item.shotIndex],sequenceStart=prefix,span=item.outTime-item.inTime;prefix+=span;
    return {id:item.id,label:item.label,sourceId:item.sourceId,sourceLabel:from.label,shotIndex:item.shotIndex,shotName:shot.name,sequenceStart,sourceStart:from.starts[item.shotIndex],duration:span,
      inTime:item.inTime,outTime:item.outTime,sourceDuration:shot.duration};
  }));
  function clipFrame(index,localTime){
    time(localTime);
    if(!Number.isInteger(index)||index<0||index>=clips.length)fail('Add a shot to the sequence or select an existing clip.');
    const selected=clips[index],from=sources.get(selected.sourceId),local=Math.max(0,Math.min(selected.duration,localTime));
    // Preserve authored endpoints exactly; inverse subtraction/addition can
    // otherwise move Out by one ULP. Interior samples keep original shot time.
    const shotLocal=local===0?selected.inTime:local===selected.duration?selected.outTime:selected.inTime+local;
    const sequenceTime=index===clips.length-1&&local===selected.duration?total:selected.sequenceStart+local;
    return freeze({clipIndex:index,clipId:selected.id,clipLocal:local,sequenceTime,sourceId:selected.sourceId,sourceGlobal:selected.sourceStart+shotLocal,shotIndex:selected.shotIndex,sourceFilm:from.film,shotLocal,camera:cameraAt(from.film.shots[selected.shotIndex],shotLocal)});
  }
  function frameAt(value){
    time(value);if(!clips.length)fail('Add a shot to the empty sequence before rehearsal or export.');
    const bounded=Math.max(0,Math.min(total,value));
    if(bounded===total||bounded>=prefix)return clipFrame(clips.length-1,clips.at(-1).duration);
    for(let index=0;index<clips.length;index++){
      const selected=clips[index],end=selected.sequenceStart+selected.duration;
      if(bounded<end)return clipFrame(index,Math.max(0,Math.min(selected.duration,bounded-selected.sequenceStart)));
    }
    fail('Sequence time is outside its prepared clips.');
  }
  return Object.freeze({document,duration:total,clips,frameAt,clipFrame});
}
