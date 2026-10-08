import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openRoll,readRoll,rollBackup} from './roll-edit-fixtures.ts';
import {decodeMidi,decodeWav} from './browser/continuation-fixtures.ts';

async function download(page:Parameters<typeof readRoll>[0],name:string){const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await pending).path())!);}

test('a512-beat reference-backed song edits, auditions its ending, exports and survives reload',async({page})=>{
 const fixture=rollBackup();fixture.document.composition.title='Complete512-beat song';
 fixture.document.composition.tracks[0].notes.push({id:'song-ending',pitch:69,start:511,duration:1,velocity:.5});
 await openRoll(page,fixture);const original=await readRoll(page);
 await page.locator('[data-note="song-ending"]').click();
 await page.getByLabel('Start beat',{exact:true}).fill('512.5');await page.getByLabel('Duration (beats)').fill('.5');
 await page.getByRole('button',{name:'Apply note',exact:true}).click();
 const edited=await readRoll(page);expect(edited.document.composition.tracks[0].notes.at(-1)).toMatchObject({start:511.5,duration:.5});
 expect(edited.assets).toEqual(original.assets);expect(edited.document.references).toEqual(original.document.references);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(original);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(edited);
 await page.getByLabel('Section start beat').fill('512');await page.getByLabel('Section end beat (exclusive)').fill('513');
 await page.getByRole('button',{name:'Play section',exact:true}).click();await expect(page.locator('#notice')).toContainText('Playing section');
 await expect(page.getByRole('button',{name:'Stop playback'})).toBeDisabled({timeout:5000});
 const midiBytes=await download(page,'Export MIDI'),midi=decodeMidi(midiBytes);
 expect(midi.tracks[1].notes.at(-1)).toMatchObject({pitch:69,start:511.5,duration:.5});
 const wav=decodeWav(await download(page,'Export WAV'));expect(wav.samples.length).toBe(Math.ceil((256+.08)*22050));
 expect(wav.samples.subarray(Math.round(255.75*22050)).some(v=>v!==0)).toBe(true);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(edited);
 // Solo comparison renders the long song at unchanged capture tempo, then crops the short reference window.
 await page.getByRole('button',{name:'Play edited notes at capture tempo',exact:true}).click();await expect(page.getByRole('button',{name:'Stop playback'})).toBeEnabled();await page.getByRole('button',{name:'Stop playback'}).click();
 await page.getByLabel('Import MIDI file',{exact:true}).setInputFiles({name:'complete-song.mid',mimeType:'audio/midi',buffer:midiBytes});
 const lane=page.locator('[data-midi-lane="channel-0"]');await lane.locator('[name=included]').check();await lane.locator('[name=instrument]').selectOption('sine');
 await page.getByLabel('Source start beat',{exact:true}).fill('1');await page.getByLabel('Source end beat (exclusive)',{exact:true}).fill('513');
 await page.getByRole('button',{name:'Review MIDI phrase',exact:true}).click();await expect(page.locator('#midi-apply')).toBeEnabled();
 expect(await readRoll(page)).toEqual(edited); // A review itself does not replace notes or references.
});
