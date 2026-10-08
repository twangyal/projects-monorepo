import {test,expect} from '@playwright/test';
import {openRoll,readRoll,rollBackup,rollDownload,assertWav,assertMidi} from './roll-edit-fixtures.ts';
import {downloadedBytes} from './browser/continuation-fixtures.ts';

test('isolated track WAV excludes another audible part and preserves exact full backup and redo',async({page})=>{
 const fixture=rollBackup();fixture.document.composition.tracks[1].muted=false;
 await openRoll(page,fixture);await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();const before=await readRoll(page);
 await expect(page.getByRole('button',{name:'Export track WAV',exact:true})).toBeVisible({timeout:1000});
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export track WAV',exact:true}).click();const file=await pending;
 expect(file.suggestedFilename()).toMatch(/-track-1-Fractional-sine\.wav$/);
 const isolated=structuredClone(before.document.composition);isolated.tracks[1].muted=true;
 assertWav(await downloadedBytes(file),isolated);
 expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
 assertMidi(await rollDownload(page,'Export MIDI'),before.document.composition);
});
test('native Solo and Stop use committed part at song tempo and preserve an unapplied timing review',async({page})=>{
 await openRoll(page);const before=await readRoll(page);await page.getByRole('button',{name:'Review timing',exact:true}).click();
 await page.getByRole('button',{name:'Solo track',exact:true}).click();await expect(page.locator('#notice')).toContainText('Soloing');await expect(page.getByRole('button',{name:'Stop playback',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Stop playback',exact:true}).click();await expect(page.getByRole('button',{name:'Stop playback',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Apply timing',exact:true})).toBeEnabled();
 assertWav(await rollDownload(page,'Export track WAV'),before.document.composition);expect(await readRoll(page)).toEqual(before);
});
test('muted or zero-volume solo/export refuses with guidance instead of a silent download',async({page})=>{
 await openRoll(page);const before=await readRoll(page);const downloads:string[]=[];page.on('download',file=>downloads.push(file.suggestedFilename()));
 await page.getByRole('button',{name:'Select track: Muted independent part',exact:true}).click();
 await page.getByRole('button',{name:'Solo track',exact:true}).click();await expect(page.locator('#notice')).toContainText('Unmute');
 await page.getByRole('button',{name:'Export track WAV',exact:true}).click();await expect(page.locator('#notice')).toContainText('Unmute');expect(downloads).toEqual([]);
 await expect(page.getByRole('button',{name:'Stop playback',exact:true})).toBeDisabled();
 page.removeAllListeners('download');expect(await readRoll(page)).toEqual(before);
 const zero=rollBackup();zero.document.composition.tracks[0].volume=0;await openRoll(page,zero);
 await page.getByRole('button',{name:'Export track WAV',exact:true}).click();await expect(page.locator('#notice')).toContainText('volume');
});
test('short selected part exports a full512-beat aligned WAV without changing late other notes',async({page})=>{
 const fixture=rollBackup();fixture.document.composition.tracks[1].notes[0].start=511.75;fixture.document.composition.tracks[1].notes[0].duration=.25;
 await openRoll(page,fixture);const before=await readRoll(page);
 const measured=assertWav(await rollDownload(page,'Export track WAV'),before.document.composition);expect(measured.samples).toBe(5_646_564);
 expect(await readRoll(page)).toEqual(before);await page.reload();expect(await readRoll(page)).toEqual(before);
});
test('natural solo and full-mix endings restore Solo readiness without a forced Stop or edit',async({page})=>{
 await openRoll(page);const before=await readRoll(page);
 const solo=page.getByRole('button',{name:'Solo track',exact:true}),stop=page.getByRole('button',{name:'Stop playback',exact:true});
 await solo.click();await expect(stop).toBeEnabled();await expect(stop).toBeDisabled({timeout:6000});await expect(solo).toBeEnabled({timeout:1000});
 await page.getByRole('button',{name:'Play composition',exact:true}).click();await expect(stop).toBeEnabled();await expect(stop).toBeDisabled({timeout:6000});await expect(solo).toBeEnabled({timeout:1000});
 expect(await readRoll(page)).toEqual(before);
});
