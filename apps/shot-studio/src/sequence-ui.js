import {importProject,validateProject} from './model.js';
import {StageRenderer} from './renderer.js';
import {exportFilm} from './export.js';
import {SEQUENCE_LIMITS,createSequence,validateSequence,addSequenceSource,removeSequenceSource,renameSequenceSource,addSequenceClip,removeSequenceClip,renameSequenceClip,moveSequenceClip,prepareSequence,setSequenceClipRange,resetSequenceClipRange,MIN_SEQUENCE_CLIP_SECONDS} from './sequence.js';
import {createSequenceDocument,validateSequenceBundle,replaceSequence,attachSequenceSoundtrack,setSequenceSoundtrack,removeSequenceSoundtrack,SequenceDocumentHistory} from './sequence-document.js';
import {encodeSequenceArchive,decodeSequenceArchive,importLegacySequence,SEQUENCE_ARCHIVE_LIMITS} from './sequence-archive.js';
import {SequenceDocumentStore} from './sequence-document-store.js';
import {admitSequenceAudio,planSoundtrack} from './sequence-audio.js';
import {prepareSequenceAudioSession} from './sequence-audio-session.js';

// This panel owns a separate document, draft, renderer and native form nodes.
export function createSequenceUI({captureFilm,sceneBusy,recordingChanged,download}){
  const $=id=>document.getElementById(id);
  let store=new SequenceDocumentStore(),bundle=validateSequenceBundle({document:createSequenceDocument(),asset:null});
  let documentState=bundle.document.sequence,history=new SequenceDocumentHistory(bundle),prepared=prepareSequence(documentState);
  let loadOwner=null,storageDrain=null,protectedCopy=true,saveActive=null,saveQueued=null,manualSave=false,version=0,savedVersion=-1;
  let audioOwner=null,selectedAudioFile=null;
  let selectedSource=documentState.sources[0]?.id??'',selectedShot=0,selectedClip=documentState.clips[0]?.id??'';
  let epoch=0,operation=null,suspended=false,unsaved=false,renderer=null,graphicsLost=false;
  let playing=false,animation=0,playStarted=0,position=0,endpoint=null;
  const drafts=new Set(),sourceRows=new Map(),clipRows=new Map(),shotRows=new Map();
  const canvas=$('sequence-stage');
  const say=text=>$('sequence-status').textContent=text;
  const message=error=>error instanceof Error?error.message:'The sequence operation failed. Your current work is kept.';
  const selectedSourceRecord=()=>documentState.sources.find(source=>source.id===selectedSource);
  const clipIndex=()=>documentState.clips.findIndex(clip=>clip.id===selectedClip);
  const locked=()=>suspended||sceneBusy()||operation?.kind==='export';
  function closeAudio(owner){
    if(!owner)return Promise.resolve();owner.controller.abort();
    try{owner.session?.stop();}catch{}
    if(!owner.session)return owner.drain??Promise.resolve();
    if(!owner.closePromise)owner.closePromise=Promise.resolve(owner.session.close()).catch(()=>{}).finally(()=>{if(audioOwner===owner){audioOwner=null;controls();}});
    return owner.closePromise;
  }
  function stop(){
    if(playing&&audioOwner?.session)try{position=audioOwner.session.time();}catch{}
    playing=false;cancelAnimationFrame(animation);animation=0;$('sequence-play').textContent='Rehearse sequence';void closeAudio(audioOwner);
  }
  function retire(){
    epoch++;const old=operation;operation=null;old?.controller.abort();clearTimeout(old?.timer);if(old?.kind==='export')recordingChanged(false);stop();
    if(loadOwner&&!loadOwner.retired){loadOwner.retired=true;loadOwner.controller.abort();protectedCopy=true;store.protect();}
  }
  function rawValue(id,value){if(!drafts.has(id)&&$(id).value!==value)$(id).value=value;}
  function saveStatus(){
    const blocked=protectedCopy||store.protected;
    $('sequence-save-status').textContent=loadOwner?'Reading saved sequence…':storageDrain?'Saved sequence recovery is waiting for browser work to finish':blocked?'Sequence browser record protected · work stays in memory':saveActive||saveQueued?'Saving complete sequence…':unsaved||manualSave?'Sequence not saved · download a backup':'Sequence saved in this browser';
    $('sequence-recovery-download').hidden=!store.hasRecoveryArchive;
    $('sequence-recovery-legacy-download').hidden=!store.hasRecoveryLegacy;
    $('sequence-replace-saved').hidden=!blocked;
    $('sequence-retry-load').hidden=!blocked;
    $('sequence-retry-save').hidden=blocked||(!unsaved&&!manualSave)||!!saveActive;
    $('sequence-load-cancel').hidden=!loadOwner||loadOwner.retired;
    $('sequence-load-cancel').disabled=false;
    for(const name of ['sequence-replace-saved','sequence-retry-load','sequence-retry-save'])$(name).disabled=suspended||locked()||!!loadOwner||!!storageDrain||!!saveActive||!!operation;
  }
  function controls(){
    if(sceneBusy()&&playing)stop();
    const external=locked(),hasClips=documentState.clips.length>0,index=clipIndex(),source=selectedSourceRecord();
    for(const input of document.querySelectorAll('#sequence-panel input,#sequence-panel button'))input.disabled=external;
    for(const id of ['sequence-play','sequence-scrub','sequence-preview-start','sequence-preview-end','sequence-export'])$(id).disabled=external||!hasClips||graphicsLost;
    $('sequence-stop').disabled=suspended||!hasClips;
    $('sequence-cancel').hidden=!operation;$('sequence-cancel').disabled=false;
    $('sequence-undo').disabled=external||!history.canUndo;$('sequence-redo').disabled=external||!history.canRedo;
    $('sequence-source-rename').disabled=external||!source;$('sequence-source-label').disabled=external||!source;
    $('sequence-source-remove').disabled=external||!source;
    $('sequence-add-shot').disabled=external||!source;
    for(const id of ['sequence-clip-label','sequence-clip-rename','sequence-clip-in','sequence-clip-out','sequence-range-apply','sequence-range-reset','sequence-repeat','sequence-remove','sequence-preview-start','sequence-preview-end'])$(id).disabled=external||index<0||(id.startsWith('sequence-preview')&&graphicsLost);
    $('sequence-earlier').disabled=external||index<=0;$('sequence-later').disabled=external||index<0||index===documentState.clips.length-1;
    $('sequence-discard-edits').hidden=!drafts.size;
    $('sequence-draft-notice').hidden=!drafts.size;
    $('sequence-draft-notice').textContent=drafts.size?'Unapplied sequence fields. Apply valid values or explicitly discard them; backups and previews contain committed work only.':'';
    for(const [id,row] of sourceRows){const button=row.querySelector('button');button.disabled=external;button.setAttribute('aria-pressed',String(id===selectedSource));}
    for(const [id,row] of clipRows){const button=row.querySelector('button');button.disabled=external;button.setAttribute('aria-pressed',String(id===selectedClip));}
    for(const [index,button] of shotRows){button.disabled=external;button.setAttribute('aria-pressed',String(index===selectedShot));}
    const hasAudio=!!bundle.document.soundtrack;
    for(const name of ['sequence-audio-label','sequence-audio-in','sequence-audio-out','sequence-audio-start','sequence-audio-gain','sequence-audio-apply','sequence-audio-remove'])$(name).disabled=external||!hasAudio;
    $('sequence-audio-import').disabled=external||!selectedAudioFile;
    $('sequence-clear-history').disabled=external||(!history.canUndo&&!history.canRedo);
    $('sequence-play').disabled=$('sequence-play').disabled||!!audioOwner&&!playing;
    $('sequence-export').disabled=$('sequence-export').disabled||!!audioOwner;
    saveStatus();
  }
  function consentRaw(){
    if(!drafts.size)return true;
    const before=epoch,source=selectedSource,clip=selectedClip;
    if(!confirm('Discard unapplied sequence fields and keep the committed sequence? Cancel keeps their exact values.'))return false;
    if(before!==epoch||source!==selectedSource||clip!==selectedClip||locked()){say('The sequence changed during confirmation. Review this action again.');return false;}
    drafts.clear();syncFields();controls();return true;
  }
  function guard({discard=false}={}){
    if(locked())return false;
    if(drafts.size){if(discard)return consentRaw();say('Apply valid sequence fields or choose Discard sequence edits first.');return false;}
    return true;
  }
  function id(kind){
    for(let attempt=0;attempt<32;attempt++){const value=crypto.randomUUID();if(!(kind==='source'?documentState.sources:documentState.clips).some(item=>item.id===value))return value;}
    throw Error('Could not create a unique sequence ID. Try again.');
  }
  function labelFor(text){let result='';for(const character of text){if(result.length+character.length>80)break;result+=character;}return result||'Scene source';}
  function protectSave(error){
    protectedCopy=true;manualSave=false;saveQueued=null;store.protect();
    say(`${message(error)} The browser copy is protected. Keep working in memory, download a complete backup, or deliberately reload or replace it.`);
  }
  function persist(){
    unsaved=true;
    if(protectedCopy||store.protected||manualSave||loadOwner||storageDrain){controls();return;}
    saveQueued={bundle:validateSequenceBundle(bundle),version,intent:epoch};void pumpSaves();controls();
  }
  async function pumpSaves(){
    if(saveActive||protectedCopy||store.protected||suspended)return;
    while(saveQueued&&!protectedCopy&&!store.protected&&!suspended){
      const captured=saveQueued,target=store;saveQueued=null;saveActive=captured;controls();
      try{
        await target.save(captured.bundle);
        if(target!==store)continue;
        if(target.protected){protectSave(Error('The legacy browser draft changed while saving.'));break;}
        savedVersion=captured.version;
        if(!suspended&&captured.version===version&&captured.intent===epoch){unsaved=false;say('Complete sequence saved in this browser.');}
      }catch(error){
        if(target!==store)continue;
        unsaved=true;saveQueued=null;
        if(target.protected||!['storage','invalid'].includes(error?.code))protectSave(error);
        else say(`${message(error)} The previous complete saved sequence is kept. Retry sequence saving explicitly or download a backup.`);
      }finally{if(saveActive===captured){saveActive=null;controls();}}
    }
  }
  function drainStore(target){
    if(storageDrain?.target===target)return storageDrain.promise;
    const owner={target};storageDrain=owner;
    owner.promise=Promise.resolve(target.close()).catch(()=>{}).finally(()=>{if(storageDrain===owner){storageDrain=null;controls();}});
    return owner.promise;
  }
  async function loadSaved(){
    if(suspended||loadOwner||storageDrain||saveActive)return;
    const controller=new AbortController(),owner={controller,retired:false,intent:epoch,target:store};loadOwner=owner;saveQueued=null;controls();
    say('Reading the complete saved sequence. Nothing is played or rewritten.');
    try{
      const result=await owner.target.load({signal:controller.signal});
      if(owner.retired||suspended||epoch!==owner.intent||loadOwner!==owner)return;
      const next=validateSequenceBundle(result.bundle??{document:createSequenceDocument(),asset:null}),nextHistory=new SequenceDocumentHistory(next),nextPrepared=prepareSequence(next.document.sequence);
      if(owner.retired||suspended||epoch!==owner.intent||loadOwner!==owner)return;
      owner.target.acceptLoad(result.receipt);
      bundle=next;documentState=next.document.sequence;history=nextHistory;prepared=nextPrepared;
      version++;savedVersion=version;unsaved=false;manualSave=false;protectedCopy=owner.target.protected||result.legacyChanged;
      selectedSource=documentState.sources[0]?.id??'';selectedShot=0;selectedClip=documentState.clips[0]?.id??'';endpoint=null;position=0;drafts.clear();
      refresh();say(protectedCopy?'Restored the complete saved sequence in memory. The older browser draft changed; review before replacing the protected saved copy.':documentState.clips.length?'Restored the complete saved sequence without playing or rewriting it.':'Sequence storage ready. Add a copied scene source, then choose shots to make a sequence.');
    }catch(error){
      owner.failed=true;if(loadOwner===owner){protectedCopy=true;owner.target.protect();if(!owner.retired&&!suspended)say(`${message(error)} The saved sequence is protected. Current sequence work stays in memory.`);}
    }finally{
      if(loadOwner===owner){loadOwner=null;if(owner.retired||controller.signal.aborted)protectedCopy=true;controls();}
      if(owner.failed||owner.retired||controller.signal.aborted)void drainStore(owner.target);
    }
  }
  function syncFields(){
    rawValue('sequence-title',documentState.title);
    rawValue('sequence-source-label',selectedSourceRecord()?.label??'');
    const clip=documentState.clips.find(clip=>clip.id===selectedClip),info=prepared.clips[clipIndex()];
    rawValue('sequence-clip-label',clip?.label??'');
    rawValue('sequence-clip-in',clip?String(clip.inTime):'');
    rawValue('sequence-clip-out',clip?String(clip.outTime):'');
    for(const name of ['sequence-clip-in','sequence-clip-out']){
      $(name).min='0';if(info)$(name).max=String(info.sourceDuration);else $(name).removeAttribute('max');
    }
    syncAudioFields();
    $('sequence-range-info').textContent=info?`Original shot: 0–${info.sourceDuration}s. Committed In ${info.inTime}s · Out ${info.outTime}s · excerpt ${info.duration}s. Original source-film range ${info.sourceStart+info.inTime}–${info.sourceStart+info.outTime}s. Out must exceed In by at least ${MIN_SEQUENCE_CLIP_SECONDS}s.`:'Select a sequence clip to choose its source range.';
  }
  function syncAudioFields(){
    const track=bundle.document.soundtrack;
    rawValue('sequence-audio-label',track?.label??'');
    rawValue('sequence-audio-in',track?String(track.inFrame/track.asset.sampleRate):'');
    rawValue('sequence-audio-out',track?String(track.outFrame/track.asset.sampleRate):'');
    rawValue('sequence-audio-start',track?String(track.startTime):'0');
    rawValue('sequence-audio-gain',track?String(track.gain):'1');
    if(!track){$('sequence-audio-summary').textContent='No soundtrack. Choose a PCM16 WAV, then explicitly import it. Original bytes are retained; endpoint previews and scrubbing are silent.';return;}
    const plan=planSoundtrack(track,bundle.asset,prepared.duration),rate=track.asset.sampleRate;
    $('sequence-audio-summary').textContent=`${track.label} · original WAV ${track.asset.bytes} bytes · ${rate} Hz / ${track.asset.channels===1?'mono':'stereo'} · SHA-256 ${track.asset.sha256}. Committed frames ${track.inFrame}–${track.outFrame} (exclusive Out) · source ${track.inFrame/rate}–${track.outFrame/rate}s · sequence start ${track.startTime}s · gain ${track.gain}. ${plan.audible?`Audible sequence interval ${plan.audibleStart}–${plan.audibleEnd}s${plan.audibleEnd<track.startTime+(track.outFrame-track.inFrame)/rate?' · cropped at the sequence end':''}.`:'Currently inaudible: the sequence is empty, the source begins after its end, or gain is zero.'} The film is never extended, looped or stretched.`;
  }
  const audioFields=['sequence-audio-label','sequence-audio-in','sequence-audio-out','sequence-audio-start','sequence-audio-gain'];
  $('sequence-audio-file').onchange=()=>{
    const input=$('sequence-audio-file'),file=input.files[0];input.value='';if(!file)return;
    if(!guard()){say('Apply or discard unapplied sequence fields before choosing a soundtrack.');return;}
    retire();selectedAudioFile=file;controls();say(`Selected ${file.name}. Choose Import soundtrack to read and attach this WAV; the current soundtrack is unchanged.`);
  };
  $('sequence-audio-import').onclick=async()=>{
    if(!selectedAudioFile||!guard())return;const file=selectedAudioFile,context=startOperation('soundtrack-import');
    say('Reading and checking the original PCM16 WAV. Current soundtrack and fields are kept.');
    try{
      const asset=await admitSequenceAudio(file,{signal:context.signal});if(!context.owns())return;
      const name=labelFor(file.name.replace(/\.wav$/i,''));
      publishBundle(attachSequenceSoundtrack(bundle,asset,name),{clearFields:audioFields});selectedAudioFile=null;controls();say('Soundtrack imported as one sequence edit. Original WAV bytes are retained; nothing is played automatically.');
    }catch(error){if(context.owns())say(`${message(error)} Current soundtrack, exact fields and history are unchanged.`);}finally{context.done();}
  };
  $('sequence-audio-apply').addEventListener('pointerdown',event=>{if(event.isPrimary&&event.button===0)event.preventDefault();});
  $('sequence-audio-apply').onclick=()=>{
    if(locked()||!bundle.document.soundtrack)return;
    try{
      const rate=bundle.document.soundtrack.asset.sampleRate,inFrame=Math.round(rangeNumber('sequence-audio-in','soundtrack In')*rate),outFrame=Math.round(rangeNumber('sequence-audio-out','soundtrack Out')*rate);
      const next=setSequenceSoundtrack(bundle,{label:$('sequence-audio-label').value,inFrame,outFrame,startTime:rangeNumber('sequence-audio-start','soundtrack sequence start'),gain:rangeNumber('sequence-audio-gain','soundtrack gain')});
      publishBundle(next,{clearFields:audioFields});say(`Soundtrack settings applied. Effective frames ${inFrame}–${outFrame}; Undo sequence restores the previous complete settings.`);
    }catch(error){for(const field of audioFields)drafts.add(field);controls();say(`${message(error)} All exact soundtrack fields are kept; the committed sequence and history are unchanged.`);}
  };
  $('sequence-audio-remove').onclick=()=>{
    if(!guard({discard:true})||!bundle.document.soundtrack)return;
    try{publishBundle(removeSequenceSoundtrack(bundle),{clearFields:audioFields});say('Soundtrack removed as one sequence edit. Undo sequence restores it with the original WAV.');}
    catch(error){say(`${message(error)} The current soundtrack is unchanged.`);}
  };
  $('sequence-clear-history').onclick=()=>{
    if(!guard())return;const before=epoch;
    if(!confirm('Clear sequence Undo and Redo history? The current complete sequence and soundtrack are kept. Download a backup first if you need earlier work.'))return;
    if(before!==epoch||locked()||drafts.size)return;retire();history.clear();controls();say('Sequence Undo and Redo history cleared. Current complete work is unchanged.');
  };
  function reconcile(list,map,records,key,make,update){
    const keep=new Set(records.map(record=>record[key]));
    for(const [id,row] of map)if(!keep.has(id)){row.remove();map.delete(id);}
    records.forEach((record,index)=>{
      let row=map.get(record[key]);if(!row){row=make(record);map.set(record[key],row);}
      update(row,record,index);
      if(list.children[index]!==row)list.insertBefore(row,list.children[index]??null);
    });
  }
  function refresh(){
    if(!documentState.sources.some(source=>source.id===selectedSource)){selectedSource=documentState.sources[0]?.id??'';selectedShot=0;}
    const source=selectedSourceRecord();if(source)selectedShot=Math.min(selectedShot,source.film.shots.length-1);
    if(!documentState.clips.some(clip=>clip.id===selectedClip))selectedClip=documentState.clips[0]?.id??'';
    syncFields();
    reconcile($('sequence-sources'),sourceRows,documentState.sources,'id',source=>{
      const row=document.createElement('li'),button=document.createElement('button'),details=document.createElement('p');button.type='button';button.dataset.sequenceSourceId=source.id;details.className='note';
      button.onclick=()=>{if(!guard({discard:true}))return;retire();selectedSource=source.id;selectedShot=0;refresh();};row.append(button,details);return row;
    },(row,source)=>{row.querySelector('button').textContent=source.label;row.querySelector('p').textContent=`${source.film.title} · ${source.film.actors.map(actor=>`${actor.name} ${actor.color}`).join(' / ')} · light ${source.film.light} · ${source.film.shots.length} whole shots`;});
    for(const [index,button] of shotRows)if(!source||index>=source.film.shots.length){button.remove();shotRows.delete(index);}
    let sourceStart=0;
    source?.film.shots.forEach((shot,index)=>{
      let button=shotRows.get(index);if(!button){button=document.createElement('button');button.type='button';button.dataset.sourceShotIndex=String(index);button.onclick=()=>{if(!guard({discard:true}))return;retire();selectedShot=index;controls();};shotRows.set(index,button);}
      button.textContent=`${index+1} · ${shot.name} · source ${sourceStart}–${sourceStart+shot.duration}s (${shot.duration}s)`;sourceStart+=shot.duration;
      if($('sequence-source-shots').children[index]!==button)$('sequence-source-shots').insertBefore(button,$('sequence-source-shots').children[index]??null);
    });
    reconcile($('sequence-clips'),clipRows,documentState.clips,'id',clip=>{
      const row=document.createElement('li'),button=document.createElement('button');button.type='button';button.dataset.sequenceClipId=clip.id;
      button.onclick=()=>{if(!guard({discard:true}))return;retire();selectedClip=clip.id;endpoint=null;position=prepared.clips[clipIndex()].sequenceStart;refresh();};row.append(button);return row;
    },(row,clip,index)=>{const info=prepared.clips[index];row.querySelector('button').textContent=`${index+1} · ${clip.label} · ${info.sourceLabel} / ${info.shotName} · ${info.duration}s · shot In ${info.inTime}s / Out ${info.outTime}s`;});
    $('sequence-summary').textContent=`${documentState.sources.length}/4 copied sources · ${documentState.clips.length}/20 clips · ${prepared.duration}/60 seconds`;
    $('sequence-scrub').max=String(prepared.duration);position=Math.min(position,prepared.duration);controls();render();
  }
  function getRenderer(){
    if(graphicsLost)throw Error('Sequence graphics are unavailable. Save a sequence backup, then reload.');
    if(!renderer){try{renderer=new StageRenderer(canvas);}catch(error){graphicsLost=true;controls();throw error;}}
    return renderer;
  }
  function render(){
    const hasClips=prepared.clips.length>0;canvas.hidden=!hasClips;$('sequence-empty').hidden=hasClips;
    if(!hasClips){$('sequence-time').textContent='Sequence 0.00 / 0.00s';$('sequence-source-time').textContent='No clip selected.';$('sequence-scrub').value='0';return;}
    try{
      const index=clipIndex(),view=endpoint&&index>=0?prepared.clipFrame(index,endpoint==='end'?prepared.clips[index].duration:0):prepared.frameAt(position);
      getRenderer().draw(view.sourceFilm,view.sourceGlobal,view.camera);
      $('sequence-time').textContent=`Sequence ${view.sequenceTime.toFixed(2)} / ${prepared.duration.toFixed(2)}s`;
      const clip=prepared.clips[view.clipIndex];
      $('sequence-source-time').textContent=`${clip.sourceLabel} / ${clip.shotName} · original source ${view.sourceGlobal.toFixed(2)}s · shot ${view.shotLocal.toFixed(2)}s · excerpt ${view.clipLocal.toFixed(2)}s${endpoint?` · ${endpoint.toUpperCase()} endpoint preview — not the next sequence cut`:''}`;
      $('sequence-scrub').value=String(view.sequenceTime);
    }catch(error){stop();say(`${message(error)} The ordinary scene remains available; sequence backups are still usable.`);}
  }
  function publish(next,{sourceId,clipId,clearField=null,clearFields=[]}={}){
    const safe=validateSequence(next);return publishBundle(replaceSequence(bundle,safe),{sourceId,clipId,clearField,clearFields});
  }
  function publishBundle(next,{sourceId,clipId,clearField=null,clearFields=[]}={}){
    const safe=validateSequenceBundle(next),nextPrepared=prepareSequence(safe.document.sequence);
    const changed=JSON.stringify(safe.document)!==JSON.stringify(bundle.document)||safe.asset!==bundle.asset;
    retire();bundle=history.commit(safe);documentState=bundle.document.sequence;prepared=nextPrepared;if(changed)version++;
    if(sourceId!==undefined){selectedSource=sourceId;selectedShot=0;}if(clipId!==undefined)selectedClip=clipId;
    if(clearField)drafts.delete(clearField);for(const field of clearFields)drafts.delete(field);
    endpoint=null;position=documentState.clips.length?prepared.clips[Math.max(0,clipIndex())].sequenceStart:0;
    refresh();if(changed)persist();else{unsaved=version!==savedVersion;controls();}return true;
  }
  function edit(action){if(!guard())return;try{publish(action());}catch(error){say(`${message(error)} The committed sequence is unchanged.`);}}
  function copySource(film,label,owns=()=>true){
    if(!owns()||!guard({discard:true}))return false;
    if(!owns()||locked()){say('The source selection changed. No source was copied.');return false;}
    try{
      const source={id:id('source'),label:labelFor(label),film:validateProject(film)};
      publish(addSequenceSource(documentState,source),{sourceId:source.id});
      say('Copied the complete editable film as a detached source. Select a whole shot and add it to the sequence. Later source edits do not update this copy.');return true;
    }catch(error){say(`${message(error)} Existing sources and clips are unchanged.`);return false;}
  }
  for(const inputId of ['sequence-title','sequence-source-label','sequence-clip-label','sequence-clip-in','sequence-clip-out','sequence-audio-label','sequence-audio-in','sequence-audio-out','sequence-audio-start','sequence-audio-gain'])$(inputId).addEventListener('input',()=>{retire();drafts.add(inputId);controls();say('Unapplied sequence field; preview and backups keep committed work.');});
  function applyField(inputId,action){
    if(locked())return;
    try{const next=action($(inputId).value);publish(next,{clearField:inputId});say('Sequence field applied.');}
    catch(error){drafts.add(inputId);controls();say(`${message(error)} The exact raw value is kept for correction.`);}
  }
  $('sequence-title-apply').onclick=()=>applyField('sequence-title',title=>validateSequence({...documentState,title}));
  $('sequence-source-rename').onclick=()=>applyField('sequence-source-label',label=>renameSequenceSource(documentState,selectedSource,label));
  $('sequence-clip-rename').onclick=()=>applyField('sequence-clip-label',label=>renameSequenceClip(documentState,selectedClip,label));
  // Applying an invalid range must not blur or rebuild the native numeric draft.
  $('sequence-range-apply').addEventListener('pointerdown',event=>{if(event.isPrimary&&event.button===0)event.preventDefault();});
  function rangeNumber(inputId,label){
    const raw=$(inputId).value;
    if(!raw.trim()||!Number.isFinite(Number(raw)))throw Error(`Enter a nonempty finite number for Clip ${label}.`);
    return Number(raw);
  }
  $('sequence-range-apply').onclick=()=>{
    if(locked()||clipIndex()<0)return;
    try{
      const inTime=rangeNumber('sequence-clip-in','In'),outTime=rangeNumber('sequence-clip-out','Out'),span=outTime-inTime;
      if(span<MIN_SEQUENCE_CLIP_SECONDS)throw Error(`The computed excerpt duration is ${span}s. Out must exceed In by at least ${MIN_SEQUENCE_CLIP_SECONDS}s.`);
      const next=setSequenceClipRange(documentState,selectedClip,inTime,outTime);
      publish(next,{clearFields:['sequence-clip-in','sequence-clip-out']});
      say('Clip range applied. Preview and export use this committed excerpt; the original source is unchanged. Undo sequence restores the previous range.');
    }catch(error){
      drafts.add('sequence-clip-in');drafts.add('sequence-clip-out');controls();
      say(`${message(error)} Both exact fields are kept for correction; the committed range and history are unchanged.`);
    }
  };
  $('sequence-range-reset').onclick=()=>{
    if(!guard({discard:true})||clipIndex()<0)return;
    try{publish(resetSequenceClipRange(documentState,selectedClip));say('The clip uses its whole original shot. Undo sequence restores the previous range.');}
    catch(error){say(`${message(error)} The committed range is unchanged.`);}
  };
  $('sequence-discard-edits').onclick=()=>{if(locked()||!drafts.size||!consentRaw())return;retire();unsaved=version!==savedVersion;controls();say('Unapplied sequence fields discarded. Committed sources, clips and history are unchanged.');};
  $('sequence-add-current').onclick=()=>{if(locked())return;const captured=captureFilm();if(captured)copySource(captured.film,captured.film.title,captured.owns);};
  $('sequence-source-remove').onclick=()=>edit(()=>removeSequenceSource(documentState,selectedSource));
  $('sequence-add-shot').onclick=()=>edit(()=>{
    const source=selectedSourceRecord();if(!source)throw Error('Choose a copied source first.');const clip={id:id('clip'),sourceId:source.id,shotIndex:selectedShot,label:source.film.shots[selectedShot].name,inTime:0,outTime:source.film.shots[selectedShot].duration};
    const next=addSequenceClip(documentState,clip);selectedClip=clip.id;return next;
  });
  $('sequence-repeat').onclick=()=>edit(()=>{const clip=documentState.clips[clipIndex()];if(!clip)throw Error('Select a clip first.');const repeated={...clip,id:id('clip')};const next=addSequenceClip(documentState,repeated);selectedClip=repeated.id;return next;});
  $('sequence-remove').onclick=()=>edit(()=>removeSequenceClip(documentState,selectedClip));
  for(const [control,direction] of [['sequence-earlier',-1],['sequence-later',1]])$(control).onclick=()=>edit(()=>moveSequenceClip(documentState,selectedClip,direction));
  for(const direction of ['undo','redo'])$(`sequence-${direction}`).onclick=()=>{
    if(!guard({discard:true})||!(direction==='undo'?history.canUndo:history.canRedo))return;
    retire();bundle=history[direction]();documentState=bundle.document.sequence;version++;prepared=prepareSequence(documentState);endpoint=null;position=0;refresh();persist();say(`Sequence ${direction} complete; scene history is unchanged.`);
  };
  async function prepareAudio(captured,context){
    if(!captured.asset)return null;
    if(audioOwner)throw Error('Previous sequence audio is still finishing. Try again when it has stopped.');
    const owner={controller:new AbortController(),session:null,closePromise:null,drain:null};audioOwner=owner;
    const abort=()=>owner.controller.abort();context.signal.addEventListener('abort',abort,{once:true});
    if(context.signal.aborted)abort();controls();
    owner.drain=(async()=>{
      try{
        const plan=planSoundtrack(captured.document.soundtrack,captured.asset,captured.document.sequence.clips.length?prepareSequence(captured.document.sequence).duration:0);
        owner.session=await prepareSequenceAudioSession(captured.asset,plan,{signal:owner.controller.signal});
        if(!context.owns()||owner.controller.signal.aborted){await closeAudio(owner);return null;}
        return owner.session;
      }catch(error){
        if(owner.session)await closeAudio(owner);
        else if(audioOwner===owner){audioOwner=null;controls();}
        throw error;
      }finally{context.signal.removeEventListener('abort',abort);}
    })();
    return owner.drain;
  }
  function tick(now){
    if(!playing||suspended||sceneBusy()||operation?.kind==='export'){stop();return;}
    try{position=Math.min(prepared.duration,audioOwner?.session?audioOwner.session.time():(now-playStarted)/1000);}
    catch(error){stop();say(`${message(error)} Sequence audio stopped. Rehearse again explicitly.`);controls();return;}
    render();if(position>=prepared.duration){stop();controls();}else animation=requestAnimationFrame(tick);
  }
  $('sequence-play').onclick=async()=>{
    if(!guard()||graphicsLost||!prepared.clips.length)return;if(playing){stop();controls();return;}
    if(audioOwner){say('Previous sequence audio is still finishing. Rehearse again once it has stopped.');return;}
    const captured=validateSequenceBundle(bundle),context=startOperation('rehearse');
    if(endpoint){position=prepared.clips[clipIndex()].sequenceStart;endpoint=null;}else if(position>=prepared.duration)position=0;
    const start=position;
    try{
      const session=await prepareAudio(captured,context);if(!context.owns())return;
      if(captured.asset&&!session)return;
      if(session)session.start(start,{capture:false});
      playing=true;playStarted=performance.now()-start*1000;$('sequence-play').textContent='Pause sequence';render();animation=requestAnimationFrame(tick);
      say(session?'Rehearsing with the committed soundtrack. Seeking and endpoint previews are silent.':'Rehearsing the silent sequence.');
    }catch(error){if(context.owns())say(`${message(error)} Sequence playback did not start.`);void closeAudio(audioOwner);}
    finally{context.done();}
  };
  $('sequence-stop').onclick=()=>{retire();controls();say('Sequence stopped at its current position.');};
  $('sequence-scrub').oninput=()=>{if(!guard()){render();return;}retire();endpoint=null;position=Number($('sequence-scrub').value);render();};
  for(const value of ['start','end'])$(`sequence-preview-${value}`).onclick=()=>{if(!guard()||clipIndex()<0||graphicsLost)return;retire();endpoint=value;render();};
  function startOperation(kind){
    retire();const controller=new AbortController(),token=epoch;
    const current=()=>!suspended&&operation?.token===token&&!controller.signal.aborted&&!sceneBusy();
    const timer=setTimeout(()=>{if(operation?.token===token&&!controller.signal.aborted){retire();controls();say('Sequence work timed out. Current work is kept. If a browser save was pending, review the saved copy before trying again.');}},10000);
    operation={kind,token,controller,timer};controls();
    return {signal:controller.signal,owns:current,prepared(){clearTimeout(timer);},done(){clearTimeout(timer);if(operation?.token===token){operation=null;controls();}}};
  }
  function replacement(next,context){
    if(!context.owns()||!guard())return;
    const before=epoch;
    if(!confirm('Replace the whole sequence with this document? Save sequence first to keep a portable copy. Undo sequence restores the previous committed sequence only.'))return;
    if(!context.owns()||before!==epoch||drafts.size)return;
    publishBundle(next);say('Complete sequence opened. The ordinary scene and saved takes are unchanged.');
  }
  $('sequence-import-source').onchange=async()=>{
    const input=$('sequence-import-source'),file=input.files[0];input.value='';if(!file||!guard())return;
    const context=startOperation('source-import');say('Reading scene source. Existing sequence fields and artwork are kept.');
    try{
      if(file.size>SEQUENCE_LIMITS.sourceBytes)throw Error('Choose a scene source no larger than 64 KiB.');const text=await file.text();if(!context.owns())return;
      const film=importProject(text);if(!context.owns())return;copySource(film,film.title,context.owns);
    }catch(error){if(context.owns())say(`${message(error)} Existing sources and clips are unchanged.`);}finally{context.done();}
  };
  $('sequence-open').onchange=async()=>{
    const input=$('sequence-open'),file=input.files[0];input.value='';if(!file||!guard())return;
    const context=startOperation('open');say('Reading sequence backup. Existing sequence fields and scene are kept.');
    try{
      if(file.size>SEQUENCE_ARCHIVE_LIMITS.bytes)throw Error('Choose a complete sequence backup no larger than 16 MiB.');
      let next;
      if(file.name.toLowerCase().endsWith('.json')){if(file.size>SEQUENCE_LIMITS.bytes)throw Error('Choose a legacy sequence JSON file no larger than 320 KiB.');const text=await file.text();if(!context.owns())return;next=importLegacySequence(text);}
      else next=await decodeSequenceArchive(file,{signal:context.signal});
      if(context.owns())replacement(next,context);
    }catch(error){if(context.owns())say(`${message(error)} The existing sequence is unchanged.`);}finally{context.done();}
  };
  $('sequence-new').onclick=()=>{if(!guard({discard:true}))return;const context=startOperation('new');try{replacement(validateSequenceBundle({document:createSequenceDocument(createSequence()),asset:null}),context);}catch(error){say(message(error));}finally{context.done();}};
  $('sequence-save').onclick=async()=>{
    if(locked())return;const captured=validateSequenceBundle(bundle),context=startOperation('backup');
    try{
      const blob=captured.asset?await encodeSequenceArchive(captured,{signal:context.signal}):new Blob([JSON.stringify(captured.document.sequence)],{type:'application/json'});
      if(context.owns()){download(blob,captured.asset?'shot-studio.shot-sequence':'shot-studio.shot-sequence.json');say(`Downloaded the complete committed sequence${captured.asset?' with its original WAV':''}.${drafts.size?' Unapplied fields are not included.':''}`);}
    }catch(error){if(context.owns())say(`${message(error)} Current sequence work is kept.`);}finally{context.done();}
  };
  $('sequence-recovery-download').onclick=()=>{if(locked())return;try{download(store.recoveryArchive(),'shot-studio-preserved.shot-sequence');say('Downloaded the retained complete saved sequence archive. Current memory work is separate.');}catch(error){say(message(error));}};
  $('sequence-recovery-legacy-download').onclick=()=>{if(locked())return;try{download(new Blob([store.recoveryLegacyJson()],{type:'application/json'}),'shot-studio-sequence-legacy-recovery.json');}catch(error){say(message(error));}};
  $('sequence-retry-save').onclick=()=>{if(locked()||protectedCopy||store.protected||loadOwner||storageDrain||saveActive)return;manualSave=false;persist();};
  $('sequence-load-cancel').onclick=()=>{if(!loadOwner)return;retire();controls();say('Saved-sequence loading cancelled. Recovery waits for browser work to finish; current sequence work is kept.');};
  $('sequence-retry-load').onclick=async()=>{
    if(!guard({discard:true})||loadOwner||storageDrain||saveActive)return;
    const context=startOperation('reload');
    if(!confirm('Reload the complete saved sequence and replace current memory work? Download Save sequence first to keep current work.')){context.done();return;}
    if(!context.owns())return;
    context.prepared();await drainStore(store);
    if(!context.owns()){context.done();return;}
    store=new SequenceDocumentStore();context.done();await loadSaved();
  };
  $('sequence-replace-saved').onclick=async()=>{
    if(!guard()||loadOwner||storageDrain||saveActive||!(protectedCopy||store.protected))return;
    const captured={bundle:validateSequenceBundle(bundle),version,intent:null},context=startOperation('replacement');captured.intent=epoch;
    let target=store,dispatched=false;
    try{
      await drainStore(target);if(!context.owns())return;
      store=target=new SequenceDocumentStore();protectedCopy=true;controls();
      const reviewed=await target.reviewReplacement({signal:context.signal});if(!context.owns()||drafts.size)return;
      const title=!reviewed.summary.present?'the currently absent complete sequence record':reviewed.summary.readable?JSON.stringify(reviewed.summary.title):'an unreadable saved sequence';
      if(!confirm(`Replace ${title} with the complete committed sequence ${JSON.stringify(captured.bundle.document.sequence.title)}? Original legacy draft bytes are kept. Download current and preserved backups first. Unapplied fields are not included.`))return;
      if(!context.owns()||drafts.size||captured.version!==version||captured.intent!==epoch)return;
      dispatched=true;await target.replaceSaved(captured.bundle,reviewed.receipt,{signal:context.signal});
      if(target!==store)return;
      protectedCopy=target.protected;savedVersion=captured.version;
      if(context.owns()&&captured.version===version&&captured.intent===epoch&&!drafts.size){unsaved=false;manualSave=false;say(protectedCopy?'Sequence write completed, but the older browser draft changed. The saved copy remains protected.':'Saved sequence explicitly replaced. Automatic sequence saving is enabled.');}
      else{unsaved=true;manualSave=!protectedCopy;if(!suspended)say('The captured sequence was saved. Newer memory work was kept and is not saved; choose Retry sequence saving explicitly.');}
    }catch(error){
      if(target===store){protectedCopy=true;target.protect();unsaved=true;saveQueued=null;}
      if(context.owns())say(`${message(error)} The saved sequence remains protected.${dispatched?' A write may have completed; review before trying again.':''}`);
    }finally{context.done();if(target.nativePending)void drainStore(target);controls();}
  };
  $('sequence-export').onclick=async()=>{
    if(!guard({discard:true})||graphicsLost||!prepared.clips.length||audioOwner)return;
    let captured,capturedBundle;try{capturedBundle=validateSequenceBundle(bundle);captured=prepareSequence(capturedBundle.document.sequence);getRenderer();}catch(error){say(message(error));return;}
    const context=startOperation('export');$('sequence-export-progress').value=0;recordingChanged(true);controls();say('Recording sequence WebM in real time. Keep this tab visible. This is fresh rendering from editable scenes, not a splice of retained recordings.');
    let session=null;
    try{
      session=await prepareAudio(capturedBundle,context);if(!context.owns()||capturedBundle.asset&&!session)return;context.prepared();
      const blob=await exportFilm(canvas,time=>{if(!context.owns())throw Error('Sequence export cancelled.');const view=captured.frameAt(time);renderer.draw(view.sourceFilm,view.sourceGlobal,view.camera);$('sequence-export-progress').value=time/captured.duration;},captured.duration,{signal:context.signal,...(session?{audioSession:session}:{})});
      if(context.owns()){download(blob,'shot-studio-sequence.webm');say(`Sequence WebM downloaded${session?' with its soundtrack':''}. No ordinary take was added.`);}
    }catch(error){if(context.owns())say(message(error));}
    finally{if(session)await closeAudio(audioOwner);if(context.owns()){recordingChanged(false);context.done();render();}else context.done();}
  };
  $('sequence-cancel').onclick=()=>{if(operation){const kind=operation.kind;retire();controls();render();say(`Sequence ${kind==='export'?'export':'work'} cancelled. Editable sequence is unchanged.`);}};
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();graphicsLost=true;retire();controls();say('Sequence graphics context lost. Save sequence to keep editable work, then reload. The ordinary scene is separate.');});
  function suspend(){suspended=true;saveQueued=null;retire();if(saveActive){protectedCopy=true;store.protect();}controls();}
  window.addEventListener('pagehide',suspend);window.addEventListener('pageshow',()=>{suspended=false;stop();controls();render();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(operation?.kind==='export'||operation?.kind==='rehearse'){retire();controls();say('Sequence playback or export cancelled because the tab became hidden.');}else{stop();controls();}}});
  window.addEventListener('storage',event=>{
    if(event.key!=='shot-studio-sequence-v1'&&event.key!==null)return;
    const target=store;
    // The storage owner compares its exact legacy receipt; unrelated clear
    // events must not invent a changed draft or overwrite an editor field.
    queueMicrotask(()=>{if(store===target&&target.protected){retire();protectedCopy=true;saveQueued=null;controls();say('The older browser sequence draft changed in another tab. Current memory work is kept; review the protected saved copy before saving.');}});
  });
  refresh();void loadSaved();
  return {controls,copySource,suspend,hasPendingWork:()=>drafts.size>0||!!operation||!!saveActive||!!saveQueued||!!loadOwner||unsaved,
    cancelExport(reason){if(operation?.kind==='export'){retire();controls();say(reason);}},
  };
}
