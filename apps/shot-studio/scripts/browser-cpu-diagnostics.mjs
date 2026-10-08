// Explicit stage variation only. Native CDP counters are process-wide cumulative
// CPU seconds across all threads, not exclusive codec CPU or wall-clock waits.
// https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/#type-ProcessInfo
const LIMITS=[
 'Matched process CPU covers all threads/work in this observation window; it is not exclusive encoder CPU.',
 'CPU milliseconds across parallel threads may exceed wall milliseconds. Do not subtract from overlapping stage timers.',
 'New, missing, changed, regressed or zero-only process counters are excluded and disclose incomplete coverage.',
 'Two native counter reads bracket the export observation window, including protocol and harness overhead; no periodic profiling runs.',
 'No command lines, device identities, process IDs, media or page data are retained in the receipt.',
];
function snapshot(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>64)throw Error('Invalid process CPU snapshot.');
 const map=new Map();
 for(const row of rows){
  if(!row||!Number.isSafeInteger(row.id)||row.id<0||typeof row.type!=='string'||row.type.length<1||row.type.length>64||!Number.isFinite(row.cpuTime)||row.cpuTime<0||map.has(row.id))throw Error('Invalid process CPU snapshot.');
  map.set(row.id,{type:row.type,cpuTime:row.cpuTime});
 }
 return map;
}
export function compareProcessCpu(before,after,wallMs){
 if(!Number.isFinite(wallMs)||wallMs<0)throw Error('Invalid process CPU interval.');
 const initial=snapshot(before),final=snapshot(after),byType=Object.create(null);
 let matchedCpuMs=0,matchedProcesses=0,newProcesses=0,missingProcesses=0,invalidPairs=0,zeroCounterPairs=0;
 for(const [id,row]of final){
  const old=initial.get(id);if(!old){newProcesses++;continue;}
  if(old.type!==row.type||row.cpuTime<old.cpuTime){invalidPairs++;continue;}
  if(old.cpuTime===0&&row.cpuTime===0){zeroCounterPairs++;continue;}
  const cpuMs=(row.cpuTime-old.cpuTime)*1000;
  if(!Number.isFinite(cpuMs)||!Number.isFinite(matchedCpuMs+cpuMs))throw Error('Invalid process CPU delta.');
  matchedCpuMs+=cpuMs;matchedProcesses++;
  const type=byType[row.type]??={processes:0,cpuMs:0};type.processes++;type.cpuMs+=cpuMs;
 }
 for(const id of initial.keys())if(!final.has(id))missingProcesses++;
 return{wallMs,matchedCpuMs,matchedProcesses,newProcesses,missingProcesses,invalidPairs,zeroCounterPairs,complete:!newProcesses&&!missingProcesses&&!invalidPairs&&!zeroCounterPairs,byType};
}
function bounded(work){
 let timer;return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native process counters unavailable.')),1000);})]).finally(()=>clearTimeout(timer));
}
export async function startBrowserCpu(browser,now=()=>performance.now()){
 let session,initial,began,retired=false,finished;
 const unavailable=(reason='Native process counters unavailable or invalid.',extra={})=>({schemaVersion:1,status:'unavailable',reason,...extra,limits:[...LIMITS]});
 const detach=async()=>{const owned=session;session=null;if(owned)try{await bounded(owned.detach());}catch{}};
 try{
  const pending=Promise.resolve().then(()=>browser.newBrowserCDPSession());
  pending.then(value=>{if(retired)Promise.resolve(value.detach()).catch(()=>{});},()=>{});
  session=await bounded(pending);began=now();initial=(await bounded(session.send('SystemInfo.getProcessInfo'))).processInfo;snapshot(initial);
 }catch{retired=true;await detach();}
 return{finish(){return finished??=(async()=>{
  if(retired)return unavailable();
  try{
   const final=(await bounded(session.send('SystemInfo.getProcessInfo'))).processInfo;
   const result=compareProcessCpu(initial,final,now()-began);
   if(!result.matchedProcesses){
    const {matchedCpuMs,byType,...coverage}=result;
    return unavailable(result.zeroCounterPairs?'Native process counters remained zero.':'No matching native process CPU counters.',coverage);
   }
   return{schemaVersion:1,status:'measured',...result,limits:[...LIMITS]};
  }catch{return unavailable();}finally{retired=true;initial=null;await detach();}
 })();}};
}
