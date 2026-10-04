import {importProject,MAX_BYTES} from './model.js';
import {StageRenderer} from './renderer.js';
import {exportFilm} from './export.js';
import {SEQUENCE_LIMITS,validateSequence,importSequence,captureSource,appendClip,removeClip,moveClip,removeSource,sequenceDuration,sequenceFrameAt,SequenceHistory} from './sequence.js';
import {SequenceDraftStore,SEQUENCE_DRAFT_KEY} from './sequence-draft.js';

// A separate renderer gives the sequence ownership of its own rehearsal/export.
// It never writes scene fields, take metadata, or their playback clocks.
export function createSequenceUI({captureScene,captureTake,sceneBusy,download}){
  const $=id=>document.getElementById(`sequence-${id}`),store=new SequenceDraftStore();
  let sequence=store.sequence,history=new SequenceHistory(sequence),source=sequence.sources[0]?.id??'',shot=0,selected=0;
  let time=0,playing=false,start=0,frame=0,exporting=false,controller=null,suspended=false,graphicsLost=false;
  let revision=0,intent=0,epoch=0,pending=false,titleDirty=false,unsaved=false,renderer;
  const say=text=>{$('status').textContent=text;};
  try{renderer=new StageRenderer($('stage'));}catch(error){graphicsLost=true;say(error.message+' Sequence backups and editing remain available.');}
  function stop(){playing=false;$('play').textContent='Rehearse sequence';}
  function guarded(){
    if(exporting||suspended)return true;
    if(titleDirty){say('Correct the unsent sequence title or choose Discard sequence title first. Backups and preview use the committed cut.');return true;}
    return false;
  }
  function save(){
    try{store.save(sequence);unsaved=false;say('Sequence saved in this browser. Source snapshots are independent of later scene and take edits.');}
    catch(error){unsaved=true;say(error.message+' Current sequence is retained in memory; download a sequence backup before leaving.');}
  }
  function clipStart(at){return sequence.clips.slice(0,at).reduce((sum,c)=>sum+sequence.sources.find(s=>s.id===c.sourceId).film.shots[c.shotIndex].duration,0);}
  function normalize(){
    if(!sequence.sources.some(s=>s.id===source))source=sequence.sources[0]?.id??'';
    const film=sequence.sources.find(s=>s.id===source)?.film;shot=film?Math.min(shot,film.shots.length-1):0;
    selected=Math.min(selected,Math.max(0,sequence.clips.length-1));time=Math.min(time,sequenceDuration(sequence));
  }
  function controls(){
    const working=exporting||suspended,film=sequence.sources.find(s=>s.id===source)?.film;
    for(const id of ['title','source','shot','capture-scene','capture-take','import-scene','open','add','remove','earlier','later','repeat','remove-source','undo','redo','replace','discard-title'])$(id).disabled=working;
    $('capture-scene').disabled=working||sceneBusy()||sequence.sources.length>=SEQUENCE_LIMITS.sources;
    for(const id of ['capture-take','import-scene'])$(id).disabled=working||sequence.sources.length>=SEQUENCE_LIMITS.sources;
    $('add').disabled=working||!film||sequence.clips.length>=SEQUENCE_LIMITS.clips;
    for(const id of ['remove','repeat'])$(id).disabled=working||!sequence.clips.length;
    $('earlier').disabled=working||!sequence.clips.length||selected===0;
    $('later').disabled=working||!sequence.clips.length||selected===sequence.clips.length-1;
    $('remove-source').disabled=working||!film;
    $('undo').disabled=working||!history.canUndo;$('redo').disabled=working||!history.canRedo;
    for(const id of ['play','stop','scrub','export'])$(id).disabled=working||graphicsLost||!sequence.clips.length;
    $('save').disabled=working;$('recovery').disabled=working;
    $('recovery').hidden=store.raw===null;$('replace').hidden=!store.blocked;
    $('discard-title').hidden=!titleDirty;$('title-notice').hidden=!titleDirty;
    $('cancel').hidden=!exporting;$('preview').hidden=!sequence.clips.length;
    $('empty').hidden=sequence.clips.length>0;
    $('count').textContent=`${sequence.sources.length}/4 sources · ${sequence.clips.length}/20 clips · ${sequenceDuration(sequence).toFixed(2)}/60 seconds${unsaved?' · NOT SAVED':''}`;
    $('scrub').max=sequenceDuration(sequence);
  }
  function refresh(resetTitle=false){
    normalize();if(resetTitle)$('title').value=sequence.title;
    $('source').replaceChildren();
    for(const s of sequence.sources){const option=document.createElement('option');option.value=s.id;option.textContent=s.name;$('source').append(option);}
    $('source').value=source;
    $('shot').replaceChildren();
    sequence.sources.find(s=>s.id===source)?.film.shots.forEach((s,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${i+1} · ${s.name} · ${s.duration}s`;$('shot').append(option);});
    $('shot').value=String(shot);
    const hadFocus=$('clips').contains(document.activeElement);$('clips').replaceChildren();
    sequence.clips.forEach((clip,i)=>{
      const s=sequence.sources.find(s=>s.id===clip.sourceId),authored=s.film.shots[clip.shotIndex],b=document.createElement('button');
      b.type='button';b.textContent=`${i+1} · ${s.name} / ${authored.name} · ${authored.duration}s`;
      b.setAttribute('aria-pressed',String(selected===i));b.disabled=exporting;
      b.onclick=()=>{if(guarded())return;intent++;stop();selected=i;time=clipStart(i);refresh();};$('clips').append(b);
    });
    if(hadFocus)$('clips').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
    controls();
  }
  function apply(candidate,{select=selected,reset=false}={}){
    const admitted=validateSequence(candidate),changed=JSON.stringify(admitted)!==JSON.stringify(sequence);
    if(changed){sequence=history.commit(admitted);revision++;}
    selected=select;titleDirty=false;stop();normalize();if(reset)time=clipStart(selected);
    if(changed)save();else say('The committed sequence is unchanged.');refresh(true);
  }
  function edit(operation,options){if(guarded())return;intent++;try{apply(operation(sequence),options);}catch(error){say(error.message);controls();}}
  function addSource(film){
    let n=1;while(sequence.sources.some(s=>s.id===`s${n}`))n++;
    const id=`s${n}`,next=captureSource(sequence,{id,name:film.title,film});
    apply(next);source=id;shot=0;refresh();
  }
  $('capture-scene').onclick=()=>{
    if(guarded()||sceneBusy())return;intent++;
    try{const film=captureScene();if(film)addSource(film);}catch(error){say(error.message);}
  };
  $('capture-take').onclick=()=>{
    if(guarded())return;intent++;
    try{const film=captureTake();if(!film)throw Error('Select a saved take first. Only its editable film is copied; the video is not spliced.');addSource(film);}catch(error){say(error.message);}
  };
  $('source').onchange=()=>{if(guarded()){refresh();return;}intent++;source=$('source').value;shot=0;refresh();};
  $('shot').onchange=()=>{if(guarded()){refresh();return;}intent++;shot=Number($('shot').value);controls();};
  $('add').onclick=()=>edit(p=>appendClip(p,source,shot),{select:sequence.clips.length,reset:true});
  $('repeat').onclick=()=>edit(p=>{const c=p.clips[selected];return appendClip(p,c.sourceId,c.shotIndex);},{select:sequence.clips.length,reset:true});
  $('remove').onclick=()=>edit(p=>removeClip(p,selected),{reset:true});
  for(const [id,direction] of [['earlier',-1],['later',1]])$(id).onclick=()=>edit(p=>moveClip(p,selected,direction),{select:selected+direction,reset:true});
  $('remove-source').onclick=()=>edit(p=>removeSource(p,source));
  for(const [id,method] of [['undo','undo'],['redo','redo']])$(id).onclick=()=>{
    if(guarded())return;intent++;stop();sequence=history[method]();revision++;normalize();time=clipStart(selected);save();refresh(true);
  };
  $('title').oninput=()=>{intent++;titleDirty=true;stop();controls();};
  $('title').onchange=()=>{if(exporting||suspended)return;intent++;try{apply({...sequence,title:$('title').value});}catch(error){titleDirty=true;say(error.message+' Correct the sequence title or discard it.');controls();}};
  $('discard-title').onclick=()=>{
    if(exporting||!titleDirty)return;if(!confirm('Discard the unsent sequence title and restore the committed title?'))return;
    intent++;titleDirty=false;refresh(true);say('Restored the committed sequence title.');
  };
  $('play').onclick=()=>{
    if(guarded()||graphicsLost||!sequence.clips.length)return;
    if(playing){stop();return;}if(time>=sequenceDuration(sequence))time=0;
    playing=true;start=performance.now()-time*1000;$('play').textContent='Pause sequence';
  };
  $('stop').onclick=()=>{stop();time=0;};
  $('scrub').oninput=()=>{if(exporting)return;stop();time=Number($('scrub').value);};
  $('save').onclick=()=>{
    if(exporting)return;download(new Blob([JSON.stringify(sequence,null,2)],{type:'application/json'}),'shot-studio.shot-sequence.json');
    say('Downloaded the complete committed sequence and all editable source snapshots.'+(titleDirty?' Unsent title is not included.':''));
  };
  $('recovery').onclick=()=>{if(exporting||store.raw===null)return;download(new Blob([JSON.stringify({kind:'unreadable-shot-studio-sequence',storageKey:SEQUENCE_DRAFT_KEY,raw:store.raw})],{type:'application/json'}),'shot-studio-sequence-recovery.json');};
  $('replace').onclick=()=>{
    if(guarded()||!store.blocked)return;
    if(!confirm('Replace the saved sequence draft with this committed cut? Download current and unreadable backups first. Another tab’s work may be replaced.'))return;
    try{store.replace(sequence);unsaved=false;say('Sequence browser draft explicitly replaced. Automatic saving is enabled.');}catch(error){say(error.message+' Saved sequence remains protected.');}controls();
  };
  async function open(input,kind){
    const file=$(input).files[0];if(!file)return;
    const token=++epoch;
    if(guarded()){$(input).value='';pending=false;return;}
    const base=revision,ownedIntent=intent;pending=true;
    try{
      if(file.size>(kind==='source'?MAX_BYTES:SEQUENCE_LIMITS.bytes))throw Error('The backup exceeds its byte limit.');
      const text=await file.text();
      if(token!==epoch||suspended)return;
      if(revision!==base||intent!==ownedIntent||titleDirty||exporting)throw Error('Sequence input changed while opening the file. Open it again to use it.');
      if(kind==='source')addSource(importProject(text));else apply(importSequence(text),{select:0,reset:true});
    }catch(error){if(token===epoch&&!suspended)say(error.message);}
    finally{if($(input).files[0]===file)$(input).value='';if(token===epoch){pending=false;controls();}}
  }
  $('open').onchange=()=>open('open','sequence');$('import-scene').onchange=()=>open('import-scene','source');
  $('export').onclick=async()=>{
    if(guarded()||graphicsLost||!sequence.clips.length)return;
    stop();const captured=validateSequence(sequence),token=++epoch;pending=false;exporting=true;controller=new AbortController();
    const signal=controller.signal;controls();say('Rendering a new silent WebM from editable source scenes. Keep this tab visible.');
    try{
      const blob=await exportFilm($('stage'),seconds=>{const v=sequenceFrameAt(captured,seconds);renderer.draw(v.film,v.sourceTime,v.camera);},sequenceDuration(captured),{signal});
      if(token!==epoch||suspended||signal.aborted)return;
      download(blob,'shot-studio-sequence.webm');say('Freshly rendered sequence WebM ready. Original recorded video bytes were not spliced.');
    }catch(error){if(token===epoch&&!suspended)say(error.message);}
    finally{if(token===epoch){exporting=false;controller=null;controls();}}
  };
  $('cancel').onclick=()=>controller?.abort();
  function draw(now){
    frame=requestAnimationFrame(draw);if(suspended||exporting||graphicsLost||!sequence.clips.length)return;
    if(playing){time=Math.min(sequenceDuration(sequence),(now-start)/1000);if(time>=sequenceDuration(sequence))stop();}
    const view=sequenceFrameAt(sequence,time);renderer.draw(view.film,view.sourceTime,view.camera);
    $('scrub').value=time;
    $('clock').textContent=`Sequence ${time.toFixed(2)} / ${sequenceDuration(sequence).toFixed(2)}s · clip ${view.index+1} · source ${view.sourceTime.toFixed(2)}s · ${view.film.title}`;
  }
  $('stage').addEventListener('webglcontextlost',event=>{event.preventDefault();graphicsLost=true;stop();controller?.abort();say('Sequence graphics context lost. Save a sequence backup and reload.');controls();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();controller?.abort();}});
  window.addEventListener('beforeunload',event=>{if(titleDirty||pending||unsaved||exporting){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{suspended=true;epoch++;pending=false;stop();controller?.abort();controller=null;exporting=false;cancelAnimationFrame(frame);});
  window.addEventListener('pageshow',()=>{suspended=false;stop();cancelAnimationFrame(frame);controls();frame=requestAnimationFrame(draw);});
  refresh(true);
  if(store.blocked)say('Saved sequence draft is protected; automatic writes are blocked. Download raw recovery if available and a current sequence backup before explicitly replacing it.');
  else if(!graphicsLost)say('Capture a committed scene, selected saved take film, or scene JSON; then add its whole shots to a new cut.');
  frame=requestAnimationFrame(draw);
  return {controls};
}
