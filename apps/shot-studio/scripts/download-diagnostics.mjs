export async function saveDownload(file,page,selector,path){
 try{await file.saveAs(path);}catch(error){
  // The failure channel may already be disposed. Never let diagnostics replace
  // the first error, and capture local connection state before another await.
  const read=fn=>{try{return fn();}catch(e){return `unavailable: ${e.message}`;}};
  const diagnostics={pageClosed:read(()=>page.isClosed()),browserConnected:read(()=>page.context().browser()?.isConnected())};
  let timer;
  try{
   diagnostics.downloadFailure=await Promise.race([
    Promise.resolve().then(()=>file.failure()).catch(e=>`unavailable: ${e.message}`),
    new Promise(resolve=>{timer=setTimeout(()=>resolve('unavailable: diagnostic timed out'),500);}),
   ]);
  }finally{clearTimeout(timer);}
  const reported=Error(`${selector} -> ${path}: ${error.message}; diagnostics=${JSON.stringify(diagnostics)}`,{cause:error});
  reported.diagnostics=diagnostics;throw reported;
 }
}
