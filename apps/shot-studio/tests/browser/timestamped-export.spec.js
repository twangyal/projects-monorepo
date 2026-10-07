import {test,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

async function encode(page,{stall=false,audio=false}={}){
 return page.evaluate(async({stall,audio})=>{
  const {exportTimestampedFilm}=await import('/src/export.js');
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');
  const draws=[];let soundtrack;
  if(audio){
   const bytes=new Uint8Array(44+48000*2),v=new DataView(bytes.buffer),text=(offset,s)=>bytes.set(new TextEncoder().encode(s),offset);
   text(0,'RIFF');v.setUint32(4,bytes.length-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,96000,true);
   for(let i=0;i<48000;i++)v.setInt16(44+2*i,Math.round(12000*Math.sin(2*Math.PI*440*i/48000)),true);
   const {admitSequenceAudio,sequenceAudioDescriptor,planSoundtrack}=await import('/src/sequence-audio.js');
   const asset=await admitSequenceAudio(new Blob([bytes]));
   soundtrack={asset,plan:planSoundtrack({label:'original440',asset:sequenceAudioDescriptor(asset),inFrame:0,outFrame:48000,startTime:.25,gain:.5},asset,2)};
  }
  const blob=await exportTimestampedFilm(canvas,time=>{
   const index=Math.round(time*30);draws.push(time);
   if(stall&&index===3){const end=performance.now()+350;while(performance.now()<end){}}
   context.fillStyle=index<30?'rgb(220,20,20)':'rgb(20,20,220)';context.fillRect(0,0,64,64);
  },2,{...(soundtrack?{soundtrack}:{})});
  return{draws,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))};
 },{stall,audio});
}
for(const audio of [false,true])test(`native timestamped ${audio?'audiovisual':'silent'} export preserves every frame through a350ms main-thread stall`,async({page},info)=>{
 await page.goto('/');const result=await encode(page,{stall:true,audio});expect(result.draws).toEqual(Array.from({length:60},(_,i)=>i/30));
 const file=info.outputPath(`timestamped-${audio?'audio':'silent'}.webm`);await writeFile(file,Buffer.from(result.bytes));
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',file],{encoding:'utf8'}));
 expect(probe.frames).toHaveLength(60);for(let i=0;i<60;i++)expect(Math.abs(Number(probe.frames[i].best_effort_timestamp_time)-i/30)).toBeLessThan(.002);
 const pixels=execFileSync('ffmpeg',['-v','error','-i',file,'-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:10*1024*1024});expect(pixels.length).toBe(60*64*64*3);
 for(let i=0;i<60;i++){const offset=i*64*64*3+(32*64+32)*3,actual=[...pixels.subarray(offset,offset+3)],expected=i<30?[220,20,20]:[20,20,220];for(let c=0;c<3;c++)expect(Math.abs(actual[c]-expected[c])).toBeLessThan(15);}
 if(audio){
  const pcm=execFileSync('ffmpeg',['-v','error','-i',file,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1'],{maxBuffer:1024*1024});
  expect(Math.abs(pcm.length/4-96000)).toBeLessThan(961);
  const rms=(start,end)=>{let sum=0,count=0;for(let i=Math.round(start*48000);i<Math.round(end*48000);i++){const x=pcm.readFloatLE(i*4);sum+=x*x;count++;}return Math.sqrt(sum/count);};
  expect(rms(.05,.2)).toBeLessThan(.005);expect(rms(.35,1.1)).toBeGreaterThan(.1);expect(rms(1.4,1.9)).toBeLessThan(.005);
 }
 await writeFile(info.outputPath('timestamped-receipt.json'),JSON.stringify({audio,frames:probe.frames.length,draws:result.draws,bytes:result.bytes.length,stallMilliseconds:350},null,2));
});
test('native timestamped cancellation closes real encoder ownership and publishes no output',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {exportTimestampedFilm}=await import('/src/export.js'),controller=new AbortController();let calls=0,closes=0;
  const close=VideoEncoder.prototype.close;VideoEncoder.prototype.close=function(...args){closes++;return close.apply(this,args);};
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d');
  try{await exportTimestampedFilm(canvas,time=>{calls++;c.fillRect(0,0,64,64);if(calls===10)controller.abort();},2,{signal:controller.signal});return{published:true,calls,closes};}
  catch(error){return{published:false,error:error.message,calls,closes};}finally{VideoEncoder.prototype.close=close;}
 });expect(result.published).toBe(false);expect(result.error).toMatch(/cancelled/);expect(result.calls).toBe(10);expect(result.closes).toBeGreaterThan(0);
});

test('native startup cancellation waits for the pending support query and closes the late encoder',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {exportTimestampedFilm}=await import('/src/export.js'),Native=VideoEncoder,controller=new AbortController();let calls=0,held=false,release,settled=false;
  const gate=new Promise(r=>release=r),encoders=[];
  window.VideoEncoder=class extends Native{
   constructor(...args){super(...args);encoders.push(this);}
   static async isConfigSupported(config){const result=await Native.isConfigSupported(config);if(++calls===2){held=true;await gate;}return result;}
  };
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');
  const pending=exportTimestampedFilm(canvas,()=>context.fillRect(0,0,64,64),1,{signal:controller.signal}).then(()=>({published:true}),error=>({published:false,error:error.message})).finally(()=>settled=true);
  try{
   const deadline=performance.now()+5000;while(!held&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));
   if(!held)throw Error('Native startup query was not reached');controller.abort();await new Promise(r=>setTimeout(r,10));const settledBeforeRelease=settled;release();const result=await pending;return{...result,settledBeforeRelease,encoders:encoders.map(e=>e.state)};
  }finally{release();await pending;window.VideoEncoder=Native;}
 });expect(result.published).toBe(false);expect(result.error).toMatch(/cancelled/);expect(result.settledBeforeRelease).toBe(false);expect(result.encoders.length).toBeGreaterThan(0);expect(result.encoders.every(x=>x==='closed')).toBe(true);
});

test('native finalization cancellation retains ownership until a real encoder flush drains',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {exportTimestampedFilm}=await import('/src/export.js'),Native=VideoEncoder,controller=new AbortController();let held=false,release,settled=false;
  const gate=new Promise(r=>release=r),encoders=[];
  window.VideoEncoder=class extends Native{
   constructor(...args){super(...args);encoders.push(this);}
   async flush(){held=true;await gate;return super.flush();}
  };
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');
  const pending=exportTimestampedFilm(canvas,()=>context.fillRect(0,0,64,64),.1,{signal:controller.signal}).then(()=>({published:true}),error=>({published:false,error:error.message})).finally(()=>settled=true);
  try{
   const deadline=performance.now()+5000;while(!held&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));
   if(!held)throw Error('Native finalization flush was not reached');controller.abort();await new Promise(r=>setTimeout(r,10));
   const settledBeforeRelease=settled,statesBeforeRelease=encoders.map(e=>e.state);release();const result=await pending;
   return{...result,settledBeforeRelease,statesBeforeRelease,encoders:encoders.map(e=>e.state)};
  }finally{release();await pending;window.VideoEncoder=Native;}
 });expect(result.published).toBe(false);expect(result.error).toMatch(/cancelled/);expect(result.settledBeforeRelease).toBe(false);
 expect(result.statesBeforeRelease).toContain('configured');expect(result.encoders.length).toBeGreaterThan(0);expect(result.encoders.every(x=>x==='closed')).toBe(true);
});

test('native stage diagnostics preserve a complete real export and restore codec methods',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const [{instrumentStages},{nativeExportBackend,exportTimestampedFilm}]=await Promise.all([import('/scripts/stage-timing-diagnostics.mjs'),import('/src/timestamped-export.js')]);
  const original={encode:VideoEncoder.prototype.encode,listen:VideoEncoder.prototype.addEventListener,close:VideoEncoder.prototype.close,create:nativeExportBackend.create};
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');
  const renderer={draw(){context.fillStyle='#d41414';context.fillRect(0,0,64,64);}};
  const observer=instrumentStages(nativeExportBackend,renderer,()=>performance.now(),{VideoEncoder,AudioEncoder});
  try{
   const blob=await exportTimestampedFilm(canvas,()=>renderer.draw(),1),report=observer.snapshot();observer.stop();
   return{report,bytes:[...new Uint8Array(await blob.arrayBuffer())],restored:original.encode===VideoEncoder.prototype.encode&&original.listen===VideoEncoder.prototype.addEventListener&&original.close===VideoEncoder.prototype.close&&original.create===nativeExportBackend.create};
  }finally{observer.stop();}
 });
 expect(result.restored).toBe(true);expect(result.report.stages.addVideo.completed).toBe(30);
 expect(result.report.nativeQueues.video.encodeCalls).toBe(30);expect(result.report.nativeQueues.video.maxQueue).toBeGreaterThan(0);
 expect(result.report.nativeQueues.video.pending).toBe(0);expect(result.report.nativeQueues.video.tracked).toBe(0);
 expect(result.report.nativeQueues.video.unobserved).toBe(0);expect(result.report.stages.sinkWrite.calls).toBeGreaterThan(0);
 const file=info.outputPath('diagnostic-native.webm');await writeFile(file,Buffer.from(result.bytes));
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',file],{encoding:'utf8'}));
 expect(probe.frames).toHaveLength(30);for(let i=0;i<30;i++)expect(Math.abs(Number(probe.frames[i].best_effort_timestamp_time)-i/30)).toBeLessThan(.002);
 await writeFile(info.outputPath('diagnostic-native-receipt.json'),JSON.stringify({source:'real64x64oneSecondNativeExport',decodedFrames:probe.frames.length,restored:result.restored,report:result.report,limits:['Small native boundary validation, not maximum throughput acceptance.']},null,2));
});

test('native queue diagnostics retain audiovisual samples and measure both codec boundaries',async({page},info)=>{
 await page.goto('/');await page.evaluate(async()=>{
  const [{instrumentStages},{nativeExportBackend}]=await Promise.all([import('/scripts/stage-timing-diagnostics.mjs'),import('/src/timestamped-export.js')]);
  window.__queueObserver=instrumentStages(nativeExportBackend,{draw(){}},()=>performance.now(),{VideoEncoder,AudioEncoder});
 });
 let result,report;
 try{result=await encode(page,{audio:true});report=await page.evaluate(()=>window.__queueObserver.snapshot());}
 finally{await page.evaluate(()=>{window.__queueObserver.stop();delete window.__queueObserver;});}
 expect(report.nativeQueues.video.encodeCalls).toBe(60);expect(report.nativeQueues.audio.encodeCalls).toBeGreaterThan(0);
 for(const row of Object.values(report.nativeQueues)){expect(row.pending).toBe(0);expect(row.tracked).toBe(0);expect(row.unobserved).toBe(0);expect(row.completed).toBe(row.waits);}
 const file=info.outputPath('diagnostic-audiovisual.webm');await writeFile(file,Buffer.from(result.bytes));
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',file],{encoding:'utf8'}));
 expect(probe.frames).toHaveLength(60);
 const pcm=execFileSync('ffmpeg',['-v','error','-i',file,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1'],{maxBuffer:1024*1024});expect(Math.abs(pcm.length/4-96000)).toBeLessThan(961);
 await writeFile(info.outputPath('diagnostic-audiovisual-receipt.json'),JSON.stringify({decodedVideoFrames:probe.frames.length,decodedAudioFrames:pcm.length/4,report,limits:['Small real audiovisual boundary validation, not maximum throughput acceptance.']},null,2));
});
