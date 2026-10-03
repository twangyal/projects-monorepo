import {createProject,validateProject,importProject,totalDuration,shotAt,MAX_BYTES} from './model.js';
import {StageRenderer} from './renderer.js';
import {exportFilm} from './export.js';
import {enterXR} from './xr.js';

const $=id=>document.getElementById(id),KEY='shot-studio-v1';
let project=createProject(),selected=0,actor=0,time=0,playing=false,start=0,revision=0,exporting=false,xr=null,xrPending=false,abort=null,frame=0;
const status=text=>$('status').textContent=text;
try{const draft=localStorage.getItem(KEY);if(draft)project=importProject(draft);}catch{status('Could not load the saved draft. It has been preserved; save a backup before making changes.');}
let renderer,graphicsLost=false;
try{renderer=new StageRenderer($('stage'));}catch(e){status(e.message);for(const b of document.querySelectorAll('button'))b.disabled=true;throw e;}
const busy=()=>exporting||xrPending||!!xr;
function persist(){try{localStorage.setItem(KEY,JSON.stringify(project));status('Saved in this browser.');}catch{status('Browser storage is unavailable. Use Save project to keep a backup.');}}
function apply(candidate){try{project=validateProject(candidate);revision++;time=Math.min(time,totalDuration(project));persist();refresh();}catch(e){status(e.message);refresh();}}
function stop(){playing=false;$('play').textContent='Rehearse';}
function shotStart(index){return project.shots.slice(0,index).reduce((s,x)=>s+x.duration,0);}
function refresh(){
  const a=project.actors[actor],s=project.shots[selected];
  for(const [id,value] of Object.entries({title:project.title,actorName:a.name,actorX:a.x,actorZ:a.z,color:a.color,action:a.action,light:project.light,shotName:s.name,duration:s.duration,fov:s.fov,eyeX:s.eye[0],eyeY:s.eye[1],eyeZ:s.eye[2],targetX:s.target[0],targetY:s.target[1],targetZ:s.target[2]}))$(id).value=value;
  $('actor').value=actor;[...$('actor').options].forEach((o,i)=>o.textContent=project.actors[i].name);
  $('scrub').max=totalDuration(project);$('shots').replaceChildren();
  project.shots.forEach((shot,i)=>{const b=document.createElement('button');b.type='button';b.textContent=`${String(i+1).padStart(2,'0')} · ${shot.name} / ${shot.duration}s`;b.setAttribute('aria-pressed',String(i===selected));b.disabled=busy();b.onclick=()=>{stop();selected=i;time=shotStart(i);refresh();};$('shots').append(b);});
  $('fields').disabled=busy();
  for(const id of ['play','stop','add','remove','save','export'])$(id).disabled=busy();
  for(const id of ['play','stop','export'])$(id).disabled=busy()||graphicsLost;
  $('import').disabled=busy();$('scrub').disabled=busy();$('vr').disabled=exporting||xrPending||graphicsLost;
  $('vr').textContent=xr?'Exit VR':'Enter VR';$('cancel').hidden=!exporting;
  $('remove').disabled=busy()||project.shots.length===1;
}
$('settings').addEventListener('submit',e=>e.preventDefault());
$('settings').addEventListener('change',e=>{
  if(busy())return;stop();
  if(e.target.id==='actor'){actor=Number($('actor').value);refresh();return;}
  const p=structuredClone(project),a=p.actors[actor],s=p.shots[selected],num=id=>Number($(id).value);
  if(e.target.id==='preset'){
    const presets={wide:{eye:[5,3,7],target:[0,1,0],fov:45},two:{eye:[0,1.8,5],target:[0,1,0],fov:40},close:{eye:[a.x,1.8,a.z+3],target:[a.x,1.35,a.z],fov:30}};
    if(presets[$('preset').value])Object.assign(s,presets[$('preset').value]);
  }else{
    p.title=$('title').value;p.light=num('light');Object.assign(a,{name:$('actorName').value,x:num('actorX'),z:num('actorZ'),color:$('color').value,action:$('action').value});
    Object.assign(s,{name:$('shotName').value,duration:num('duration'),fov:num('fov'),eye:['eyeX','eyeY','eyeZ'].map(num),target:['targetX','targetY','targetZ'].map(num)});$('preset').value='custom';
  }apply(p);
});
$('play').onclick=()=>{if(playing){stop();return;}if(time>=totalDuration(project))time=0;playing=true;start=performance.now()-time*1000;$('play').textContent='Pause rehearsal';};
$('stop').onclick=()=>{stop();time=0;};$('scrub').oninput=()=>{stop();time=Number($('scrub').value);};
$('add').onclick=()=>{const p=structuredClone(project);p.shots.push({...structuredClone(p.shots[selected]),name:`Shot ${p.shots.length+1}`,duration:2});try{validateProject(p);selected=p.shots.length-1;time=shotStart(project.shots.length);apply(p);}catch(e){status(e.message);}};
$('remove').onclick=()=>{if(project.shots.length===1)return;const p=structuredClone(project);p.shots.splice(selected,1);selected=Math.min(selected,p.shots.length-1);time=0;apply(p);};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('save').onclick=()=>download(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),'shot-studio.json');
let importEpoch=0;
$('import').onchange=async()=>{
  const file=$('import').files[0],epoch=++importEpoch,base=revision;if(!file)return;
  try{if(file.size>MAX_BYTES)throw Error('Project backup exceeds 64 KiB.');const p=importProject(await file.text());if(epoch!==importEpoch||revision!==base||busy())throw Error('The scene changed while opening the file. Open it again to replace it.');stop();selected=0;time=0;apply(p);}catch(e){status(e.message);}finally{$('import').value='';}
};
$('export').onclick=async()=>{
  stop();exporting=true;abort=new AbortController();refresh();status('Recording WebM. Keep this tab visible.');
  const p=structuredClone(project);
  try{const blob=await exportFilm($('stage'),t=>renderer.draw(p,t,shotAt(p,t).shot),totalDuration(p),{signal:abort.signal});download(blob,'shot-studio.webm');status('WebM ready.');}catch(e){status(e.message);}finally{exporting=false;abort=null;refresh();}
};
$('cancel').onclick=()=>abort?.abort();
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();abort?.abort();}});
$('vr').onclick=async()=>{
  if(xr){await xr.end();return;}stop();xrPending=true;refresh();status('Requesting VR…');
  try{xr=await enterXR(renderer,()=>project,()=>time,([x,z])=>{const p=structuredClone(project);p.actors[actor].x=Math.round(x*10)/10;p.actors[actor].z=Math.round(z*10)/10;apply(p);},()=>{xr=null;status(graphicsLost?'Graphics context lost. Save a backup and reload.':'Left VR.');refresh();});status('VR active. Select the floor marker to place the chosen performer.');}catch(e){status(e.message);}finally{xrPending=false;refresh();}
};
function loop(now){
  frame=requestAnimationFrame(loop);if(xr||xrPending||exporting||graphicsLost)return;
  if(playing){time=Math.min(totalDuration(project),(now-start)/1000);if(time>=totalDuration(project))stop();}
  renderer.draw(project,time,shotAt(project,time).shot);$('time').textContent=`${time.toFixed(2)} / ${totalDuration(project).toFixed(2)}s`;$('scrub').value=time;
  $('shotLabel').textContent=`CAMERA ${String(shotAt(project,time).index+1).padStart(2,'0')} · ${shotAt(project,time).shot.name}`;
}
window.addEventListener('pagehide',()=>{abort?.abort();stop();cancelAnimationFrame(frame);xr?.end();});
window.addEventListener('pageshow',()=>{stop();cancelAnimationFrame(frame);frame=requestAnimationFrame(loop);});
$('stage').addEventListener('webglcontextlost',e=>{e.preventDefault();graphicsLost=true;stop();abort?.abort();xr?.end();refresh();status('The graphics context was lost. Save your project backup, then reload.');});
refresh();if($('status').textContent==='Starting the stage…')status('Ready. Rehearse the starter film or arrange your own scene.');frame=requestAnimationFrame(loop);
