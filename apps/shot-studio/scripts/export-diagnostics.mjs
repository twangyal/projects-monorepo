// Passive observations for the independent maximum probe. No encoder wrappers,
// clock changes, retries, application imports, or changes to acceptance gates.
export function observeExport(page,{intervalMs=5000,timeoutMs=500,maxSamples=24}={}){
 const samples=[],began=performance.now();let stopped=false,pending=null;
 async function sample(reason){
  if(stopped)return;
  if(pending)await pending;
  if(stopped)return;
  let timer;
  pending=(async()=>{
   let state;
   try{
    state=await Promise.race([
     Promise.resolve().then(()=>page.evaluate(()=>{
      const text=id=>document.getElementById(id)?.textContent?.slice(0,1000)??null;
      const disabled=id=>document.getElementById(id)?.disabled??null;
      const progress=document.getElementById('sequence-export-progress');
      return {status:text('sequence-status'),saveStatus:text('sequence-save-status'),
       progress:progress?.value??null,progressMax:progress?.max??null,
       exportDisabled:disabled('sequence-export'),cancelDisabled:disabled('sequence-cancel'),
       visibility:document.visibilityState,focused:document.hasFocus()};
     })),
     new Promise(resolve=>{timer=setTimeout(()=>resolve({unavailable:'renderer diagnostic timed out'}),timeoutMs);}),
    ]);
   }catch(error){state={unavailable:String(error.message).slice(0,1000)};}
   finally{clearTimeout(timer);}
   if(!stopped){samples.push({reason,wallMs:performance.now()-began,...state});if(samples.length>maxSamples)samples.splice(0,samples.length-maxSamples);}
  })();
  try{await pending;}finally{pending=null;}
 }
 const interval=setInterval(()=>{if(!pending)void sample('poll');},intervalMs);
 interval.unref?.();
 return {samples,sample,stop(){stopped=true;clearInterval(interval);}};
}
