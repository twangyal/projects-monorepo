import {test,expect} from '@playwright/test';
import {openRoll,readRoll,rollDownload,assertMidi,assertWav,rollBackup} from './roll-edit-fixtures.ts';
import {savedProject} from './browser/continuation-fixtures.ts';
const action='Remove section and close gap';
test('remove section closes all-track gap in one complete edit with exact references history exports and reload',async({page})=>{
 await openRoll(page);const before=await readRoll(page);
 await page.getByLabel('Section start beat').fill('1');await page.getByLabel('Section end beat (exclusive)').fill('3');
 await page.getByRole('button',{name:action,exact:true}).click();await expect(page.locator('#notice')).toContainText('Section removed');
 const expected=structuredClone(before);expected.document.composition.tracks[0].notes=[{...before.document.composition.tracks[0].notes[2],start:.125}];expected.document.composition.tracks[1].notes[0].start=1;
 expect(await readRoll(page)).toEqual(expected);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(expected);
 assertMidi(await rollDownload(page,'Export MIDI'),expected.document.composition);assertWav(await rollDownload(page,'Export WAV'),expected.document.composition);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(expected);
});
test('boundary and past-song refusal preserve complete backup and redo, invalid bounds retain raw text',async({page})=>{
 await openRoll(page);await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();const before=await readRoll(page);
 await page.getByLabel('Section start beat').fill('1.5');await page.getByLabel('Section end beat (exclusive)').fill('3');await page.getByRole('button',{name:action,exact:true}).click();await expect(page.locator('#notice')).toContainText('crosses');expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
 await page.getByLabel('Section start beat').fill('4.5');await page.getByLabel('Section end beat (exclusive)').fill('5');await page.getByRole('button',{name:action,exact:true}).click();await expect(page.locator('#notice')).toContainText('fit');expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
 await page.getByLabel('Section start beat').fill('');await page.getByRole('button',{name:action,exact:true}).click();await expect(page.getByLabel('Section start beat')).toHaveValue('');expect(await readRoll(page)).toEqual(before);
});
test('focused valid unapplied title is guarded before pointer blur',async({page})=>{
 await openRoll(page);const before=await savedProject(page),field=page.getByLabel('Project title');await field.fill('Unsent trim title');
 await page.getByRole('button',{name:action,exact:true}).click();await expect(page.locator('#notice')).toContainText('unapplied');await expect(field).toBeFocused();await expect(field).toHaveValue('Unsent trim title');expect(await savedProject(page)).toEqual(before);
});
test('keyboard admission refuses a retained invalid note draft without changing complete saved project',async({page})=>{
 await openRoll(page);await page.locator('[data-note="fractional-low"]').click();const before=await savedProject(page),field=page.getByLabel('Start beat',{exact:true});await field.fill('');
 await page.getByRole('button',{name:action,exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('#notice')).toContainText('unapplied');await expect(field).toHaveValue('');expect(await savedProject(page)).toEqual(before);
});
test('390px keyboard removes entire song without deleting tracks or retained capture',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openRoll(page);const before=await readRoll(page);
 await page.getByLabel('Section start beat').fill('1');await page.getByLabel('Section end beat (exclusive)').fill('4.5');await page.getByRole('button',{name:action,exact:true}).focus();await page.keyboard.press('Enter');
 const expected=structuredClone(before);expected.document.composition.tracks.forEach(track=>track.notes=[]);expect(await readRoll(page)).toEqual(expected);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);
});
test('native long song closes an empty fractional gap and retires timing review and playback',async({page})=>{
 const fixture=rollBackup();fixture.document.composition.tracks[0].notes=[{...fixture.document.composition.tracks[0].notes[0],start:0,duration:.5},{...fixture.document.composition.tracks[0].notes[2],start:511.625,duration:.25}];fixture.document.composition.tracks[1].notes=[];
 await openRoll(page,fixture);const before=await readRoll(page);await page.getByLabel('Section start beat').fill('2.125');await page.getByLabel('Section end beat (exclusive)').fill('3.375');
 await page.getByRole('button',{name:'Review timing',exact:true}).click();await page.getByRole('button',{name:'Play composition',exact:true}).click();await expect(page.locator('#notice')).toContainText('Playing your composition');
 await expect(page.getByRole('button',{name:'Stop playback',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Apply timing',exact:true})).toBeEnabled();await page.getByRole('button',{name:action,exact:true}).click();
 const expected=structuredClone(before);expected.document.composition.tracks[0].notes[1].start=510.375;expect(await readRoll(page)).toEqual(expected);await expect(page.getByRole('button',{name:'Stop playback',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Apply timing',exact:true})).toBeDisabled();
 assertMidi(await rollDownload(page,'Export MIDI'),expected.document.composition);await page.reload();expect(await readRoll(page)).toEqual(expected);
});
