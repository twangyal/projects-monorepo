import { test, expect } from '@playwright/test';
import { savedProject } from './browser/continuation-fixtures.ts';
import { openRoll, readRoll, rollDownload, assertMidi, assertWav } from './roll-edit-fixtures.ts';

test('timing review is unsaved and one exact reference-preserving edit reaches history, real exports and reload',async({page})=>{
 await openRoll(page);const original=await readRoll(page);
 await page.getByRole('button',{name:'Review timing',exact:true}).click();
 await expect(page.locator('#timing-status')).toContainText('2 of 3');
 expect(await readRoll(page)).toEqual(original);
 await expect(page.locator('[data-timing-note="fractional-low"]')).toContainText('1.25');
 await page.getByRole('button',{name:'Apply timing',exact:true}).click();
 const expected=structuredClone(original);expected.document.composition.tracks[0].notes[0].start=.25;expected.document.composition.tracks[0].notes[2].start=2.25;
 expect(await readRoll(page)).toEqual(expected);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(original);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(expected);
 assertMidi(await rollDownload(page,'Export MIDI'),expected.document.composition);assertWav(await rollDownload(page,'Export WAV'),expected.document.composition);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(expected);
});
test('changing timing settings retires review, preserves raw text and applies deliberate swing/strength',async({page})=>{
 await openRoll(page);const original=await readRoll(page);
 await page.getByRole('button',{name:'Review timing',exact:true}).click();
 await page.getByLabel('Timing strength (%)',{exact:true}).fill('');await expect(page.getByRole('button',{name:'Apply timing',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Review timing',exact:true}).click();await expect(page.locator('#timing-status')).toContainText('finite');
 await expect(page.getByLabel('Timing strength (%)',{exact:true})).toHaveValue('');expect(await readRoll(page)).toEqual(original);
 await page.getByLabel('Timing grid (beats)',{exact:true}).selectOption('.5');await page.getByLabel('Timing strength (%)',{exact:true}).fill('50');await page.getByLabel('Timing swing (%)',{exact:true}).fill('25');
 await page.getByRole('button',{name:'Review timing',exact:true}).click();await page.getByRole('button',{name:'Apply timing',exact:true}).click();
 const result=await readRoll(page);expect(result.document.composition.tracks[0].notes.map(n=>n.start)).toEqual([.47916666666666663,.5625,2.0625]);
 expect(result.assets).toEqual(original.assets);expect(result.document.references).toEqual(original.document.references);
});
test('focused raw editor fields refuse timing preparation before blur and leave redo intact',async({page})=>{
 await openRoll(page);await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();const original=await readRoll(page);await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
 await page.getByLabel('Project title').fill('An unsent title');
 await page.getByRole('button',{name:'Review timing',exact:true}).click();await expect(page.locator('#notice')).toContainText('unapplied');
 await expect(page.getByLabel('Project title')).toHaveValue('An unsent title');await expect(page.getByLabel('Project title')).toBeFocused();expect(await savedProject(page)).toEqual(original.document.composition);
 await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Apply timing',exact:true})).toBeDisabled();
});
test('source edits retire review and discard/no-change timing preserve the redo branch',async({page})=>{
 await openRoll(page);await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();const original=await readRoll(page);
 await page.getByRole('button',{name:'Review timing',exact:true}).click();await page.getByRole('button',{name:'Discard timing',exact:true}).click();expect(await readRoll(page)).toEqual(original);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
 await page.getByLabel('Timing strength (%)',{exact:true}).fill('0');await page.getByRole('button',{name:'Review timing',exact:true}).click();await page.getByRole('button',{name:'Apply timing',exact:true}).click();expect(await readRoll(page)).toEqual(original);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
 await page.getByLabel('Timing strength (%)',{exact:true}).fill('100');await page.getByRole('button',{name:'Review timing',exact:true}).click();await page.getByRole('button',{name:'Transpose up a semitone',exact:true}).click();await expect(page.getByRole('button',{name:'Apply timing',exact:true})).toBeDisabled();
 expect((await readRoll(page)).document.composition.tracks[0].notes.map(n=>n.start)).toEqual(original.document.composition.tracks[0].notes.map(n=>n.start));
});
test('390px keyboard review and application remain usable without page overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openRoll(page);
 const review=page.getByRole('button',{name:'Review timing',exact:true});await review.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Apply timing',exact:true})).toBeEnabled();
 const apply=page.getByRole('button',{name:'Apply timing',exact:true});await apply.focus();await page.keyboard.press('Enter');expect((await readRoll(page)).document.composition.tracks[0].notes[0].start).toBe(.25);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
