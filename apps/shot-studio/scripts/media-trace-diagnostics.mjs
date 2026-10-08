// Explicit diagnostic only: retain fixed native event aggregates, never raw
// arguments, URLs, process/thread IDs, timestamps, frames or PCM.
const NAMES=new Set(['vpx_codec_encode','VideoEncoder::Ouput','VideoEncoder::Output','GLES2::ReadPixels','GpuChannel::ExecuteDeferredRequest']);
const LIMITS=[
 'Each named bucket is inclusive native event time; buckets can overlap and must not be added or subtracted into a CPU budget.',
 'Thread CPU covers only the emitting thread, not codec/raster worker threads or exclusive encoder CPU; missing counters are null, not zero. Wall and thread durations use independently reported native clocks.',
 'Only selected complete media/GPU events are admitted. Native buffer loss/fullness, unsupported phases, invalid counters and event caps disclose incomplete coverage.',
 'This separately labelled tracing variation has observer overhead and cannot clear an unchanged original acceptance failure.',
 'No raw arguments, URLs, identities, process/thread IDs, timestamps or media are retained.'
];
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const unavailable=(reason,extra={})=>({schemaVersion:1,status:'unavailable',reason,...extra,limits:[...LIMITS]});
export function createMediaTrace(){
 const rows=new Map();let observedEvents=0,invalidEvents=0,unsupportedPhases=0,eventLimitReached=false,overflow=false;
 return{add(events){
  if(!Array.isArray(events))throw Error('Invalid trace batch.');
  for(const e of events){
   if(observedEvents>=100000){eventLimitReached=true;break;}observedEvents++;
   if(!e||!NAMES.has(e.name)||typeof e.cat!=='string'||!e.cat.split(',').some(c=>c==='media'||c==='gpu'))continue;
   if(e.ph!=='X'){unsupportedPhases++;continue;}
   if(!valid(e.dur)){invalidEvents++;continue;}
   const row=rows.get(e.name)||{events:0,wallUs:0,maxWallUs:0,threadUs:0,threadCpuEvents:0,missingThreadCpuEvents:0,invalidThreadCpuEvents:0};
   row.events++;row.wallUs+=e.dur;row.maxWallUs=Math.max(row.maxWallUs,e.dur);
   if(e.tdur===undefined)row.missingThreadCpuEvents++;
   else if(!valid(e.tdur))row.invalidThreadCpuEvents++;
   else{row.threadUs+=e.tdur;row.threadCpuEvents++;}
   overflow ||= !Number.isFinite(row.wallUs)||!Number.isFinite(row.threadUs);rows.set(e.name,row);
  }
 },finish({dataLossOccurred=false,bufferFull=false}={}){
  const coverage={observedEvents,invalidEvents,unsupportedPhases,eventLimitReached,dataLossOccurred:!!dataLossOccurred,bufferFull:!!bufferFull};
  if(overflow)return unavailable('Native trace aggregates overflowed.',{...coverage,complete:false});
  if(!rows.size)return unavailable('Selected native media events were not observed.',{...coverage,complete:false});
  const buckets=Object.fromEntries([...rows].map(([name,r])=>[name,{events:r.events,wallMs:r.wallUs/1000,maxWallMs:r.maxWallUs/1000,threadCpuMs:r.threadCpuEvents?r.threadUs/1000:null,threadCpuEvents:r.threadCpuEvents,missingThreadCpuEvents:r.missingThreadCpuEvents,invalidThreadCpuEvents:r.invalidThreadCpuEvents}]));
  const complete=!invalidEvents&&!unsupportedPhases&&!eventLimitReached&&!dataLossOccurred&&!bufferFull&&[...rows.values()].every(r=>!r.missingThreadCpuEvents&&!r.invalidThreadCpuEvents);
  return{schemaVersion:1,status:'measured',...coverage,complete,buckets,limits:[...LIMITS]};
 }};
}
function bounded(work){let timer;return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native trace unavailable.')),1000);})]).finally(()=>clearTimeout(timer));}
export async function startMediaTrace(browser){
 const collector=createMediaTrace();let session,started=false,startPending,retired=false,finished,bufferFull=false,invalidBatch=false,endPending;
 let resolveComplete;const completed=new Promise(resolve=>{resolveComplete=resolve;});
 const data=({value})=>{try{collector.add(value);}catch{invalidBatch=true;}};
 const usage=({percentFull})=>{if(valid(percentFull)&&percentFull>=.95)bufferFull=true;};
 const done=value=>resolveComplete(value);
 const detached=new WeakSet();
 const detach=async owned=>{if(!owned||detached.has(owned))return;detached.add(owned);owned.off('Tracing.dataCollected',data);owned.off('Tracing.bufferUsage',usage);owned.off('Tracing.tracingComplete',done);try{await bounded(owned.detach());}catch{}};
 const end=owned=>endPending??=bounded(owned.send('Tracing.end'));
 try{
  const admission=Promise.resolve().then(()=>browser.newBrowserCDPSession());admission.then(owned=>{if(retired)void detach(owned);},()=>{});
  session=await bounded(admission);session.on('Tracing.dataCollected',data);session.on('Tracing.bufferUsage',usage);session.on('Tracing.tracingComplete',done);
  const owned=session;startPending=Promise.resolve().then(()=>owned.send('Tracing.start',{traceConfig:{recordMode:'recordUntilFull',traceBufferSizeInKb:4096,enableArgumentFilter:true,includedCategories:['media'],excludedCategories:['*']},transferMode:'ReportEvents',bufferUsageReportingInterval:1000}));
  startPending.then(()=>{started=true;if(retired&&!detached.has(owned))void end(owned).catch(()=>{}).finally(()=>detach(owned));},()=>{if(retired)void detach(owned);});
  await bounded(startPending);
 }catch{retired=true;if(session){if(started)try{await end(session);}catch{}await detach(session);}}
 return{finish(){return finished??=(async()=>{
  if(retired)return unavailable('Native media trace admission unavailable.');
  try{
   if(!started)return unavailable('Native media trace admission unavailable.');
   await end(session);const result=await bounded(completed);
   if(invalidBatch)return unavailable('Native media trace batch invalid.');
   return collector.finish({dataLossOccurred:result.dataLossOccurred,bufferFull});
  }catch{return unavailable('Native media trace completion unavailable.');}
  finally{retired=true;await detach(session);session=null;}
 })();}};
}
