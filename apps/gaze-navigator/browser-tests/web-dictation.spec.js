import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function command(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
}
async function open(page, rich = false) {
  await page.goto('/practice-site/contact.html');
  await expect(panel(page).getByLabel('Typed instruction')).toBeVisible();
  await page.evaluate(rich => {
    document.querySelectorAll('input,textarea,[contenteditable=true]').forEach(node => node.remove());
    const field = document.createElement(rich ? 'div' : 'textarea');
    field.id = 'dictation-message'; field.setAttribute('aria-label', 'Message');
    if (rich) { field.contentEditable = 'true'; field.setAttribute('role', 'textbox'); field.innerHTML = '<b>Draft</b>'; }
    else field.value = 'Draft';
    field.style.cssText = 'position:fixed;left:12px;top:12px;width:130px;height:65px;z-index:1';
    const other = document.createElement('input'); other.id='dictation-other'; other.value='safe'; other.setAttribute('aria-label','Other');
    document.body.append(field, other); field.focus();
  }, rich);
  await page.mouse.move(40, 35);
}
for (const rich of [false, true]) test(`${rich ? 'rich' : 'plain'} dictation appends phrases after gaze drift, keeps page commands literal and undoes one phrase`, async ({page}) => {
  await open(page, rich); await command(page, 'start dictation into Message');
  await expect(panel(page).locator('.dictation')).toContainText('Message');
  await page.mouse.move(280, 200); await command(page, 'hello comma world'); await command(page, 'click Send');
  const value = () => page.locator('#dictation-message').evaluate(node => 'value' in node ? node.value : node.textContent);
  expect(await value()).toBe('Draft hello, world click Send');
  await command(page, 'undo typing'); expect(await value()).toBe('Draft hello, world');
  await command(page, 'new paragraph'); await command(page, 'more words'); expect(await value()).toBe('Draft hello, world\n\nmore words');
  if (rich) await expect(page.locator('#dictation-message b')).toContainText('Draft');
  await expect(page.locator('#dictation-other')).toHaveValue('safe');
  await command(page, 'stop dictation'); await expect(panel(page).locator('.dictation')).toBeHidden();
  await command(page, 'unprefixed words'); expect(await value()).toBe('Draft hello, world\n\nmore words');
});
for (const state of ['focus','readonly','password','detached']) test(`dictation stops when the selected field changes: ${state}`, async ({page}) => {
  await open(page);
  if (state === 'password') await page.evaluate(()=>{const old=document.querySelector('#dictation-message'), input=document.createElement('input');input.id=old.id;input.setAttribute('aria-label','Message');input.value=old.value;input.style.cssText=old.style.cssText;old.replaceWith(input);input.focus();});
  await command(page,'start dictation into Message');await expect(panel(page).locator('.dictation')).toBeVisible();
  await page.evaluate(state=>{const field=document.querySelector('#dictation-message');window.retainedDictation=field;if(state==='focus')document.querySelector('#dictation-other').focus();if(state==='readonly')field.readOnly=true;if(state==='password')field.type='password';if(state==='detached')field.remove();},state);
  await command(page,'private words');expect(await page.evaluate(()=>window.retainedDictation.value)).toBe('Draft');
  await expect(page.locator('#dictation-other')).toHaveValue('safe');await expect(panel(page).locator('.dictation')).toBeHidden();
});
for (const stop of ['cancel','pause']) test(`${stop} retires dictation and resume never silently restarts it`,async({page})=>{
  await open(page);await command(page,'start dictation into Message');await expect(panel(page).locator('.dictation')).toBeVisible();
  await command(page,stop);await expect(panel(page).locator('.dictation')).toBeHidden();
  await command(page,'resume');await command(page,'private words');await expect(page.locator('#dictation-message')).toHaveValue('Draft');
});
test('stopping listening retires dictation through the real speech callbacks',async({page})=>{
  await page.addInitScript(()=>{window.SpeechRecognition=class {constructor(){window.testRecognition=this;}start(){this.nextIndex=0;this.onstart?.();}abort(){this.onend?.();}};});
  await open(page);await panel(page).getByRole('button',{name:'Start listening',exact:true}).click();
  const say= text=>page.evaluate(text=>{const r=window.testRecognition,index=r.nextIndex++;r.onspeechstart?.();const results=Array.from({length:index+1},()=>Object.assign([{transcript:''}],{isFinal:true}));results[index]=Object.assign([{transcript:text}],{isFinal:true});r.onresult?.({resultIndex:index,results});},text);
  await say('start dictation into Message');await expect(panel(page).locator('.dictation')).toBeVisible();
  await say('hello world');await expect(page.locator('#dictation-message')).toHaveValue('Draft hello world');
  await panel(page).getByRole('button',{name:'Stop listening',exact:true}).click();await expect(panel(page).locator('.dictation')).toBeHidden();
  await command(page,'private words');await expect(page.locator('#dictation-message')).toHaveValue('Draft hello world');
});

test('a distant field asks before dictation starts and rechecks writability on confirm',async({page})=>{
  await page.goto('/practice-site/contact.html');
  const result=await page.evaluate(async()=>{
    document.body.innerHTML='<textarea aria-label="Message" style="position:fixed;left:10px;top:10px">Draft</textarea>';
    const {captureContext}=await import('/src/web/page-context.js'),{createController}=await import('/src/web/controller.js');
    const field=document.querySelector('textarea'),controller=createController({window});
    const capture=()=>captureContext(document,{x:300,y:400,radius:20});
    const asked=controller.handle('start dictation into Message',capture());
    const before=controller.dictation;field.readOnly=true;const denied=controller.handle('confirm',capture());
    field.readOnly=false;controller.handle('start dictation into Message',capture());controller.handle('confirm',capture());
    controller.handle('hello',capture());controller.handle('stop dictation',capture());
    return {asked:asked.tone,before,denied:denied.tone,value:field.value,active:controller.dictation};
  });
  expect(result).toEqual({asked:'question',before:null,denied:'error',value:'Draft hello',active:null});
});
test('a focus handler cannot start dictation on a redirected or protected field',async({page})=>{
  await page.goto('/practice-site/contact.html');
  const result=await page.evaluate(async()=>{
    document.body.innerHTML='<textarea aria-label="Message">Draft</textarea><input id="other" value="safe">';
    const {captureContext}=await import('/src/web/page-context.js'),{createController}=await import('/src/web/controller.js');
    const field=document.querySelector('textarea'),controller=createController({window});
    const context=captureContext(document,{x:field.getBoundingClientRect().x+5,y:field.getBoundingClientRect().y+5,radius:50});
    field.addEventListener('focus',()=>document.querySelector('#other').focus(),{once:true});
    const reply=controller.handle('start dictation into Message',context);controller.handle('private',context);
    return {tone:reply.tone,value:field.value,other:document.querySelector('#other').value,active:controller.dictation};
  });expect(result).toEqual({tone:'error',value:'Draft',other:'safe',active:null});
});

test('focus leaving a same-origin frame field retires dictation even if it returns before the next phrase',async({page})=>{
  await page.goto('/practice-site/contact.html');await expect(panel(page).getByLabel('Typed instruction')).toBeVisible();
  await page.evaluate(async()=>{
    document.querySelectorAll('input,textarea,[contenteditable=true]').forEach(node=>node.remove());
    const frame=document.createElement('iframe');frame.id='dictation-frame';frame.style.cssText='position:fixed;left:10px;top:10px;width:160px;height:140px';
    const loaded=new Promise(resolve=>frame.onload=resolve);frame.srcdoc='<textarea aria-label="Message">Draft</textarea><input aria-label="Other" value="safe">';document.body.append(frame);await loaded;frame.contentDocument.querySelector('textarea').focus();
  });
  await page.mouse.move(45,40);await command(page,'start dictation into Message');await expect(panel(page).locator('.dictation')).toBeVisible();
  await page.evaluate(()=>{const d=document.querySelector('#dictation-frame').contentDocument;d.querySelector('input').focus();d.querySelector('textarea').focus();});
  await expect(panel(page).locator('.dictation')).toBeHidden();await command(page,'private words');
  expect(await page.locator('#dictation-frame').evaluate(frame=>frame.contentDocument.querySelector('textarea').value)).toBe('Draft');
});

test('the active dictation indicator stays visible when the navigator is collapsed',async({page})=>{
  await open(page);await command(page,'start dictation into Message');await command(page,'hello');
  await panel(page).getByRole('button',{name:'Hide',exact:true}).click();
  await expect(panel(page).locator('.dictation')).toBeVisible();
  await expect(panel(page).locator('.dictation')).toContainText('stop dictation');
});

test('a temporary field lock requires an explicit dictation restart after it is unlocked',async({page})=>{
  await open(page);await command(page,'start dictation into Message');await expect(panel(page).locator('.dictation')).toBeVisible();
  await page.evaluate(()=>{document.querySelector('#dictation-message').readOnly=true;});
  await expect(panel(page).locator('.dictation')).toBeHidden();
  await page.evaluate(()=>{document.querySelector('#dictation-message').readOnly=false;});
  await command(page,'private words');await expect(page.locator('#dictation-message')).toHaveValue('Draft');
});

test('a lock restored in one DOM batch still ends the explicit dictation choice',async({page})=>{
  await open(page);await command(page,'start dictation into Message');
  await page.evaluate(()=>{const field=document.querySelector('#dictation-message');field.readOnly=true;field.readOnly=false;});
  await expect(panel(page).locator('.dictation')).toBeHidden();
  await command(page,'private words');await expect(page.locator('#dictation-message')).toHaveValue('Draft');
});
