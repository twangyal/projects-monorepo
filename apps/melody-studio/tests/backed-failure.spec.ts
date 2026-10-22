import {test,expect} from './helpers/expanded-workspace.ts';
import {microphone,open,backup,stored,released,probe} from './backed-recording-fixtures.ts';

test('actual lost microphone input explains refusal and retains complete prior take and history',async({page})=>{
 await microphone(page);
 await page.addInitScript(()=>{
  const native=AudioContext.prototype.createMediaStreamSource;
  let source:MediaStreamAudioSourceNode|null=null;
  AudioContext.prototype.createMediaStreamSource=function(stream){source=native.call(this,stream);return source;};
  Object.defineProperty(window,'dropRecordedInput300',{value:()=>{if(!source)throw new Error('No actual microphone graph');source.disconnect();}});
 });
 await open(page);const before=await backup(page);
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Undo',exact:true}).click();const previous=await backup(page);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await backup(page)).toEqual(before);await expect(page.locator('#save-status')).toHaveText('Saved in this browser');const durable=await stored(page);
 const undo=await page.getByRole('button',{name:'Undo',exact:true}).isEnabled(),redo=await page.getByRole('button',{name:'Redo',exact:true}).isEnabled();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Record with backing',exact:true}).click();
 await expect(page.locator('#capture-state')).toContainText(/count.?in/i);
 await page.evaluate(()=>(window as unknown as {dropRecordedInput300:()=>void}).dropRecordedInput300());
 await expect(page.locator('#notice')).toContainText('The microphone input stopped. Your prior take is unchanged.');
 await expect(page.locator('#notice')).toContainText(/try again explicitly/i);await released(page);
 expect(await backup(page)).toEqual(before);expect(await stored(page)).toEqual(durable);
 expect(await page.getByRole('button',{name:'Undo',exact:true}).isEnabled()).toBe(undo);expect(await page.getByRole('button',{name:'Redo',exact:true}).isEnabled()).toBe(redo);
 await expect(page.getByRole('button',{name:'Record with backing',exact:true})).toBeEnabled();expect((await probe(page)).requests).toBe(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await backup(page)).toEqual(previous);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await backup(page)).toEqual(before);
});
