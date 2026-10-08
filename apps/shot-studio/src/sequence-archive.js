/** Complete framed sequence backups; legacy JSON remains independently readable. */
import {importSequence} from './sequence.js';
import {createSequenceDocument,validateSequenceDocument,validateSequenceBundle} from './sequence-document.js';
import {admitSequenceAudio} from './sequence-audio.js';
export const SEQUENCE_ARCHIVE_LIMITS=Object.freeze({headerBytes:16,metadataBytes:324*1024,wavBytes:12*1024*1024,bytes:16*1024*1024});
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),magic=encoder.encode('SHOTSEQ1');
const fail=message=>{throw Error(message);};
const cancelled=()=>Error('Sequence archive operation cancelled.');
function blobSize(value){try{return Object.getOwnPropertyDescriptor(Blob.prototype,'size').get.call(value);}catch{fail('Choose a native complete sequence Blob or File.');}}
async function operation(signal,work){
 if(signal?.aborted)throw cancelled();
 const controller=new AbortController(),deadline=performance.now()+10000;let retired=false,rejectStop;
 const stopped=new Promise((_,reject)=>rejectStop=reject),stop=error=>{if(retired)return;retired=true;controller.abort();rejectStop(error);};
 const abort=()=>stop(cancelled()),timer=setTimeout(()=>stop(Error('Sequence archive operation timed out after 10 seconds.')),10000);
 signal?.addEventListener('abort',abort,{once:true});
 const check=()=>{if(retired||signal?.aborted)throw cancelled();if(performance.now()>=deadline)throw Error('Sequence archive operation timed out after 10 seconds.');};
 try{return await Promise.race([work(check,controller.signal),stopped]);}
 finally{retired=true;controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function strictJson(text){
 let at=0;const space=()=>{while(/[ \t\r\n]/.test(text[at]??'!'))at++;},invalid=()=>fail('Complete sequence metadata must be strict bounded JSON with unique fields.');
 function string(){
  const start=at++;
  while(at<text.length){const char=text.charCodeAt(at++);if(char===34){try{return JSON.parse(text.slice(start,at));}catch{invalid();}}
   if(char<32)invalid();if(char===92){const escaped=text[at++];if(escaped==='u'){if(!/^[0-9a-fA-F]{4}$/.test(text.slice(at,at+4)))invalid();at+=4;}else if(!escaped||!['"','\\','/','b','f','n','r','t'].includes(escaped))invalid();}
  }invalid();
 }
 function value(depth){
  space();const char=text[at];
  if(char==='{'||char==='['){
   if(depth>=32)invalid();const object=char==='{',end=object?'}':']',keys=new Set();at++;space();if(text[at]===end){at++;return;}
   while(at<text.length){if(object){if(text[at]!=='"')invalid();const key=string();if(keys.has(key))invalid();keys.add(key);space();if(text[at++]!==':')invalid();}value(depth+1);space();if(text[at]===end){at++;return;}if(text[at++]!==',')invalid();space();}invalid();
  }else if(char==='"')string();
  else if(text.startsWith('true',at))at+=4;
  else if(text.startsWith('false',at))at+=5;
  else if(text.startsWith('null',at))at+=4;
  else{const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));if(!match||!Number.isFinite(Number(match[0])))invalid();at+=match[0].length;}
 }
 value(0);space();if(at!==text.length)invalid();try{return JSON.parse(text);}catch{invalid();}
}
export async function encodeSequenceArchive(bundle,{signal}={}){
 return operation(signal,async check=>{
  check();const safe=validateSequenceBundle(bundle),metadata=encoder.encode(JSON.stringify(safe.document));
  if(metadata.byteLength<1||metadata.byteLength>SEQUENCE_ARCHIVE_LIMITS.metadataBytes)fail('Complete sequence metadata exceeds 324 KiB.');
  const wavBytes=safe.asset?blobSize(safe.asset.blob):0;
  if(wavBytes>SEQUENCE_ARCHIVE_LIMITS.wavBytes||16+metadata.byteLength+wavBytes>SEQUENCE_ARCHIVE_LIMITS.bytes)fail('Complete sequence archive exceeds its byte limit.');
  if(safe.asset&&wavBytes!==safe.document.soundtrack.asset.bytes)fail('Complete sequence WAV length does not match metadata.');
  const header=new Uint8Array(16);header.set(magic);const view=new DataView(header.buffer);view.setUint32(8,metadata.byteLength,true);view.setUint32(12,wavBytes,true);check();
  // Only privately admitted immutable WAVs reach here; concatenate their exact
  // bytes without decoding, reencoding, mutating or making base64 history copies.
  return new Blob(safe.asset?[header,metadata,safe.asset.blob]:[header,metadata],{type:'application/octet-stream'});
 });
}
export async function decodeSequenceArchive(file,{signal}={}){
 return operation(signal,async(check,ownedSignal)=>{
  check();const size=blobSize(file);
  if(size<17||size>SEQUENCE_ARCHIVE_LIMITS.bytes)fail('Complete sequence backup is empty or exceeds 16 MiB.');
  const header=await Blob.prototype.slice.call(file,0,16).arrayBuffer();check();
  if(!(header instanceof ArrayBuffer)||header.byteLength!==16)fail('Incomplete sequence archive header.');
  const bytes=new Uint8Array(header);if(!magic.every((value,index)=>bytes[index]===value))fail('Unsupported complete sequence archive format.');
  const view=new DataView(header),metadataBytes=view.getUint32(8,true),wavBytes=view.getUint32(12,true);
  if(metadataBytes<1||metadataBytes>SEQUENCE_ARCHIVE_LIMITS.metadataBytes||wavBytes>SEQUENCE_ARCHIVE_LIMITS.wavBytes||16+metadataBytes+wavBytes!==size)fail('Sequence archive lengths, byte limits or exact EOF do not match.');
  const raw=await Blob.prototype.slice.call(file,16,16+metadataBytes).arrayBuffer();check();
  if(!(raw instanceof ArrayBuffer)||raw.byteLength!==metadataBytes)fail('Incomplete sequence metadata.');
  let text;try{text=decoder.decode(raw);}catch{fail('Sequence archive metadata must be valid UTF-8.');}
  const document=validateSequenceDocument(strictJson(text));check();
  if((document.soundtrack===null)!==(wavBytes===0))fail('Sequence soundtrack and WAV presence do not match.');
  if(document.soundtrack&&document.soundtrack.asset.bytes!==wavBytes)fail('Sequence descriptor and WAV byte lengths do not match.');
  const asset=wavBytes?await admitSequenceAudio(Blob.prototype.slice.call(file,16+metadataBytes,size,'audio/wav'),{signal:ownedSignal}):null;
  check();return validateSequenceBundle({document,asset});
 });
}
export function importLegacySequence(text){return {document:createSequenceDocument(importSequence(text)),asset:null};}
