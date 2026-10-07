// Explicit diagnostic variation only. No input samples, canvases, audio or
// promise results are retained. Native methods and promises remain authoritative.
export function instrumentStages(backend,renderer,now=()=>performance.now()){
 const names=['probe','create','draw','start','video','audio','addVideo','addAudio','finalize','cancel'];
 const stages=Object.fromEntries(names.map(name=>[name,{calls:0,completed:0,errors:0,totalMs:0,maxMs:0,pending:0,firstPending:0}]));
 let active=true;const restorations=[];
 function wrap(receiver,key,name,callReceiver=false){
  const original=receiver[key];if(typeof original!=='function')return original;
  return function(...args){
   if(!active)return original.apply(callReceiver?this:receiver,args);
   const row=stages[name],began=now();row.calls++;if(!row.pending)row.firstPending=began;row.pending++;
   const end=failed=>{if(!active)return;const elapsed=Math.max(0,now()-began);row.completed++;row.errors+=Number(failed);row.totalMs+=elapsed;row.maxMs=Math.max(row.maxMs,elapsed);row.pending--;};
   try{
    const result=original.apply(callReceiver?this:receiver,args);
    if(result instanceof Promise)result.then(()=>end(false),()=>end(true));else end(false);
    return result;
   }catch(error){end(true);throw error;}
  };
 }
 function replace(receiver,key,replacement){const original=receiver[key];receiver[key]=replacement;restorations.push(()=>{if(receiver[key]===replacement)receiver[key]=original;});}
 replace(backend,'probe',wrap(backend,'probe','probe'));
 replace(renderer,'draw',wrap(renderer,'draw','draw',true));
 // Preserve each encoder's receiver. Only its bounded public native operations
 // are observed; no extra native call, retry, sample copy or result substitution.
 const timedCreate=wrap(backend,'create','create');
 replace(backend,'create',function(...args){
  const encoder=timedCreate(...args);
  for(const name of ['start','video','audio','addVideo','addAudio','finalize','cancel'])if(typeof encoder[name]==='function')encoder[name]=wrap(encoder,name,name);
  return encoder;
 });
 return {
  snapshot(){return {schemaVersion:1,mode:'stage-timing-diagnostic-variation',active,stages:Object.fromEntries(names.map(name=>{const {firstPending,...row}=stages[name];return[name,{...row,pendingMs:row.pending?Math.max(0,now()-firstPending):0}];})),limits:['Observer elapsed times include scheduling/native waits; stages may overlap and are not additive CPU time.','Draw timing excludes later GPU work; VideoFrame snapshots may synchronize rendering.','All renderer draw calls in this window are counted; draw timing is not export-only attribution.','A separate diagnostic variation, not the unchanged original acceptance run.']};},
  stop(){if(!active)return;active=false;for(const restore of restorations.reverse())restore();},
 };
}

export async function installStageTiming(page){
 let timer;try{await Promise.race([page.evaluate(async()=>{
  if(globalThis.__shotStageTiming)throw Error('Stage timing already installed.');
  const [{instrumentStages},{nativeExportBackend},{StageRenderer}]=await Promise.all([import('/scripts/stage-timing-diagnostics.mjs'),import('/src/timestamped-export.js'),import('/src/renderer.js')]);
  const observer=instrumentStages(nativeExportBackend,StageRenderer.prototype);
  globalThis.__shotStageTiming={observer,restore(){observer.stop();delete globalThis.__shotStageTiming;}};
 }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stage timing installation timed out.')),5000);})]);}finally{clearTimeout(timer);}
}
export async function sampleStageTiming(page){
 let timer;try{return await Promise.race([page.evaluate(()=>globalThis.__shotStageTiming?.observer.snapshot()??{unavailable:'stage timing not installed'}),new Promise(resolve=>{timer=setTimeout(()=>resolve({unavailable:'stage diagnostic renderer timed out'}),500);})]);}
 catch(error){return {unavailable:String(error.message).slice(0,1000)};}finally{clearTimeout(timer);}
}
export async function stopStageTiming(page){let timer;try{await Promise.race([page.evaluate(()=>globalThis.__shotStageTiming?.restore()),new Promise(resolve=>{timer=setTimeout(resolve,500);})]);}catch{}finally{clearTimeout(timer);}}
