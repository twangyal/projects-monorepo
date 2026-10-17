import test from 'node:test';import assert from 'node:assert/strict';
import {validateBodyProfiles,mergeBodyProfiles,readBodyProfiles,writeBodyProfiles,PROFILE_KEY} from '../src/top-body-profiles.ts';
const profile={name:'My measurements',body:{chest:94,waist:null,hip:110,chestDepth:20}};
const envelope=<T>(profiles:T[])=>({schema:1,kind:'clothing-top-body-profiles',profiles});
test('profile backup roundtrip preserves explicit and proportional dimensions without aliasing',()=>{
 const source=envelope([profile]),result=validateBodyProfiles(JSON.parse(JSON.stringify(source)));assert.deepEqual(result,source);
 result.profiles[0]!.body.chest=100;assert.equal(source.profiles[0]!.body.chest,94);
});
test('profile admission refuses impossible geometry, unknown fields and duplicate names',()=>{
 for(const body of [{...profile.body,chest:'94'},{...profile.body,chest:NaN},{...profile.body,chest:70,chestDepth:30},{...profile.body,waist:49},{...profile.body,hip:221},{...profile.body,avatar:'hidden'}])assert.throws(()=>validateBodyProfiles(envelope([{...profile,body}])));
 for(const name of ['', 'x'.repeat(61),'a\nb'])assert.throws(()=>validateBodyProfiles(envelope([{...profile,name}])));
 assert.throws(()=>validateBodyProfiles(envelope([profile,{...profile,name:'MY MEASUREMENTS'}])));
 assert.throws(()=>validateBodyProfiles({...envelope([profile]),privateData:true}));assert.throws(()=>validateBodyProfiles({...envelope([profile]),schema:2}));
});
test('import merge appends fresh names, skips identical profiles and refuses conflicts atomically',()=>{
 const a=validateBodyProfiles(envelope([profile])),b=validateBodyProfiles(envelope([{...profile,name:'Other'}]));
 assert.equal(mergeBodyProfiles(a,b).profiles.length,2);assert.deepEqual(mergeBodyProfiles(a,a),a);
 assert.throws(()=>mergeBodyProfiles(a,validateBodyProfiles(envelope([{...profile,body:{...profile.body,chest:100}}]))),/conflict/i);assert.equal(a.profiles[0]!.body.chest,94);
 const full=validateBodyProfiles(envelope(Array.from({length:20},(_,i)=>({...profile,name:`Person ${i}`}))));assert.throws(()=>mergeBodyProfiles(full,a),/20/);
});
test('storage persists canonical profiles and write failure leaves the previous complete library',()=>{
 const data=new Map<string,string>();let refuse=false;const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{if(refuse)throw new Error('quota');data.set(key,value);}};
 assert.equal(readBodyProfiles(storage).profiles.length,0);const a=validateBodyProfiles(envelope([profile]));writeBodyProfiles(storage,a);assert.deepEqual(readBodyProfiles(storage),a);
 const before=data.get(PROFILE_KEY);refuse=true;assert.throws(()=>writeBodyProfiles(storage,validateBodyProfiles(envelope([]))),/quota/);assert.equal(data.get(PROFILE_KEY),before);
});
test('corrupt or oversized stored libraries are refused without repair writes',()=>{
 for(const text of ['{bad','x'.repeat(65537),JSON.stringify(envelope([{...profile,body:{chest:10}}]))]){
  let writes=0;assert.throws(()=>readBodyProfiles({getItem:()=>text,setItem:()=>{writes++;}}));assert.equal(writes,0);
 }
});
