import {test,expect} from '@playwright/test';
async function setup(page,{role='checkbox',state='false',effect='toggle'}={}){
 await page.goto('/practice-site/contact.html');
 await page.evaluate(async({role,state,effect})=>{
  document.body.innerHTML=`<button id="a" type="button" role="${role}" aria-label="Newsletter" aria-checked="${state}">Newsletter</button><button id="other">Other</button>`;
  const {createController}=await import('/src/web/controller.js');window.c=createController({window});window.events=[];
  const e=document.querySelector('#a');for(const type of ['click','input','change'])e.addEventListener(type,()=>window.events.push(type));
  if(effect==='toggle')e.addEventListener('click',()=>queueMicrotask(()=>e.setAttribute('aria-checked',e.getAttribute('aria-checked')==='true'?'false':'true')));
  window.ctx=()=>({elements:[{id:1,element:e,role,name:'Newsletter',distance:0,consequential:e.hasAttribute('data-confirm')}]});
 },{role,state,effect});
}
const command=(page,text)=>page.evaluate(async text=>{const r=window.c.handle(text,window.ctx());return r.followUp?await r.followUp:r;},text);

test('binary custom checkbox and switch use one site click and observe microtask state',async({page})=>{
 for(const role of ['checkbox','switch']){
  await setup(page,{role});expect((await command(page,'uncheck Newsletter')).tone).toBe('success');
  expect((await command(page,'check Newsletter')).tone).toBe('success');await expect(page.locator('#a')).toHaveAttribute('aria-checked','true');
  expect((await command(page,'tick Newsletter')).tone).toBe('success');expect(await page.evaluate(()=>window.events)).toEqual(['click']);
  expect((await command(page,'untick Newsletter')).tone).toBe('success');await expect(page.locator('#a')).toHaveAttribute('aria-checked','false');
  expect(await page.evaluate(()=>window.events)).toEqual(['click','click']);
 }
});

test('missing mixed invalid or locked ARIA state refuses without activation',async({page})=>{
 for(const effect of ['e.removeAttribute("aria-checked")','e.setAttribute("aria-checked","mixed")','e.setAttribute("aria-checked","yes")','e.disabled=true','e.parentElement.inert=true','e.parentElement.setAttribute("aria-readonly","true")','e.parentElement.setAttribute("aria-disabled","true")']){
  await setup(page);await page.locator('#a').evaluate((e,effect)=>Function('e',effect)(e),effect);
  expect((await command(page,'check Newsletter')).tone,effect).toBe('error');expect(await page.evaluate(()=>window.events),effect).toEqual([]);
 }
});

test('focus handlers cannot redirect lock replace or change role/state before activation',async({page})=>{
 for(const effect of ['e.setAttribute("aria-checked","true")','e.setAttribute("role","switch")','e.disabled=true','e.replaceWith(e.cloneNode(true))','document.querySelector("#other").focus()']){
  await setup(page);await page.locator('#a').evaluate((e,effect)=>e.addEventListener('focus',()=>Function('e',effect)(e),{once:true}),effect);
  expect((await command(page,'check Newsletter')).tone,effect).toBe('error');expect(await page.evaluate(()=>window.events),effect).toEqual([]);
 }
});

test('site refusals and microtask replacements never claim retained custom state',async({page})=>{
 for(const effect of ['none','remove','lock','mixed']){
  await setup(page,{effect});if(effect!=='none')await page.locator('#a').evaluate((e,effect)=>e.addEventListener('click',()=>queueMicrotask(()=>{
   e.setAttribute('aria-checked','true');if(effect==='remove')e.remove();if(effect==='lock')e.disabled=true;if(effect==='mixed')e.setAttribute('aria-checked','mixed');
  })),effect);
  expect((await command(page,'check Newsletter')).tone,effect).toBe('error');expect(await page.evaluate(()=>window.events),effect).toEqual(['click']);
 }
});

test('consequential custom changes wait for confirmation and stale acknowledgments retire',async({page})=>{
 await setup(page);await page.locator('#a').evaluate(e=>e.setAttribute('data-confirm',''));
 expect((await command(page,'check Newsletter')).pending.kind).toBe('confirm');expect(await page.evaluate(()=>window.events)).toEqual([]);
 await command(page,'cancel');await command(page,'confirm');expect(await page.evaluate(()=>window.events)).toEqual([]);
 await command(page,'check Newsletter');expect((await command(page,'confirm')).tone).toBe('success');
 for(const next of ['cancel','pause','uncheck Newsletter']){
  await setup(page);expect(await page.evaluate(async next=>{const r=window.c.handle('check Newsletter',window.ctx());window.c.handle(next,window.ctx());return (await r.followUp)===null;},next)).toBe(true);
 }
});

test('custom roles do not bypass native input link or form-action semantics',async({page})=>{
 for(const html of ['<input type="radio">','<a href="javascript:window.bad=1" tabindex="0">Setting</a>','<form><button type="submit">Setting</button></form>','<form><button type="reset">Setting</button></form>']){
  await setup(page,{effect:'none'});expect(await page.evaluate(html=>{
   document.body.innerHTML=html;const e=document.querySelector('input,a,button');e.setAttribute('role','checkbox');e.setAttribute('aria-checked','false');let clicks=0;e.addEventListener('click',()=>clicks++);
   const r=window.c.handle('check Newsletter',{elements:[{id:1,element:e,name:'Newsletter',role:'checkbox',distance:0}]});return {tone:r.tone,clicks,bad:window.bad??0};
  },html)).toEqual({tone:'error',clicks:0,bad:0});
 }
});

test('custom widgets honor shadow and frame ancestor locks',async({page})=>{
 await setup(page);expect(await page.evaluate(async()=>{
  document.body.innerHTML='<div id="host"></div><iframe id="frame"></iframe>';
  const host=document.querySelector('#host'),shadow=host.attachShadow({mode:'open'}),frame=document.querySelector('#frame');
  shadow.innerHTML='<button type="button" role="switch" aria-checked="false">Setting</button>';
  frame.contentDocument.body.innerHTML='<button type="button" role="checkbox" aria-checked="false">Setting</button>';
  const results=[];
  for(const [e,parent]of[[shadow.querySelector('button'),host],[frame.contentDocument.querySelector('button'),frame]]){
   e.addEventListener('click',()=>queueMicrotask(()=>e.setAttribute('aria-checked',e.getAttribute('aria-checked')==='true'?'false':'true')));
   const context={elements:[{id:1,element:e,name:'Newsletter',role:e.getAttribute('role'),distance:0}]};
   let r=window.c.handle('check Newsletter',context);r=await(r.followUp??r);results.push(r.tone,e.getAttribute('aria-checked'));
   r=window.c.handle('uncheck Newsletter',context);await(r.followUp??r);parent.setAttribute('aria-disabled','true');
   results.push(window.c.handle('check Newsletter',context).tone,e.getAttribute('aria-checked'));
  }return results;
 })).toEqual(['success','true','error','false','success','true','error','false']);
});

test('discovery does not describe unknown or mixed checked state as false',async({page})=>{
 for(const value of ['mixed','','invalid']){
  await setup(page,{state:value});expect(await page.evaluate(async()=>{
   const {captureContext}=await import('/src/web/page-context.js');const e=document.querySelector('#a'),r=e.getBoundingClientRect();
   return captureContext(document,{x:r.x+r.width/2,y:r.y+r.height/2,radius:80}).elements.find(t=>t.element===e).checked;
  })).toBeUndefined();
 }
});

test('nested website microtasks cannot report a state already reversed',async({page})=>{
 await setup(page,{effect:'none'});
 await page.locator('#a').evaluate(e=>e.addEventListener('click',()=>{e.setAttribute('aria-checked','true');queueMicrotask(()=>queueMicrotask(()=>e.setAttribute('aria-checked','false')));}));
 expect((await command(page,'check Newsletter')).tone).toBe('error');
 await expect(page.locator('#a')).toHaveAttribute('aria-checked','false');
 expect(await page.evaluate(()=>window.events)).toEqual(['click']);
});
