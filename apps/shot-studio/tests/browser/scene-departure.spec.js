import {test,expect} from '@playwright/test';

async function warns(page){
  const dialog=page.waitForEvent('dialog',{timeout:2500});
  const reload=page.reload({timeout:5000}).catch(()=>null);
  const event=await dialog;expect(event.type()).toBe('beforeunload');await event.dismiss();await reload;
}
async function cleanReload(page){
  let warned=false;const listener=async dialog=>{warned=true;await dialog.dismiss();};
  page.on('dialog',listener);await page.reload();page.off('dialog',listener);expect(warned).toBe(false);
}
async function title(page,text){await page.getByLabel('Film title').fill(text);await page.getByLabel('Film title').press('Tab');}

test('failed committed scene save warns after backup download, then successful save clears protection',async({page})=>{
  await page.goto('/');await title(page,'Saved film A');
  const original=await page.evaluate(()=>localStorage.getItem('shot-studio-v1'));
  await page.evaluate(()=>{const write=Storage.prototype.setItem;window.failSceneSave=true;Storage.prototype.setItem=function(key,value){if(key==='shot-studio-v1'&&window.failSceneSave)throw new DOMException('Synthetic quota','QuotaExceededError');return write.call(this,key,value);};});
  await title(page,'Unsaved film B');await expect(page.locator('#draftNotice')).toBeHidden();
  await expect(page.locator('#status')).toContainText('storage is unavailable');
  expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(original);
  await warns(page);await expect(page.getByLabel('Film title')).toHaveValue('Unsaved film B');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();await downloading;
  await warns(page);await expect(page.getByLabel('Film title')).toHaveValue('Unsaved film B');
  await page.evaluate(()=>{window.failSceneSave=false;});await title(page,'Saved film C');
  await expect(page.locator('#status')).toContainText('Saved in this browser');await cleanReload(page);
  await expect(page.getByLabel('Film title')).toHaveValue('Saved film C');
});

test('protected startup record keeps committed work guarded until confirmed replacement succeeds',async({page})=>{
  await page.goto('/');await page.evaluate(()=>localStorage.setItem('shot-studio-v1','{original unreadable'));await page.reload();
  await title(page,'Protected memory film');await expect(page.locator('#draftNotice')).toBeHidden();
  await warns(page);expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe('{original unreadable');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Replace browser draft',exact:true}).click();
  await warns(page);
  await page.evaluate(()=>{const write=Storage.prototype.setItem;window.failReplacement=true;Storage.prototype.setItem=function(key,value){if(key==='shot-studio-v1'&&window.failReplacement)throw new DOMException('Synthetic quota','QuotaExceededError');return write.call(this,key,value);};});
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Replace browser draft',exact:true}).click();
  await expect(page.locator('#status')).toContainText('Could not replace');await warns(page);
  expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe('{original unreadable');
  await page.evaluate(()=>{window.failReplacement=false;});
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Replace browser draft',exact:true}).click();
  await expect(page.locator('#status')).toContainText('explicitly replaced');await cleanReload(page);
  await expect(page.getByLabel('Film title')).toHaveValue('Protected memory film');
});
