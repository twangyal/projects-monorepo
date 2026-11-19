import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/web/controller.js';
function fixture() {
  const field = {name:'Message',type:'text',isConnected:true,value:'Draft',writable:true,focused:true,isContentEditable:false};
  let callback=()=>{};
  const actions={readValue:e=>e.value,writeValue:(e,value)=>{const before=e.value;e.value=value;callback(e,value,before);},canWrite:e=>e.writable,ownsFocus:e=>e.focused,isSensitive:e=>Boolean(e.sensitive),selectText:()=>({ok:true,message:'Ready'})};
  const context={elements:[{id:1,element:field,name:'Message',role:'textbox',editable:true,distance:0,consequential:false}],focusedId:1};
  const controller=createController({window:{},actions});
  return {field,controller,context,afterWrite:fn=>{callback=fn;},say:text=>controller.handle(text,context)};
}
test('an edit rejected by a website does not add a duplicate Undo step',()=>{
  const f=fixture();f.say('type hello');f.afterWrite((e,_v,before)=>{e.value=before;});
  const denied=f.say('type lost');assert.equal(denied.tone,'error');assert.equal(denied.performed,null);assert.equal(f.field.value,'Draft hello');
  f.afterWrite(()=>{});assert.equal(f.say('undo typing').tone,'success');assert.equal(f.field.value,'Draft');assert.match(f.say('undo typing').message,/Nothing to undo/);
});
test('a rejected Undo keeps its entry for a deliberate later retry',()=>{
  const f=fixture();f.say('type hello');f.afterWrite((e,_v,before)=>{e.value=before;});
  assert.equal(f.say('undo typing').tone,'error');assert.equal(f.field.value,'Draft hello');
  f.afterWrite(()=>{});assert.equal(f.say('undo typing').tone,'success');assert.equal(f.field.value,'Draft');assert.match(f.say('undo typing').message,/Nothing to undo/);
});
for(const effect of ['rewrite','lock','detach','redirect'])test(`an input-time ${effect} refuses success without echoing text`,()=>{
  const f=fixture();f.afterWrite(e=>{if(effect==='rewrite')e.value='Private website update';if(effect==='lock')e.writable=false;if(effect==='detach')e.isConnected=false;if(effect==='redirect')e.focused=false;});
  const result=f.say('type private words');assert.equal(result.tone,'error');assert.equal(result.performed,null);assert.doesNotMatch(result.message,/private words|Private website update|Draft/);
});
for(const command of ['cancel','pause'])test(`${command} during a write does not announce stale success and leaves actual text undoable`,()=>{
  const f=fixture();f.afterWrite(()=>{f.afterWrite(()=>{});f.say(command);});
  const result=f.say('type hello');assert.equal(result.tone,'error');assert.equal(result.performed,null);assert.equal(f.field.value,'Draft hello');
  if(command==='pause')f.say('resume');assert.equal(f.say('undo typing').tone,'success');assert.equal(f.field.value,'Draft');
});
test('a nested newer edit keeps its own history and is not rolled back by the outer result',()=>{
  const f=fixture();f.afterWrite(()=>{f.afterWrite(()=>{});f.say('type inner');});
  assert.equal(f.say('type outer').tone,'error');assert.equal(f.field.value,'Draft outer inner');
  f.say('undo typing');assert.equal(f.field.value,'Draft outer');f.say('undo typing');assert.equal(f.field.value,'Draft');
});
test('an Undo from an input handler is not restored by a stale outer edit',()=>{
  const f=fixture();f.afterWrite(()=>{f.afterWrite(()=>{});f.say('undo typing');});
  assert.equal(f.say('type hello').tone,'error');assert.equal(f.field.value,'Draft');assert.match(f.say('undo typing').message,/Nothing to undo/);
});
test('a rejected continuous dictation phrase stops dictation and keeps prior phrase Undo useful',()=>{
  const f=fixture();f.controller=createController({window:{},actions:{readValue:e=>e.value,writeValue:(e,value)=>{if(!e.reject)e.value=value;},canWrite:e=>e.writable,ownsFocus:e=>e.focused,isSensitive:()=>false,selectText:()=>({ok:true,message:'Ready'})}});
  const say=text=>f.controller.handle(text,f.context);
  assert.equal(say('start dictation into Message').tone,'success');say('hello');f.field.reject=true;
  const refused=say('lost phrase');assert.equal(refused.tone,'error');assert.equal(f.controller.dictation,null);assert.equal(f.field.value,'Draft hello');
  f.field.reject=false;say('undo typing');assert.equal(f.field.value,'Draft');
});
for(const effect of ['password','otp','rich mode'])test(`review: input-time ${effect} change stops dictation without exposing words`,()=>{
 const f=fixture();if(effect==='rich mode')f.field.isContentEditable=true;
 f.say('start dictation into Message');f.afterWrite(e=>{if(effect==='password')e.type='password';if(effect==='otp')e.sensitive=true;if(effect==='rich mode')e.isContentEditable=false;});
 const result=f.say('private phrase');assert.equal(result.tone,'error');assert.equal(f.controller.dictation,null);assert.doesNotMatch(result.message,/private phrase|Draft/);
});
for(const effect of ['lock','redirect'])test(`review: Undo followed by ${effect} keeps its own entry for a no-op retry, not an earlier edit`,()=>{
 const f=fixture();f.say('type one');f.say('type two');f.afterWrite(e=>{if(effect==='lock')e.writable=false;else e.focused=false;});
 assert.equal(f.say('undo typing').tone,'error');assert.equal(f.field.value,'Draft one');f.field.writable=true;f.field.focused=true;f.afterWrite(()=>{});
 assert.equal(f.say('undo typing').tone,'success');assert.equal(f.field.value,'Draft one');f.say('undo typing');assert.equal(f.field.value,'Draft');
});
for(const child of ['rejected','successful'])test(`review: a rejected outer edit and ${child} inner edit leave no phantom Undo`,()=>{
 const f=fixture();f.say('type hello');f.afterWrite((e,_value,before)=>{e.value=before;f.afterWrite(child==='rejected'?(e,_v,b)=>{e.value=b;}:()=>{});f.say('type inner');});
 assert.equal(f.say('type outer').tone,'error');f.afterWrite(()=>{});
 if(child==='successful'){assert.equal(f.field.value,'Draft hello inner');f.say('undo typing');assert.equal(f.field.value,'Draft hello');}
 f.say('undo typing');assert.equal(f.field.value,'Draft');assert.match(f.say('undo typing').message,/Nothing to undo/);
});
test('review: rejected nested edits preserve all history at its capacity',()=>{
 const f=fixture();for(let i=0;i<25;i++)f.say(`type w${i}`);
 f.afterWrite((e,_v,before)=>{e.value=before;f.afterWrite((e,_v,before)=>{e.value=before;});f.say('type inner');});f.say('type outer');f.afterWrite(()=>{});
 for(let i=0;i<20;i++)f.say('undo typing');assert.equal(f.field.value,'Draft w0 w1 w2 w3 w4');assert.match(f.say('undo typing').message,/Nothing to undo/);
});
for(const sensitive of [false,true])test(`review: an alternative text instruction respects ${sensitive?'sensitive':'refused'} reply redaction`,()=>{
 const f=fixture();if(sensitive){f.field.type='password';f.field.sensitive=true;}else f.afterWrite((e,_v,before)=>{e.value=before;});
 const result=f.controller.handle('xxxxzq',f.context,{alternatives:['type private words']});
 assert.equal(result.tone,sensitive?'success':'error');assert.doesNotMatch(result.message,/private words|Heard/);if(sensitive)assert.match(result.message,/hidden/);
});
test('review: a newer dictation session survives an obsolete phrase result',()=>{
 const f=fixture();f.say('start dictation into Message');f.afterWrite(()=>{f.afterWrite(()=>{});f.say('stop dictation');f.say('start dictation into Message');});
 assert.equal(f.say('first phrase').tone,'error');assert.ok(f.controller.dictation);f.say('next phrase');assert.equal(f.field.value,'Draft first phrase next phrase');
});
