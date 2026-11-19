import {test,expect} from '@playwright/test';
async function setup(page,rich=false){
 await page.goto('/practice-site/contact.html');
 await page.evaluate(async rich=>{
  document.body.innerHTML=rich?'<div id="field" contenteditable="true" role="textbox" aria-label="Message"><b>Draft</b></div><input id="other" value="safe">':'<label>Message<input id="field" value="Draft"></label><input id="other" value="safe">';
  const {createController}=await import('/src/web/controller.js'),{captureContext}=await import('/src/web/page-context.js');
  window.resultController=createController({window});window.resultRich=rich;
  window.sayResult=(text,options)=>{const box=document.querySelector('#field').getBoundingClientRect();return resultController.handle(text,captureContext(document,{x:box.x+box.width/2,y:box.y+box.height/2,radius:20}),options);};
  window.textResult=()=>rich?document.querySelector('#field').textContent.replace(/\u00a0/g,' '):document.querySelector('#field').value;
 },rich);
}
for(const rich of [false,true]){
 test(`${rich?'rich':'native'} rejected edit leaves the preceding successful edit as the next Undo`,async({page})=>{
  await setup(page,rich);const result=await page.evaluate(()=>{
   sayResult('type hello');const field=document.querySelector('#field'),before=field.innerHTML;
   field.addEventListener('input',()=>{if(resultRich)field.innerHTML=before;else field.value='Draft hello';},{once:true});
   const denied=sayResult('type lost'),kept=textResult(),undo=sayResult('undo typing'),after=textResult(),empty=sayResult('undo typing');
   return{denied,kept,undo,after,empty};
  });
  expect(result.denied.tone).toBe('error');expect(result.denied.performed).toBeNull();expect(result.kept).toBe('Draft hello');expect(result.undo.tone).toBe('success');expect(result.after).toBe('Draft');expect(result.empty.message).toContain('Nothing to undo');
 });
 test(`${rich?'rich':'native'} rejected Undo can be retried and keeps rich formatting`,async({page})=>{
  await setup(page,rich);const result=await page.evaluate(()=>{
   sayResult('type hello');const field=document.querySelector('#field'),before=field.innerHTML;
   field.addEventListener('input',()=>{if(resultRich)field.innerHTML=before;else field.value='Draft hello';},{once:true});
   const denied=sayResult('undo typing'),kept=textResult(),undo=sayResult('undo typing');return{denied,kept,undo,after:textResult(),bold:field.querySelector('b')?.textContent};
  });
  expect(result.denied.tone).toBe('error');expect(result.kept).toBe('Draft hello');expect(result.undo.tone).toBe('success');expect(result.after).toBe('Draft');if(rich)expect(result.bold).toBe('Draft');
 });
 for(const effect of ['rewrite','lock','detach','redirect','cancel','pause'])test(`${rich?'rich':'native'} input-time ${effect} does not announce stale success or private text`,async({page})=>{
  await setup(page,rich);const result=await page.evaluate(effect=>{
   const field=document.querySelector('#field'),events=[];field.addEventListener('change',()=>events.push('change'));
   field.addEventListener('input',()=>{if(effect==='rewrite'){if(resultRich)field.textContent='Private site update';else field.value='Private site update';}if(effect==='lock')field.setAttribute('aria-readonly','true');if(effect==='detach')field.remove();if(effect==='redirect')document.querySelector('#other').focus();if(effect==='cancel'||effect==='pause')resultController.handle(effect,{elements:[]});},{once:true});
   const reply=sayResult('type private words');return{reply,events,other:document.querySelector('#other').value};
  },effect);
  expect(result.reply.tone).toBe('error');expect(result.reply.performed).toBeNull();expect(result.reply.message).not.toMatch(/private words|Private site update|Draft/);expect(result.other).toBe('safe');
 });
}
for(const effect of ['password','otp','rich mode'])test(`review: ${effect} introduced by input stops continuous dictation`,async({page})=>{
 await setup(page,effect==='rich mode');const result=await page.evaluate(effect=>{
  sayResult('start dictation into Message');const field=document.querySelector('#field');
  field.addEventListener('input',()=>{if(effect==='password')field.type='password';if(effect==='otp')field.autocomplete='one-time-code';if(effect==='rich mode')field.contentEditable='false';},{once:true});
  const reply=sayResult('private phrase');return{reply,dictating:!!resultController.dictation};
 },effect);expect(result.reply.tone).toBe('error');expect(result.dictating).toBe(false);expect(result.reply.message).not.toContain('private phrase');
});
for(const effect of ['lock','redirect'])test(`review: Undo with input-time ${effect} is retried before an earlier edit`,async({page})=>{
 await setup(page);const result=await page.evaluate(effect=>{
  sayResult('type one');sayResult('type two');const field=document.querySelector('#field');
  field.addEventListener('input',()=>{if(effect==='lock')field.setAttribute('aria-readonly','true');else document.querySelector('#other').focus();},{once:true});
  const denied=sayResult('undo typing'),afterDenial=textResult();field.removeAttribute('aria-readonly');field.focus();
  const retry=sayResult('undo typing'),afterRetry=textResult();sayResult('undo typing');return{denied,afterDenial,retry,afterRetry,final:textResult()};
 },effect);expect(result.denied.tone).toBe('error');expect(result.afterDenial).toBe('Draft one');expect(result.retry.tone).toBe('success');expect(result.afterRetry).toBe('Draft one');expect(result.final).toBe('Draft');
});
for(const child of ['rejected','successful'])test(`review: rejected outer plus ${child} inner edit has no phantom Undo`,async({page})=>{
 await setup(page);const result=await page.evaluate(child=>{
  sayResult('type hello');const field=document.querySelector('#field');field.addEventListener('input',()=>{field.value='Draft hello';if(child==='rejected')field.addEventListener('input',()=>{field.value='Draft hello';},{once:true});sayResult('type inner');},{once:true});
  const reply=sayResult('type outer'),value=textResult();const states=[];if(child==='successful'){sayResult('undo typing');states.push(textResult());}sayResult('undo typing');states.push(textResult());return{reply,value,states,last:sayResult('undo typing')};
 },child);expect(result.reply.tone).toBe('error');expect(result.states).toEqual(child==='successful'?['Draft hello','Draft']:['Draft']);expect(result.last.message).toContain('Nothing to undo');
});
for(const sensitive of [false,true])test(`review: spoken alternate text respects ${sensitive?'sensitive':'refusal'} redaction`,async({page})=>{
 await setup(page);const reply=await page.evaluate(sensitive=>{const field=document.querySelector('#field');if(sensitive)field.type='password';else field.addEventListener('input',()=>{field.value='Draft';},{once:true});return sayResult('xxxxzq',{alternatives:['type private words'],spoken:true});},sensitive);
 expect(reply.tone).toBe(sensitive?'success':'error');expect(reply.message).not.toMatch(/private words|Heard/);if(sensitive)expect(reply.message).toContain('hidden');
});
test('review: a dictation session restarted by an input callback outlives the stale phrase',async({page})=>{
 await setup(page);const result=await page.evaluate(()=>{sayResult('start dictation into Message');document.querySelector('#field').addEventListener('input',()=>{sayResult('stop dictation');sayResult('start dictation into Message');},{once:true});const reply=sayResult('first phrase'),active=!!resultController.dictation;sayResult('next phrase');return{reply,active,value:textResult()};});
 expect(result.reply.tone).toBe('error');expect(result.active).toBe(true);expect(result.value).toBe('Draft first phrase next phrase');
});
