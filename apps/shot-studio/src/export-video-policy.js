// Native output admission holds timestamps only, never packet/frame/sample data.
export function createFrameCompleteness(plan){
 if(!Number.isSafeInteger(plan?.frameCount)||plan.frameCount<1||plan.frameCount>1800||typeof plan.frame!=='function')throw Error('Use an authored video frame plan within the1800-frame limit.');
 const expected=new Set(),observed=new Set();let previous=-1,failure=null,retired=false;
 for(let i=0;i<plan.frameCount;i++){
  const timestamp=plan.frame(i).timestamp;
  if(!Number.isSafeInteger(timestamp)||timestamp<=previous||timestamp>=60000000)throw Error('Use strictly increasing integer timestamps in the authored video plan.');
  expected.add(timestamp);previous=timestamp;
 }
 return {
  observe(seconds){
   if(retired||failure)return;
   if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>=60){failure='Encoder returned an invalid video timestamp.';return;}
   const timestamp=Math.round(seconds*1000000);
   if(!expected.has(timestamp)){failure='Encoder returned an unexpected video timestamp.';return;}
   if(observed.has(timestamp)){failure='Encoder returned a duplicate video frame.';return;}
   observed.add(timestamp);
  },
  verify(){
   if(retired)throw Error('Export frame accounting is retired.');
   if(failure)throw Error(failure);
   if(observed.size!==expected.size)throw Error('Encoder dropped video frames. Export was not published; save a complete backup or try another browser.');
  },
  retire(){retired=true;expected.clear();observed.clear();},
 };
}

