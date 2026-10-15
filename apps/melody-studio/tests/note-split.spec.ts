import {test,expect} from './helpers/expanded-workspace.ts';
import {savedProject} from './browser/continuation-fixtures.ts';
import {openRoll,readRoll,rollDownload,assertMidi,assertWav} from './roll-edit-fixtures.ts';

test('split selected note preserves exact references and exports through undo redo and reload',async({page})=>{
 test.setTimeout(60000);await openRoll(page);const before=await readRoll(page);
 await page.locator('[data-note="fractional-low"]').press('Enter');
 await page.getByLabel('Split at beat',{exact:true}).fill(String(1+2/3));
 await page.getByRole('button',{name:'Split selected note',exact:true}).click();
 const after=await readRoll(page),notes=after.document.composition.tracks[0].notes;
 const at=Number(String(1+2/3))-1;
 const expected=structuredClone(before);expected.document.composition.tracks[0].notes.splice(0,1,
 {...before.document.composition.tracks[0].notes[0],duration:at-1/3},
 {...before.document.composition.tracks[0].notes[0],id:notes[1].id,start:at,duration:1-at});
 expect(notes[1].id).not.toBe(notes[0].id);expect(after).toEqual(expected);
 assertMidi(await rollDownload(page,'Export MIDI'),after.document.composition);
 assertWav(await rollDownload(page,'Export WAV'),after.document.composition);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(after);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(after);
});
test('split keyboard and pointer protect unapplied fields and invalid point keeps redo',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openRoll(page);const before=await readRoll(page);
 await page.locator('[data-note="fractional-low"]').press('Enter');
 const split=page.getByLabel('Split at beat',{exact:true}),button=page.getByRole('button',{name:'Split selected note',exact:true});
 await split.fill('1.7');await page.getByLabel('Project title',{exact:true}).fill('Unsent title');await button.click();
 await expect(page.getByLabel('Project title',{exact:true})).toHaveValue('Unsent title');expect(await savedProject(page)).toEqual(before.document.composition);
 await page.getByLabel('Project title',{exact:true}).fill(before.document.composition.title);await page.getByLabel('Project title',{exact:true}).press('Tab');
 await page.getByLabel('Duration (beats)',{exact:true}).fill('');await button.focus();await page.keyboard.press('Enter');
 await expect(page.getByLabel('Duration (beats)',{exact:true})).toHaveValue('');expect(await savedProject(page)).toEqual(before.document.composition);
 await page.getByRole('button',{name:'Discard note edits',exact:true}).click();await split.fill('1.7');await button.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#notice')).toContainText('split');await page.getByRole('button',{name:'Undo',exact:true}).click();
 await split.fill('1.4');await button.click();await expect(page.locator('#notice')).toContainText('0.25');expect(await readRoll(page)).toEqual(before);
 await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
