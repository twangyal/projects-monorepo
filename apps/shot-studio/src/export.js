export function exportFilm(canvas,draw,duration,{signal}={}){
  if(!canvas.captureStream||!globalThis.MediaRecorder)throw Error('Video export is unavailable in this browser.');
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime)throw Error('This browser cannot encode WebM. Save a project backup instead.');
  if(signal?.aborted)throw Error('Export cancelled.');
  return new Promise((resolve,reject)=>{
    let stream,recorder,frame=0,timeout,finished=false,started;
    const chunks=[];
    const cleanup=()=>{cancelAnimationFrame(frame);clearTimeout(timeout);stream?.getTracks().forEach(t=>t.stop());signal?.removeEventListener('abort',cancel);};
    const fail=error=>{if(finished)return;finished=true;try{if(recorder?.state==='recording')recorder.stop();}catch{}cleanup();reject(error);};
    const cancel=()=>fail(Error('Export cancelled.'));
    const tick=now=>{if(finished)return;try{const t=Math.min(duration,(now-started)/1000);draw(t);if(t>=duration)recorder.stop();else frame=requestAnimationFrame(tick);}catch(e){fail(e);}};
    try{
      draw(0);stream=canvas.captureStream(30);recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000});
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onerror=()=>fail(Error('Video encoder failed. Try a shorter film.'));
      recorder.onstop=()=>{if(finished)return;finished=true;cleanup();const blob=new Blob(chunks,{type:mime});blob.size?resolve(blob):reject(Error('Encoder produced no video.'));};
      signal?.addEventListener('abort',cancel,{once:true});recorder.start(100);started=performance.now();
      timeout=setTimeout(()=>fail(Error('Export timed out. Keep this tab visible while recording.')),(duration+10)*1000);frame=requestAnimationFrame(tick);
    }catch(e){fail(e);}
  });
}
