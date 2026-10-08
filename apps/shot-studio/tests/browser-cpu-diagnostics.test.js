import test from 'node:test';
import assert from 'node:assert/strict';
const diagnostic=await import('../scripts/browser-cpu-diagnostics.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});

const process=(id,type,cpuTime)=>({id,type,cpuTime});
test('paired process counters exclude lifetime CPU and do not invent CPU for process churn',()=>{
 const before=[process(1,'browser',10),process(2,'renderer',20),process(3,'GPU',5)];
 const after=[process(1,'browser',10.5),process(2,'renderer',22),process(4,'utility',30)];
 const result=diagnostic.compareProcessCpu(before,after,4000);
 assert.equal(result.matchedCpuMs,2500);assert.equal(result.byType.browser.cpuMs,500);assert.equal(result.byType.renderer.cpuMs,2000);
 assert.equal(result.newProcesses,1);assert.equal(result.missingProcesses,1);assert.equal(result.complete,false);
 assert.equal(result.wallMs,4000);
});
test('regressed or changed process counters are disclosed instead of becoming negative or inflated CPU',()=>{
 const result=diagnostic.compareProcessCpu([process(1,'browser',10),process(2,'renderer',5)],[process(1,'browser',9),process(2,'GPU',8)],1000);
 assert.equal(result.matchedCpuMs,0);assert.equal(result.invalidPairs,2);assert.equal(result.complete,false);
});
test('malformed and oversized process snapshots are refused rather than reported as zero usage',()=>{
 for(const rows of [null,[],[process(1,'renderer',NaN)],[process(1,'renderer',-1)],[process(1,'renderer',1),process(1,'renderer',2)],Array.from({length:65},(_,i)=>process(i,'renderer',1))])
  assert.throws(()=>diagnostic.compareProcessCpu(rows,[process(2,'browser',1)],100));
 for(const wall of [-1,NaN,Infinity])assert.throws(()=>diagnostic.compareProcessCpu([process(1,'browser',0)],[process(1,'browser',1)],wall));
});
test('native protocol failure remains unavailable and owned session detaches',async()=>{
 let detached=0;
 const session={send:async()=>{throw Error('secret protocol details');},detach:async()=>{detached++;}};
 const observer=await diagnostic.startBrowserCpu({newBrowserCDPSession:async()=>session});
 const result=await observer.finish();
 assert.equal(result.status,'unavailable');assert.equal(detached,1);assert.equal(result.matchedCpuMs,undefined);
 assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('finishing a diagnostic twice samples once and retires the same owned session',async()=>{
 let reads=0,detached=0,now=1000;
 const session={send:async method=>{assert.equal(method,'SystemInfo.getProcessInfo');reads++;return{processInfo:[process(7,'browser',reads===1?4:4.25)]};},detach:async()=>{detached++;}};
 const observer=await diagnostic.startBrowserCpu({newBrowserCDPSession:async()=>session},()=>now);now=2000;
 const first=await observer.finish(),second=await observer.finish();
 assert.equal(first.status,'measured');assert.equal(first.matchedCpuMs,250);assert.equal(first.complete,true);assert.equal(first.wallMs,1000);
 assert.deepEqual(second,first);assert.equal(reads,2);assert.equal(detached,1);
});
test('a counter request that never settles is bounded and detached without fabricating zero CPU',async()=>{
 let detached=0;
 const observer=await diagnostic.startBrowserCpu({newBrowserCDPSession:async()=>({send:()=>new Promise(()=>{}),detach:async()=>{detached++;}})});
 assert.equal((await observer.finish()).status,'unavailable');assert.equal(detached,1);
});
test('a late session creation is retired when the bounded admission has already failed',async()=>{
 let release,detached=0;
 const pending=diagnostic.startBrowserCpu({newBrowserCDPSession:()=>new Promise(resolve=>release=resolve)});
 const observer=await pending;assert.equal((await observer.finish()).status,'unavailable');
 release({detach:async()=>{detached++;}});await new Promise(resolve=>setImmediate(resolve));assert.equal(detached,1);
});

test('finite counter values that overflow milliseconds or totals refuse a measured receipt',()=>{
 assert.throws(()=>diagnostic.compareProcessCpu([process(1,'renderer',0)],[process(1,'renderer',Number.MAX_VALUE)],1000));
 assert.throws(()=>diagnostic.compareProcessCpu([process(1,'renderer',0),process(2,'renderer',0)],[process(1,'renderer',9e304),process(2,'renderer',9e304)],1000));
});
test('zero-only lifetime counters disclose unavailable CPU instead of a fabricated idle export',async()=>{
 const observer=await diagnostic.startBrowserCpu({newBrowserCDPSession:async()=>({send:async()=>({processInfo:[process(1,'browser',0),process(2,'renderer',0)]}),detach:async()=>{}})});
 const result=await observer.finish();assert.equal(result.status,'unavailable');assert.equal(result.reason,'Native process counters remained zero.');assert.equal(result.matchedCpuMs,undefined);
});
test('a zero-only process pair makes otherwise readable coverage incomplete',()=>{
 const result=diagnostic.compareProcessCpu([process(1,'browser',1),process(2,'renderer',0)],[process(1,'browser',1.5),process(2,'renderer',0)],1000);
 assert.equal(result.matchedCpuMs,500);assert.equal(result.zeroCounterPairs,1);assert.equal(result.matchedProcesses,1);assert.equal(result.complete,false);
});
test('unavailable CPU retains churn and regression coverage counts without numerical CPU claims',async()=>{
 for(const [before,after,reason,coverage] of [
  [[process(1,'browser',0),process(2,'renderer',2),process(4,'GPU',5)],[process(1,'browser',0),process(3,'renderer',3),process(4,'GPU',4)],'Native process counters remained zero.',{newProcesses:1,missingProcesses:1,invalidPairs:1,zeroCounterPairs:1}],
  [[process(1,'browser',1)],[process(2,'browser',2)],'No matching native process CPU counters.',{newProcesses:1,missingProcesses:1,invalidPairs:0,zeroCounterPairs:0}],
 ]){
  let reads=0;
  const observer=await diagnostic.startBrowserCpu({newBrowserCDPSession:async()=>({send:async()=>({processInfo:++reads===1?before:after}),detach:async()=>{}})});
  const result=await observer.finish();assert.equal(result.status,'unavailable');assert.equal(result.reason,reason);
  for(const [key,value]of Object.entries(coverage))assert.equal(result[key],value,key);
  assert.equal(result.complete,false);assert.equal(result.matchedCpuMs,undefined);assert.equal(result.byType,undefined);
 }
});
