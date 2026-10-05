import {writeFile} from 'node:fs/promises';

// Observe one genuine capture without changing its clocks, rendering or admission.
// The first second has bounded detail; the rest retains counts and largest gaps.
export async function observeCaptureTiming(page){
 await page.evaluate(async()=>{
  const {StageRenderer}=await import('/src/renderer.js');
  const state={armed:false,armedAt:null,startAt:null,events:[],totals:{},omitted:0};
  const restores=[],listeners=[],callbackIds=new WeakMap();let nextCallback=1;
  const record=(kind,details={},terminal=false)=>{
   if(!state.armed)return;
   const now=performance.now(),total=state.totals[kind]??={count:0,first:now,last:now,maxGap:0};
   if(total.count)total.maxGap=Math.max(total.maxGap,now-total.last);
   total.count++;total.last=now;
   if(state.events.length<1500&&(terminal||state.startAt===null||now-state.startAt<=1000))state.events.push({kind,now,...details});else state.omitted++;
  };
  const replace=(owner,key,value)=>{const original=owner[key];owner[key]=value;restores.push(()=>{if(owner[key]===value)owner[key]=original;});};
  const listen=(owner,event,listener)=>{owner.addEventListener(event,listener);listeners.push(()=>owner.removeEventListener(event,listener));};
  const intent=event=>{
   if(event.target?.closest?.('#sequence-export')&&state.armedAt===null){state.armed=true;state.armedAt=performance.now();record('export.intent',{},true);}
  };
  window.addEventListener('click',intent,{capture:true});restores.push(()=>window.removeEventListener('click',intent,{capture:true}));
  const raf=window.requestAnimationFrame;
  replace(window,'requestAnimationFrame',function(callback){
   let id=callbackIds.get(callback);if(!id){id=nextCallback++;callbackIds.set(callback,id);}
   const label=callback.name||'(anonymous)';
   return raf.call(window,function(timestamp){record('raf.begin',{id,label,timestamp,callbackDelay:performance.now()-timestamp});try{return callback(timestamp);}finally{record('raf.end',{id,label});}});
  });
  const draw=StageRenderer.prototype.draw;
  replace(StageRenderer.prototype,'draw',function(project,time,camera){
   const details={canvas:this.canvas.id,sourceTime:time};record('draw.begin',details);
   try{return Reflect.apply(draw,this,[project,time,camera]);}finally{record('draw.end',details);}
  });
  const capture=HTMLCanvasElement.prototype.captureStream;
  replace(HTMLCanvasElement.prototype,'captureStream',function(...args){
   record('captureStream.begin',{canvas:this.id,args});
   try{const stream=Reflect.apply(capture,this,args);record('captureStream.end',{canvas:this.id,kinds:stream.getTracks().map(track=>track.kind)});return stream;}
   catch(error){record('captureStream.error',{message:String(error).slice(0,300)},true);throw error;}
  });
  if(globalThis.CanvasCaptureMediaStreamTrack?.prototype.requestFrame){
   const request=CanvasCaptureMediaStreamTrack.prototype.requestFrame;
   replace(CanvasCaptureMediaStreamTrack.prototype,'requestFrame',function(...args){record('requestFrame.begin');try{return Reflect.apply(request,this,args);}finally{record('requestFrame.end');}});
  }
  const Native=window.MediaRecorder,start=Native.prototype.start,stop=Native.prototype.stop;
  replace(window,'MediaRecorder',new Proxy(Native,{construct(target,args,newTarget){
   record('recorder.construct.begin',{mimeType:args[1]?.mimeType,kinds:args[0].getTracks().map(track=>track.kind)});
   const recorder=Reflect.construct(target,args,newTarget);record('recorder.construct.end');
   listen(recorder,'start',()=>record('recorder.start.event',{state:recorder.state},true));
   listen(recorder,'stop',()=>{record('recorder.stop.event',{state:recorder.state},true);state.armed=false;});
   listen(recorder,'error',event=>record('recorder.error.event',{message:String(event.error?.message??'native encoder error').slice(0,300)},true));
   listen(recorder,'dataavailable',event=>record('recorder.dataavailable',{bytes:event.data.size,timecode:event.timecode}));
   return recorder;
  }}));
  replace(Native.prototype,'start',function(...args){
   if(state.armed&&state.startAt===null)state.startAt=performance.now();record('recorder.start.begin',{args},true);
   try{return Reflect.apply(start,this,args);}finally{record('recorder.start.end',{state:this.state},true);}
  });
  replace(Native.prototype,'stop',function(...args){record('recorder.stop.begin',{state:this.state},true);try{return Reflect.apply(stop,this,args);}finally{record('recorder.stop.end',{state:this.state},true);}});
  const before={visibility:document.visibilityState,hidden:document.hidden,focused:document.hasFocus(),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},canvas:document.querySelector('#sequence-stage').getBoundingClientRect().toJSON()};
  window.shotCaptureTiming={finish(){
   state.armed=false;for(const remove of listeners.reverse())remove();for(const restore of restores.reverse())restore();delete window.shotCaptureTiming;
   return{schemaVersion:1,kind:'native-capture-timing-observation',before,armedAt:state.armedAt,recorderStartAt:state.startAt,detailWindowMs:1000,eventLimit:1500,events:state.events,totals:state.totals,omittedDetailedEvents:state.omitted,wrappersRestored:true,scope:'Diagnostic timing only; original media, pixel and temporal acceptance gates remain unchanged. No screenshot or readPixels is added.'};
  }};
 });
 return async path=>{
  let observation;
  try{observation=await page.evaluate(()=>window.shotCaptureTiming.finish());}
  catch(error){observation={schemaVersion:1,kind:'native-capture-timing-observation',status:'unavailable',message:String(error).slice(0,1000)};}
  await writeFile(path,JSON.stringify(observation,null,2)+'\n');
 };
}
