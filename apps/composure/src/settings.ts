export interface Settings {schemaVersion:1;baseline:number;scares:boolean;reducedMotion:boolean;muted:boolean;bestSeconds:number|null}
export interface Store {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export const SETTINGS_KEY='composure-settings-v1';
export const defaults=():Settings=>({schemaVersion:1,baseline:70,scares:true,reducedMotion:false,muted:true,bestSeconds:null});
export function validateSettings(value:unknown):Settings {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid preferences.');const r=value as Record<string,unknown>;
  const keys=['schemaVersion','baseline','scares','reducedMotion','muted','bestSeconds'];
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))||r.schemaVersion!==1||typeof r.baseline!=='number'||!Number.isFinite(r.baseline)||r.baseline<40||r.baseline>120||['scares','reducedMotion','muted'].some(k=>typeof r[k]!=='boolean')||r.bestSeconds!==null&&(typeof r.bestSeconds!=='number'||!Number.isFinite(r.bestSeconds)||r.bestSeconds<0||r.bestSeconds>180))throw Error('Invalid preferences.');
  return {...r} as unknown as Settings;
}
export function loadSettings(store:Store):{value:Settings;error:boolean} {try{const raw=store.getItem(SETTINGS_KEY);if(raw===null)return{value:defaults(),error:false};if(raw.length>1024)throw Error('Bound');return{value:validateSettings(JSON.parse(raw)),error:false};}catch{return{value:defaults(),error:true};}}
export function saveSettings(store:Store,value:Settings):Settings {const next=validateSettings(value),current=currentSettings(store);next.bestSeconds=faster(current.bestSeconds,next.bestSeconds);store.setItem(SETTINGS_KEY,JSON.stringify(next));return next;}

export class UnreadableSettingsError extends Error {}
function currentSettings(store:Store):Settings {
  try{const raw=store.getItem(SETTINGS_KEY);if(raw===null)return defaults();if(raw.length>1024)throw Error('Bound');return validateSettings(JSON.parse(raw));}
  catch{throw new UnreadableSettingsError('Saved preferences are unreadable. Their raw record was kept.');}
}
function faster(a:number|null,b:number|null):number|null {return a===null?b:b===null?a:Math.min(a,b);}
export function retainInMemoryBest(saved:Settings,bestSeconds:number|null):Settings {return {...saved,bestSeconds:faster(saved.bestSeconds,bestSeconds)};}
// The browser caller holds the origin-wide write lock through this synchronous
// read/merge/write section. Preserve the newest observed best on manual saves.
export function recordBestTime(store:Store,seconds:number):Settings {
  if(typeof seconds!=='number')throw Error('Use a bounded numeric completion time.');
  validateSettings({...defaults(),bestSeconds:seconds});
  const current=currentSettings(store),bestSeconds=faster(current.bestSeconds,seconds);
  if(bestSeconds===current.bestSeconds)return current;
  const next={...current,bestSeconds};store.setItem(SETTINGS_KEY,JSON.stringify(next));return next;
}
export function resetUnreadableSettings(store:Store):void {
  const raw=store.getItem(SETTINGS_KEY);if(raw===null)return;
  let readable=false;try{if(raw.length<=1024){validateSettings(JSON.parse(raw));readable=true;}}catch{/* Preserve until this explicit reset. */}
  if(readable)throw Error('Saved preferences changed and are now readable. Reload to use them; no record was reset.');
  store.removeItem(SETTINGS_KEY);
}
export async function withSettingsLock<T extends Settings|void>(locks:LockManager|undefined,update:()=>T):Promise<T> {
  if(!locks)throw Error('Coordinated preference saving is unavailable. Use a supported browser on localhost or HTTPS.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{return await locks.request(SETTINGS_KEY,{mode:'exclusive',signal:controller.signal},()=>update());}
  catch(error){if(controller.signal.aborted)throw Error('Preference saving waited too long. Try again; the saved record was kept.');throw error;}
  finally{clearTimeout(timer);}
}
