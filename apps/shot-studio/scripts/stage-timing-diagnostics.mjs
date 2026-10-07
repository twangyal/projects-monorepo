// Explicit diagnostic variation only. No input samples, canvases, audio or
// promise results are retained. Native methods and promises remain authoritative.
export function instrumentStages(backend,renderer,now=()=>performance.now(),codecs=null){
 const queueObserver=codecs?instrumentCodecQueues(codecs,now):null;
 const sinks=new Map();
 const names=['probe','create','draw','start','video','audio','addVideo','addAudio','finalize','cancel','sinkWrite'];
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
  const sink=args[0];
  if(sink&&typeof sink.write==='function'&&!sinks.has(sink)&&sinks.size<8){const original=sink.write,replacement=wrap(sink,'write','sinkWrite');sink.write=replacement;sinks.set(sink,{original,replacement});}
  const encoder=timedCreate(...args);
  for(const name of ['start','video','audio','addVideo','addAudio','finalize','cancel'])if(typeof encoder[name]==='function')encoder[name]=wrap(encoder,name,name);
  return encoder;
 });
 return {
  snapshot(){return {schemaVersion:1,mode:'stage-timing-diagnostic-variation',active,nativeQueues:queueObserver?.snapshot()??null,stages:Object.fromEntries(names.map(name=>{const {firstPending,...row}=stages[name];return[name,{...row,pendingMs:row.pending?Math.max(0,now()-firstPending):0}];})),limits:['Observer elapsed times include scheduling/native waits; stages may overlap and are not additive CPU time.','Draw timing excludes later GPU work; VideoFrame snapshots may synchronize rendering.','All renderer draw calls in this window are counted; draw timing is not export-only attribution.','Native once-dequeue waits measure the pinned encoder backpressure boundary, not exclusive encoder CPU time.','Sink writes exclude upstream muxer scheduling/serialization and do not account for all writer backpressure.','Queue observations retain at most8 active encoders and8 pending listeners per encoder; unobserved counts disclose overflow.','A separate diagnostic variation, not the unchanged original acceptance run.']};},
  stop(){if(!active)return;active=false;queueObserver?.stop();for(const [sink,{original,replacement}] of sinks){if(sink.write===replacement)sink.write=original;}sinks.clear();for(const restore of restorations.reverse())restore();},
 };
}

export async function installStageTiming(page){
 let timer;try{await Promise.race([page.evaluate(async()=>{
  if(globalThis.__shotStageTiming)throw Error('Stage timing already installed.');
  const [{instrumentStages},{nativeExportBackend},{StageRenderer}]=await Promise.all([import('/scripts/stage-timing-diagnostics.mjs'),import('/src/timestamped-export.js'),import('/src/renderer.js')]);
  const observer=instrumentStages(nativeExportBackend,StageRenderer.prototype,()=>performance.now(),{VideoEncoder:globalThis.VideoEncoder,AudioEncoder:globalThis.AudioEncoder});
  globalThis.__shotStageTiming={observer,restore(){observer.stop();delete globalThis.__shotStageTiming;}};
 }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stage timing installation timed out.')),5000);})]);}finally{clearTimeout(timer);}
}
export async function sampleStageTiming(page){
 let timer;try{return await Promise.race([page.evaluate(()=>globalThis.__shotStageTiming?.observer.snapshot()??{unavailable:'stage timing not installed'}),new Promise(resolve=>{timer=setTimeout(()=>resolve({unavailable:'stage diagnostic renderer timed out'}),500);})]);}
 catch(error){return {unavailable:String(error.message).slice(0,1000)};}finally{clearTimeout(timer);}
}
export async function stopStageTiming(page){let timer;try{await Promise.race([page.evaluate(()=>globalThis.__shotStageTiming?.restore()),new Promise(resolve=>{timer=setTimeout(resolve,500);})]);}catch{}finally{clearTimeout(timer);}}

// Observe the pinned adapter's once-dequeue wait boundary without replacing its
// listener or any native result. Counts include only encoders seen by encode.
export function instrumentCodecQueues(codecs,now=()=>performance.now()){
 let active=true;const restore=[],owned=new Set();
 const rows=Object.fromEntries(['video','audio'].map(key=>[key,{encodeCalls:0,maxQueue:0,waits:0,completed:0,waitMs:0,maxWaitMs:0,pending:0,tracked:0,unobserved:0}]));
 function replace(proto,key,fn){const own=Object.getOwnPropertyDescriptor(proto,key);proto[key]=fn;restore.push(()=>{if(proto[key]===fn){if(own)Object.defineProperty(proto,key,own);else delete proto[key];}});}
 for(const [name,key] of [['VideoEncoder','video'],['AudioEncoder','audio']]){
  const proto=codecs[name]?.prototype;if(!proto)continue;
  const encode=proto.encode,listen=proto.addEventListener,remove=proto.removeEventListener,close=proto.close;
  if(![encode,listen,remove,close].every(fn=>typeof fn==='function'))continue;
  const row=rows[key],records=new WeakMap();
  const sample=encoder=>{row.maxQueue=Math.max(row.maxQueue,encoder.encodeQueueSize);};
  const clear=record=>{for(const waiter of record.waiters){remove.call(record.encoder,'dequeue',waiter.listener);row.pending--;}record.waiters.clear();owned.delete(record);row.tracked--;records.delete(record.encoder);};
  replace(proto,'encode',function(...args){
   const result=encode.apply(this,args);if(!active)return result;
   row.encodeCalls++;let record=records.get(this);
   if(!record){if(owned.size>=8){row.unobserved++;return result;}record={encoder:this,waiters:new Set(),clear:null};record.clear=()=>clear(record);records.set(this,record);owned.add(record);row.tracked++;}
   sample(this);return result;
  });
  replace(proto,'addEventListener',function(type,callback,options){
   const result=listen.call(this,type,callback,options);const record=records.get(this);
   if(!active||!record||type!=='dequeue'||options?.once!==true)return result;
   // Bound pending listener observations even for unexpected external callers.
   if(record.waiters.size>=8){row.unobserved++;return result;}
   const began=now(),waiter={listener:null};row.waits++;row.pending++;
   waiter.listener=()=>{record.waiters.delete(waiter);row.pending--;if(!active)return;const elapsed=Math.max(0,now()-began);row.completed++;row.waitMs+=elapsed;row.maxWaitMs=Math.max(row.maxWaitMs,elapsed);sample(this);};
   record.waiters.add(waiter);listen.call(this,type,waiter.listener,{once:true});return result;
  });
  replace(proto,'close',function(...args){try{return close.apply(this,args);}finally{const record=records.get(this);if(record)clear(record);}});
 }
 return {
  snapshot(){return Object.fromEntries(Object.entries(rows).map(([key,row])=>[key,{...row}]));},
  stop(){if(!active)return;active=false;for(const record of [...owned])record.clear();for(const fn of restore.reverse())fn();},
 };
}
