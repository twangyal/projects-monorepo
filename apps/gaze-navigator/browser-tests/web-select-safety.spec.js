import {test,expect} from '@playwright/test';
async function setup(page,html='<label>Format<select id="a"><option value="paper">Paperback</option><option value="hard">Hardcover</option></select></label><button id="other">Other</button>'){
 await page.goto('/practice-site/contact.html');
 await page.evaluate(async html=>{document.body.innerHTML=html;const {createController}=await import('/src/web/controller.js');const {captureContext}=await import('/src/web/page-context.js');window.c=createController({window});window.events=[];for(const e of document.querySelectorAll('select'))for(const type of ['input','change'])e.addEventListener(type,event=>window.events.push([e.id,type,e.value,event.composed]));window.ctx=()=>captureContext(document,{x:100,y:60,radius:1000});window.run=async text=>{const r=window.c.handle(text,window.ctx());return r.followUp?await r.followUp:r;};},html);
}
const command=(page,text='choose Hardcover from Format')=>page.evaluate(text=>window.run(text),text);
test('native selection emits one pair of events and repeated choice is a no-op',async({page})=>{
 await setup(page);expect((await command(page)).performed).toBe('select-option');await expect(page.locator('#a')).toHaveValue('hard');
 expect(await page.evaluate(()=>window.events)).toEqual([['a','input','hard',true],['a','change','hard',false]]);
 await command(page);expect((await page.evaluate(()=>window.events)).length).toBe(2);
});
test('captured disabled select fieldset optgroup locks and multi-select refuse without events',async({page})=>{
 for(const change of ['e.disabled=true','e.parentElement.inert=true','e.parentElement.setAttribute("aria-disabled","true")','e.parentElement.setAttribute("aria-readonly","true")','e.readOnly=true','e.multiple=true','e.options[1].disabled=true','e.outerHTML="<fieldset disabled>"+e.outerHTML+"</fieldset>"','const g=document.createElement("optgroup");g.disabled=true;e.append(g);g.append(e.options[1])']){
  await setup(page);expect(await page.evaluate(async change=>{const context=window.ctx(),e=document.querySelector('#a');Function('e',change)(e);const r=window.c.handle('choose Hardcover from Format',context);return r.followUp?await r.followUp:r;},change)).toMatchObject({tone:'error'});expect(await page.evaluate(()=>window.events),change).toEqual([]);
 }
});
test('multi-select keeps all preexisting selections and refuses even a selected option',async({page})=>{
 await setup(page,'<label>Format<select id="a" multiple><option selected>Paperback</option><option selected>Hardcover</option><option>Large print</option></select></label>');
 expect((await command(page,'choose Large print from Format')).tone).toBe('error');expect((await command(page)).tone).toBe('error');
 expect(await page.locator('#a').evaluate(e=>[...e.options].map(o=>o.selected))).toEqual([true,true,false]);expect(await page.evaluate(()=>window.events)).toEqual([]);
});
test('captured option identity labels values ordering and selection cannot drift before execution',async({page})=>{
 for(const change of ['e.options[1].textContent="Different"','e.options[1].label="Different label"','e.options[1].value="other"','e.options[1].replaceWith(e.options[1].cloneNode(true))','e.prepend(e.options[1])','e.append(new Option("Extra","extra"))','e.selectedIndex=1']){
  await setup(page);expect((await page.evaluate(async change=>{const context=window.ctx(),e=document.querySelector('#a');Function('e',change)(e);const r=window.c.handle('choose Hardcover from Format',context);return r.followUp?await r.followUp:r;},change)).tone,change).toBe('error');expect(await page.evaluate(()=>window.events),change).toEqual([]);
 }
});
test('focus handlers cannot replace reorder relabel lock select or redirect the captured dropdown',async({page})=>{
 for(const change of ['e.options[1].replaceWith(e.options[1].cloneNode(true))','e.prepend(e.options[1])','e.options[1].textContent="Different"','e.options[1].label="Different label"','e.disabled=true','e.multiple=true','e.selectedIndex=1','document.querySelector("#other").focus()']){
  await setup(page);await page.locator('#a').evaluate((e,change)=>e.addEventListener('focus',()=>Function('e',change)(e),{once:true}),change);
  expect((await command(page)).tone,change).toBe('error');expect(await page.evaluate(()=>window.events),change).toEqual([]);
 }
});
test('site input and microtask overrides are respected and never reported as retained selection',async({page})=>{
 for(const change of ['e.selectedIndex=0','e.remove()','e.disabled=true','queueMicrotask(()=>e.selectedIndex=0)','queueMicrotask(()=>e.options[1].value="different")','e.labels[0].firstChild.textContent="Elsewhere"','e.setAttribute("role","button")','queueMicrotask(()=>e.options[1].label="Different label")']){
  await setup(page);await page.locator('#a').evaluate((e,change)=>e.addEventListener('input',()=>Function('e',change)(e),{once:true}),change);
  expect((await command(page)).tone,change).toBe('error');
 }
});
test('clarification uses captured option identity and cancellation retires the pending choice',async({page})=>{
 await setup(page,'<label>Format<select id="a"><option>Paperback</option><option>Hardcover</option></select></label><label>Format<select id="b"><option>Paperback</option><option>Hardcover</option></select></label>');
 expect((await command(page)).pending.kind).toBe('clarify');await command(page,'cancel');await command(page,'two');expect(await page.evaluate(()=>window.events)).toEqual([]);
 await command(page);await page.evaluate(()=>{const id=window.c.pending.candidates[1].elementId;const e=window.ctx().elements.find(t=>t.id===id).element;e.options[1].replaceWith(e.options[1].cloneNode(true));});expect((await command(page,'two')).tone).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);
});
test('newer commands retire delayed native selection feedback',async({page})=>{
 for(const next of ['cancel','pause','choose Paperback from Format']){
  await setup(page);expect(await page.evaluate(async next=>{const r=window.c.handle('choose Hardcover from Format',window.ctx());window.c.handle(next,window.ctx());return Boolean(r.followUp)&&(await r.followUp)===null;},next)).toBe(true);
 }
});
test('shadow and same-origin frame selects preserve native input propagation and ancestor locks',async({page})=>{
 await setup(page,'<div id="host"></div><iframe id="frame"></iframe>');
 expect(await page.evaluate(async()=>{
  const {captureSelectSnapshot}=await import('/src/web/page-context.js');
  const host=document.querySelector('#host'),root=host.attachShadow({mode:'open'}),frame=document.querySelector('#frame');
  const html='<select aria-label="Format"><option value="paper">Paperback</option><option value="hard">Hardcover</option></select>';
  root.innerHTML=html;frame.contentDocument.body.innerHTML=html;const outer=[];host.addEventListener('input',()=>outer.push('input'));host.addEventListener('change',()=>outer.push('change'));
  const results=[];
  for(const [e,ancestor]of[[root.querySelector('select'),host],[frame.contentDocument.querySelector('select'),frame]]){
   const context=()=>({elements:[{id:1,element:e,role:'combobox',name:'Format',options:['Paperback','Hardcover'],selectSnapshot:captureSelectSnapshot(e)}]});
   let r=window.c.handle('choose Hardcover from Format',context());r=r.followUp?await r.followUp:r;results.push(r.tone,e.value);
   e.selectedIndex=0;const captured=context();ancestor.setAttribute('aria-readonly','true');r=window.c.handle('choose Hardcover from Format',captured);r=r.followUp?await r.followUp:r;results.push(r.tone,e.value);
  }
  return{results,outer};
 })).toEqual({results:['success','hard','error','paper','success','hard','error','paper'],outer:['input']});
});
test('visible option label attributes drive interpretation and successful feedback',async({page})=>{
 await setup(page,'<label>Format<select id="a"><option value="paper">Paperback</option><option value="hard" label="Hardcover">Internal code</option></select></label>');
 expect(await command(page)).toMatchObject({performed:'select-option',message:'Hardcover selected.'});await expect(page.locator('#a')).toHaveValue('hard');
});
test('site optgroup parent or group-label changes do not acknowledge the old choice',async({page})=>{
 for(const change of ['e.options[1].parentElement.label="Other collection"','e.append(e.options[1])']){
  await setup(page,'<label>Format<select id="a"><option value="paper">Paperback</option><optgroup label="Books"><option value="hard">Hardcover</option></optgroup></select></label>');
  await page.locator('#a').evaluate((e,change)=>e.addEventListener('change',()=>Function('e',change)(e),{once:true}),change);
  expect((await command(page)).tone,change).toBe('error');
 }
});
test('consequential dropdown labels and choices wait for confirmation and honor cancellation',async({page})=>{
 for(const [label,choice]of[['Action','Delete account'],['Delete account','Permanent']]){
  await setup(page,`<label>${label}<select id="a"><option value="keep">Keep</option><option value="remove">${choice}</option></select></label>`);
  const request=`choose ${choice} from ${label}`,waiting=await command(page,request);expect(waiting.pending?.kind).toBe('confirm');expect(waiting.message).toContain(choice);expect(await page.evaluate(()=>window.events)).toEqual([]);
  await command(page,'cancel');await command(page,'confirm');await expect(page.locator('#a')).toHaveValue('keep');
  await command(page,request);expect((await command(page,'confirm')).performed).toBe('select-option');await expect(page.locator('#a')).toHaveValue('remove');
 }
});
test('retiring an iframe during site microtasks resolves feedback as unavailable',async({page})=>{
 await setup(page,'<iframe id="frame"></iframe>');
 expect(await page.evaluate(async()=>{
  const {captureSelectSnapshot}=await import('/src/web/page-context.js');const frame=document.querySelector('#frame');frame.contentDocument.body.innerHTML='<select aria-label="Format"><option>Paperback</option><option>Hardcover</option></select>';
  const e=frame.contentDocument.querySelector('select'),ctx={elements:[{id:1,element:e,role:'combobox',name:'Format',options:['Paperback','Hardcover'],selectSnapshot:captureSelectSnapshot(e)}]};
  e.addEventListener('change',()=>queueMicrotask(()=>frame.remove()),{once:true});
  const r=window.c.handle('choose Hardcover from Format',ctx);return Promise.race([r.followUp??r,new Promise(resolve=>setTimeout(()=>resolve({tone:'pending'}),250))]);
 })).toMatchObject({tone:'error'});
});
