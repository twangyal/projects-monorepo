import test from 'node:test';import assert from 'node:assert/strict';import * as settings from '../src/settings.ts';
test('settings validate exact bounded state and retain failed raw records',()=>{
  assert.equal(typeof settings.loadSettings,'function');
  let raw:string|null=null;let writes=0;const store={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;writes++;},removeItem:()=>{raw=null;}};
  const loaded=settings.loadSettings(store);assert.equal(loaded.error,false);assert.equal(loaded.value.baseline,70);
  settings.saveSettings(store,{...loaded.value,bestSeconds:12.5});assert.equal(settings.loadSettings(store).value.bestSeconds,12.5);
  raw='{broken';const corrupted=settings.loadSettings(store);assert.equal(corrupted.error,true);assert.equal(raw,'{broken');assert.equal(writes,1);
  for(const patch of [{baseline:0},{bestSeconds:-1},{scares:'yes'},{extra:1},{schemaVersion:2}])assert.throws(()=>settings.saveSettings(store,{...loaded.value,...patch} as never));
  raw=JSON.stringify(loaded.value);const intact=raw,quota=Error('quota');
  assert.throws(()=>settings.saveSettings({...store,setItem:()=>{throw quota;}},loaded.value),error=>error===quota);assert.equal(raw,intact);
});

test('an old preference snapshot cannot erase a newer completed best time',()=>{
 let raw:string|null=JSON.stringify({...settings.defaults(),bestSeconds:12});
 const store={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;},removeItem:()=>{raw=null;}};
 const saved=settings.saveSettings(store,{...settings.defaults(),baseline:80,bestSeconds:null});
 assert.equal(JSON.parse(raw!).bestSeconds,12);assert.equal(JSON.parse(raw!).baseline,80);assert.equal(saved.bestSeconds,12);
});
test('automatic best updates keep the latest comfort preferences and the faster completed result',()=>{
 let raw:string|null=JSON.stringify({...settings.defaults(),baseline:90,muted:false,reducedMotion:true,bestSeconds:20}),writes=0;
 const store={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;writes++;},removeItem:()=>{raw=null;}};
 const record=settings.recordBestTime(store,12);
 assert.deepEqual(record,{schemaVersion:1,baseline:90,scares:true,reducedMotion:true,muted:false,bestSeconds:12});assert.equal(writes,1);
 settings.recordBestTime(store,30);assert.equal(writes,1);assert.equal(JSON.parse(raw!).bestSeconds,12);
});
test('corruption after initial load refuses both manual and automatic writes without changing raw bytes',()=>{
 let raw:string|null=JSON.stringify(settings.defaults());const store={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;},removeItem:()=>{raw=null;}};
 const loaded=settings.loadSettings(store);raw='{original unreadable';
 assert.throws(()=>settings.saveSettings(store,loaded.value),settings.UnreadableSettingsError);assert.equal(raw,'{original unreadable');
 assert.throws(()=>settings.recordBestTime(store,12),settings.UnreadableSettingsError);assert.equal(raw,'{original unreadable');
});
test('explicit unreadable reset refuses a repaired record and removes only still-unreadable data',()=>{
 let raw:string|null=JSON.stringify({...settings.defaults(),bestSeconds:12});const original=raw;
 const store={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;},removeItem:()=>{raw=null;}};
 assert.throws(()=>settings.resetUnreadableSettings(store));assert.equal(raw,original);
 raw='{broken';settings.resetUnreadableSettings(store);assert.equal(raw,null);
});
test('best-time updates require an actual bounded numeric result before reading or writing storage',()=>{
 let touches=0;const store={getItem:()=>{touches++;return null;},setItem:()=>{touches++;},removeItem:()=>{touches++;}};
 for(const value of [null,'12',NaN,Infinity,-1,181])assert.throws(()=>settings.recordBestTime(store,value as never));assert.equal(touches,0);
});
