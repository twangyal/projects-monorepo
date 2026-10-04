import {validateProject,importProject,totalDuration,cameraAt,frameAt,MAX_BYTES} from './model.js';
import {StageRenderer} from './renderer.js';
import {exportFilm} from './export.js';
import {enterXR} from './xr.js';
import {ProjectHistory,moveShot} from './history.js';
import {DraftStore} from './draft.js';

const $=id=>document.getElementById(id),draft=new DraftStore();
let project=draft.project,selected=0,actor=0,time=0,playing=false,start=0,revision=0,editIntent=0;
let exporting=false,xr=null,xrPending=false,xrAbort=null,abort=null,frame=0;
let endpoint='start',previewMode='film',previewEndpoint='start',storageWarning='';
let importEpoch=0,pendingImport=false;
const unsent=new Set();
const selectors=new Set(['actor','cameraEndpoint','cameraMode','preset']);
const status=text=>$('status').textContent=text;
if(draft.blocked)status('Could not load the saved draft. It has been preserved; automatic saving is blocked. '+(draft.raw!==null?'Save your current project and download the unreadable draft before explicitly replacing it.':'No recovery download is available because the saved contents could not be read. Save your current project before explicitly replacing the browser draft.'));
let renderer,graphicsLost=false;
const history=new ProjectHistory(project);
try{renderer=new StageRenderer($('stage'));}catch(e){status(e.message);for(const b of document.querySelectorAll('button'))b.disabled=true;throw e;}
const busy=()=>exporting||xrPending||!!xr;
function persist(){
  try{draft.save(project);storageWarning='';status('Saved in this browser.');}
  catch(e){storageWarning=draft.blocked?e.message:'Browser storage is unavailable. Use Save project to keep a backup.';status(storageWarning);}
}
function stop(){playing=false;$('play').textContent='Rehearse';}
function shotStart(index){return project.shots.slice(0,index).reduce((sum,shot)=>sum+shot.duration,0);}
function guarded(){
  if(busy())return true;
  if(unsent.size){status('Correct the unsent fields or choose Discard unsent edits first. The preview and backups contain the committed film.');return true;}
  return false;
}
function resetPresentation(){endpoint='start';previewMode='film';time=shotStart(selected);}
function evaluatedPreview(){
  if(previewMode==='endpoint'){
    const shot=project.shots[selected],local=previewEndpoint==='end'?shot.duration:0;
    return {index:selected,shot,local,camera:cameraAt(shot,local),global:shotStart(selected)+local};
  }
  const result=frameAt(project,time);
  return {...result,global:shotStart(result.index)+result.local};
}
function refresh(resetFields=false){
  const a=project.actors[actor],s=project.shots[selected];
  if(resetFields){
    const eye=endpoint==='end'?s.endEye:s.eye,target=endpoint==='end'?s.endTarget:s.target;
    for(const [id,value] of Object.entries({title:project.title,actorName:a.name,actorX:a.x,actorZ:a.z,color:a.color,action:a.action,light:project.light,shotName:s.name,duration:s.duration,fov:s.fov,eyeX:eye[0],eyeY:eye[1],eyeZ:eye[2],targetX:target[0],targetY:target[1],targetZ:target[2]}))$(id).value=value;
    $('preset').value='custom';
  }
  $('actor').value=actor;[...$('actor').options].forEach((o,i)=>o.textContent=project.actors[i].name);
  $('cameraMode').value=s.cameraMode;$('cameraEndpoint').value=endpoint;
  $('cameraEndpoint').disabled=busy()||s.cameraMode==='static';
  $('cameraEndpoint').options[1].disabled=s.cameraMode==='static';
  $('endpointLabel').textContent=`Editing shot ${selected+1} — ${s.name} — ${endpoint==='start'?'Start':'End'}`;
  $('copyDirection').textContent=endpoint==='start'?'End → Start':'Start → End';
  $('copyEndpoint').disabled=busy()||s.cameraMode!=='linear';
  $('previewEndpoint').disabled=busy()||graphicsLost;
  $('usePreview').disabled=busy()||graphicsLost||evaluatedPreview().index!==selected;
  $('discardEdits').hidden=!unsent.size;$('discardEdits').disabled=busy();
  $('draftNotice').hidden=!unsent.size;
  $('scrub').max=totalDuration(project);$('shots').replaceChildren();
  project.shots.forEach((shot,i)=>{
    const b=document.createElement('button');b.type='button';b.textContent=`${String(i+1).padStart(2,'0')} · ${shot.name} / ${shot.duration}s${shot.cameraMode==='linear'?' · travel':''}`;
    b.setAttribute('aria-pressed',String(i===selected));b.disabled=busy();
    b.onclick=()=>{if(guarded())return;editIntent++;stop();selected=i;resetPresentation();refresh(true);};$('shots').append(b);
  });
  $('rawDraft').hidden=draft.raw===null;$('rawDraft').disabled=busy();
  $('replaceDraft').hidden=!draft.blocked;$('replaceDraft').disabled=busy();
  $('fields').disabled=busy();
  for(const id of ['play','stop','add','remove','save','export'])$(id).disabled=busy();
  for(const id of ['play','stop','export'])$(id).disabled=busy()||graphicsLost;
  $('import').disabled=busy();$('scrub').disabled=busy();$('vr').disabled=exporting||xrPending||graphicsLost;
  $('vr').textContent=xr?'Exit VR':'Enter VR';$('cancel').hidden=!exporting;
  $('remove').disabled=busy()||project.shots.length===1;
  $('undo').disabled=busy()||!history.canUndo;$('redo').disabled=busy()||!history.canRedo;
  $('earlier').disabled=busy()||selected===0;$('later').disabled=busy()||selected===project.shots.length-1;
}
// Validate before changing any film, presentation, history or durable state.
function apply(candidate,{selection=selected,reset=false}={}){
  try{
    const next=validateProject(candidate),changed=JSON.stringify(next)!==JSON.stringify(project);
    if(changed){project=history.commit(next);revision++;}
    selected=selection;
    if(reset)resetPresentation();
    if(project.shots[selected].cameraMode==='static'){endpoint='start';if(previewMode==='endpoint')previewEndpoint='start';}
    time=Math.min(time,totalDuration(project));unsent.clear();
    if(changed)persist();
    else status('The committed film is unchanged.'+(storageWarning?' '+storageWarning:''));
    refresh(true);return true;
  }catch(e){status(e.message+' The committed film is unchanged. Correct the fields or discard unsent edits.');refresh();return false;}
}
function restoreHistory(state){stop();project=state;selected=Math.min(selected,project.shots.length-1);resetPresentation();revision++;persist();refresh(true);}
$('undo').onclick=()=>{if(!guarded()){editIntent++;restoreHistory(history.undo());}};
$('redo').onclick=()=>{if(!guarded()){editIntent++;restoreHistory(history.redo());}};
for(const [id,direction] of [['earlier',-1],['later',1]])$(id).onclick=()=>{
  if(guarded())return;editIntent++;try{const next=moveShot(project,selected,direction);stop();apply(next,{selection:selected+direction,reset:true});}catch(e){status(e.message);}
};
function setCamera(shot,camera,which=endpoint){
  if(which==='end'){shot.endEye=[...camera.eye];shot.endTarget=[...camera.target];}
  else{shot.eye=[...camera.eye];shot.target=[...camera.target];}
}
function number(id){const raw=$(id).value;if(raw.trim()===''||!Number.isFinite(Number(raw)))throw Error('Enter a nonempty finite number for '+($(id).getAttribute('aria-label')||$(id).closest('label').textContent.trim())+'.');return Number(raw);}
function formCandidate(){
  const p=structuredClone(project),a=p.actors[actor],s=p.shots[selected];
  p.title=$('title').value;p.light=number('light');
  Object.assign(a,{name:$('actorName').value,x:number('actorX'),z:number('actorZ'),color:$('color').value,action:$('action').value});
  Object.assign(s,{name:$('shotName').value,duration:number('duration'),fov:number('fov')});
  setCamera(s,{eye:['eyeX','eyeY','eyeZ'].map(number),target:['targetX','targetY','targetZ'].map(number)});return p;
}
$('settings').addEventListener('submit',e=>e.preventDefault());
$('settings').addEventListener('input',e=>{
  editIntent++;
  if(!selectors.has(e.target.id)){unsent.add(e.target.id);stop();$('discardEdits').hidden=false;$('draftNotice').hidden=false;}
});
$('settings').addEventListener('change',e=>{
  if(busy())return;
  const id=e.target.id;
  if(selectors.has(id)){
    if(guarded()){if(id==='preset')$('preset').value='custom';refresh();return;}editIntent++;
    if(id==='actor'){actor=Number($('actor').value);refresh(true);return;}
    if(id==='cameraEndpoint'){endpoint=$('cameraEndpoint').value;refresh(true);return;}
    stop();const p=structuredClone(project),s=p.shots[selected];
    if(id==='cameraMode'){
      const mode=$('cameraMode').value;
      if(mode===s.cameraMode)return;
      if(mode==='static'){
        if((JSON.stringify(s.eye)!==JSON.stringify(s.endEye)||JSON.stringify(s.target)!==JSON.stringify(s.endTarget))&&!confirm('Keep Start and discard the End camera and travel? Undo scene can restore them.')){refresh();return;}
        s.cameraMode='static';delete s.endEye;delete s.endTarget;
      }else{s.cameraMode='linear';s.endEye=[...s.eye];s.endTarget=[...s.target];}
    }else if(id==='preset'){
      const a=p.actors[actor],presets={wide:{eye:[5,3,7],target:[0,1,0],fov:45},two:{eye:[0,1.8,5],target:[0,1,0],fov:40},close:{eye:[a.x,1.8,a.z+3],target:[a.x,1.35,a.z],fov:30}};
      const preset=presets[$('preset').value];if(!preset)return;setCamera(s,preset);s.fov=preset.fov;
    }
    apply(p);return;
  }
  // A change without an input event is still an unsent edit until accepted.
  unsent.add(id);editIntent++;stop();
  try{apply(formCandidate());}catch(e){status(e.message);refresh();}
});
$('discardEdits').onclick=()=>{
  if(busy()||!unsent.size)return;
  if(!confirm('Discard unsent edits and restore the committed fields?'))return;
  editIntent++;unsent.clear();refresh(true);status('Unsent edits discarded. The committed film and history are unchanged.');
};
$('copyEndpoint').onclick=()=>{
  if(guarded())return;editIntent++;const p=structuredClone(project),s=p.shots[selected];if(s.cameraMode!=='linear')return;
  setCamera(s,endpoint==='start'?{eye:s.endEye,target:s.endTarget}:{eye:s.eye,target:s.target});stop();apply(p);
};
$('previewEndpoint').onclick=()=>{
  if(guarded())return;editIntent++;stop();previewMode='endpoint';previewEndpoint=endpoint;time=evaluatedPreview().global;refresh();
};
$('usePreview').onclick=()=>{
  if(guarded())return;const view=evaluatedPreview();if(view.index!==selected){status('Select the shot currently shown before using its preview.');return;}
  editIntent++;const p=structuredClone(project);setCamera(p.shots[selected],view.camera);stop();apply(p);
};
$('play').onclick=()=>{
  if(guarded())return;if(playing){stop();return;}
  if(previewMode==='endpoint')time=shotStart(selected);else if(time>=totalDuration(project))time=0;
  previewMode='film';playing=true;start=performance.now()-time*1000;$('play').textContent='Pause rehearsal';
};
$('stop').onclick=()=>{stop();previewMode='film';time=0;};
$('scrub').oninput=()=>{stop();previewMode='film';time=Number($('scrub').value);};
$('add').onclick=()=>{
  if(guarded())return;editIntent++;const p=structuredClone(project);p.shots.push({...structuredClone(p.shots[selected]),name:`Shot ${p.shots.length+1}`,duration:2});stop();apply(p,{selection:p.shots.length-1,reset:true});
};
$('remove').onclick=()=>{
  if(guarded()||project.shots.length===1)return;editIntent++;stop();const p=structuredClone(project);p.shots.splice(selected,1);apply(p,{selection:Math.min(selected,p.shots.length-1),reset:true});
};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('rawDraft').onclick=()=>{if(busy()||draft.raw===null)return;download(new Blob([JSON.stringify({schemaVersion:1,kind:'unreadable-shot-studio-draft',storageKey:'shot-studio-v1',raw:draft.raw},null,2)],{type:'application/json'}),'shot-studio-unreadable-draft.json');};
$('replaceDraft').onclick=()=>{
  if(guarded()||!draft.blocked)return;
  if(!confirm('Replace the saved browser draft with the current scene? '+(draft.raw!==null?'Download the unreadable draft and save your current project first.':'No recovery download is available because the saved contents could not be read. Save your current project first.')+' This will replace the old browser draft.')){status('Saved draft was not replaced. Automatic saving remains blocked.');return;}
  try{draft.replace(project);storageWarning='';status('Browser draft explicitly replaced with the current scene. Automatic saving is enabled.');}catch{status('Could not replace the browser draft. The old contents remain protected; save a project backup.');}refresh();
};
$('save').onclick=()=>{download(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),'shot-studio.json');if(unsent.size)status('Downloaded the committed film. Unsent fields are not included.');};
$('import').onchange=async()=>{
  const file=$('import').files[0];if(!file)return;
  const epoch=++importEpoch;
  if(guarded()){$('import').value='';pendingImport=false;return;}
  const base=revision,intent=editIntent;pendingImport=true;
  try{
    if(file.size>MAX_BYTES)throw Error('Project backup exceeds 64 KiB.');
    const text=await file.text();
    if(epoch!==importEpoch)return;
    if(revision!==base||editIntent!==intent||unsent.size||busy())throw Error('The scene changed while opening the file. Open it again to replace it.');
    const p=importProject(text);stop();apply(p,{selection:0,reset:true});
  }catch(e){if(epoch===importEpoch)status(e.message);}
  finally{if(epoch===importEpoch){$('import').value='';pendingImport=false;}}
};
$('export').onclick=async()=>{
  if(guarded())return;stop();exporting=true;abort=new AbortController();refresh();status('Recording WebM. Keep this tab visible.');
  const p=structuredClone(project);
  try{const blob=await exportFilm($('stage'),t=>{const view=frameAt(p,t);const global=p.shots.slice(0,view.index).reduce((sum,shot)=>sum+shot.duration,0)+view.local;renderer.draw(p,global,view.camera);},totalDuration(p),{signal:abort.signal});download(blob,'shot-studio.webm');status('WebM ready.'+(storageWarning?' '+storageWarning:''));}
  catch(e){status(e.message);}finally{exporting=false;abort=null;refresh();}
};
$('cancel').onclick=()=>abort?.abort();
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();abort?.abort();}});
$('vr').onclick=async()=>{
  if(xr){await xr.end();return;}if(guarded())return;
  const capturedShot=selected,capturedEndpoint=endpoint,capturedActor=actor;
  stop();xrPending=true;xrAbort=new AbortController();refresh();status('Requesting VR…');
  try{
    xr=await enterXR(renderer,()=>project,()=>time,([x,z])=>{
      const p=structuredClone(project);p.actors[capturedActor].x=Math.round(x*10)/10;p.actors[capturedActor].z=Math.round(z*10)/10;apply(p);
    },()=>{
      xr=null;previewMode='endpoint';previewEndpoint=capturedEndpoint;time=evaluatedPreview().global;
      status((graphicsLost?'Graphics context lost. Save a backup and reload.':'Left VR.')+(storageWarning?' '+storageWarning:''));refresh();
    },{signal:xrAbort.signal,onCamera:camera=>{
      const p=structuredClone(project);setCamera(p.shots[capturedShot],camera,capturedEndpoint);
      if(apply(p)){previewMode='endpoint';previewEndpoint=capturedEndpoint;time=evaluatedPreview().global;status('Camera captured. '+$('status').textContent);}
    },onCameraError:status});
    status('VR active. Select the floor marker to place the performer; squeeze to capture into the selected '+capturedEndpoint+' endpoint.');
  }catch(e){status(e.message);}finally{xrPending=false;if(!xr)xrAbort=null;refresh();}
};
function loop(now){
  frame=requestAnimationFrame(loop);if(xr||xrPending||exporting||graphicsLost)return;
  if(playing){time=Math.min(totalDuration(project),(now-start)/1000);if(time>=totalDuration(project))stop();}
  const view=evaluatedPreview();time=view.global;renderer.draw(project,time,view.camera);
  $('time').textContent=`${time.toFixed(2)} / ${totalDuration(project).toFixed(2)}s`;$('scrub').value=time;
  $('shotLabel').textContent=`CAMERA ${String(view.index+1).padStart(2,'0')} · ${view.shot.name}${previewMode==='endpoint'?` · ${previewEndpoint.toUpperCase()} endpoint preview — not the film cut at this position`:' · Film'}${unsent.size?' · committed preview':''}`;
  $('usePreview').disabled=view.index!==selected;
}
window.addEventListener('beforeunload',e=>{if(unsent.size||pendingImport){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{importEpoch++;pendingImport=false;abort?.abort();xrAbort?.abort();stop();cancelAnimationFrame(frame);xr?.end();});
window.addEventListener('pageshow',()=>{stop();cancelAnimationFrame(frame);frame=requestAnimationFrame(loop);});
$('stage').addEventListener('webglcontextlost',e=>{e.preventDefault();graphicsLost=true;stop();abort?.abort();xrAbort?.abort();xr?.end();refresh();status('The graphics context was lost. Save your project backup, then reload.');});
refresh(true);if($('status').textContent==='Starting the stage…')status('Ready. Rehearse the starter film or arrange your own scene.');frame=requestAnimationFrame(loop);
