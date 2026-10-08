import {test,expect} from '@playwright/test';
import {sequenceStoredState} from './sequence-storage-fixtures.js';

// Controlled omission of one real encoded output tests admission, not overload.
test('native output omission refuses publication and preserves saved authoring',async({page})=>{
 await page.addInitScript(()=>{
  const Native=VideoEncoder;window.completeFrameTest={omitted:0,encoders:[]};
  window.VideoEncoder=class extends Native{
   constructor(init){
    super({...init,output:(chunk,metadata)=>{
     if(chunk.timestamp===33333){window.completeFrameTest.omitted++;return;}
     init.output(chunk,metadata);
    }});
    window.completeFrameTest.encoders.push(this);
   }
  };
 });
 await page.goto('/');
 await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
 // Pin a short authored shot; wait through its unchanged duration+10s product deadline.
 await page.locator('#duration').fill('1');await page.locator('#duration').press('Tab');
 await page.locator('#sequence-add-current').click();await page.locator('#sequence-add-shot').click();
 await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
 const ordinary=await page.evaluate(()=>localStorage.getItem('shot-studio-v1')),sequence=await sequenceStoredState(page);
 const downloads=[];page.on('download',file=>downloads.push(file.suggestedFilename()));
 await page.locator('#sequence-export').click();
 await expect(page.locator('#sequence-status')).toContainText('Encoder dropped video frames',{timeout:12000});
 await expect(page.locator('#sequence-export')).toBeEnabled();
 const native=await page.evaluate(()=>({omitted:completeFrameTest.omitted,states:completeFrameTest.encoders.map(e=>e.state)}));
 expect(native.omitted).toBe(1);expect(native.states.length).toBeGreaterThan(0);expect(native.states.every(s=>s==='closed')).toBe(true);
 expect(downloads).toEqual([]);
 expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(ordinary);
 expect(await sequenceStoredState(page)).toEqual(sequence);
});
