// Only cancellation fixtures use this observer. Actual native encoders, samples
// and media run unchanged; zero-delay task yields are held250ms while a real
// encoder is configured so the user cancellation can arrive before completion.
export async function observeNativeExport(page){
 await page.addInitScript(()=>{
  window.exportOracle={video:[],audio:[]};
  for(const [name,key] of [['VideoEncoder','video'],['AudioEncoder','audio']]){
   const Native=window[name];if(typeof Native!=='function')continue;
   window[name]=class extends Native{constructor(...args){super(...args);window.exportOracle[key].push(this);}};
  }
  const timeout=window.setTimeout;window.setTimeout=function(callback,delay,...args){
   if(delay===0&&[...window.exportOracle.video,...window.exportOracle.audio].some(encoder=>encoder.state==='configured'))delay=250;
   return timeout.call(this,callback,delay,...args);
  };
 });
}
