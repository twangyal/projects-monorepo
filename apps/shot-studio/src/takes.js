import {validateProject} from './model.js';
export const TAKE_LIMITS=Object.freeze({count:4,videoBytes:33554432,manifestBytes:81920,filmBytes:65536,totalVideoBytes:134217728,archiveBytes:33636368,nameUnits:80,depth:16,probeMs:10000});
export class TakeError extends Error{
 constructor(code,message){super(message);this.name='TakeError';Object.defineProperty(this,'code',{value:code,enumerable:true});}
}
const encoder=new TextEncoder();
const MIME=new Set(['video/webm','video/webm;codecs=vp8','video/webm;codecs=vp9']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bad=message=>{throw new TakeError('invalid',message);};
function object(value,keys,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))bad(`Invalid ${label}.`);
 const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))bad(`Invalid ${label} fields.`);
 for(const key of own){const d=Object.getOwnPropertyDescriptor(value,key);if(!d.enumerable||!('value'in d))bad(`Invalid ${label} fields.`);}return value;
}
function dense(value,max){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>max||Reflect.ownKeys(value).length!==value.length+1)bad('Take records must be a dense bounded array.');for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d?.enumerable||!('value'in d))bad('Take records must be a dense data array.');}return value;}
function unicode(text){for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const low=text.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;}
function filmUnicode(value){if(typeof value==='string'){if(!unicode(value))bad('Film text must contain valid Unicode.');}else if(Array.isArray(value)){for(const item of value)filmUnicode(item);}else if(value&&typeof value==='object'){for(const item of Object.values(value))filmUnicode(item);}}
export function validateTakeMetadata(value){
 const input=object(value,['schemaVersion','id','name','recordedAt','origin','film','video'],'take metadata');
 if(input.schemaVersion!==1||typeof input.id!=='string'||!UUID.test(input.id))bad('Invalid take version or local ID.');
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>TAKE_LIMITS.nameUnits||!unicode(input.name)||/[\x00-\x1f\x7f]/.test(input.name))bad('Take name needs 1–80 valid characters without controls.');
 if(typeof input.recordedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.recordedAt))bad('Take timestamp must be a canonical UTC ISO date.');
 const time=Date.parse(input.recordedAt);if(!Number.isFinite(time)||new Date(time).toISOString()!==input.recordedAt)bad('Take timestamp must be a canonical UTC ISO date.');
 if(!['recorded-here','imported-declared'].includes(input.origin))bad('Invalid take provenance.');
 if(!input.film||Object.getOwnPropertyDescriptor(input.film,'schemaVersion')?.value!==3)bad('A take must contain a complete schema-3 film.');
 let film;try{film=validateProject(input.film);}catch{bad('Invalid captured film.');}filmUnicode(film);
 if(encoder.encode(JSON.stringify(film)).length>TAKE_LIMITS.filmBytes)throw new TakeError('limit','Captured film exceeds 64 KiB.');
 const video=object(input.video,['mime','bytes','sha256'],'video metadata');
 if(!MIME.has(video.mime)||!Number.isSafeInteger(video.bytes)||video.bytes<1||video.bytes>TAKE_LIMITS.videoBytes||typeof video.sha256!=='string'||!/^[0-9a-f]{64}$/.test(video.sha256))bad('Invalid bounded WebM metadata.');
 return{schemaVersion:1,id:input.id,name:input.name,recordedAt:input.recordedAt,origin:input.origin,film,video:{mime:video.mime,bytes:video.bytes,sha256:video.sha256}};
}
export function createTakeMetadata(value){
 const input=object(value,['id','name','recordedAt','origin','film','mime','bytes','sha256'],'take capture');
 return validateTakeMetadata({schemaVersion:1,id:input.id,name:input.name,recordedAt:input.recordedAt,origin:input.origin,film:input.film,video:{mime:input.mime,bytes:input.bytes,sha256:input.sha256}});
}
export function validateLibrary(value){
 const input=object(value,['schemaVersion','revision','records'],'take library');
 if(input.schemaVersion!==1||!Number.isSafeInteger(input.revision)||input.revision<0)bad('Invalid take-library version or revision.');
 const records=[],seen=new Set();let bytes=0;
 for(const raw of dense(input.records,TAKE_LIMITS.count)){
  const row=object(raw,['metadata','video'],'take record'),metadata=validateTakeMetadata(row.metadata);if(seen.has(metadata.id))bad('Take IDs must be unique.');seen.add(metadata.id);
  let size,type;try{size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get.call(row.video);type=Object.getOwnPropertyDescriptor(Blob.prototype,'type').get.call(row.video);}catch{bad('Take video must be a native Blob.');}
  if(size!==metadata.video.bytes||type!==metadata.video.mime)bad('Take video and metadata do not match.');bytes+=size;if(bytes>TAKE_LIMITS.totalVideoBytes)throw new TakeError('limit','Take library exceeds its video byte budget.');
  records.push({metadata,video:new Blob([row.video],{type})});
 }
 return{schemaVersion:1,revision:input.revision,records};
}
