import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../src/web/controller.js';
const context={elements:[]};
function fixture(){
 const entry={kind:'given',name:'First name'},calls=[];let controller,fill=()=>({ok:true,filled:[entry],message:'Filled first'}),restore=()=>({ok:true,remaining:[],message:'Restored first'});
 const details={plan:()=>({ok:true,fields:[entry],message:'Confirm fill'}),fill:(plan,options)=>(calls.push(['fill',plan]),fill(plan,options)),restore:(entries,options)=>(calls.push(['restore',entries]),restore(entries,options))};
 controller=createController({window:{},commands:{details}});
 return{entry,calls,controller,say:text=>controller.handle(text,context),fill:fn=>{fill=fn;},restore:fn=>{restore=fn;}};
}
test('a partial fill retains its confirmed entries for Undo',()=>{
 const f=fixture();f.fill(()=>({ok:false,filled:[f.entry],message:'Stopped after first'}));f.say('fill in my details');assert.equal(f.say('confirm').tone,'error');
 assert.equal(f.say('undo').message,'Restored first');assert.deepEqual(f.calls.at(-1),['restore',[f.entry]]);
});
for(const interrupt of ['cancel','pause'])test(`a ${interrupt} during fill invalidates its write guard and prevents stale success`,()=>{
 const f=fixture();let current;f.fill((_plan,options)=>{f.say(interrupt);current=options?.isCurrent?.();return{ok:true,filled:[f.entry],message:'Filled first'};});f.say('fill in my details');assert.equal(f.say('confirm').tone,'error');assert.equal(current,false);
 if(interrupt==='pause')f.say('resume');f.say('undo');assert.equal(f.calls.filter(([type])=>type==='restore').length,0);
});
test('a partial Undo keeps remaining entries and reports failure instead of emptying earlier work',()=>{
 const f=fixture();let count=0;f.restore(()=>++count===1?{ok:false,remaining:[f.entry],message:'Kept changed first'}:{ok:true,remaining:[],message:'Retried first'});
 f.say('fill in my details');f.say('confirm');assert.equal(f.say('undo').tone,'error');assert.equal(f.say('undo').message,'Retried first');
});
test('an older fill cannot replace the Undo record of a newer fill',()=>{
 const f=fixture(),newer={kind:'email',name:'Email'};let count=0;
 f.fill(()=>{if(++count===1){f.say('fill in my details');f.say('confirm');return{ok:true,filled:[f.entry],message:'Old fill'};}return{ok:true,filled:[newer],message:'New fill'};});
 f.say('fill in my details');assert.equal(f.say('confirm').tone,'error');f.say('undo');assert.deepEqual(f.calls.at(-1),['restore',[newer]]);
});
test('alternate readings of saved-detail commands never repeat personal values in feedback',()=>{
 const controller=createController({window:{},commands:{details:{remember:()=>({ok:true,message:'Your email address is saved on this device.'})}}});
 const result=controller.handle('xxxxzq',context,{alternatives:['remember my email is jo at example dot com'],spoken:true});
 assert.equal(result.tone,'success');assert.doesNotMatch(result.message,/jo|example|Heard/i);
});
