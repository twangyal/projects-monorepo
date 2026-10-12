import {test,expect} from '@playwright/test';
import {openRoll,readRoll,rollBackup,rollDownload,assertMidi,assertWav} from './roll-edit-fixtures.ts';
import {savedProject} from './browser/continuation-fixtures.ts';

function joinedFixture(){const p=rollBackup();p.document.composition.tracks[0].notes=[{id:'fractional-low',pitch:60,start:.25,duration:.75,velocity:.5},{id:'following',pitch:60,start:1,duration:.5,velocity:.5},{id:'independent',pitch:67,start:1,duration:1,velocity:.25}];return p;}
test('join produces a sustained voice with exact project MIDI WAV undo redo and reload',async({page})=>{
 test.setTimeout(60000);await openRoll(page,joinedFixture());const before=await readRoll(page);await page.locator('[data-note="fractional-low"]').press('Enter');
 const button=page.getByRole('button',{name:'Join next matching note',exact:true});await expect(button).toBeVisible({timeout:1000});await button.click();
 const expected=structuredClone(before);expected.document.composition.tracks[0].notes.splice(0,2,{...before.document.composition.tracks[0].notes[0],duration:1.25});
 expect(await readRoll(page)).toEqual(expected);assertMidi(await rollDownload(page,'Export MIDI'),expected.document.composition);assertWav(await rollDownload(page,'Export WAV'),expected.document.composition);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(expected);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();await expect(page.getByRole('button',{name:'Save project file',exact:true})).toBeEnabled();expect(await readRoll(page)).toEqual(expected);
});
test('join refuses pointer and keyboard drafts and preserves redo on missing next note',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openRoll(page,joinedFixture());const before=await readRoll(page);await page.locator('[data-note="fractional-low"]').press('Enter');
 const button=page.getByRole('button',{name:'Join next matching note',exact:true});await expect(button).toBeVisible({timeout:1000});
 await page.getByLabel('Project title',{exact:true}).fill('Unsent join title');await button.click();await expect(page.getByLabel('Project title',{exact:true})).toHaveValue('Unsent join title');expect(await savedProject(page)).toEqual(before.document.composition);
 await page.getByLabel('Project title',{exact:true}).fill(before.document.composition.title);await page.getByLabel('Project title',{exact:true}).press('Tab');await page.getByLabel('Duration (beats)',{exact:true}).fill('');await button.focus();await page.keyboard.press('Enter');await expect(page.getByLabel('Duration (beats)',{exact:true})).toHaveValue('');expect(await savedProject(page)).toEqual(before.document.composition);
 await page.getByRole('button',{name:'Discard note edits',exact:true}).click();await button.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.locator('[data-note="independent"]').press('Enter');await button.click();await expect(page.locator('#notice')).toContainText('exactly one touching');expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await button.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('note-articulation-mobile.png')});
});
