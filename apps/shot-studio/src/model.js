export const MAX_BYTES=65536;
export const ACTIONS=['idle','wave','walk'];
export function createProject(){return {
  schemaVersion:1,title:'The arrival',light:1,
  actors:[{name:'Mika',x:-1.2,z:0,color:'#db825c',action:'wave'},
    {name:'Noor',x:1.2,z:-1,color:'#6cb1ba',action:'walk'}],
  shots:[{name:'Establishing',duration:4,eye:[5,3,7],target:[0,1,0],fov:45},
    {name:'Two-shot',duration:4,eye:[0,1.8,5],target:[0,1,0],fov:40}],
};}
const finite=(n,lo,hi)=>typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi;
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const vector=(v)=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,-15,15));
export function validateProject(p){
  if(!p||p.schemaVersion!==1||!text(p.title,80)||!finite(p.light,.2,2)
    ||!Array.isArray(p.actors)||p.actors.length!==2
    ||!Array.isArray(p.shots)||p.shots.length<1||p.shots.length>20) throw Error('Invalid project format or limits.');
  const actors=p.actors.map(a=>{
    if(!a||!text(a.name,30)||!finite(a.x,-4,4)||!finite(a.z,-4,4)
      ||!/^#[0-9a-fA-F]{6}$/.test(a.color)||!ACTIONS.includes(a.action)) throw Error('Invalid performer settings.');
    return {name:a.name,x:a.x,z:a.z,color:a.color,action:a.action};
  });
  const shots=p.shots.map(s=>{
    if(!s||!text(s.name,40)||!finite(s.duration,1,15)||!finite(s.fov,25,80)
      ||!vector(s.eye)||!vector(s.target)||s.eye[1]<.3||s.target[1]<.3
      ||Math.hypot(...s.eye.map((v,i)=>v-s.target[i]))<.3
      ||Math.hypot(s.eye[0]-s.target[0],s.eye[2]-s.target[2])<.1) throw Error('Invalid camera or shot settings.');
    return {name:s.name,duration:s.duration,eye:[...s.eye],target:[...s.target],fov:s.fov};
  });
  if(shots.reduce((s,x)=>s+x.duration,0)>60) throw Error('Films are limited to 60 seconds.');
  return {schemaVersion:1,title:p.title,light:p.light,actors,shots};
}
export function importProject(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES) throw Error('Project backup exceeds 64 KiB.');
  try{return validateProject(JSON.parse(text));}catch{throw Error('Invalid project backup. Check version, camera and limits.');}
}
export function cameraFromPose(matrix){
  if(!matrix||matrix.length!==16||!Array.from(matrix).every(Number.isFinite))throw Error('Headset tracking is unavailable.');
  const eye=[matrix[12],matrix[13],matrix[14]],direction=[-matrix[8],-matrix[9],-matrix[10]],length=Math.hypot(...direction);
  if(length<.001)throw Error('Invalid headset camera direction.');
  const target=eye.map((v,i)=>v+3*direction[i]/length),p=createProject();
  Object.assign(p.shots[0],{eye,target});
  try{const shot=validateProject(p).shots[0];return {eye:shot.eye,target:shot.target};}
  catch{throw Error('Headset camera exceeds the scene limits. Stay above the floor, within the set bounds, and look away from straight up/down.');}
}
export const totalDuration=p=>p.shots.reduce((sum,s)=>sum+s.duration,0);
export function shotAt(p,time){
  let local=Math.max(0,Math.min(totalDuration(p),time));
  for(let index=0;index<p.shots.length;index++){
    const shot=p.shots[index];
    if(local<shot.duration||index===p.shots.length-1)return {shot,index,local};
    local-=shot.duration;
  }
}
export function actorPose(a,time){
  return {x:a.x+(a.action==='walk'?.7*Math.sin(time):0),z:a.z,
    arm:a.action==='wave'?.8+.5*Math.sin(time*6):a.action==='walk'?.5*Math.sin(time*5):0,
    leg:a.action==='walk'?.35*Math.sin(time*5):0};
}
