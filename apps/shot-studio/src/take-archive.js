import {TakeError,TAKE_LIMITS,validateTakeMetadata} from './takes.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const MAGIC=encoder.encode('SHOTTAK1'),PLACEHOLDER_ID='00000000-0000-0000-0000-000000000000';
function fail(message){throw new TakeError('invalid',message);}
function blobInfo(blob){try{return{bytes:Object.getOwnPropertyDescriptor(Blob.prototype,'size').get.call(blob),mime:Object.getOwnPropertyDescriptor(Blob.prototype,'type').get.call(blob)};}catch{fail('Take data must be a native Blob.');}}
function cancelled(){return new TakeError('cancelled','Take operation cancelled.');}
async function operation(signal,work){
 if(signal?.aborted)throw cancelled();let retired=false,rejectStop;
 const stopped=new Promise((_,reject)=>{rejectStop=reject;});
 const abort=()=>{retired=true;rejectStop(cancelled());};
 const timer=setTimeout(()=>{retired=true;rejectStop(new TakeError('timeout','Take operation timed out. Try again.'));},TAKE_LIMITS.probeMs);
 signal?.addEventListener('abort',abort,{once:true});
 const check=()=>{if(retired||signal?.aborted)throw cancelled();};
 try{return await Promise.race([work(check),stopped]);}finally{retired=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function hash(blob,check){
 const info=blobInfo(blob);if(info.bytes>TAKE_LIMITS.videoBytes)throw new TakeError('limit','Take media exceeds 32 MiB.');check();
 const bytes=await blob.arrayBuffer();check();if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==info.bytes)fail('Take media could not be read completely.');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);check();return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
export async function sha256Blob(blob,{signal}={}){return operation(signal,check=>hash(blob,check));}
function strictJson(text){
 let at=0;const space=()=>{while(/[ \t\r\n]/.test(text[at]??'!'))at++;};
 const invalid=()=>fail('Take manifest must be strict bounded JSON with unique fields.');
 function string(){
  const start=at++;while(at<text.length){const c=text.charCodeAt(at++);if(c===34){try{return JSON.parse(text.slice(start,at));}catch{invalid();}}
   if(c<32)invalid();if(c===92){const escape=text[at++];if(escape==='u'){if(!/^[0-9a-fA-F]{4}$/.test(text.slice(at,at+4)))invalid();at+=4;}else if(!escape||!['"','\\','/','b','f','n','r','t'].includes(escape))invalid();}
  }invalid();
 }
 function value(depth){
  space();const c=text[at];
  if(c==='{'||c==='['){if(depth>=TAKE_LIMITS.depth)invalid();const object=c==='{',end=object?'}':']',keys=new Set();at++;space();if(text[at]===end){at++;return;}
   while(at<text.length){if(object){if(text[at]!== '"')invalid();const key=string();if(keys.has(key))invalid();keys.add(key);space();if(text[at++]!==':')invalid();}value(depth+1);space();if(text[at]===end){at++;return;}if(text[at++]!==',')invalid();space();}invalid();
  }else if(c==='"'){string();}
  else if(text.startsWith('true',at)){at+=4;}else if(text.startsWith('false',at)){at+=5;}else if(text.startsWith('null',at)){at+=4;}
  else{const number=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));if(!number||!Number.isFinite(Number(number[0])))invalid();at+=number[0].length;}
 }
 value(0);space();if(at!==text.length)invalid();try{return JSON.parse(text);}catch{invalid();}
}
function metadataWithoutId(metadata){const{schemaVersion,name,recordedAt,origin,film,video}=metadata;return{schemaVersion,name,recordedAt,origin,film,video};}
function portableMetadata(raw){
 // Six portable fields; local ID is never admitted from the archive.
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Reflect.ownKeys(raw).length!==6||!['schemaVersion','name','recordedAt','origin','film','video'].every(key=>Object.hasOwn(raw,key)))fail('Invalid portable take manifest fields.');
 return validateTakeMetadata({schemaVersion:raw.schemaVersion,id:PLACEHOLDER_ID,name:raw.name,recordedAt:raw.recordedAt,origin:raw.origin,film:raw.film,video:raw.video});
}
export async function encodeTakeBackup(input,video,{signal}={}){
 return operation(signal,async check=>{
  check();const metadata=validateTakeMetadata(input),info=blobInfo(video);if(info.bytes!==metadata.video.bytes||info.mime!==metadata.video.mime)fail('Take video and captured metadata do not match.');
  const manifest=encoder.encode(JSON.stringify(metadataWithoutId(metadata)));if(!manifest.length||manifest.length>TAKE_LIMITS.manifestBytes)throw new TakeError('limit','Take manifest exceeds 80 KiB.');
  if(await hash(video,check)!==metadata.video.sha256)fail('Take video checksum does not match.');check();
  const header=new Uint8Array(16);header.set(MAGIC);const view=new DataView(header.buffer);view.setUint32(8,manifest.length,true);view.setUint32(12,info.bytes,true);
  return new Blob([header,manifest,video],{type:'application/octet-stream'});
 });
}
export async function decodeTakeBackup(file,{signal}={}){
 return operation(signal,async check=>{
  check();const info=blobInfo(file);if(info.bytes<17||info.bytes>TAKE_LIMITS.archiveBytes)throw new TakeError('limit','Take backup is empty or exceeds its byte limit.');
  const header=await file.slice(0,16).arrayBuffer();check();if(header.byteLength!==16)fail('Incomplete take backup header.');const bytes=new Uint8Array(header);if(!MAGIC.every((byte,i)=>bytes[i]===byte))fail('Unsupported take backup format.');
  const view=new DataView(header),manifestBytes=view.getUint32(8,true),videoBytes=view.getUint32(12,true);if(manifestBytes<1||manifestBytes>TAKE_LIMITS.manifestBytes||videoBytes<1||videoBytes>TAKE_LIMITS.videoBytes||16+manifestBytes+videoBytes!==info.bytes)fail('Take backup lengths or byte limits do not match.');
  const raw=await file.slice(16,16+manifestBytes).arrayBuffer();check();if(raw.byteLength!==manifestBytes)fail('Incomplete take manifest.');let text;try{text=decoder.decode(raw);}catch{fail('Take manifest must be valid UTF-8.');}
  const metadata=portableMetadata(strictJson(text));if(metadata.video.bytes!==videoBytes)fail('Take manifest and media lengths do not match.');
  const video=file.slice(16+manifestBytes,info.bytes,metadata.video.mime);if(await hash(video,check)!==metadata.video.sha256)fail('Take video checksum does not match.');check();
  return{metadataWithoutId:{...metadataWithoutId(metadata),origin:'imported-declared'},video};
 });
}
