import{test,expect}from'@playwright/test';
const html='<label>Message<textarea id="field">Keep 🌓 remove\nend</textarea></label><input id="other" aria-label="Other" value="Other value">';
async function setup(page,markup=html){await page.goto('/practice-site/contact.html');await page.evaluate(async markup=>{document.body.innerHTML=markup;const{captureContext}=await import('/src/web/page-context.js'),{createController}=await import('/src/web/controller.js');window.dc=createController({window});window.events=[];for(const type of ['input','change'])document.addEventListener(type,e=>window.events.push([type,e.inputType??null,e.target.value]));window.ctx=()=>{const c=captureContext(document,{x:70,y:20,radius:1000});c.focusedId=c.elements.find(e=>e.element===document.activeElement)?.id;c.selectionFocusedId=c.disclosureElements?.find(e=>e.element===document.activeElement)?.id??c.focusedId;return c;};window.say=async text=>{const r=window.dc.handle(text,window.ctx());return await(r.followUp??r);};},markup);if(await page.locator('#field').count())await page.locator('#field').evaluate(e=>{e.focus();if(e.selectionStart!==null)e.setSelectionRange(8,14);});}
const say=(page,text)=>page.evaluate(text=>window.say(text),text);
test('native selected deletion retains exact survivors caret events and one shared text Undo',async({page})=>{await setup(page);expect((await say(page,'delete selected text')).tone).toBe('success');await expect(page.locator('#field')).toHaveValue('Keep 🌓 \nend');expect(await page.locator('#field').evaluate(e=>[e.selectionStart,e.selectionEnd])).toEqual([8,8]);expect(await page.evaluate(()=>window.events.map(e=>e.slice(0,2)))).toEqual([['input','deleteContentBackward'],['change',null]]);expect((await say(page,'undo')).tone).toBe('success');await expect(page.locator('#field')).toHaveValue('Keep 🌓 remove\nend');});

test('collapsed unsupported unavailable and half-surrogate selections refuse with no new history',async({page})=>{
 for(const effect of ['e.setSelectionRange(8,8)','e.setSelectionRange(6,7)','e.readOnly=true','e.disabled=true','e.setAttribute("aria-disabled","true")','e.hidden=true']){
  await setup(page);expect(await page.evaluate(async effect=>{const c=window.ctx(),e=document.querySelector('#field');Function('e',effect)(e);const r=window.dc.handle('delete selected text',c);return(await(r.followUp??r)).tone;},effect),effect).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);
 }
 for(const type of ['email','password']){await setup(page,`<label>Message<input id="field" type="${type}" value="hello@example.test"></label><input id="other" value="Other">`);expect((await say(page,'delete selected text')).tone,type).toBe('error');expect(await page.evaluate(()=>window.events)).toEqual([]);}
});
test('captured value selection identity form and focus microtasks cannot redirect deletion',async({page})=>{
 for(const effect of ['e.value="Changed by site"','e.setSelectionRange(0,1)','e.readOnly=true','e.hidden=true','e.setAttribute("aria-label","New")','e.id="changed"','document.querySelector("#newform").append(e)','document.querySelector("#other").focus()']){
  await setup(page,'<form>'+html+'</form><form id="newform"></form>');expect(await page.evaluate(async effect=>{const c=window.ctx(),e=document.querySelector('#field');document.querySelector('#other').focus();e.addEventListener('focus',()=>queueMicrotask(()=>Function('e',effect)(e)),{once:true});const r=window.dc.handle('delete selected text',c);return(await(r.followUp??r)).tone;},effect),effect).toBe('error');expect(await page.evaluate(()=>window.events),effect).toEqual([]);
 }
});
test('fresh locked focused intended field never redirects to an eligible neighbor',async({page})=>{
 for(const effect of ['e.disabled=true','e.readOnly=true','e.setAttribute("aria-disabled","true")']){
  await setup(page);await page.locator('#field').evaluate((e,effect)=>Function('e',effect)(e),effect);expect((await say(page,'delete selected text from Message')).tone,effect).toBe('error');await expect(page.locator('#other')).toHaveValue('Other value');expect(await page.evaluate(()=>window.events)).toEqual([]);
 }
});
test('cancel pause or newer command retires the deferred write without consuming text Undo',async({page})=>{
 for(const text of ['cancel','pause','help']){
  await setup(page);expect(await page.evaluate(async text=>{const r=window.dc.handle('delete selected text',window.ctx());window.dc.handle(text,window.ctx());return await r.followUp;},text)).toBe(null);await expect(page.locator('#field')).toHaveValue('Keep 🌓 remove\nend');expect(await page.evaluate(()=>window.events)).toEqual([]);
 }
});
test('site overrides receive truthful feedback and keep their caret without retry',async({page})=>{
 await setup(page);await page.locator('#field').evaluate(e=>e.addEventListener('input',()=>{e.setSelectionRange(1,1);queueMicrotask(()=>queueMicrotask(()=>{e.value='Site result';e.setSelectionRange(2,2);}));},{once:true}));
 expect((await say(page,'delete selected text')).tone).toBe('error');await expect(page.locator('#field')).toHaveValue('Site result');expect(await page.locator('#field').evaluate(e=>[e.selectionStart,e.selectionEnd])).toEqual([2,2]);expect(await page.evaluate(()=>window.events.map(e=>e[0]))).toEqual(['input','change']);expect((await say(page,'undo')).tone).toBe('success');await expect(page.locator('#field')).toHaveValue('Keep 🌓 remove\nend');
});
test('shadow and frame native deletion retains captured owner and composed locks',async({page})=>{
 await setup(page,'<div id="host"></div><iframe id="frame"></iframe>');expect(await page.evaluate(async html=>{
  const {captureTextSelectionSnapshot}=await import('/src/web/page-context.js'),host=document.querySelector('#host'),root=host.attachShadow({mode:'open'}),frame=document.querySelector('#frame');root.innerHTML=html;frame.contentDocument.body.innerHTML=html;const out=[];
  for(const[scope,ancestor]of[[root,host],[frame.contentDocument,frame]]){const e=scope.querySelector('#field');e.focus();if(e.selectionStart!==null)e.setSelectionRange(8,14);const context={focusedId:1,elements:[{id:1,element:e,name:'Message',role:'textbox',editable:true,distance:0,textSelectionSnapshot:captureTextSelectionSnapshot(e)}]};let r=window.dc.handle('delete selected text',context);out.push((await(r.followUp??r)).tone,e.value);ancestor.setAttribute('aria-disabled','true');r=window.dc.handle('delete selected text',context);out.push((await(r.followUp??r)).tone);}return out;
 },html)).toEqual(['success','Keep 🌓 \nend','error','success','Keep 🌓 \nend','error']);
});

test('site default-value reflection after deletion is accepted while pre-write reflection refuses',async({page})=>{
 await setup(page,'<input id="field" aria-label="Message" value="Keep remove end"><input id="other" value="Other">');await page.locator('#field').evaluate(e=>{e.setSelectionRange(5,11);e.addEventListener('input',()=>{e.defaultValue=e.value;});});expect((await say(page,'delete selected text')).tone).toBe('success');await expect(page.locator('#field')).toHaveValue('Keep  end');expect(await page.evaluate(()=>window.events.map(e=>e[0]))).toEqual(['input','change']);await say(page,'undo');await expect(page.locator('#field')).toHaveValue('Keep remove end');
 await setup(page,'<input id="field" aria-label="Message" value="Keep remove end"><input id="other" value="Other">');expect(await page.evaluate(async()=>{const e=document.querySelector('#field');e.value='Keep remove end';e.setSelectionRange(5,11);const c=window.ctx();document.querySelector('#other').focus();e.addEventListener('focus',()=>{e.defaultValue='Site default';},{once:true});const r=window.dc.handle('delete selected text',c);return(await(r.followUp??r)).tone;})).toBe('error');await expect(page.locator('#field')).toHaveValue('Keep remove end');expect(await page.evaluate(()=>window.events)).toEqual([]);
});
