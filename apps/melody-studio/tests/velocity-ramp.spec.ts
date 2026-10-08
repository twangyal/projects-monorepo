import { test, expect } from '@playwright/test';
import { openRoll, readRoll, rollDownload, assertMidi, assertWav } from './roll-edit-fixtures.ts';
import { savedProject, decodeMidi } from './browser/continuation-fixtures.ts';

test('phrase dynamics is one reference-preserving edit through undo, redo, native exports and reload',async({page})=>{
 await openRoll(page);const before=await readRoll(page);
 await page.getByLabel('Section end beat (exclusive)').fill('4.5');
 await page.getByLabel('Ramp start velocity').fill('.2');await page.getByLabel('Ramp end velocity').fill('.8');
 await page.getByRole('button',{name:'Apply velocity ramp',exact:true}).click();await expect(page.locator('#notice')).toContainText('Velocity ramp applied');
 const after=await readRoll(page),expected=structuredClone(before);
 expected.document.composition.tracks[0].notes[0].velocity=.2;
 expected.document.composition.tracks[0].notes[1].velocity=.2+(.8-.2)*(.5-1/3)/(2.125-1/3);
 expected.document.composition.tracks[0].notes[2].velocity=.8;
 expect(after).toEqual(expected);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(after);
 assertMidi(await rollDownload(page,'Export MIDI'),expected.document.composition);assertWav(await rollDownload(page,'Export WAV'),expected.document.composition);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(after);
});
test('invalid, empty and single-onset selections preserve project and redo; zero ramp endpoint is silent in MIDI',async({page})=>{
 await openRoll(page);await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();const before=await readRoll(page);
 await page.getByLabel('Section end beat (exclusive)').fill('4.5');await page.getByLabel('Ramp start velocity').fill('');
 await page.getByRole('button',{name:'Apply velocity ramp',exact:true}).click();await expect(page.locator('#notice')).toContainText('Ramp start velocity');expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
 await page.getByLabel('Ramp start velocity').fill('1');await page.getByLabel('Ramp end velocity').fill('0');
 for(const bounds of [['1.6','2'],['3','4']]){await page.getByLabel('Section start beat').fill(bounds[0]);await page.getByLabel('Section end beat (exclusive)').fill(bounds[1]);await page.getByRole('button',{name:'Apply velocity ramp',exact:true}).click();expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();}
 await page.getByLabel('Section start beat').fill('1');await page.getByLabel('Section end beat (exclusive)').fill('4.5');await page.getByRole('button',{name:'Apply velocity ramp',exact:true}).click();
 expect(decodeMidi(await rollDownload(page,'Export MIDI')).tracks[1].notes.map(n=>n.pitch)).toEqual([60,67]);
});
test('390px focused title and invalid note drafts are guarded before ramp activation',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openRoll(page);await expect(page.locator('#save-status')).toHaveText('Saved in this browser');const before=await savedProject(page);
 await page.getByLabel('Section end beat (exclusive)').fill('4.5');const field=page.getByLabel('Project title');await field.fill('Unsent dynamics title');await page.getByRole('button',{name:'Apply velocity ramp',exact:true}).click();
 await expect(page.locator('#notice')).toContainText('unapplied');await expect(field).toHaveValue('Unsent dynamics title');await expect(field).toBeFocused();expect(await savedProject(page)).toEqual(before);
 await field.fill('Original fractional overlap');await page.locator('[data-note="fractional-low"]').click();const start=page.getByLabel('Start beat',{exact:true});await start.fill('');
 await page.getByRole('button',{name:'Apply velocity ramp',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('#notice')).toContainText('unapplied');await expect(start).toHaveValue('');expect(await savedProject(page)).toEqual(before);
 await page.locator('#dynamics-heading').scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('velocity-ramp-mobile.png')});
});
