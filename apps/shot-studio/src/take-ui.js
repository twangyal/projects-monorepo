import {TakeError,TAKE_LIMITS,createTakeMetadata,validateTakeMetadata,validateLibrary} from './takes.js';
import {sha256Blob,encodeTakeBackup,decodeTakeBackup} from './take-archive.js';
import {inspectTakeVideo} from './take-video.js';
import {TakeStore} from './take-store.js';

// The take notebook owns its controls and media, never scene fields or history.
export function createTakeUI({captureFilm,recordFilm,restoreFilm,sceneIntent,sceneBusy,recordingChanged,download}){
  const $=id=>document.getElementById(id);
  let store=new TakeStore(),library={schemaVersion:1,revision:0,records:[]};
  let loaded=false,protectedLibrary=true,selected=null,unsaved=null;
  let operation=null,epoch=0,suspended=false,playerEpoch=0,playerUrl=null;
  const rows=new Map(),video=$('take-video');
  const say=text=>{$('take-status').textContent=text;};
  const selectedRecord=()=>library.records.find(r=>r.metadata.id===selected)??(unsaved?.metadata.id===selected?unsaved:null);
  const savedRecord=()=>library.records.find(r=>r.metadata.id===selected);
  const message=error=>error instanceof Error?error.message:'The take operation failed. Existing saved takes and the current film are unchanged.';
  function freshId(){
    for(let i=0;i<32;i++){
      const id=crypto.randomUUID();
      if(!library.records.some(r=>r.metadata.id===id)&&unsaved?.metadata.id!==id)return id;
    }
    throw new TakeError('limit','Could not create a unique take ID. Try again.');
  }
  function stopPlayer(){
    playerEpoch++;
    video.pause();video.removeAttribute('src');video.load();
    if(playerUrl)URL.revokeObjectURL(playerUrl);
    playerUrl=null;
  }
  function controls(){
    const working=!!operation,record=selectedRecord(),saved=savedRecord();
    $('record-take').disabled=working||sceneBusy()||protectedLibrary||!loaded||!!unsaved||library.records.length>=TAKE_LIMITS.count;
    $('import-take').disabled=working||protectedLibrary||!loaded||!!unsaved||library.records.length>=TAKE_LIMITS.count;
    $('cancel-take').hidden=!working;$('cancel-take').textContent=operation?.kind==='record'?'Cancel take recording':'Cancel take operation';
    $('retry-library').disabled=working;$('retry-library').hidden=!protectedLibrary;
    $('retry-take').hidden=!unsaved;$('retry-take').disabled=working;
    $('discard-take').hidden=!unsaved;$('discard-take').disabled=working;
    $('unsaved-take').hidden=!unsaved;
    $('unsaved-take-select').textContent=unsaved?`${unsaved.metadata.name} · completed, not saved`:'';
    $('unsaved-take-select').disabled=operation?.kind==='record';
    $('unsaved-take-select').setAttribute('aria-pressed',String(!!unsaved&&selected===unsaved.metadata.id));
    $('take-empty').hidden=library.records.length>0;
    $('take-library-count').textContent=`${library.records.length} of ${TAKE_LIMITS.count} saved takes`;
    $('take-details').hidden=!record;
    for(const id of ['play-take','restart-take','stop-take','download-take'])$(id).disabled=!record||working;
    $('restore-take').disabled=!record||working||sceneBusy();
    $('rename-take').disabled=!saved||working||protectedLibrary;
    $('delete-take').disabled=!saved||working||protectedLibrary;
    $('take-rename').disabled=!saved||working||protectedLibrary;
    $('take-provenance').textContent=record?`${record.metadata.origin==='recorded-here'?'Recorded here from the captured committed film':'Imported declaration — film/video pairing and timestamp are supplied and unverified'} · ${record.metadata.recordedAt} · ${record.metadata.video.bytes.toLocaleString()} video bytes${saved?'':' · NOT SAVED'}`:'';
    const liveIds=new Set(library.records.map(r=>r.metadata.id));
    for(const [id,row] of rows)if(!liveIds.has(id)){row.remove();rows.delete(id);}
    for(const r of library.records){
      let row=rows.get(r.metadata.id);
      if(!row){row=document.createElement('li');const button=document.createElement('button');button.type='button';button.dataset.takeId=r.metadata.id;button.onclick=()=>choose(r.metadata.id);row.append(button);rows.set(r.metadata.id,row);}
      const button=row.firstElementChild;
      button.textContent=r.metadata.name;button.setAttribute('aria-pressed',String(selected===r.metadata.id));button.disabled=operation?.kind==='record';
      $('take-list').append(row);
    }
  }
  function retire(){
    epoch++;const old=operation;operation=null;old?.controller.abort();
    if(old?.kind==='record')recordingChanged(false);
    controls();
  }
  function choose(id){
    if(selected===id)return;
    retire();stopPlayer();selected=id;
    $('take-rename').value=selectedRecord()?.metadata.name??'';
    controls();
  }
  async function run(kind,task,{bindScene=false}={}){
    if(operation||suspended)return;
    const controller=new AbortController(),token=++epoch;
    const context={signal:controller.signal,bindScene,intent:sceneIntent(),owns:()=>operation?.token===token&&!suspended&&!controller.signal.aborted,
      check(){if(!this.owns()||(this.bindScene&&sceneIntent()!==this.intent))throw new TakeError('cancelled','The scene input or take selection changed. The take operation was cancelled; existing data is unchanged.');}};
    operation={kind,controller,token,context};
    if(kind==='record')recordingChanged(true);
    controls();
    try{await task(context);}
    catch(error){if(context.owns())say(message(error));}
    finally{if(operation?.token===token){operation=null;if(kind==='record')recordingChanged(false);controls();}}
  }
  function publish(next){
    const previous=selectedRecord(),admitted=validateLibrary(next);
    const replacement=admitted.records.find(r=>r.metadata.id===selected);
    if(previous&&replacement&&!samePair(previous,replacement))stopPlayer();
    library=admitted;loaded=true;protectedLibrary=false;
    if(selected&&!selectedRecord()){stopPlayer();selected=null;}
    controls();
  }
  function samePair(a,b){return JSON.stringify(a.metadata)===JSON.stringify(b.metadata)&&a.video.size===b.video.size;}
  function reconcile(){
    if(!unsaved)return false;
    const saved=library.records.find(r=>r.metadata.id===unsaved.metadata.id);
    if(!saved)return false;
    if(!samePair(saved,unsaved))throw new TakeError('protected','The pending take ID conflicts with a different saved record. Download the unsaved backup; existing data is protected.');
    unsaved=null;return true;
  }
  async function load(context){
    const result=await store.read({signal:context.signal});context.check();
    publish(result);
    if(reconcile()){say('Saved take in this browser. A previously completed write was found; no duplicate was added.');controls();}
  }
  async function save(context,candidate){
    try{return await store.save(candidate,{expectedRevision:library.revision,signal:context.signal});}
    catch(error){if(context.owns()&&(error?.code==='conflict'||error?.code==='protected'))protectedLibrary=true;throw error;}
  }
  async function append(context,pair,{reload=false}={}){
    if(reload){await load(context);context.check();if(!unsaved)return;}
    if(protectedLibrary||!loaded)throw new TakeError('protected','The take library could not be read. Retry the take library before saving; the completed take remains available for backup.');
    if(library.records.some(r=>r.metadata.id===pair.metadata.id)){
      if(!samePair(library.records.find(r=>r.metadata.id===pair.metadata.id),pair))throw new TakeError('protected','A different saved take has this ID. Existing records are protected.');
      unsaved=null;say('Saved take in this browser.');controls();return;
    }
    const candidate=validateLibrary({schemaVersion:1,revision:library.revision+1,records:[...library.records,pair]});
    say('Saving completed take… It is not saved until the browser transaction completes.');
    const committed=await save(context,candidate);context.check();
    publish(committed);unsaved=null;selected=pair.metadata.id;$('take-rename').value=pair.metadata.name;
    say('Saved take in this browser.');controls();
  }
  $('record-take').onclick=()=>{
    if(operation||unsaved||protectedLibrary||!loaded||library.records.length>=TAKE_LIMITS.count||sceneBusy())return;
    let captured;
    try{
      const film=captureFilm();if(!film)return;
      captured=createTakeMetadata({id:freshId(),name:$('take-name').value,recordedAt:new Date().toISOString(),origin:'recorded-here',film,mime:'video/webm',bytes:1,sha256:'0'.repeat(64)});
    }catch(error){say(message(error));return;}
    run('record',async context=>{
      say('Recording take from the captured committed film. Keep this tab visible.');
      const blob=await recordFilm(captured.film,context.signal);context.check();
      say('Checking the completed recording…');
      const info=await inspectTakeVideo(blob,{signal:context.signal});context.check();
      const sha256=await sha256Blob(blob,{signal:context.signal});context.check();
      const metadata=validateTakeMetadata({...captured,video:{mime:info.mime,bytes:blob.size,sha256}});
      const pair={metadata,video:blob};unsaved=pair;stopPlayer();selected=metadata.id;$('take-rename').value=metadata.name;
      context.bindScene=false;controls();
      try{await append(context,pair);}catch(error){if(context.owns())say(`Completed take is NOT SAVED. ${message(error)} Retry saving, download its complete backup, or deliberately discard it.`);}
    },{bindScene:true});
  };
  $('import-take').onchange=()=>{
    const file=$('import-take').files[0];if(!file)return;
    if(operation||unsaved||protectedLibrary||!loaded||library.records.length>=TAKE_LIMITS.count){$('import-take').value='';return;}
    run('import',async context=>{
      say('Reading complete take backup. The current film and saved takes are unchanged.');
      try{
        const pair=await decodeTakeBackup(file,{signal:context.signal});context.check();
        await inspectTakeVideo(pair.video,{signal:context.signal});context.check();
        const metadata=validateTakeMetadata({...pair.metadataWithoutId,id:freshId(),origin:'imported-declared'});
        const pending={metadata,video:pair.video};unsaved=pending;stopPlayer();selected=metadata.id;$('take-rename').value=metadata.name;
        context.bindScene=false;controls();
        try{await append(context,pending);}catch(error){if(context.owns())say(`Imported take is NOT SAVED. ${message(error)} Retry saving, download its complete backup, or deliberately discard it.`);}
      }finally{if(context.owns())$('import-take').value='';}
    },{bindScene:true});
  };
  $('retry-take').onclick=()=>{const pair=unsaved;if(!pair)return;run('retry',async context=>{
    try{await append(context,pair,{reload:true});}
    catch(error){if(context.owns()){protectedLibrary=true;say(`Completed take is NOT SAVED. ${message(error)} Its complete backup is still available.`);}}
  });};
  $('retry-library').onclick=()=>run('load',async context=>{
    try{await load(context);if(unsaved)say('Take library read successfully. The completed unsaved take still needs Retry saving take.');else say('Take library read successfully.');}
    catch(error){if(context.owns()){protectedLibrary=true;say(`Take library is protected. ${message(error)} Retry reading it; no saved data was replaced.`);}}
  });
  $('discard-take').onclick=()=>{
    if(operation||!unsaved)return;const pair=unsaved,token=epoch;
    if(!confirm('Discard the completed unsaved take? Download its complete backup first if you want to keep it. This cannot be undone.'))return;
    if(token!==epoch||unsaved!==pair||operation)return;
    if(selected===pair.metadata.id){stopPlayer();selected=null;}
    unsaved=null;controls();say('Completed unsaved take deliberately discarded. Saved takes and the current film are unchanged.');
  };
  $('unsaved-take-select').onclick=()=>{if(unsaved)choose(unsaved.metadata.id);};
  $('rename-take').onclick=()=>{
    const record=savedRecord();if(!record||operation||protectedLibrary)return;
    const name=$('take-rename').value;
    run('rename',async context=>{
      const metadata=validateTakeMetadata({...record.metadata,name});
      if(JSON.stringify(metadata)===JSON.stringify(record.metadata)){say('Take name is unchanged.');return;}
      const candidate=validateLibrary({schemaVersion:1,revision:library.revision+1,records:library.records.map(r=>r.metadata.id===record.metadata.id?{metadata,video:r.video}:r)});
      const committed=await save(context,candidate);context.check();publish(committed);say('Take renamed in this browser. Its captured film and recording are unchanged.');
    });
  };
  $('delete-take').onclick=()=>{
    const record=savedRecord();if(!record||operation||protectedLibrary)return;
    const token=epoch,id=selected;
    if(!confirm('Delete this saved take and its recording? This cannot be undone. Download its complete take backup first if you want to keep it. The current film will remain unchanged.'))return;
    if(token!==epoch||selected!==id||operation||protectedLibrary)return;
    run('delete',async context=>{
      const candidate=validateLibrary({schemaVersion:1,revision:library.revision+1,records:library.records.filter(r=>r.metadata.id!==id)});
      const committed=await save(context,candidate);context.check();stopPlayer();publish(committed);selected=null;controls();say('Take deleted from this browser. The current film and scene history are unchanged.');
    });
  };
  $('restore-take').onclick=()=>{
    const record=selectedRecord();if(!record||operation||sceneBusy())return;
    const id=selected,token=epoch;
    restoreFilm(record.metadata.film,()=>!operation&&!suspended&&epoch===token&&selected===id&&selectedRecord()===record);
  };
  $('download-take').onclick=()=>{
    const record=selectedRecord();if(!record)return;
    const metadata=structuredClone(record.metadata),blob=record.video,id=selected;
    run('backup',async context=>{
      const backup=await encodeTakeBackup(metadata,blob,{signal:context.signal});context.check();
      if(selected!==id)return;download(backup,'shot-studio.shot-take');say('Downloaded the complete take backup with its exact recording and captured film.');
    },{bindScene:true});
  };
  async function play(restart){
    const record=selectedRecord();if(!record||operation)return;
    if(restart||!playerUrl){stopPlayer();playerUrl=URL.createObjectURL(record.video);video.src=playerUrl;video.muted=true;}
    const token=playerEpoch,id=selected;
    try{await video.play();if(token===playerEpoch&&selected===id&&!suspended)say('Playing the selected actual recording. The current film is unchanged.');}
    catch{if(token===playerEpoch&&selected===id&&!suspended)say('Recording playback could not start. Try Restart recording or download the preserved complete backup.');}
  }
  $('play-take').onclick=()=>play(false);$('restart-take').onclick=()=>play(true);
  $('stop-take').onclick=()=>{stopPlayer();say('Recording playback stopped.');};
  video.addEventListener('error',()=>{if(playerUrl&&!suspended)say('Recording playback failed. Its original bytes are preserved; download the complete backup.');});
  video.addEventListener('ended',()=>{if(playerUrl&&!suspended)say('Recording playback finished. Restart recording plays it from the beginning.');});
  $('cancel-take').onclick=()=>{if(!operation)return;retire();$('import-take').value='';say(unsaved?'Take operation cancelled. The completed unsaved take is retained for retry or backup.':'Take operation cancelled. Existing takes and the current film are unchanged.');};
  function suspend(){suspended=true;retire();stopPlayer();store.close();}
  function resume(){if(!suspended)return;suspended=false;store=new TakeStore();protectedLibrary=true;controls();$('retry-library').click();}
  function sceneIntentChanged(){
    if(operation?.context.bindScene){retire();$('import-take').value='';say('Scene input changed. The pending take operation was cancelled; saved takes and exact scene fields are unchanged.');}
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopPlayer();if(operation?.kind==='record'){retire();say('Take recording cancelled because the tab became hidden.');}}});
  window.addEventListener('pagehide',suspend);window.addEventListener('pageshow',resume);
  controls();$('retry-library').click();
  return {controls,sceneIntentChanged,hasPendingWork:()=>!!unsaved,
    capturedFilm:()=>{const record=savedRecord();return record?structuredClone(record.metadata.film):null;},
    cancelRecording(reason){if(operation?.kind==='record'){retire();say(reason);}}};
}
