import test from 'node:test';import assert from 'node:assert/strict';import * as settings from '../src/settings.ts';
test('settings validate exact bounded state and retain failed raw records',()=>{
  assert.equal(typeof settings.loadSettings,'function');
  let raw:string|null=null;let writes=0;const store={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;writes++;},removeItem:()=>{raw=null;}};
  const loaded=settings.loadSettings(store);assert.equal(loaded.error,false);assert.equal(loaded.value.baseline,70);
  settings.saveSettings(store,{...loaded.value,bestSeconds:12.5});assert.equal(settings.loadSettings(store).value.bestSeconds,12.5);
  raw='{broken';const corrupted=settings.loadSettings(store);assert.equal(corrupted.error,true);assert.equal(raw,'{broken');assert.equal(writes,1);
  for(const patch of [{baseline:0},{bestSeconds:-1},{scares:'yes'},{extra:1},{schemaVersion:2}])assert.throws(()=>settings.saveSettings(store,{...loaded.value,...patch} as never));
  assert.throws(()=>settings.saveSettings({...store,setItem:()=>{throw Error('quota');}},loaded.value));
});
