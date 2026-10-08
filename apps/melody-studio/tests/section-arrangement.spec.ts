import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { openRoll, readRoll, rollBackup, type RollBackup } from './roll-edit-fixtures.ts';
import { decodeMidi, decodeWav, savedProject } from './browser/continuation-fixtures.ts';

async function downloadedBytes(page: Parameters<typeof readRoll>[0], name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name, exact: true}).click();
  return readFile((await (await pending).path())!);
}
async function complete(page: Parameters<typeof readRoll>[0]) {
  return JSON.parse((await downloadedBytes(page, 'Save project file')).toString()) as RollBackup;
}

test('duplicate all-track section is one exact reference-preserving edit through undo, redo, exports and reload', async ({page}) => {
  await openRoll(page);
  const before = await complete(page);
  await page.getByLabel('Section start beat').fill('1');
  await page.getByLabel('Section end beat (exclusive)').fill('3');
  await page.getByRole('button', {name:'Duplicate section', exact:true}).click();
  await expect(page.locator('#notice')).toContainText('Section duplicated');
  const after = await complete(page);
  expect(after.document.references).toEqual(before.document.references);
  expect(after.assets).toEqual(before.assets);
  const tracks = after.document.composition.tracks;
  expect(tracks[0].notes.filter((n:{id:string})=>['fractional-low','polyphonic-high','later-accent'].includes(n.id)).map((n:{id:string;start:number})=>[n.id,n.start])).toEqual([['fractional-low',1/3],['polyphonic-high',.5],['later-accent',4.125]]);
  expect(tracks[0].notes.filter((n:{id:string})=>!before.document.composition.tracks[0].notes.some((o:{id:string})=>o.id===n.id)).map((n:{start:number;duration:number})=>[n.start,n.duration])).toEqual([[2+1/3,2/3],[2.5,.75]]);
  expect(tracks[1].notes[0].start).toBe(5);expect(tracks[1].muted).toBe(true);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await complete(page)).toEqual(before);
  await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await complete(page)).toEqual(after);
  const midi=decodeMidi(await downloadedBytes(page,'Export MIDI'));
  expect(midi.tracks[1].notes.map(n=>[n.pitch,n.start,n.duration])).toEqual([[60,1/3,2/3],[67,.5,.75],[60,2+1/3,2/3],[67,2.5,.75],[64,4.125,.375]]);
  expect(midi.tracks[2].notes).toEqual([]);
  const wav=decodeWav(await downloadedBytes(page,'Export WAV'));
  expect(wav.sampleRate).toBe(22050);expect(wav.samples.length).toBe(Math.ceil((5.5*.5+.08)*22050));
  for (const second of [.1,.2,.4,1.2,1.4,2.15,2.6]) {
    const index=Math.round(second*22050);let expected=0;
    for(const n of tracks[0].notes) {
      const offset=index-Math.round(n.start*.5*22050),duration=n.duration*.5*22050;
      if(offset<0||offset>=Math.ceil(duration+.08*22050))continue;
      const envelope=offset<.01*22050?offset/(.01*22050):offset<=duration?1:Math.max(0,1-(offset-duration)/(.08*22050));
      expected+=Math.sin(2*Math.PI*440*2**((n.pitch-69)/12)*offset/22050)*envelope*.4*n.velocity*.4;
    }
    expect(Math.abs(wav.samples[index]-Math.round(expected*(expected<0?32768:32767)))).toBeLessThanOrEqual(2);
  }
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  await page.reload();expect(await complete(page)).toEqual(after);
});

test('boundary refusal preserves complete backup and redo branch', async ({page}) => {
  await openRoll(page);
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  const before=await complete(page);
  await page.getByLabel('Section start beat').fill('1.5');
  await page.getByLabel('Section end beat (exclusive)').fill('3');
  await page.getByRole('button',{name:'Duplicate section',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('crosses');expect(await complete(page)).toEqual(before);
  await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
});

test('focused unapplied numeric draft is guarded before pointer blur and keyboard activation', async ({page}) => {
  await openRoll(page);await page.locator('[data-note="fractional-low"]').click();
  const before=await readRoll(page),field=page.getByLabel('Start beat',{exact:true});await field.fill('');
  await page.getByRole('button',{name:'Duplicate section',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('unapplied');await expect(field).toHaveValue('');await expect(field).toBeFocused();expect(await readRoll(page)).toEqual(before);
  await page.getByRole('button',{name:'Duplicate section',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(field).toHaveValue('');expect(await readRoll(page)).toEqual(before);
});

test('valid unapplied project field cannot commit through Duplicate section pointer blur', async ({page}) => {
  await openRoll(page);
  const before=await savedProject(page),field=page.getByLabel('Project title');
  await field.fill('Unsent title');
  await page.getByRole('button',{name:'Duplicate section',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('unapplied');
  await expect(field).toHaveValue('Unsent title');await expect(field).toBeFocused();
  expect(await savedProject(page)).toEqual(before);
});

test('native exact-capacity section duplication retains2048 notes through real exports and reload', async ({page}) => {
  const fixture=rollBackup();
  fixture.document.composition={version:1,title:'Eight-part section',tempo:120,tracks:Array.from({length:8},(_,t)=>({id:t===0?'fractional-track':`part-${t}`,name:`Part ${t}`,instrument:'sine',volume:.1,muted:false,notes:Array.from({length:128},(_,i)=>({id:t===0&&i===0?'fractional-low':`note-${t}-${i}`,pitch:60+t,start:i*.5,duration:.5,velocity:.7}))}))};
  await openRoll(page,fixture);const before=await complete(page);
  await page.getByLabel('Section start beat').fill('1');await page.getByLabel('Section end beat (exclusive)').fill('65');
  await page.getByRole('button',{name:'Duplicate section',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('Section duplicated');
  const after=await complete(page);
  expect(after.assets).toEqual(before.assets);expect(after.document.references).toEqual(before.document.references);
  for(let t=0;t<8;t++) {
    expect(after.document.composition.tracks[t].notes).toHaveLength(256);
    expect(after.document.composition.tracks[t].notes.slice(0,128)).toEqual(before.document.composition.tracks[t].notes);
  }
  const midi=decodeMidi(await downloadedBytes(page,'Export MIDI'));
  for(let t=0;t<8;t++) {
    expect(midi.tracks[t+1].notes).toHaveLength(256);
    expect(midi.tracks[t+1].notes.at(-1)).toMatchObject({pitch:60+t,start:127.5,duration:.5});
  }
  const wav=decodeWav(await downloadedBytes(page,'Export WAV'));
  expect(wav.samples.length).toBe(Math.ceil((64+.08)*22050));
  await page.getByRole('button',{name:'Duplicate section',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('256');expect(await complete(page)).toEqual(after);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  await page.reload();expect(await complete(page)).toEqual(after);
});
