import {TakeError,TAKE_LIMITS} from './takes.js';

const HEADER_BYTES=4096;
const HEADER_ELEMENTS=64;
const MIMES=new Set(['video/webm','video/webm;codecs=vp8','video/webm;codecs=vp9']);
const invalid=()=>new TakeError('invalid','Take video has an invalid or truncated WebM header.');

function vint(bytes,offset,id=false){
  if(offset>=bytes.length)throw invalid();
  const first=bytes[offset];let marker=0x80,length=1;
  while(marker&&!(first&marker)){marker>>=1;length++;}
  if(!marker||length>(id?4:8)||offset+length>bytes.length)throw invalid();
  let value=id?first:first&(marker-1),unknown=!id&&(first&(marker-1))===marker-1;
  for(let index=1;index<length;index++){
    const byte=bytes[offset+index];value=value*256+byte;unknown&&=byte===255;
    if(!id&&value>HEADER_BYTES)throw new TakeError('limit','WebM header exceeds the bounded 4 KiB inspection window.');
  }
  if(unknown)throw invalid();
  return {value,next:offset+length};
}
function webmHeader(bytes){
  if(bytes.length<5||bytes[0]!==0x1a||bytes[1]!==0x45||bytes[2]!==0xdf||bytes[3]!==0xa3)throw invalid();
  const size=vint(bytes,4),end=size.next+size.value;
  if(end>HEADER_BYTES)throw new TakeError('limit','WebM header exceeds the bounded 4 KiB inspection window.');
  if(end>bytes.length)throw invalid();
  let offset=size.next,elements=1,doctype=false;
  // EBML header is the sole master(depth1); its direct leaf children are depth2.
  // Unknown leaves are skipped by declared size, never searched recursively.
  while(offset<end){
    if(++elements>HEADER_ELEMENTS)throw new TakeError('limit','WebM header contains too many elements.');
    const id=vint(bytes,offset,true),length=vint(bytes,id.next);
    const next=length.next+length.value;
    if(next>end||id.value===0x1a45dfa3)throw invalid();
    if(id.value===0x4282){
      if(doctype||length.value!==4||bytes[length.next]!==119||bytes[length.next+1]!==101
          ||bytes[length.next+2]!==98||bytes[length.next+3]!==109)throw invalid();
      doctype=true;
    }
    offset=next;
  }
  if(!doctype)throw invalid();
}

/** Header plus one native decoded frame, not whole-stream or film-association verification. */
export async function inspectTakeVideo(blob,{signal}={}){
  if(!(blob instanceof Blob)||blob.size<1)throw new TakeError('invalid','Choose a nonempty WebM take video.');
  if(blob.size>TAKE_LIMITS.videoBytes)throw new TakeError('limit','Take video exceeds the 32 MiB limit.');
  if(!MIMES.has(blob.type))throw new TakeError('unsupported','Take video must declare WebM with VP8 or VP9.');
  if(signal?.aborted)throw new TakeError('cancelled','Take video inspection cancelled.');
  if(!globalThis.document?.createElement||!globalThis.URL?.createObjectURL)throw new TakeError('unsupported','Native take video inspection is unavailable in this browser.');
  return new Promise((resolve,reject)=>{
    let video,url,timer,finished=false;
    const deadline=performance.now()+TAKE_LIMITS.probeMs;
    const cleanup=()=>{
      clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      if(video){
        video.removeEventListener('loadedmetadata',metadata);
        video.removeEventListener('loadeddata',decoded);
        video.removeEventListener('error',decodeError);
        try{video.pause();}catch{}
        try{video.removeAttribute('src');video.load();}catch{}
      }
      if(url){URL.revokeObjectURL(url);url=null;}
    };
    const settle=(error,result)=>{
      if(finished)return;finished=true;cleanup();
      if(error)reject(error);else resolve(result);
    };
    const cancel=()=>settle(new TakeError('cancelled','Take video inspection cancelled.'));
    const timeout=()=>settle(new TakeError('timeout','Take video inspection timed out after 10 seconds.'));
    const owns=()=>{
      if(finished)return false;
      if(signal?.aborted){cancel();return false;}
      if(performance.now()>=deadline){timeout();return false;}
      return true;
    };
    const metadata=()=>{
      if(!owns())return;
      if(video.videoWidth!==960||video.videoHeight!==540)settle(new TakeError('unsupported','Take video must have a decoded 960 × 540 frame.'));
    };
    const decoded=()=>{
      if(!owns())return;metadata();
      if(finished)return;
      if(video.readyState<2){settle(new TakeError('invalid','Take video has no decoded first frame.'));return;}
      settle(null,{mime:blob.type,bytes:blob.size,width:960,height:540});
    };
    const decodeError=()=>{if(owns())settle(new TakeError('invalid','Take video could not decode its first frame.'));};
    timer=setTimeout(timeout,TAKE_LIMITS.probeMs);
    signal?.addEventListener('abort',cancel,{once:true});
    if(!owns())return;
    // Read no more than 4 KiB in JavaScript. The separately bounded native decoder
    // receives the owned Blob URL; it never plays audio or follows another URL.
    Blob.prototype.slice.call(blob,0,HEADER_BYTES).arrayBuffer().then(buffer=>{
      if(!owns())return;
      webmHeader(new Uint8Array(buffer));
      if(!owns())return;
      video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
      video.addEventListener('loadedmetadata',metadata);
      video.addEventListener('loadeddata',decoded);
      video.addEventListener('error',decodeError);
      url=URL.createObjectURL(blob);video.src=url;
      if(!owns())return;
      video.load();
    }).catch(error=>{
      if(finished)return;
      settle(error instanceof TakeError?error:new TakeError('invalid','Take video could not be inspected.'));
    });
  });
}
