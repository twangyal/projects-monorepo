import {test,expect,type Page} from '@playwright/test';
import {openRoll,readRoll} from './roll-edit-fixtures.ts';
import {loadFixture,phraseFixture,savedProject} from './browser/continuation-fixtures.ts';

async function rejectDeparture(page:Page){
 const pending=page.waitForEvent('dialog',{timeout:2000});
 const navigation=page.reload({timeout:5000}).catch(()=>null);
 const dialog=await pending;expect(dialog.type()).toBe('beforeunload');await dialog.dismiss();await navigation;
}
test('native departure warns for unapplied notes without publishing them and stops warning after discard',async({page})=>{
 await openRoll(page);await expect(page.locator('#save-status')).toHaveText('Saved in this browser');const before=await readRoll(page);
 await page.locator('[data-note="fractional-low"]').click();await page.getByLabel('Pitch (MIDI)',{exact:true}).fill('72');
 await rejectDeparture(page);await expect(page.getByLabel('Pitch (MIDI)',{exact:true})).toHaveValue('72');expect(await savedProject(page)).toEqual(before.document.composition);
 await page.getByRole('button',{name:'Discard note edits',exact:true}).click();expect(await readRoll(page)).toEqual(before);
 let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});await page.reload();expect(dialogs).toBe(0);expect(await readRoll(page)).toEqual(before);
});
for(const field of ['Tempo (BPM)','Track name'])test(`native departure warns for retained invalid ${field} and applying correction restores clean departure`,async({page})=>{
 await openRoll(page);await expect(page.locator('#save-status')).toHaveText('Saved in this browser');const before=await readRoll(page),input=page.getByLabel(field,{exact:true});await input.fill('');await input.press('Tab');
 await rejectDeparture(page);await expect(input).toHaveValue('');expect(await savedProject(page)).toEqual(before.document.composition);
 await input.fill(field==='Tempo (BPM)'?'120':'Fractional sine');await input.press('Tab');await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
 let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});await page.reload();expect(dialogs).toBe(0);expect(await readRoll(page)).toEqual(before);
});
test('native departure protects an unsaved continuation until deliberate apply and completed autosave',async({page})=>{
 const original=phraseFixture();await loadFixture(page,original);await page.getByRole('button',{name:'Retry save',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
 await page.getByRole('button',{name:'Suggest continuation',exact:true}).click();await expect(page.locator('#continuation-proposal')).toBeVisible();await rejectDeparture(page);expect(await savedProject(page)).toEqual(original);
 await page.getByRole('button',{name:'Apply continuation',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved in this browser');const applied=await savedProject(page);expect(applied.tracks[0].notes.length).toBeGreaterThan(original.tracks[0].notes.length);
 let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});await page.reload();expect(dialogs).toBe(0);expect(await savedProject(page)).toEqual(applied);
});
