import {createFrameCompleteness} from './export-video-policy.js';
export {createFrameCompleteness} from './export-video-policy.js';
import {planExportFrames,prepareExportPcm} from './export-timeline.js';
import * as bunny from '../vendor/mediabunny/mediabunny.min.mjs';
const CAP=32*1024*1024;

// WebM finalization seeks back to patch metadata. Bound every write before copy,
// including sparse offsets; never allocate an unbounded whole-file target.
export function createBoundedVideoSink(maxBytes,check){
 let data=new Uint8Array(Math.min(65536,maxBytes)),length=0;
 return {
  write(chunk){
   check();const {position,data:incoming}=chunk;
   if(!Number.isSafeInteger(position)||position<0||!(incoming instanceof Uint8Array))throw Error('Video muxer produced an invalid write.');
   if(position>maxBytes||incoming.byteLength>maxBytes-position)throw Error('Video exceeds the byte limit (at most 32 MiB). Try a shorter film.');
   const end=position+incoming.byteLength;
   if(end>data.length){const next=new Uint8Array(Math.min(maxBytes,Math.max(end,data.length*2)));next.set(data);data=next;}
   data.set(incoming,position);length=Math.max(length,end);
  },
  bytes(){check();return data.subarray(0,length);},
  clear(){data=new Uint8Array(0);length=0;},
 };
}

export const nativeExportBackend={
 async probe(canvas,pcm){
  if(typeof VideoFrame!=='function'||typeof VideoEncoder!=='function'||pcm&&(typeof AudioData!=='function'||typeof AudioEncoder!=='function'))return null;
  const options={width:canvas.width,height:canvas.height,bitrate:2500000,frameRate:30};
  if(pcm&&!await bunny.canEncodeAudio('opus',{sampleRate:48000,numberOfChannels:pcm.block(0).numberOfChannels,bitrate:128000}))return null;
  for(const codec of ['vp9','vp8'])if(await bunny.canEncodeVideo(codec,options))return codec;
  return null;
 },
 create(sink,codec,pcm,plan){
  // Packet accounting proves native output coverage, not independent decoding.
  const completeness=createFrameCompleteness(plan);
  const target=new bunny.StreamTarget(new WritableStream({write:chunk=>sink.write(chunk)}));
  const output=new bunny.Output({format:new bunny.WebMOutputFormat(),target});
  const video=new bunny.VideoSampleSource({codec,bitrate:2500000,onEncodedPacket:packet=>completeness.observe(packet.timestamp)});output.addVideoTrack(video,{frameRate:30});
  const audio=pcm?new bunny.AudioSampleSource({codec:'opus',bitrate:128000}):null;if(audio)output.addAudioTrack(audio);
  let retired=false,closing;const pending=new Set();
  const active=()=>{if(retired)throw Error('Export cancelled.');};
  const track=work=>{active();const promise=work();pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
  // Pinned1.61.1's aggregate finalize rejects as soon as one source fails, and
  // cancel then returns on its canceled state. This internal source-close hook
  // reuses each existing close promise so a sibling flush cannot be abandoned.
  // Keep this adapter regression-tested when updating the pinned dependency.
  const drainSources=()=>Promise.allSettled([video,...(audio?[audio]:[])].map(source=>source._flushOrWaitForOngoingClose(true)));
  // Native support queries and finalization flushes cannot be cancelled. Drain
  // every owned operation before retiring output, including a late encoder.
  const cancel=()=>{retired=true;return closing??=(async()=>{await Promise.allSettled([...pending]);try{await drainSources();await output.cancel();}finally{completeness.retire();}})();};
  return {
   start:()=>track(()=>output.start()),finalize:()=>track(async()=>{try{try{await output.finalize();}finally{await drainSources();}completeness.verify();}finally{completeness.retire();}}),cancel,
   video(canvas,frame){
    active();const native=new VideoFrame(canvas,{timestamp:frame.timestamp,duration:frame.duration});
    try{return new bunny.VideoSample(native);}catch(error){native.close();throw error;}
   },
   audio(block){
    active();const native=new AudioData({...block,format:'f32-planar'});
    try{return new bunny.AudioSample(native);}catch(error){native.close();throw error;}
   },
   addVideo:sample=>track(()=>video.add(sample)),addAudio:sample=>track(()=>audio.add(sample)),
  };
 },
};

// The backend owns native codecs/muxing; this driver owns admission, authored
// time, backpressure, cancellation and publication. No live capture clock runs.
export function createTimestampedExporter(backend){
 return function exportTimestampedFilm(canvas,draw,duration,{signal,maxBytes=CAP,soundtrack}={}){
  if(!Number.isInteger(maxBytes)||maxBytes<=0||maxBytes>CAP)throw Error('Video byte limit must be a positive integer of at most 32 MiB.');
  const frames=planExportFrames(duration);
  if(typeof draw!=='function')throw Error('Provide a film renderer.');
  return run();
  async function run(){
   const deadline=performance.now()+(duration+10)*1000;
   let failure=null,encoder=null,timer,cancel,sink,finished=false,cancelling=null;
   const check=()=>{if(failure)throw failure;if(signal?.aborted)throw Error('Export cancelled.');if(performance.now()>=deadline)throw Error('Export timed out. Try a shorter film.');};
   const retire=error=>{failure??=error;if(encoder&&!cancelling)cancelling=Promise.resolve().then(()=>encoder.cancel()).catch(()=>{});};
   let rejectStopped;
   const stopped=new Promise((_,reject)=>{rejectStopped=reject;});stopped.catch(()=>{});
   const stop=error=>{if(finished)return;retire(error);rejectStopped(failure);};
   cancel=()=>stop(Error('Export cancelled.'));
   signal?.addEventListener('abort',cancel,{once:true});
   timer=setTimeout(()=>stop(Error('Export timed out. Try a shorter film.')),Math.max(0,deadline-performance.now()));
   const wait=async promise=>{check();const result=await Promise.race([promise,stopped]);check();return result;};
   try{
    check();
    const pcm=soundtrack?await wait(prepareExportPcm(soundtrack.asset,soundtrack.plan,{signal})):null;
    if(soundtrack&&soundtrack.plan.sequenceDuration!==duration)throw Error('Use the soundtrack plan for this complete sequence.');
    const codec=await wait(backend.probe(canvas,pcm));
    if(!codec)throw Error('This browser cannot encode this WebM. Save a complete backup instead.');
    sink=createBoundedVideoSink(maxBytes,check);check();encoder=backend.create(sink,codec,pcm,frames);check();await wait(encoder.start());
    let vi=0,ai=0;
    while(vi<frames.frameCount||pcm&&ai<pcm.blockCount){
     check();const frame=vi<frames.frameCount?frames.frame(vi):null;
     const block=pcm&&ai<pcm.blockCount?pcm.block(ai):null;
     if(frame&&(!block||frame.timestamp<=block.timestamp)){
      draw(frame.time);check();const sample=encoder.video(canvas,frame);
      try{await wait(encoder.addVideo(sample));}finally{sample.close();}
      vi++;
      // Yield deliberate tasks for cancellation/UI even on immediate encoders.
      if(vi%6===0)await wait(new Promise(resolve=>setTimeout(resolve,0)));
     }else{
      const sample=encoder.audio(block);try{await wait(encoder.addAudio(sample));}finally{sample.close();}ai++;
     }
    }
    await wait(encoder.finalize());check();const bytes=sink.bytes();
    if(!bytes.length)throw Error('Encoder produced no video.');
    const blob=new Blob([bytes],{type:'video/webm'});check();finished=true;return blob;
   }catch(error){retire(error);throw failure;}
   finally{
    finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    if(cancelling)await cancelling;sink?.clear();
   }
  }
 };
}
export const exportTimestampedFilm=createTimestampedExporter(nativeExportBackend);
