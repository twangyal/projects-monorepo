import { test, expect } from '@playwright/test';
const markup='<details id="faq"><summary id="toggle">FAQ</summary><p>Answer</p></details><button id="other" type="button">Other</button>';
async function setup(page,html=markup){
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async html=>{
    document.body.innerHTML=html;
    const {createController}=await import('/src/web/controller.js'),{captureContext}=await import('/src/web/page-context.js');
    window.dc=createController({window});window.events=[];
    document.addEventListener('click',e=>window.events.push(e.target.id));
    window.ctx=()=>captureContext(document,{x:50,y:20,radius:1000});
    window.say=async text=>{const r=window.dc.handle(text,window.ctx());return await(r.followUp??r);};
  },html);
}
const say=(page,text)=>page.evaluate(text=>window.say(text),text);
test('repeat expand and collapse keep native state with no redundant clicks',async({page})=>{
 await setup(page);expect((await say(page,'expand FAQ')).tone).toBe('success');await expect(page.locator('#faq')).toHaveAttribute('open','');
 expect((await say(page,'expand FAQ')).message).toMatch(/already expanded/);await expect(page.locator('#faq')).toHaveAttribute('open','');
 expect((await say(page,'collapse FAQ')).tone).toBe('success');expect((await say(page,'collapse FAQ')).message).toMatch(/already collapsed/);
 expect(await page.evaluate(()=>window.events)).toEqual(['toggle','toggle']);
});
test('unsupported named gazed ordinal targets never redirect to supported neighbors',async({page})=>{
 await setup(page,'<button id="bad">FAQ</button><button id="good" aria-expanded="false">FAQ details</button>');
 for(const text of ['expand FAQ','expand that','expand first panel']){expect((await say(page,text)).tone,text).toBe('error');}
 expect(await page.evaluate(()=>window.events)).toEqual([]);
});

test('binary ARIA uses one website click and observes nested microtask retained state',async({page})=>{
 await setup(page,'<button id="toggle" type="button" aria-expanded="false">FAQ</button>');
 await page.locator('#toggle').evaluate(e=>e.addEventListener('click',()=>queueMicrotask(()=>queueMicrotask(()=>e.setAttribute('aria-expanded',String(e.getAttribute('aria-expanded')!=='true'))))));
 for(const text of ['expand FAQ','expand FAQ','collapse FAQ','collapse FAQ'])expect((await say(page,text)).tone).toBe('success');
 expect(await page.evaluate(()=>window.events)).toEqual(['toggle','toggle']);
});
test('invalid locked hidden replaced and implicit form-submit controls refuse',async({page})=>{
 for(const effect of ['e.removeAttribute("aria-expanded")','e.setAttribute("aria-expanded","mixed")','e.disabled=true','e.readOnly=true','e.hidden=true','document.body.inert=true','document.body.setAttribute("aria-readonly","true")','e.replaceWith(e.cloneNode(true))']){
  await setup(page,'<button id="toggle" type="button" aria-expanded="false">FAQ</button>');
  expect(await page.evaluate(async effect=>{const c=window.ctx(),e=document.querySelector('#toggle');Function('e',effect)(e);const r=window.dc.handle('expand FAQ',c);return(await(r.followUp??r)).tone;},effect),effect).toBe('error');
  expect(await page.evaluate(()=>window.events),effect).toEqual([]);
 }
 for(const html of ['<form><button id="toggle" aria-expanded="false">FAQ</button></form>','<a id="toggle" href="#next" role="button" aria-expanded="false">FAQ</a>','<details open><summary>First</summary><summary id="toggle">FAQ</summary></details>']){
  await setup(page,html);let r=await say(page,'expand FAQ');if(r.pending?.kind==='confirm')r=await say(page,'confirm');expect(r.tone,html).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);
 }
});
test('focus microtasks cannot change identity form ownership visibility focus or cancel ownership',async({page})=>{
 for(const effect of ['e.setAttribute("aria-disabled","true")','e.hidden=true','e.setAttribute("aria-label","Other")','e.setAttribute("aria-controls","new")','e.replaceWith(e.cloneNode(true))','document.querySelector("#other").focus()','document.querySelector("#newform").append(e.parentElement)']){
  await setup(page,'<form id="oldform">'+markup+'</form><form id="newform"></form>');
  await page.locator('#toggle').evaluate((e,effect)=>e.addEventListener('focus',()=>queueMicrotask(()=>Function('e',effect)(e)),{once:true}),effect);
  expect((await say(page,'expand FAQ')).tone,effect).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);
 }
 for(const text of ['cancel','pause','help']){
  await setup(page);expect(await page.evaluate(async text=>{const r=window.dc.handle('expand FAQ',window.ctx());window.dc.handle(text,window.ctx());return await r.followUp;},text)).toBe(null);expect(await page.evaluate(()=>window.events)).toEqual([]);
 }
});
test('focus-driven requested state avoids click and website cancellation overrides are not forced',async({page})=>{
 await setup(page);await page.locator('#toggle').evaluate(e=>e.addEventListener('focus',()=>queueMicrotask(()=>{e.parentElement.open=true;})));
 expect((await say(page,'expand FAQ')).tone).toBe('success');expect(await page.evaluate(()=>window.events)).toEqual([]);
 for(const aria of [false,true]){
  await setup(page,aria?'<button id="toggle" type="button" aria-expanded="false">FAQ</button>':markup);
  await page.locator('#toggle').evaluate((e,aria)=>e.addEventListener('click',event=>{if(!aria)event.preventDefault();else {e.setAttribute('aria-expanded','true');queueMicrotask(()=>queueMicrotask(()=>e.setAttribute('aria-expanded','false')));}}),aria);
  expect((await say(page,'expand FAQ')).tone).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual(['toggle']);
 }
});
test('clarification confirmation cancel and pending structural drift retain exact intent',async({page})=>{
 const html='<form id="oldform"><details id="one"><summary id="a">Delete account</summary>A</details><details id="two"><summary id="b">Delete account</summary>B</details></form><form id="newform"></form>';
 await setup(page,html);let r=await say(page,'expand Delete account');expect(r.pending.kind).toBe('clarify');r=await say(page,String(r.pending.candidates[1].number));expect(r.pending.kind).toBe('confirm');await say(page,'cancel');await say(page,'confirm');expect(await page.evaluate(()=>window.events)).toEqual([]);
 for(const effect of ['e.setAttribute("aria-controls","changed")','document.querySelector("#newform").append(e.parentElement)']){
  await setup(page,html);r=await say(page,'expand Delete account');await say(page,String(r.pending.candidates[1].number));await page.locator('#b').evaluate((e,effect)=>Function('e',effect)(e),effect);expect((await say(page,'confirm')).tone,effect).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);
 }
 await setup(page,html);r=await say(page,'expand Delete account');await say(page,String(r.pending.candidates[1].number));expect((await say(page,'confirm')).tone).toBe('success');await expect(page.locator('#two')).toHaveAttribute('open','');expect(await page.evaluate(()=>window.events)).toEqual(['b']);
});
test('captured unsupported admission and details ownership cannot change while pending',async({page})=>{
 for(const html of ['<button id="toggle">Delete account</button>','<details id="one"><summary id="toggle">Delete account</summary>A</details><details id="two"></details>']){
  await setup(page,html);expect((await say(page,'expand Delete account')).pending.kind).toBe('confirm');await page.locator('#toggle').evaluate(e=>{if(e.tagName==='BUTTON')e.setAttribute('aria-expanded','false');else document.querySelector('#two').append(e);});expect((await say(page,'confirm')).tone).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);
 }
});
test('shadow and frame disclosure identity retains ancestor locks',async({page})=>{
 await setup(page,'<div id="host"></div><iframe id="frame"></iframe>');
 expect(await page.evaluate(async html=>{
  const host=document.querySelector('#host'),root=host.attachShadow({mode:'open'}),frame=document.querySelector('#frame');root.innerHTML=html;frame.contentDocument.body.innerHTML=html;
  const {captureDisclosureSnapshot}=await import('/src/web/page-context.js');const outcomes=[];
  for(const [scope,ancestor] of [[root,host],[frame.contentDocument,frame]]){
   const e=scope.querySelector('#toggle'),context={elements:[{id:1,element:e,role:'button',name:'FAQ',distance:0,disclosureSnapshot:captureDisclosureSnapshot(e)}]};
   let r=window.dc.handle('expand FAQ',context);outcomes.push((await(r.followUp??r)).tone,e.parentElement.open);ancestor.setAttribute('aria-disabled','true');r=window.dc.handle('collapse FAQ',context);outcomes.push((await(r.followUp??r)).tone,e.parentElement.open);
  }return outcomes;
 },markup)).toEqual(['success',true,'error',true,'success',true,'error',true]);
});

test('pending navigation-link eligibility cannot become a disclosure by removing href',async({page})=>{
 await setup(page,'<a id="toggle" href="#danger" tabindex="0" role="button" aria-expanded="false">Delete account</a>');
 await page.locator('#toggle').evaluate(e=>e.addEventListener('click',()=>e.setAttribute('aria-expanded','true')));
 expect((await say(page,'expand Delete account')).pending.kind).toBe('confirm');
 await page.locator('#toggle').evaluate(e=>e.removeAttribute('href'));
 expect((await say(page,'confirm')).tone).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);
});

test('fresh disabled and aria-disabled intent remains visible for refusal without neighbor activation',async({page})=>{
 for(const restriction of ['disabled','aria-disabled="true"','inert']){
  for(const text of ['expand FAQ','expand that','expand first panel']){
   await setup(page,`<button id="bad" ${restriction} aria-expanded="false">FAQ</button><button id="good" type="button" aria-expanded="false">FAQ details</button>`);
   await page.locator('#good').evaluate(e=>e.addEventListener('click',()=>e.setAttribute('aria-expanded','true')));
   expect((await say(page,text)).tone,`${restriction}: ${text}`).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);
  }
 }
});
