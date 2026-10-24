import {test,expect} from './helpers/expanded-workspace.ts';
import {openRoll,readRoll,rollDownload,assertMidi,assertWav,rollBackup} from './roll-edit-fixtures.ts';
test('cycle chord voicing retains ordinary project history and exported sound',async({page})=>{
 await openRoll(page);await page.locator('[data-note="later-accent"]').press('Enter');
 await page.getByRole('button',{name:'Add chord tones',exact:true}).click();
 const before=await readRoll(page),expected=structuredClone(before);expected.document.composition.tracks[0].notes.find(n=>n.id==='later-accent')!.pitch=76;
 await page.getByRole('button',{name:'Raise lowest chord voice',exact:true}).click();
 await expect(page.locator('#notice')).toContainText('Chord voicing');
 expect(await readRoll(page)).toEqual(expected);
 assertMidi(await rollDownload(page,'Export MIDI'),expected.document.composition);assertWav(await rollDownload(page,'Export WAV'),expected.document.composition);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
 await page.reload();expect(await readRoll(page)).toEqual(expected);
 await page.locator('[data-note="later-accent"]').press('Enter');await expect(page.getByLabel('Pitch (MIDI)',{exact:true})).toHaveValue('76');
});

test('lower voicing preserves expression while phone drafts refuse pointer and keyboard actions',async({page})=>{
 await page.setViewportSize({width:390,height:900});await openRoll(page);await page.locator('[data-note="later-accent"]').press('Enter');
 const lower=page.getByRole('button',{name:'Lower highest chord voice',exact:true});
 const single=await readRoll(page);await lower.click();await expect(page.locator('#notice')).toContainText('at least two');expect(await readRoll(page)).toEqual(single);
 await page.getByRole('button',{name:'Add chord tones',exact:true}).click();const before=await readRoll(page),expected=structuredClone(before);
 expected.document.composition.tracks[0].notes.find(n=>n.pitch===71)!.pitch=59;
 const title=page.getByLabel('Project title',{exact:true});await title.fill('Unapplied voicing title');await lower.click();await expect(title).toHaveValue('Unapplied voicing title');
 await expect(page.locator('#notice')).toContainText('Apply or discard');
 await title.fill(before.document.composition.title);await title.press('Tab');await page.getByLabel('Duration (beats)',{exact:true}).fill('');
 await lower.focus();await page.keyboard.press('Enter');await expect(page.getByLabel('Duration (beats)',{exact:true})).toHaveValue('');await expect(page.locator('#notice')).toContainText('Apply or discard');
 await page.getByRole('button',{name:'Discard note edits',exact:true}).click();await lower.click();await expect(page.locator('#notice')).toContainText('Chord voicing');expect(await readRoll(page)).toEqual(expected);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);
 await page.getByRole('button',{name:'Focus workspace',exact:true}).click();await page.getByRole('button',{name:'Notes',exact:true}).click();await lower.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#workspace-feedback')).toContainText('Chord voicing');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('native range boundary cycles once then refuses atomically without changing history',async({page})=>{
 const p=rollBackup(),notes=p.document.composition.tracks[0].notes;
 notes.forEach((n,i)=>{n.start=2.125;n.pitch=[84,95,86][i];});
 await openRoll(page,p);await page.locator('[data-note="later-accent"]').press('Enter');
 const raise=page.getByRole('button',{name:'Raise lowest chord voice',exact:true});
 await raise.click();await expect(page.locator('#notice')).toContainText('Chord voicing');
 const expected=structuredClone(p);expected.document.composition.tracks[0].notes[0].pitch=96;expect(await readRoll(page)).toEqual(expected);
 await raise.click();await expect(page.locator('#notice')).toContainText('C2–C7');expect(await readRoll(page)).toEqual(expected);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(p);
 await page.getByRole('button',{name:'Lower highest chord voice',exact:true}).click();await expect(page.locator('#notice')).toContainText('Chord voicing');
 const lower=structuredClone(p);lower.document.composition.tracks[0].notes[1].pitch=83;expect(await readRoll(page)).toEqual(lower);
});
