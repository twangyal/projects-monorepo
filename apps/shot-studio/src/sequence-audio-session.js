import {assertAdmittedWavAsset,assertSoundtrackPlan,parsePcm16Wav} from './sequence-audio.js';

const sessions=new WeakMap();
export function assertSequenceAudioSession(session,duration){
  const admitted=sessions.get(session);
  if(!admitted||(duration!==undefined&&(admitted.duration!==duration||!admitted.ready())))throw Error('Use a prepared, unused audio session for this complete sequence.');
  return session;
}
export async function prepareSequenceAudioSession(asset,plan,{signal}={}){
  assertAdmittedWavAsset(asset);assertSoundtrackPlan(plan,asset);
  if(signal?.aborted)throw Error('Sequence audio cancelled.');
  if(typeof globalThis.AudioContext!=='function')throw Error('Sequence audio is unavailable. Export a silent sequence or complete backup instead.');
  const context=new AudioContext();
  let destination,buffer,source,gain,silence,origin,position=0,started=false,stopped=false,retired=false,failure=null,closing=null,tracksStopped=false;
  const deadline=performance.now()+10000;
  const running=()=>{
    if(context.state!=='running'||!Number.isFinite(context.currentTime))throw Error('Sequence audio context is not running. Start rehearsal or export again.');
  };
  const elapsed=()=>Math.max(0,Math.min(plan.sequenceDuration,position+(context.currentTime-origin)));
  function stop(){
    if(stopped)return;
    if(started&&Number.isFinite(context.currentTime))position=elapsed();
    stopped=true;
    try{source?.stop();}catch{}try{source?.disconnect();}catch{}try{gain?.disconnect();}catch{}try{silence?.stop();}catch{}try{silence?.disconnect();}catch{}
    source=null;gain=null;silence=null;
  }
  function close(){
    if(closing)return closing;
    retired=true;stop();clearTimeout(timer);signal?.removeEventListener('abort',cancel);context.removeEventListener?.('statechange',stateChanged);
    if(!tracksStopped){tracksStopped=true;for(const track of destination?.stream.getTracks()??[]){try{track.stop();}catch{}}}
    try{destination?.disconnect();}catch{}
    closing=Promise.resolve().then(()=>context.state==='closed'?undefined:context.close()).finally(()=>{buffer=null;});
    return closing;
  }
  function cancel(){failure??=Error('Sequence audio cancelled.');void close().catch(()=>{});}
  function stateChanged(){if(started&&!stopped&&context.state!=='running'){failure??=Error('Sequence audio context stopped running.');void close().catch(()=>{});}}
  const timer=setTimeout(()=>{failure??=Error('Sequence audio setup timed out.');void close().catch(()=>{});},10000);
  const check=()=>{if(failure)throw failure;if(signal?.aborted)throw Error('Sequence audio cancelled.');if(retired||performance.now()>=deadline)throw Error('Sequence audio setup timed out.');};
  signal?.addEventListener('abort',cancel,{once:true});context.addEventListener?.('statechange',stateChanged);
  try{
    check();
    if(!Number.isFinite(context.sampleRate)||context.sampleRate<=0||!context.createMediaStreamDestination||!context.createBuffer||!context.createBufferSource||!context.resume)throw Error('This browser cannot prepare sequence audio.');
    const bytes=new Uint8Array(await Blob.prototype.arrayBuffer.call(asset.blob));check();
    const metadata=parsePcm16Wav(bytes),pcm=new DataView(bytes.buffer,bytes.byteOffset+metadata.dataOffset,metadata.dataBytes);
    buffer=context.createBuffer(asset.channels,asset.frameCount,asset.sampleRate);
    for(let channel=0;channel<asset.channels;channel++){
      const output=buffer.getChannelData(channel);
      for(let frame=0;frame<asset.frameCount;frame++){if(frame%16384===0)check();output[frame]=pcm.getInt16((frame*asset.channels+channel)*2,true)/32768;}
    }
    check();destination=context.createMediaStreamDestination();destination.channelCount=asset.channels;destination.channelCountMode='explicit';destination.channelInterpretation='discrete';
    await context.resume();check();running();clearTimeout(timer);
    const session=Object.freeze({
      captureStream:destination.stream,
      start(from,{capture=false}={}){
        if(failure)throw failure;
        if(retired||started||stopped)throw Error('Sequence audio session has already been retired or started.');
        if(typeof from!=='number'||!Number.isFinite(from)||from<0||from>plan.sequenceDuration||typeof capture!=='boolean')throw Error('Choose a finite sequence playback position and explicit capture mode.');
        if(signal?.aborted){cancel();throw Error('Sequence audio cancelled.');}
        running();position=from===0?0:from;origin=Math.ceil(context.currentTime*context.sampleRate)/context.sampleRate;
        const playStart=Math.max(position,plan.audibleStart);
        try{
          if(capture){
            if(typeof context.createConstantSource!=='function')throw Error('This browser cannot maintain a complete sequence audio track.');
            // Keep capture producing frames before and after the original WAV without allocating silent PCM.
            silence=context.createConstantSource();silence.offset.value=0;silence.connect(destination);silence.start(origin);
          }
          if(plan.audible&&playStart<plan.audibleEnd){
            source=context.createBufferSource();source.buffer=buffer;gain=context.createGain();gain.gain.value=plan.gain;
            source.connect(gain);gain.connect(capture?destination:context.destination);
            if(retired||signal?.aborted)throw Error('Sequence audio cancelled.');
            source.start(origin+playStart-position,plan.inFrame/plan.sampleRate+playStart-plan.startTime,plan.audibleEnd-playStart);
          }
          if(retired||signal?.aborted)throw Error('Sequence audio cancelled.');
          started=true;
        }catch(error){failure=error;void close().catch(()=>{});throw error;}
      },
      time(){if(failure)throw failure;if(!started)throw Error('Sequence audio has not started.');if(stopped)return position;try{running();return elapsed();}catch(error){failure=error;void close().catch(()=>{});throw error;}},
      stop,close,
    });
    sessions.set(session,{duration:plan.sequenceDuration,ready:()=>!retired&&!started&&!stopped&&!failure&&context.state==='running'});
    return session;
  }catch(error){failure??=error;try{await close();}catch{}throw failure;}
}
