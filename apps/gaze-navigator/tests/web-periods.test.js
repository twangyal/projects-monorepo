import {createAssistedInterpreter} from '../src/web/assisted-interpreter.js';
import test from 'node:test';import assert from 'node:assert/strict';import {interpret} from '../src/web/interpreter.js';
for(const[kind,flag,good,bad]of[
 ['month','nativeMonth',['0001-01','2026-11','9999-12'],['2026-1','2026-00','2026-13','November 2026','2026-11-01']],
 ['week','nativeWeek',['0001-W01','2026-W43','9999-W53'],['2026-W1','2026-W00','2026-W54','2026-w43','week 43','2026-11-01']]
]){const field=(id,name='Reporting')=>({id,name,role:'textbox',[flag]:true,distance:0});
 test(`${kind} literal set preserves exact digits and kind`,()=>{for(const value of good)assert.deepEqual(interpret(`set Reporting ${kind} field to ${value}`,{elements:[field(1)]}),{type:kind,targetId:1,value});});
 test(`${kind} deictic set and Undo keep target identity`,()=>{for(const name of['','this ','That ']){assert.deepEqual(interpret(`set ${name}${kind} field to ${good[1]}`,{elements:[field(1)]}),{type:kind,targetId:1,value:good[1]});assert.deepEqual(interpret(`undo ${name}${kind} field`,{elements:[field(1)]}),{type:kind,targetId:1,undo:true});}});
 test(`${kind} malformed literals and different input kinds refuse`,()=>{for(const value of bad)assert.equal(interpret(`set ${kind} field to ${value}`,{elements:[field(1)]}).type,'unknown');assert.equal(interpret(`set ${kind} field to ${good[1]}`,{elements:[{id:1,name:'Reporting',role:'textbox',nativeDate:true}]}).type,'unknown');});
 test(`${kind} explicit intent cannot escape into text activation or assistant`,()=>{const context={elements:[{id:1,name:`Reporting ${kind}`,role:'textbox',editable:true},{id:3,name:`undo Reporting ${kind} field`,role:'button'},field(2)]};const assistant=createAssistedInterpreter({model:{}});
 for(const text of[`set Reporting ${kind}  field to ${good[1]}`,`set Reporting ${kind} field  to ${good[1]}`])assert.deepEqual(interpret(text,context),{type:kind,targetId:2,value:good[1]});
 assert.deepEqual(interpret(`undo Reporting ${kind} field.`,context),{type:kind,targetId:2,undo:true});
 for(const text of[`set ${kind} field to`,`set Reporting ${kind} field`,`set Reporting ${kind} field to invalid`,`undo Reporting ${kind} field to invalid`]){const action=interpret(text,context);assert.equal(action.type,'unknown');assert.equal(assistant.needs(text,context,action),false);}
 });
 test(`${kind} ambiguity retains exact value through choice`,()=>{const r=interpret(`set Reporting ${kind} field to ${good[1]}`,{elements:[field(1),field(2)]});assert.equal(r.type,'clarify');assert.deepEqual(r.choose(2),{type:kind,targetId:2,value:good[1]});});
}
test('period words in ordinary replacement payload remain literal text',()=>{const action=interpret('set Notes field to month field',{elements:[{id:1,name:'Notes',role:'textbox',editable:true}]});assert.deepEqual(action,{type:'edit',targetId:1,edit:{kind:'replace-all',text:'month field'}});});
