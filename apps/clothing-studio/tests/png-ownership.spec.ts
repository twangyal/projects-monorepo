import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
interface EncoderProbe{hold:boolean;ready:boolean;release:(()=>void)|null}
async function bytes(page:Page,id:string){const pending=page.waitForEvent('download');await page.locator(`#${id}`).click();const download=await pending;return{filename:download.suggestedFilename(),bytes:await readFile((await download.path())!)};}
for(const kind of ['garment','preview'] as const)for(const change of ['rename','new','open'] as const)test(`${kind} PNG keeps original snapshot filename and pixels during ${change}`,async({page})=>{
 await page.addInitScript(()=>{
  const state:EncoderProbe={hold:false,ready:false,release:null};(window as unknown as {encoderProbe:EncoderProbe}).encoderProbe=state;
  const original=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){return original.call(this,blob=>{if(state.hold){state.ready=true;state.release=()=>{state.release=null;state.hold=false;callback(blob);};}else callback(blob);},...args);};
 });
 await page.goto('/');await page.locator('#title').fill('Original A');await page.locator('#body-width').fill('240');await page.locator('#body-width').press('Tab');
 const baseline=await bytes(page,`${kind}-png`),backup=JSON.parse((await bytes(page,'backup')).bytes.toString());expect(baseline.filename).toBe(`Original A-${kind}.png`);
 await page.evaluate(()=>{const state=(window as unknown as {encoderProbe:EncoderProbe}).encoderProbe;state.hold=true;state.ready=false;});
 const pending=page.waitForEvent('download');await page.locator(`#${kind}-png`).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {encoderProbe:EncoderProbe}).encoderProbe.ready)).toBe(true);
 if(change==='rename')await page.locator('#title').fill('Renamed B');
 else if(change==='new')await page.locator('#new-project').click();
 else{backup.title='Opened B';await page.locator('#project-file').setInputFiles({name:'opened-b.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await expect(page.locator('#title')).toHaveValue('Opened B');}
 const expectedTitle=change==='rename'?'Renamed B':change==='new'?'Untitled concept':'Opened B';await expect(page.locator('#title')).toHaveValue(expectedTitle);
 await page.evaluate(()=>(window as unknown as {encoderProbe:EncoderProbe}).encoderProbe.release?.());const download=await pending;expect(download.suggestedFilename()).toBe(`Original A-${kind}.png`);expect(await readFile((await download.path())!)).toEqual(baseline.bytes);await expect(page.locator('#title')).toHaveValue(expectedTitle);await expect(page.locator(`#${kind}-png`)).toBeEnabled();
});
