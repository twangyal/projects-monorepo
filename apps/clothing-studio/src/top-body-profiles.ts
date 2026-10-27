import {validateBodyChest,validateBodyHeight,validateTopBodyShape} from './garment-drape.ts';
export const PROFILE_KEY='clothing-studio:top-body-profiles:v1';
export const PROFILE_BYTES=65536;
/** `height` is optional; bodies saved before it existed have none. */
export interface ProfileBody {chest:number;waist:number|null;hip:number|null;chestDepth:number|null;height?:number|null}
export interface BodyProfile {name:string;body:ProfileBody}
export interface BodyProfiles {schema:1;kind:'clothing-top-body-profiles';profiles:BodyProfile[]}
type Store=Pick<Storage,'getItem'|'setItem'>;
function record(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw new Error('Invalid body profile format.');
 return value as Record<string,unknown>;
}
export function validateProfileBody(value:unknown):ProfileBody{
 const keys=['chest','waist','hip','chestDepth',...(value&&typeof value==='object'&&Object.hasOwn(value,'height')?['height']:[])];
 const b=record(value,keys),chest=validateBodyChest(b.chest);
 for(const key of ['waist','hip','chestDepth'])if(b[key]!==null&&(typeof b[key]!=='number'||!Number.isFinite(b[key])))throw new Error('Use finite body dimensions, or null for proportional dimensions.');
  const height=b.height===undefined||b.height===null?b.height:validateBodyHeight(b.height);
  const body={chest,waist:b.waist as number|null,hip:b.hip as number|null,chestDepth:b.chestDepth as number|null,...(height===undefined?{}:{height:height as number|null})};
  validateTopBodyShape(chest,{waist:body.waist??undefined,hip:body.hip??undefined,chestDepth:body.chestDepth??undefined});
 return body;
}
export function validateBodyProfiles(value:unknown):BodyProfiles{
 const root=record(value,['schema','kind','profiles']);
 if(root.schema!==1||root.kind!=='clothing-top-body-profiles'||!Array.isArray(root.profiles)||root.profiles.length>20)throw new Error('Use a version 1 body profile backup with at most 20 profiles.');
 const names=new Set<string>();
 const profiles=root.profiles.map(raw=>{
  const item=record(raw,['name','body']);
  if(typeof item.name!=='string'||!item.name.trim()||item.name.trim().length>60||[...item.name].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))throw new Error('Profile names must contain 1–60 printable characters.');
  const name=item.name.trim(),key=name.toLowerCase();if(names.has(key))throw new Error('Body profile names must be unique.');names.add(key);
  const body=validateProfileBody(item.body);
  return{name,body};
 });
 return{schema:1,kind:'clothing-top-body-profiles',profiles};
}
export const emptyBodyProfiles=():BodyProfiles=>({schema:1,kind:'clothing-top-body-profiles',profiles:[]});
export function readBodyProfiles(storage:Store):BodyProfiles{
 const text=storage.getItem(PROFILE_KEY);if(text===null)return emptyBodyProfiles();
 if(new TextEncoder().encode(text).length>PROFILE_BYTES)throw new Error('Body profile storage exceeds 64 KiB.');
 return validateBodyProfiles(JSON.parse(text));
}
export function writeBodyProfiles(storage:Store,value:BodyProfiles):BodyProfiles{
 const next=validateBodyProfiles(value),text=JSON.stringify(next);
 if(new TextEncoder().encode(text).length>PROFILE_BYTES)throw new Error('Body profile backup exceeds 64 KiB.');
 storage.setItem(PROFILE_KEY,text);return next;
}
export function mergeBodyProfiles(current:BodyProfiles,incoming:BodyProfiles):BodyProfiles{
 const next=validateBodyProfiles(current),addition=validateBodyProfiles(incoming);
 for(const profile of addition.profiles){
  const existing=next.profiles.find(p=>p.name.toLowerCase()===profile.name.toLowerCase());
  if(existing){if(JSON.stringify(existing.body)!==JSON.stringify(profile.body))throw new Error(`Profile name conflict: ${profile.name}. Rename a profile before importing.`);continue;}
  next.profiles.push(profile);
 }
 return validateBodyProfiles(next);
}
