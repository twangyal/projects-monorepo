import {validateProjectImages} from './project-media.ts';
import {MAX_PROJECT_BYTES,validateProject,serializeProject,parseProject,type Project} from './model.ts';
export interface DesignReceipt {id:string;name:string;savedAt:string;bytes:number}
export function validateDesignName(value:unknown):string {
 if(typeof value!=='string'||!value.trim()||value.trim().length>80||[...value].some(c=>{const n=c.codePointAt(0)!;return n<32||n>=127&&n<=159||n>=0xd800&&n<=0xdfff;}))throw new Error('Use1–80 printable characters for the saved design name.');
 return value.trim();
}
export function validateDesignReceipt(value:unknown):DesignReceipt {
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).sort().join()!=='bytes,id,name,savedAt')throw new Error('Invalid saved design metadata.');
 for(const key of Object.keys(value))if(!('value' in Object.getOwnPropertyDescriptor(value,key)!))throw new Error('Invalid saved design metadata.');
 const r=value as DesignReceipt;
 if(typeof r.id!=='string'||!/^[-0-9a-f]{36}$/.test(r.id)||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/.test(r.id)||validateDesignName(r.name)!==r.name||typeof r.savedAt!=='string'||new Date(r.savedAt).toISOString()!==r.savedAt||!Number.isInteger(r.bytes)||r.bytes<1||r.bytes>MAX_PROJECT_BYTES)throw new Error('Invalid saved design metadata.');
 return{id:r.id,name:r.name,savedAt:r.savedAt,bytes:r.bytes};
}
const DB='clothing-studio-designs',META='metadata',PAYLOAD='payloads',CAP=12,DEADLINE=10_000;
const unavailable=()=>new Error('Saved design storage is unavailable. Keep the current concept open and export a JSON backup, then retry.');
function openLibrary():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(unavailable());return;}
  let settled=false;
  const request=indexedDB.open(DB,1);
  const fail=(error:Error)=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);};
  const timer=setTimeout(()=>fail(new Error('Opening saved designs timed out. Close other Clothing Studio tabs and retry.')),DEADLINE);
  request.onupgradeneeded=()=>{try{for(const name of [META,PAYLOAD])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);}catch{request.transaction?.abort();}};
  request.onerror=()=>fail(unavailable());
  request.onblocked=()=>fail(new Error('Saved designs are blocked by another tab. Close other Clothing Studio tabs and retry.'));
  request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;clearTimeout(timer);request.result.onversionchange=()=>request.result.close();resolve(request.result);};
 });
}
async function transaction<T>(mode:IDBTransactionMode,work:(tx:IDBTransaction,done:(value:T)=>void,fail:(error:unknown)=>void)=>void):Promise<T>{
 const db=await openLibrary();
 return new Promise((resolve,reject)=>{
  let tx:IDBTransaction;try{tx=db.transaction([META,PAYLOAD],mode);}catch{db.close();reject(unavailable());return;}
  let failure:Error|undefined,result:T;
  const fail=(error:unknown)=>{failure??=error instanceof Error?error:unavailable();try{tx.abort();}catch{/* Native terminal callback owns the outcome. */}};
  const timer=setTimeout(()=>{try{tx.abort();failure??=new Error('Saved design storage timed out. Current work and previous copies are kept; retry.');}catch{/* An actual commit may already have won. */}},DEADLINE);
  const finish=()=>{clearTimeout(timer);db.close();};
  tx.oncomplete=()=>{finish();if(failure)reject(failure);else resolve(result);};
  tx.onabort=()=>{finish();reject(failure??unavailable());};
  tx.onerror=()=>{failure??=unavailable();};
  try{work(tx,value=>{result=value;},fail);}catch(error){fail(error);}
 });
}
function metadata(tx:IDBTransaction,accept:(rows:DesignReceipt[])=>void,fail:(error:unknown)=>void):void{
 const store=tx.objectStore(META),count=store.count();
 count.onsuccess=()=>{try{
  if(count.result>CAP)throw new Error('Saved design library exceeds12 copies. No data was changed.');
  const request=store.getAll();request.onsuccess=()=>{try{accept(request.result.map(validateDesignReceipt));}catch(error){fail(error);}};
 }catch(error){fail(error);}};
}
function matching(raw:unknown,receipt:DesignReceipt):DesignReceipt{
 const stored=validateDesignReceipt(raw);
 if(JSON.stringify(stored)!==JSON.stringify(receipt))throw new Error('The selected saved design changed. Refresh the library and select it again.');
 return stored;
}
export async function listDesigns():Promise<DesignReceipt[]>{
 return transaction('readonly',(tx,done,fail)=>metadata(tx,rows=>done(rows.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id))),fail));
}
export async function saveDesign(name:string,project:Project):Promise<DesignReceipt>{
 const safeName=validateDesignName(name),safe=validateProject(project),json=serializeProject(safe);
 const receipt=validateDesignReceipt({id:crypto.randomUUID(),name:safeName,savedAt:new Date().toISOString(),bytes:new TextEncoder().encode(json).length});
 await validateProjectImages(safe);
 return transaction('readwrite',(tx,done,fail)=>metadata(tx,rows=>{
  if(rows.length>=CAP)throw new Error('The library holds12 saved designs. Download and delete a copy before saving another.');
  if(rows.some(row=>row.name.toLowerCase()===safeName.toLowerCase()))throw new Error('That saved design name already exists. Choose a new version name.');
  tx.objectStore(META).add(receipt,receipt.id);tx.objectStore(PAYLOAD).add(json,receipt.id);done(receipt);
 },fail));
}
export async function readDesign(receipt:DesignReceipt):Promise<Project>{
 const safe=validateDesignReceipt(receipt);
 const json=await transaction<string>('readonly',(tx,done,fail)=>{
  const meta=tx.objectStore(META).get(safe.id),payload=tx.objectStore(PAYLOAD).get(safe.id);
  payload.onsuccess=()=>{try{matching(meta.result,safe);if(typeof payload.result!=='string'||new TextEncoder().encode(payload.result).length!==safe.bytes)throw new Error('Saved design data is missing or damaged. Current work is kept.');done(payload.result);}catch(error){fail(error);}};
 });
 const project=parseProject(json);await validateProjectImages(project);return project;
}
export async function deleteDesign(receipt:DesignReceipt):Promise<void>{
 const safe=validateDesignReceipt(receipt);
 await transaction<void>('readwrite',(tx,done,fail)=>{
  const request=tx.objectStore(META).get(safe.id);
  request.onsuccess=()=>{try{matching(request.result,safe);tx.objectStore(META).delete(safe.id);tx.objectStore(PAYLOAD).delete(safe.id);done(undefined);}catch(error){fail(error);}};
 });
}
