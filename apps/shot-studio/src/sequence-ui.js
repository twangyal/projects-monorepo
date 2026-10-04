import {importProject,validateProject} from './model.js';
import {StageRenderer} from './renderer.js';
import {exportFilm} from './export.js';
import {SEQUENCE_LIMITS,createSequence,validateSequence,importSequence,addSequenceSource,removeSequenceSource,renameSequenceSource,addSequenceClip,removeSequenceClip,renameSequenceClip,moveSequenceClip,prepareSequence,setSequenceClipRange,resetSequenceClipRange,MIN_SEQUENCE_CLIP_SECONDS} from './sequence.js';
import {SequenceDraftStore,SequenceHistory} from './sequence-store.js';

// This panel owns a separate document, draft, renderer and native form nodes.
export function createSequenceUI({captureFilm,sceneBusy,recordingChanged,download}){
  const $=id=>document.getElementById(id),store=new SequenceDraftStore();
  let documentState=validateSequence(store.sequence),history=new SequenceHistory(documentState),prepared=prepareSequence(documentState);
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
  function stop(){playing=false;cancelAnimationFrame(animation);animation=0;$('sequence-play').textContent='Rehearse sequence';}
  function retire(){epoch++;const old=operation;operation=null;old?.controller.abort();if(old?.kind==='export')recordingChanged(false);stop();}
  function rawValue(id,value){if(!drafts.has(id)&&$(id).value!==value)$(id).value=value;}
  function saveStatus(){
    $('sequence-save-status').textContent=store.blocked?'Sequence browser record protected · work stays in memory':unsaved?'Sequence not saved · download a backup':'Sequence saved in this browser';
    $('sequence-recovery-download').hidden=!store.blocked||store.raw===null;
    $('sequence-replace-saved').hidden=!store.blocked;
  }
  function controls(){
    if(sceneBusy()&&playing)stop();
    const external=locked(),hasClips=documentState.clips.length>0,index=clipIndex(),source=selectedSourceRecord();
    for(const input of document.querySelectorAll('#sequence-panel input,#sequence-panel button'))input.disabled=external;
    for(const id of ['sequence-play','sequence-scrub','sequence-preview-start','sequence-preview-end','sequence-export'])$(id).disabled=external||!hasClips||graphicsLost;
    $('sequence-stop').disabled=suspended||!hasClips;
    $('sequence-cancel').hidden=operation?.kind!=='export';$('sequence-cancel').disabled=false;
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
  function persist(){
    try{store.save(documentState);unsaved=false;}
    catch(error){unsaved=true;say(`${message(error)} Memory work is kept; Save sequence downloads a complete backup.`);}
    saveStatus();
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
    $('sequence-range-info').textContent=info?`Original shot: 0–${info.sourceDuration}s. Committed In ${info.inTime}s · Out ${info.outTime}s · excerpt ${info.duration}s. Original source-film range ${info.sourceStart+info.inTime}–${info.sourceStart+info.outTime}s. Out must exceed In by at least ${MIN_SEQUENCE_CLIP_SECONDS}s.`:'Select a sequence clip to choose its source range.';
  }
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
    const safe=validateSequence(next),nextPrepared=prepareSequence(safe);
    retire();documentState=history.commit(safe);prepared=nextPrepared;
    if(sourceId!==undefined){selectedSource=sourceId;selectedShot=0;}if(clipId!==undefined)selectedClip=clipId;
    if(clearField)drafts.delete(clearField);for(const field of clearFields)drafts.delete(field);
    endpoint=null;position=documentState.clips.length?prepared.clips[Math.max(0,clipIndex())].sequenceStart:0;
    refresh();persist();return true;
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
  for(const inputId of ['sequence-title','sequence-source-label','sequence-clip-label','sequence-clip-in','sequence-clip-out'])$(inputId).addEventListener('input',()=>{retire();drafts.add(inputId);controls();say('Unapplied sequence field; preview and backups keep committed work.');});
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
  $('sequence-discard-edits').onclick=()=>{if(locked()||!drafts.size||!consentRaw())return;retire();controls();say('Unapplied sequence fields discarded. Committed sources, clips and history are unchanged.');};
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
    retire();documentState=history[direction]();prepared=prepareSequence(documentState);endpoint=null;position=0;refresh();persist();say(`Sequence ${direction} complete; scene history is unchanged.`);
  };
  function tick(now){
    if(!playing||suspended||sceneBusy()||operation?.kind==='export'){stop();return;}
    position=Math.min(prepared.duration,(now-playStarted)/1000);render();if(position>=prepared.duration)stop();else animation=requestAnimationFrame(tick);
  }
  $('sequence-play').onclick=()=>{
    if(!guard()||graphicsLost||!prepared.clips.length)return;if(playing){stop();return;}
    retire();if(endpoint){position=prepared.clips[clipIndex()].sequenceStart;endpoint=null;}else if(position>=prepared.duration)position=0;
    playing=true;playStarted=performance.now()-position*1000;$('sequence-play').textContent='Pause sequence';render();animation=requestAnimationFrame(tick);
  };
  $('sequence-stop').onclick=()=>{retire();controls();say('Sequence stopped at its current position.');};
  $('sequence-scrub').oninput=()=>{if(!guard()){render();return;}retire();endpoint=null;position=Number($('sequence-scrub').value);render();};
  for(const value of ['start','end'])$(`sequence-preview-${value}`).onclick=()=>{if(!guard()||clipIndex()<0||graphicsLost)return;retire();endpoint=value;render();};
  function startOperation(kind){
    retire();const controller=new AbortController(),token=epoch;operation={kind,token,controller};controls();
    return {signal:controller.signal,owns:()=>!suspended&&operation?.token===token&&!controller.signal.aborted&&!sceneBusy(),done(){if(operation?.token===token){operation=null;controls();}}};
  }
  function replacement(next,context){
    if(!context.owns()||!guard())return;
    const before=epoch;
    if(!confirm('Replace the whole sequence with this document? Save sequence first to keep a portable copy. Undo sequence restores the previous committed sequence only.'))return;
    if(!context.owns()||before!==epoch||drafts.size)return;
    publish(next);say('Complete sequence opened. The ordinary scene and saved takes are unchanged.');
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
    try{if(file.size>SEQUENCE_LIMITS.bytes)throw Error('Choose a sequence file no larger than 320 KiB.');const text=await file.text();if(!context.owns())return;replacement(importSequence(text),context);}
    catch(error){if(context.owns())say(`${message(error)} The existing sequence is unchanged.`);}finally{context.done();}
  };
  $('sequence-new').onclick=()=>{if(!guard({discard:true}))return;const context=startOperation('new');try{replacement(createSequence(),context);}catch(error){say(message(error));}finally{context.done();}};
  $('sequence-save').onclick=()=>{if(locked())return;download(new Blob([JSON.stringify(validateSequence(documentState))],{type:'application/json'}),'shot-studio.shot-sequence.json');say(`Downloaded the complete committed sequence.${drafts.size?' Unapplied fields are not included.':''}`);};
  $('sequence-recovery-download').onclick=()=>{if(locked())return;try{download(new Blob([store.recoveryJson()],{type:'application/json'}),'shot-studio-sequence-unreadable.json');}catch(error){say(message(error));}};
  $('sequence-replace-saved').onclick=()=>{
    if(!guard()||!store.blocked)return;const before=epoch,snapshot=validateSequence(documentState);
    if(!confirm('Replace the protected saved sequence with this committed sequence? Download the unreadable record and Save sequence first. The old browser record will be replaced.'))return;
    if(before!==epoch||locked()||drafts.size)return;
    try{store.replace(snapshot);unsaved=false;saveStatus();say('Saved sequence explicitly replaced. Automatic sequence saving is enabled.');}catch(error){unsaved=true;saveStatus();say(`${message(error)} The saved sequence remains protected.`);}
  };
  $('sequence-export').onclick=async()=>{
    if(!guard({discard:true})||graphicsLost||!prepared.clips.length)return;
    let captured;try{captured=prepareSequence(documentState);getRenderer();}catch(error){say(message(error));return;}
    const context=startOperation('export');$('sequence-export-progress').value=0;recordingChanged(true);controls();say('Recording sequence WebM in real time. Keep this tab visible. This is fresh rendering from editable scenes, not a splice of retained recordings.');
    try{
      const blob=await exportFilm(canvas,time=>{if(!context.owns())throw Error('Sequence export cancelled.');const view=captured.frameAt(time);renderer.draw(view.sourceFilm,view.sourceGlobal,view.camera);$('sequence-export-progress').value=time/captured.duration;},captured.duration,{signal:context.signal});
      // sceneBusy excludes this sequence's own recording, avoiding self-deadlock.
      if(context.owns()){download(blob,'shot-studio-sequence.webm');say('Sequence WebM downloaded. No ordinary take was added.');}
    }catch(error){if(context.owns())say(message(error));}
    finally{if(operation?.kind==='export'&&context.owns()){operation=null;recordingChanged(false);controls();render();}}
  };
  $('sequence-cancel').onclick=()=>{if(operation?.kind==='export'){retire();controls();render();say('Sequence export cancelled. Editable sequence is unchanged.');}};
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();graphicsLost=true;retire();controls();say('Sequence graphics context lost. Save sequence to keep editable work, then reload. The ordinary scene is separate.');});
  function suspend(){suspended=true;retire();controls();}
  window.addEventListener('pagehide',suspend);window.addEventListener('pageshow',()=>{suspended=false;stop();controls();render();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(operation?.kind==='export'){retire();controls();say('Sequence export cancelled because the tab became hidden.');}else stop();}});
  refresh();if(store.blocked)say('The saved sequence could not be read and is protected. Work in memory, download backups, or deliberately replace it.');else say(documentState.clips.length?'Restored the saved sequence without rewriting it.':'Add a copied scene source, then choose whole shots to make a sequence.');
  return {controls,copySource,suspend,hasPendingWork:()=>drafts.size>0||!!operation||unsaved,
    cancelExport(reason){if(operation?.kind==='export'){retire();controls();say(reason);}},
  };
}
