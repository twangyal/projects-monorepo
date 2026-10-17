import { test, expect } from '@playwright/test';
async function setup(page,html='<label>Newsletter<input id="a" type="checkbox"></label>') {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async html=>{
    document.body.innerHTML=html;const {createController}=await import('/src/web/controller.js');
    window.checkController=createController({window});window.checkEvents=[];
    for(const e of document.querySelectorAll('input,[role=checkbox]')) for(const type of ['click','input','change']) e.addEventListener(type,()=>window.checkEvents.push([e.id,type,e.checked]));
    window.checkContext=()=>({elements:[...document.querySelectorAll('input,[role=checkbox]')].map((element,i)=>({id:i+1,element,name:element.labels?.[0]?.textContent??element.getAttribute('aria-label'),role:'checkbox',distance:20,consequential:element.hasAttribute('data-consequential')}))});
    window.commandCheck=text=>window.checkController.handle(text,window.checkContext());
  },html);
}
const command=(page,text)=>page.evaluate(text=>window.commandCheck(text),text);

test('uncheck clear and repeated check preserve state without extra native events',async({page})=>{
  await setup(page);await command(page,'uncheck Newsletter');await expect(page.locator('#a')).not.toBeChecked();
  expect(await page.evaluate(()=>window.checkEvents)).toEqual([]);
  await command(page,'check Newsletter');await command(page,'check Newsletter');await expect(page.locator('#a')).toBeChecked();
  expect(await page.evaluate(()=>window.checkEvents)).toEqual([['a','click',true],['a','input',true],['a','change',true]]);
  await command(page,'untick that checkbox');await expect(page.locator('#a')).not.toBeChecked();
});

test('ambiguous and consequential requests preserve desired state through cancel and confirmation',async({page})=>{
  await setup(page,'<label>Agree<input id="a" type="checkbox" data-consequential></label><label>Agree<input id="b" type="checkbox" data-consequential></label>');
  expect((await command(page,'check Agree')).pending.kind).toBe('clarify');await command(page,'two');
  expect(await page.evaluate(()=>window.checkEvents)).toEqual([]);await command(page,'cancel');await command(page,'confirm');
  await expect(page.locator('#b')).not.toBeChecked();
  await command(page,'check Agree');expect((await command(page,'two')).pending.kind).toBe('confirm');await command(page,'confirm');
  await expect(page.locator('#a')).not.toBeChecked();await expect(page.locator('#b')).toBeChecked();
});

test('mixed custom disabled readonly and ancestor-locked controls refuse without native activation',async({page})=>{
  for(const effect of ['e.indeterminate=true','e.disabled=true','e.readOnly=true','e.parentElement.inert=true','e.parentElement.setAttribute("aria-disabled","true")','e.parentElement.setAttribute("aria-readonly","true")','e.type="radio"','e.remove()']){
    await setup(page);const result=await page.evaluate(effect=>{const context=window.checkContext(),e=document.querySelector('#a');Function('e',effect)(e);return window.checkController.handle('check Newsletter',context);},effect);
    expect(result.tone,effect).toBe('error');expect(await page.evaluate(()=>window.checkEvents),effect).toEqual([]);
  }
  await setup(page,'<div id="a" role="checkbox" aria-label="Newsletter" aria-checked="false" tabindex="0"></div>');
  expect((await command(page,'check Newsletter')).tone).toBe('error');await expect(page.locator('#a')).toHaveAttribute('aria-checked','false');expect(await page.evaluate(()=>window.checkEvents)).toEqual([]);
});

test('focus-time locking replacement state changes and redirects refuse before clicking',async({page})=>{
  for(const effect of ['e.checked=true','e.indeterminate=true','e.disabled=true','e.type="text"','e.replaceWith(e.cloneNode())','document.querySelector("#other").focus()']){
    await setup(page,'<label>Newsletter<input id="a" type="checkbox"></label><button id="other">Other</button>');
    await page.locator('#a').evaluate((e,effect)=>e.addEventListener('focus',()=>Function('e',effect)(e),{once:true}),effect);
    expect((await command(page,'check Newsletter')).tone,effect).toBe('error');expect(await page.evaluate(()=>window.checkEvents),effect).toEqual([]);
  }
});

test('native canceled clicks site overrides and replacements never claim retained state',async({page})=>{
  for(const effect of ['event.preventDefault()','e.checked=false','e.replaceWith(e.cloneNode())','e.indeterminate=true','e.disabled=true']){
    await setup(page);await page.locator('#a').evaluate((e,effect)=>e.addEventListener('click',event=>Function('e','event',effect)(e,event)),effect);
    expect((await command(page,'check Newsletter')).tone,effect).toBe('error');
  }
});

test('shadow and same-origin frame ancestor restrictions protect captured checkboxes',async({page})=>{
  await setup(page,'<div id="host"></div><iframe id="frame"></iframe>');
  expect(await page.evaluate(()=>{
    const host=document.querySelector('#host'),root=host.attachShadow({mode:'open'});root.innerHTML='<input type="checkbox">';
    const frame=document.querySelector('#frame');frame.contentDocument.body.innerHTML='<input type="checkbox">';
    const results=[];
    for(const [element,ancestor]of[[root.querySelector('input'),host],[frame.contentDocument.querySelector('input'),frame]]){
      const context={elements:[{id:1,element,name:'Newsletter',role:'checkbox',distance:0}]};
      results.push(window.checkController.handle('check Newsletter',context).performed,element.checked);
      window.checkController.handle('uncheck Newsletter',context);ancestor.setAttribute('aria-readonly','true');
      results.push(window.checkController.handle('check Newsletter',context).tone,element.checked);
    }return results;
  })).toEqual(['check',true,'error',false,'check',true,'error',false]);
});
