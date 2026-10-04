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
export function saveSettings(store:Store,value:Settings):void {store.setItem(SETTINGS_KEY,JSON.stringify(validateSettings(value)));}
