import {test,expect} from '@playwright/test';

for(const near of [true,false])test(`named in-field dictation reaches the ${near?'nearby':'far'} field and keeps a gazed neighbour unchanged`,async({page})=>{
  await page.goto('/practice-site/contact.html');
  const result=await page.evaluate(async near=>{
    document.getElementById('gaze-web-navigator')?.remove();document.body.innerHTML=`<input id="other" aria-label="Other" value="safe" style="position:fixed;left:10px;top:20px;width:90px"><input id="message" aria-label="Message" value="one" style="position:fixed;${near?'left:160px;top:30px':'right:10px;bottom:10px'};width:120px">`;
    const {captureContext}=await import('/src/web/page-context.js'),{createController}=await import('/src/web/controller.js');
    const controller=createController({window}),capture=()=>captureContext(document,{x:30,y:30,radius:50});
    const other=document.querySelector('#other'),message=document.querySelector('#message');
    const asked=controller.handle('type Hello, Sam! in the Message field',capture()),before=[other.value,message.value];
    const completed=near?asked:controller.handle('confirm',capture());
    return {tone:asked.tone,before,after:[other.value,message.value],completed:completed.tone};
  },near);
  expect(result).toEqual({tone:near?'success':'question',before:['safe',near?'one Hello, Sam!':'one'],after:['safe','one Hello, Sam!'],completed:'success'});
});

test('missing, read-only and duplicated named fields never redirect a write into the gazed field',async({page})=>{
  await page.goto('/practice-site/contact.html');
  const result=await page.evaluate(async()=>{
    document.getElementById('gaze-web-navigator')?.remove();document.body.innerHTML='<input id="other" aria-label="Other" value="safe" style="position:fixed;left:10px;top:20px;width:90px"><button aria-label="Message" style="position:fixed;right:10px;bottom:10px">Message</button>';
    const {captureContext}=await import('/src/web/page-context.js'),{createController}=await import('/src/web/controller.js');
    const controller=createController({window}),capture=()=>captureContext(document,{x:30,y:30,radius:40}),other=document.querySelector('#other');
    const missing=controller.handle('write private words in the Message box',capture());
    const target=document.createElement('input');target.setAttribute('aria-label','Message');target.value='locked';target.readOnly=true;target.style.cssText='position:fixed;right:10px;bottom:50px;width:100px';document.body.append(target);
    const locked=controller.handle('write private words in the Message input',capture());target.readOnly=false;
    const second=target.cloneNode();second.value='second';second.style.bottom='90px';document.body.append(second);
    const ambiguous=controller.handle('write private words in the Message field',capture());
    const values=[other.value,target.value,second.value];controller.handle('cancel',capture());
    const literal=controller.handle('type "meet in the football field"',capture());
    return {missing:missing.tone,locked:locked.tone,ambiguous:ambiguous.tone,values,literal:literal.tone,other:other.value};
  });
  expect(result).toEqual({missing:'error',locked:'error',ambiguous:'question',values:['safe','locked','second'],literal:'success',other:'safe meet in the football field'});
});

test('overlay asks for confirmation of a far dictation field before changing it',async({page})=>{
  test.skip(page.viewportSize().width<1000,'needs room beside the panel');await page.goto('/practice-site/contact.html');
  await page.evaluate(()=>{const host=document.getElementById('gaze-web-navigator');for(const e of [...document.body.children])if(e!==host)e.remove();document.body.insertAdjacentHTML('beforeend','<input id="other" aria-label="Other" value="safe" style="position:fixed;left:10px;top:20px;width:100px"><input id="message" aria-label="Message" value="one" style="position:fixed;left:10px;top:420px;width:100px">');});
  const panel=page.locator('#gaze-web-navigator section');await page.mouse.move(30,30);
  await panel.getByLabel('Typed instruction').fill('type hello in the Message field; please:');await panel.getByRole('button',{name:'Do it',exact:true}).click();
  await expect(panel.locator('.status')).toContainText('not near your gaze');await expect(page.locator('#other')).toHaveValue('safe');await expect(page.locator('#message')).toHaveValue('one');
  await panel.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.locator('#message')).toHaveValue('one hello');await expect(page.locator('#other')).toHaveValue('safe');
});
