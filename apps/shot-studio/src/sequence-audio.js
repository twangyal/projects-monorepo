export const MAX_SEQUENCE_AUDIO_BYTES=12*1024*1024;
const assets=new WeakSet(),plans=new WeakMap();
const descriptorKeys=['sha256','bytes','sampleRate','channels','frameCount'];
function fail(message){throw Error(message);}
function record(value,keys){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('Use exact soundtrack data fields.');
  const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))fail('Use exact soundtrack data fields.');
  for(const key of own){const d=Object.getOwnPropertyDescriptor(value,key);if(!d.enumerable||!('value'in d))fail('Soundtrack fields cannot be accessors.');}
  return value;
}
function finite(value,label,min,max){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label} must be finite within ${min}–${max}.`);return value===0?0:value;}
function label(value){
  if(typeof value!=='string'||!value.trim()||value.length>80||/[\x00-\x1f\x7f]/.test(value))fail('Soundtrack label needs nonblank text of at most 80 units without controls.');
  for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail('Soundtrack label must be well-formed Unicode.');}else if(c>=0xdc00&&c<=0xdfff)fail('Soundtrack label must be well-formed Unicode.');}
}
export function parsePcm16Wav(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<44||bytes.byteLength>MAX_SEQUENCE_AUDIO_BYTES)fail('Choose a PCM16 WAV of at most 12 MiB.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const four=offset=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  if(four(0)!=='RIFF'||four(8)!=='WAVE'||view.getUint32(4,true)!==bytes.byteLength-8)fail('WAV must have exact RIFF/WAVE framing and declared EOF.');
  let offset=12,count=0,fmt=null,data=null;
  while(offset<bytes.byteLength){
    if(++count>64||offset+8>bytes.byteLength)fail('WAV has too many or truncated chunks.');
    const kind=four(offset),size=view.getUint32(offset+4,true),start=offset+8,end=start+size,padded=end+(size%2);
    if(padded>bytes.byteLength)fail('WAV chunk data or padding is truncated.');
    if(kind==='fmt '){
      if(fmt||![16,18].includes(size)||view.getUint16(start,true)!==1||(size===18&&view.getUint16(start+16,true)!==0))fail('Export uncompressed PCM16 WAV with one fmt chunk (16 bytes, or 18 with cbSize 0).');
      const channels=view.getUint16(start+2,true),sampleRate=view.getUint32(start+4,true),align=view.getUint16(start+12,true);
      if(![1,2].includes(channels)||![44100,48000].includes(sampleRate)||view.getUint16(start+14,true)!==16||align!==channels*2||view.getUint32(start+8,true)!==sampleRate*align)fail('WAV needs mono/stereo PCM16 at 44.1 or 48 kHz with matching byte rate.');
      fmt={sampleRate,channels};
    }else if(kind==='data'){
      if(data)fail('WAV must have one data chunk.');data={dataOffset:start,dataBytes:size};
    }
    offset=padded;
  }
  if(!fmt||!data||data.dataBytes%(fmt.channels*2))fail('WAV requires complete PCM frames and exactly one fmt/data pair.');
  const frameCount=data.dataBytes/(fmt.channels*2);
  if(frameCount<fmt.sampleRate||frameCount>fmt.sampleRate*60)fail('Choose a WAV containing 1–60 seconds of PCM frames.');
  return Object.freeze({...fmt,frameCount,...data});
}
export async function admitSequenceAudio(blob,{signal}={}){
  let size,type;try{size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get.call(blob);type=Object.getOwnPropertyDescriptor(Blob.prototype,'type').get.call(blob);}catch{fail('Choose a native WAV file.');}
  if(size<44||size>MAX_SEQUENCE_AUDIO_BYTES)fail('Choose a PCM16 WAV of at most 12 MiB.');
  if(signal?.aborted)fail('Audio import cancelled.');
  const original=new Blob([blob],{type}),deadline=performance.now()+10000;
  let timer,cancel;
  const check=()=>{if(signal?.aborted)fail('Audio import cancelled.');if(performance.now()>=deadline)fail('Audio import timed out.');};
  const work=async()=>{
    const bytes=new Uint8Array(await Blob.prototype.arrayBuffer.call(original));check();const metadata=parsePcm16Wav(bytes);
    if(!globalThis.crypto?.subtle)fail('Secure SHA256 is unavailable. Use a secure browser origin.');
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));check();
    const asset=Object.freeze({sha256:Array.from(hash,b=>b.toString(16).padStart(2,'0')).join(''),bytes:size,sampleRate:metadata.sampleRate,channels:metadata.channels,frameCount:metadata.frameCount,blob:original});assets.add(asset);return asset;
  };
  try{return await Promise.race([work(),new Promise((resolve,reject)=>{
    cancel=()=>reject(Error('Audio import cancelled.'));signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>reject(Error('Audio import timed out.')),10000);
    if(signal?.aborted)cancel();
  })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export function assertAdmittedWavAsset(asset){if(!assets.has(asset))fail('Use an admitted original WAV asset.');return asset;}
export function sequenceAudioDescriptor(asset){assertAdmittedWavAsset(asset);return Object.freeze(Object.fromEntries(descriptorKeys.map(key=>[key,asset[key]])));}
export function planSoundtrack(soundtrack,asset,sequenceDuration){
  assertAdmittedWavAsset(asset);record(soundtrack,['label','asset','inFrame','outFrame','startTime','gain']);label(soundtrack.label);record(soundtrack.asset,descriptorKeys);
  if(descriptorKeys.some(key=>soundtrack.asset[key]!==asset[key]))fail('Soundtrack descriptor does not match its admitted WAV.');
  const {inFrame,outFrame}=soundtrack;
  if(!Number.isSafeInteger(inFrame)||!Number.isSafeInteger(outFrame)||inFrame<0||outFrame>asset.frameCount||outFrame-inFrame<Math.ceil(.1*asset.sampleRate))fail('Choose integer source frames within the WAV with at least 0.1 seconds between In and Out.');
  const startTime=finite(soundtrack.startTime,'Soundtrack start',0,60),gain=finite(soundtrack.gain,'Soundtrack gain',0,1),duration=finite(sequenceDuration,'Sequence duration',0,60);
  const audibleStart=Math.min(startTime,duration),audibleEnd=Math.max(audibleStart,Math.min(duration,startTime+(outFrame-inFrame)/asset.sampleRate));
  const plan=Object.freeze({sampleRate:asset.sampleRate,channels:asset.channels,frameCount:asset.frameCount,inFrame:inFrame===0?0:inFrame,outFrame,startTime,gain,sequenceDuration:duration,audibleStart,audibleEnd,audible:gain>0&&audibleEnd>audibleStart});plans.set(plan,asset);return plan;
}
// Shared runtime admission keeps the immutable plan bound to its original WAV.
export function assertSoundtrackPlan(plan,asset){assertAdmittedWavAsset(asset);if(plans.get(plan)!==asset)fail('Prepare soundtrack timing from this admitted WAV.');return plan;}
