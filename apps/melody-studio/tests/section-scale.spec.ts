import {test,expect} from '@playwright/test';
import {openRoll,readRoll,rollDownload,rollBackup,assertMidi,assertWav} from './roll-edit-fixtures.ts';
import {savedProject} from './browser/continuation-fixtures.ts';
function fixture(){const p=rollBackup();p.document.composition.tracks[0].notes.push({id:'following',pitch:65,start:3,duration:.5,velocity:.4});return p;}
async function bounds(page:import('@playwright/test').Page,start='1',end='3.5'){await page.getByLabel('Section start beat',{exact:true}).fill(start);await page.getByLabel('Section end beat (exclusive)',{exact:true}).fill(end);}
test('stretch and compress ripple one track with exact MIDI WAV complete history and reload',async({page})=>{
 await openRoll(page,fixture());const before=await readRoll(page);await bounds(page);await page.getByRole('button',{name:'Stretch section timing ×2',exact:true}).click();
 const expected=structuredClone(before),notes=expected.document.composition.tracks[0].notes;notes[0].start=2/3;notes[0].duration=4/3;notes[1].start=1;notes[1].duration=1.5;notes[2].start=4.25;notes[2].duration=.75;notes[3].start=5.5;
 expect(await readRoll(page)).toEqual(expected);assertMidi(await rollDownload(page,'Export MIDI'),expected.document.composition);assertWav(await rollDownload(page,'Export WAV'),expected.document.composition);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(expected);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(expected);
 await bounds(page,'1','6');await page.getByRole('button',{name:'Compress section timing ×0.5',exact:true}).click();expect(await readRoll(page)).toEqual(before);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(expected);
});
test('refusals preserve complete automation effects reference bytes and existing Redo',async({page})=>{
 const p=fixture();p.document.composition.tracks[0].volumeRamp={start:0,end:4,from:1,to:0};p.document.composition.tracks[0].echo={beats:1,decay:.5,repeats:3};await openRoll(page,p);const before=await readRoll(page);
 await bounds(page);await page.getByRole('button',{name:'Stretch section timing ×2',exact:true}).click();const changed=await readRoll(page);expect(changed.document.composition.tracks[0].volumeRamp).toEqual(before.document.composition.tracks[0].volumeRamp);expect(changed.assets).toEqual(before.assets);expect(changed.document.references).toEqual(before.document.references);expect(changed.document.composition.tracks[1]).toEqual(before.document.composition.tracks[1]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 for(const [start,end,action,message] of [['1','3.5','Compress section timing ×0.5','duration'],['1.5','3.5','Stretch section timing ×2','crosses'],['2.5','3','Stretch section timing ×2','no note onsets'],['','3.5','Stretch section timing ×2','bounds']]){
  await bounds(page,start,end);await page.getByRole('button',{name:action,exact:true}).click();await expect(page.locator('#notice')).toContainText(message);expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
 }
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(changed);
});
test('scale protects focused drafts and works by keyboard at 390px',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openRoll(page,fixture());const before=await readRoll(page);await bounds(page);const title=page.getByLabel('Project title',{exact:true});await title.fill('Unsent stretch title');await page.getByRole('button',{name:'Stretch section timing ×2',exact:true}).click();await expect(title).toHaveValue('Unsent stretch title');await expect(title).toBeFocused();expect(await savedProject(page)).toEqual(before.document.composition);
 await title.fill(before.document.composition.title);await title.press('Tab');await page.locator('[data-note="fractional-low"]').press('Enter');await page.getByLabel('Duration (beats)',{exact:true}).fill('');await page.getByRole('button',{name:'Stretch section timing ×2',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByLabel('Duration (beats)',{exact:true})).toHaveValue('');expect(await readRoll(page)).toEqual(before);
 await page.getByRole('button',{name:'Discard note edits',exact:true}).click();await page.getByRole('button',{name:'Stretch section timing ×2',exact:true}).focus();await page.keyboard.press('Enter');expect((await readRoll(page)).document.composition.tracks[0].notes[3].start).toBe(5.5);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Stretch section timing ×2',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('section-scale-mobile.png')});
});
