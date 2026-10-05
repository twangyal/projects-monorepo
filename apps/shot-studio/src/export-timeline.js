import {assertAdmittedWavAsset,assertSoundtrackPlan,parsePcm16Wav} from './sequence-audio.js';

const SAMPLE_RATE=48000,BLOCK_FRAMES=960;
function durationMicros(duration){
  if(typeof duration!=='number'||!Number.isFinite(duration)||duration<.000001||duration>60)throw Error('Export duration must be between one microsecond and 60 seconds.');
  return Math.round(duration*1000000);
}
function indexIn(index,count){
  if(!Number.isSafeInteger(index)||index<0||index>=count)throw Error('Choose an integer export sample index within the timeline.');
}

/** Timestamped inputs are derived from authored time, never browser scheduling. */
export function planExportFrames(duration){
  const end=durationMicros(duration),frameCount=Math.ceil(end*30/1000000);
  return Object.freeze({frameCount,frame(index){
    indexIn(index,frameCount);
    const timestamp=Math.round(index*1000000/30),next=Math.min(end,Math.round((index+1)*1000000/30));
    return Object.freeze({time:index/30,timestamp,duration:next-timestamp});
  }});
}

/** Lazily converts original PCM to planar48kHz blocks, including the silent tail.
 * Linear interpolation is explicit; this is not native resampler equivalence.
 * Only one bounded block is allocated per call. No AudioContext or device runs.
 */
export async function prepareExportPcm(asset,plan,{signal}={}){
  assertAdmittedWavAsset(asset);assertSoundtrackPlan(plan,asset);durationMicros(plan.sequenceDuration);
  if(signal?.aborted)throw Error('Export PCM preparation cancelled.');
  const deadline=performance.now()+10000;
  let timer,cancel,retired=false;
  const check=()=>{
    if(retired||signal?.aborted)throw Error('Export PCM preparation cancelled.');
    if(performance.now()>=deadline)throw Error('Export PCM preparation timed out.');
  };
  const work=async()=>{
    const bytes=new Uint8Array(await Blob.prototype.arrayBuffer.call(asset.blob));check();
    const metadata=parsePcm16Wav(bytes),pcm=new DataView(bytes.buffer,bytes.byteOffset+metadata.dataOffset,metadata.dataBytes);
    const frameCount=Math.ceil(plan.sequenceDuration*SAMPLE_RATE),blockCount=Math.ceil(frameCount/BLOCK_FRAMES);
    check();
    return Object.freeze({frameCount,blockCount,block(index){
      indexIn(index,blockCount);
      const first=index*BLOCK_FRAMES,numberOfFrames=Math.min(BLOCK_FRAMES,frameCount-first),data=new Float32Array(numberOfFrames*asset.channels);
      if(plan.audible)for(let frame=0;frame<numberOfFrames;frame++){
        const time=(first+frame)/SAMPLE_RATE;
        if(time<plan.audibleStart||time>=plan.audibleEnd)continue;
        const source=plan.inFrame+(time-plan.startTime)*asset.sampleRate;
        const left=Math.min(plan.outFrame-1,Math.max(plan.inFrame,Math.floor(source))),right=Math.min(plan.outFrame-1,left+1),fraction=source-left;
        for(let channel=0;channel<asset.channels;channel++){
          const a=pcm.getInt16((left*asset.channels+channel)*2,true),b=pcm.getInt16((right*asset.channels+channel)*2,true);
          data[channel*numberOfFrames+frame]=(a+(b-a)*fraction)*plan.gain/32768;
        }
      }
      return{timestamp:Math.round(first*1000000/SAMPLE_RATE),numberOfFrames,numberOfChannels:asset.channels,sampleRate:SAMPLE_RATE,data};
    }});
  };
  try{return await Promise.race([work(),new Promise((_,reject)=>{
    cancel=()=>{retired=true;reject(Error('Export PCM preparation cancelled.'));};
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{retired=true;reject(Error('Export PCM preparation timed out.'));},10000);
    if(signal?.aborted)cancel();
  })]);}finally{retired=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
