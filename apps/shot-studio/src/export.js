import {assertSequenceAudioSession} from './sequence-audio-session.js';
export const MAX_VIDEO_BYTES=32*1024*1024;

export function exportFilm(canvas,draw,duration,{signal,maxBytes=MAX_VIDEO_BYTES,audioSession}={}){
  if(audioSession!==undefined)return exportWithAudio(canvas,draw,duration,{signal,maxBytes,audioSession});
  return captureFilm(canvas,draw,duration,{signal,maxBytes});
}
async function exportWithAudio(canvas,draw,duration,options){
  assertSequenceAudioSession(options.audioSession);
  try{
    assertSequenceAudioSession(options.audioSession,duration);
    return await captureFilm(canvas,draw,duration,options);
  }finally{await options.audioSession.close();}
}
function captureFilm(canvas,draw,duration,{signal,maxBytes,audioSession}){
  if(!Number.isInteger(maxBytes)||maxBytes<=0||maxBytes>MAX_VIDEO_BYTES)throw Error('Video byte limit must be a positive integer of at most 32 MiB.');
  if(typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||duration>60)throw Error('Video duration must be finite and greater than 0, at most 60 seconds.');
  if(!canvas.captureStream||!globalThis.MediaRecorder)throw Error('Video export is unavailable in this browser.');
  const formats=audioSession?['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus']:['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  const mime=formats.find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime)throw Error(audioSession?'This browser cannot encode audiovisual WebM. Save a complete sequence backup instead.':'This browser cannot encode WebM. Save a project backup instead.');
  if(signal?.aborted)throw Error('Export cancelled.');
  return new Promise((resolve,reject)=>{
    let stream,recorder,frame=0,timeout,finished=false,started,bytes=0,lastCapture=-Infinity,captureTrack;
    const chunks=[];
    const cleanup=()=>{
      cancelAnimationFrame(frame);clearTimeout(timeout);
      if(recorder){recorder.ondataavailable=null;recorder.onerror=null;recorder.onstop=null;}
      audioSession?.stop();
      for(const track of stream?.getTracks()??[]){try{track.stop();}catch{}}
      signal?.removeEventListener('abort',cancel);
    };
    const fail=error=>{
      if(finished)return;finished=true;
      try{if(recorder?.state==='recording'||recorder?.state==='paused')recorder.stop();}catch{}
      cleanup();chunks.length=0;reject(error);
    };
    const cancel=()=>fail(Error('Export cancelled.'));
    const tick=now=>{
      if(finished)return;
      try{
        const t=audioSession?audioSession.time():Math.min(duration,(now-started)/1000);draw(t);
        if(finished)return;
        const eligible=!captureTrack||now-lastCapture>=1000/30;
        if(captureTrack&&eligible){captureTrack.requestFrame();lastCapture=now;}
        if(finished)return;
        if(t>=duration&&eligible)recorder.stop();else frame=requestAnimationFrame(tick);
      }catch(error){fail(error);}
    };
    try{
      draw(0);
      if(signal?.aborted)throw Error('Export cancelled.');
      stream=canvas.captureStream(0);
      if(signal?.aborted)throw Error('Export cancelled.');
      captureTrack=stream.getVideoTracks?.()[0];
      if(typeof captureTrack?.requestFrame!=='function'){
        const probe=stream;stream=undefined;captureTrack=undefined;
        for(const track of probe.getTracks()){try{track.stop();}catch{}}
        if(signal?.aborted)throw Error('Export cancelled.');
        stream=canvas.captureStream(30);
        if(signal?.aborted)throw Error('Export cancelled.');
      }
      const recordingStream=audioSession?new MediaStream([...stream.getVideoTracks(),...audioSession.captureStream.getAudioTracks()]):stream;
      recorder=new MediaRecorder(recordingStream,{mimeType:mime,videoBitsPerSecond:2500000});
      recorder.ondataavailable=event=>{
        if(finished)return;
        try{
          const data=event.data;
          if(!Number.isSafeInteger(data.size)||data.size<0)throw Error('Video encoder produced an invalid chunk.');
          if(data.size>maxBytes-bytes){fail(Error('Video exceeds the byte limit (at most 32 MiB). Try a shorter film.'));return;}
          if(data.size){bytes+=data.size;chunks.push(data);}
        }catch(error){fail(error);}
      };
      recorder.onerror=()=>fail(Error('Video encoder failed. Try a shorter film.'));
      recorder.onstop=()=>{
        if(finished)return;finished=true;cleanup();
        try{
          const blob=new Blob(chunks,{type:mime});
          if(!blob.size)throw Error('Encoder produced no video.');
          if(blob.size>maxBytes)throw Error('Video exceeds the byte limit (at most 32 MiB).');
          resolve(blob);
        }catch(error){reject(error);}finally{chunks.length=0;}
      };
      signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted){cancel();return;}
      recorder.start(100);
      if(finished)return;
      if(audioSession)audioSession.start(0,{capture:true});
      if(finished)return;
      started=performance.now();
      if(captureTrack){captureTrack.requestFrame();lastCapture=started;}
      if(finished)return;
      timeout=setTimeout(()=>fail(Error('Export timed out. Keep this tab visible while recording.')),(duration+10)*1000);
      frame=requestAnimationFrame(tick);
    }catch(error){fail(error);}
  });
}
