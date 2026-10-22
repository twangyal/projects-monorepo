import {test,expect} from './helpers/expanded-workspace.ts';
import {openRoll,readRoll,rollDownload,assertMidi,assertWav} from './roll-edit-fixtures.ts';
import {savedProject} from './browser/continuation-fixtures.ts';
test('rolling a chord retains ordinary editable voices in backups MIDI WAV history and reload',async({page})=>{
  await openRoll(page);await page.locator('[data-note="later-accent"]').press('Enter');
  await page.getByRole('button',{name:'Add chord tones',exact:true}).click();await expect(page.locator('#notice')).toContainText('Chord tones added');
  const before=await readRoll(page);await page.getByText('Roll chord attacks',{exact:true}).click();
  await page.getByLabel('Roll direction',{exact:true}).selectOption('up');await page.getByLabel('Attack spacing (beats)',{exact:true}).selectOption('0.5');
  await page.getByRole('button',{name:'Roll chord notes',exact:true}).click();await expect(page.locator('#notice')).toContainText('Chord attacks rolled');
  const after=await readRoll(page),expected=structuredClone(before);
  for(const note of expected.document.composition.tracks[0].notes)if(note.start===2.125)note.start=note.pitch===64?2.125:note.pitch===68?2.625:3.125;
  expect(after).toEqual(expected);assertMidi(await rollDownload(page,'Export MIDI'),expected.document.composition);assertWav(await rollDownload(page,'Export WAV'),expected.document.composition);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(after);
  const middle=after.document.composition.tracks[0].notes.find(n=>n.pitch===68)!;await page.locator(`[data-note="${middle.id}"]`).press('Enter');await expect(page.getByLabel('Pitch (MIDI)',{exact:true})).toHaveValue('68');
});
test('phone chord rolling keeps session settings and refuses a single voice and unapplied drafts',async({page})=>{
  await page.setViewportSize({width:390,height:900});await openRoll(page);await page.locator('[data-note="later-accent"]').press('Enter');
  const before=await readRoll(page);await page.getByText('Roll chord attacks',{exact:true}).click();
  await page.getByLabel('Roll direction',{exact:true}).selectOption('down');await page.getByLabel('Attack spacing (beats)',{exact:true}).selectOption('0.25');
  const button=page.getByRole('button',{name:'Roll chord notes',exact:true});await button.click();await expect(page.locator('#notice')).toContainText('at least two');expect(await readRoll(page)).toEqual(before);
  const title=page.getByLabel('Project title',{exact:true});await title.fill('Unsent rolled song');await button.click();await expect(title).toHaveValue('Unsent rolled song');expect(await savedProject(page)).toEqual(before.document.composition);
  await title.fill(before.document.composition.title);await title.press('Tab');await page.getByLabel('Duration (beats)',{exact:true}).fill('');if(!await button.isVisible())await page.getByText('Roll chord attacks',{exact:true}).click();await expect(button).toBeVisible();await button.focus();await expect(button).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#notice')).toContainText('Apply or discard');await expect(page.getByLabel('Duration (beats)',{exact:true})).toHaveValue('');expect(await savedProject(page)).toEqual(before.document.composition);
  await page.getByRole('button',{name:'Discard note edits',exact:true}).click();await page.getByRole('button',{name:'Add chord tones',exact:true}).click();await page.getByText('Roll chord attacks',{exact:true}).click();
  await expect(page.getByLabel('Roll direction',{exact:true})).toHaveValue('down');await expect(page.getByLabel('Attack spacing (beats)',{exact:true})).toHaveValue('0.25');
  await page.getByRole('button',{name:'Focus workspace',exact:true}).click();for(const name of ['Compose','Sound','Arrange']){await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('#chord-roll-panel')).toBeHidden();}await page.getByRole('button',{name:'Notes',exact:true}).click();await expect(page.locator('#chord-roll-panel')).toBeVisible();await button.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-feedback')).toContainText('Chord attacks rolled');const result=await savedProject(page);expect(result.tracks[0].notes.slice(2).map(n=>[n.pitch,n.start])).toEqual([[64,2.625],[68,2.375],[71,2.125]]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
