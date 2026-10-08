/** Complete sequence metadata with shared immutable soundtrack assets. */
import {createSequence,validateSequence} from './sequence.js';
import {assertAdmittedWavAsset,sequenceAudioDescriptor} from './sequence-audio.js';
export const SEQUENCE_DOCUMENT_LIMITS=Object.freeze({metadataBytes:324*1024,historyBytes:64*1024*1024,priorStates:30});
const encoder=new TextEncoder();
const fail=message=>{throw Error(message);};
function record(value,keys,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${label} must be a plain data record.`);
 const descriptors=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(descriptors);
 if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))fail(`${label} has missing or unsupported fields.`);
 for(const key of keys){const field=descriptors[key];if(!field?.enumerable||!('value' in field))fail(`${label} must not contain accessors.`);}
 return value;
}
function label(value){
 if(typeof value!=='string'||!value.trim()||value.length>80)fail('Soundtrack label must be nonblank text of at most 80 UTF-16 units without controls.');
 for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);if(code<32||(code>=127&&code<=159)||code===0x2028||code===0x2029)fail('Soundtrack label must not contain controls or line separators.');if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail('Soundtrack label must contain well-formed Unicode.');}else if(code>=0xdc00&&code<=0xdfff)fail('Soundtrack label must contain well-formed Unicode.');}
 return value;
}
function number(value,low,high,name,integer=false){
 if(typeof value!=='number'||!Number.isFinite(value)||value<low||value>high||(integer&&!Number.isSafeInteger(value)))fail(`Invalid soundtrack ${name}.`);
 return value===0?0:value;
}
function descriptor(value){
 record(value,['sha256','bytes','sampleRate','channels','frameCount'],'Soundtrack asset descriptor');
 if(typeof value.sha256!=='string'||!/^[0-9a-f]{64}$/.test(value.sha256))fail('Soundtrack asset must have a complete lowercase SHA-256.');
 if(![44100,48000].includes(value.sampleRate)||![1,2].includes(value.channels))fail('Soundtrack must be mono/stereo 44.1 or 48 kHz PCM16 WAV.');
 const frameCount=number(value.frameCount,value.sampleRate,60*value.sampleRate,'frame count',true);
 const bytes=number(value.bytes,44+frameCount*value.channels*2,12*1024*1024,'WAV byte length',true);
 return {sha256:value.sha256,bytes,sampleRate:value.sampleRate,channels:value.channels,frameCount};
}
function soundtrack(value){
 record(value,['label','asset','inFrame','outFrame','startTime','gain'],'Soundtrack');
 const asset=descriptor(value.asset),inFrame=number(value.inFrame,0,asset.frameCount,'In frame',true),outFrame=number(value.outFrame,0,asset.frameCount,'Out frame',true);
 if(outFrame-inFrame<Math.ceil(.1*asset.sampleRate))fail('Soundtrack Out must be at least 0.1 seconds after In, in source sample frames.');
 return {label:label(value.label),asset,inFrame,outFrame,startTime:number(value.startTime,0,60,'start time'),gain:number(value.gain,0,1,'gain')};
}
export function createSequenceDocument(sequence=createSequence()){
 return validateSequenceDocument({schemaVersion:1,kind:'shot-studio-sequence-document',sequence,soundtrack:null});
}
export function validateSequenceDocument(value){
 record(value,['schemaVersion','kind','sequence','soundtrack'],'Sequence document');
 if(value.schemaVersion!==1||value.kind!=='shot-studio-sequence-document')fail('Open a supported complete sequence document.');
 const sequence=validateSequence(value.sequence);
 if(value.sequence.schemaVersion!==3)fail('The complete document must contain a canonical schema-3 sequence. Import legacy sequence JSON separately.');
 const document={schemaVersion:1,kind:'shot-studio-sequence-document',sequence,soundtrack:value.soundtrack===null?null:soundtrack(value.soundtrack)};
 if(encoder.encode(JSON.stringify(document)).byteLength>SEQUENCE_DOCUMENT_LIMITS.metadataBytes)fail('Complete sequence metadata exceeds 324 KiB.');
 return document;
}
export function validateSequenceBundle(bundle){
 record(bundle,['document','asset'],'Complete sequence bundle');
 const document=validateSequenceDocument(bundle.document);
 if(document.soundtrack===null){if(bundle.asset!==null)fail('A silent sequence must not include an orphan WAV asset.');return {document,asset:null};}
 const asset=assertAdmittedWavAsset(bundle.asset),actual=sequenceAudioDescriptor(asset);
 for(const key of ['sha256','bytes','sampleRate','channels','frameCount'])if(actual[key]!==document.soundtrack.asset[key])fail('Soundtrack metadata and admitted original WAV do not match.');
 return {document,asset};
}
export function replaceSequence(bundle,sequence){
 const current=validateSequenceBundle(bundle);
 return validateSequenceBundle({document:{...current.document,sequence},asset:current.asset});
}
export function attachSequenceSoundtrack(bundle,asset,label){
 const current=validateSequenceBundle(bundle),admitted=assertAdmittedWavAsset(asset),metadata=sequenceAudioDescriptor(admitted);
 return validateSequenceBundle({document:{...current.document,soundtrack:{label,asset:metadata,inFrame:0,outFrame:metadata.frameCount,startTime:0,gain:1}},asset:admitted});
}
export function setSequenceSoundtrack(bundle,settings){
 const current=validateSequenceBundle(bundle);
 if(!current.document.soundtrack)fail('Import a soundtrack before changing its settings.');
 record(settings,['inFrame','outFrame','startTime','gain','label'],'Soundtrack settings');
 return validateSequenceBundle({document:{...current.document,soundtrack:{...current.document.soundtrack,...settings}},asset:current.asset});
}
export function removeSequenceSoundtrack(bundle){
 const current=validateSequenceBundle(bundle);
 return {document:{...current.document,soundtrack:null},asset:null};
}
function state(bundle){const safe=validateSequenceBundle(bundle);return {json:JSON.stringify(safe.document),asset:safe.asset};}
function retained(states){
 const assets=new Map();let bytes=0;
 for(const item of states){if(!item.asset)continue;const key=item.asset.sha256,previous=assets.get(key);
  if(previous){for(const field of ['bytes','sampleRate','channels','frameCount'])if(previous[field]!==item.asset[field])fail('Conflicting soundtrack metadata for one asset identity.');}
  else{assets.set(key,item.asset);bytes+=item.asset.bytes;}
 }
 if(bytes>SEQUENCE_DOCUMENT_LIMITS.historyBytes)fail('Sequence Undo history would exceed 64 MiB of unique WAVs. Download a complete backup or explicitly clear sequence Undo history before importing another soundtrack.');
 return states.map(item=>({json:item.json,asset:item.asset?assets.get(item.asset.sha256):null}));
}
export class SequenceDocumentHistory{
 #states;#index=0;
 constructor(bundle){this.#states=retained([state(bundle)]);}
 get current(){const item=this.#states[this.#index];return {document:JSON.parse(item.json),asset:item.asset};}
 get canUndo(){return this.#index>0;}
 get canRedo(){return this.#index+1<this.#states.length;}
 commit(bundle){
  const next=state(bundle);if(next.json===this.#states[this.#index].json)return this.current;
  const candidate=this.#states.slice(0,this.#index+1);candidate.push(next);
  if(candidate.length>SEQUENCE_DOCUMENT_LIMITS.priorStates+1)candidate.shift();
  const accepted=retained(candidate);this.#states=accepted;this.#index=accepted.length-1;return this.current;
 }
 undo(){if(this.canUndo)this.#index--;return this.current;}
 redo(){if(this.canRedo)this.#index++;return this.current;}
 clear(){this.#states=[this.#states[this.#index]];this.#index=0;return this.current;}
}
