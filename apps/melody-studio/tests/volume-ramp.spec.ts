import {test,expect,type Page} from '@playwright/test';
import {openRoll,readRoll,rollDownload,rollBackup} from './roll-edit-fixtures.ts';
import {decodeWav,savedProject} from './browser/continuation-fixtures.ts';
import type {Composition} from '../src/types.ts';

async function setRamp(page:Page,start='1',end='4',from='1',to='0') {
  await page.getByLabel('Enable volume ramp',{exact:true}).check();
  for(const [label,value] of [['Ramp start beat',start],['Ramp end beat',end],['Ramp start level',from],['Ramp end level',to]]) {
    await page.getByLabel(label,{exact:true}).fill(value);
  }
}
async function applyRamp(page:Page) {
  await page.getByRole('button',{name:'Apply volume ramp',exact:true}).click();
}
// Independent analytic sine + legacy envelope + absolute-time gain oracle.
// No production rendering, ramp or oscillator-table helper computes expectations.
function assertRampWav(bytes:Buffer,p:Composition) {
  const wav=decodeWav(bytes),rate=22050,seconds=60/p.tempo;
  expect(wav.sampleRate).toBe(rate);
  const end=Math.max(...p.tracks.flatMap(t=>t.notes.map(n=>(n.start+n.duration+(t.echo?t.echo.beats*t.echo.repeats:0))*seconds+.08)));
  expect(wav.samples.length).toBe(Math.ceil(end*rate));
  let maximum=0;
  for(let index=0;index<wav.samples.length;index+=37) {
    let value=0;
    for(const track of p.tracks) if(!track.muted) {
      const beat=index/rate/seconds,r=track.volumeRamp;
      const gain=!r?1:beat<=r.start?r.from:beat>=r.end?r.to:r.from+(r.to-r.from)*(beat-r.start)/(r.end-r.start);
      for(const note of track.notes) for(let tap=0;tap<=(track.echo?.repeats??0);tap++) {
        const offset=Math.round((note.start+tap*(track.echo?.beats??0))*seconds*rate),i=index-offset,duration=note.duration*seconds*rate;
        if(i<0||i>=Math.ceil(duration+.08*rate)) continue;
        const envelope=i<.01*rate?i/(.01*rate):i<=duration?1:Math.max(0,1-(i-duration)/(.08*rate));
        value+=Math.sin(2*Math.PI*440*2**((note.pitch-69)/12)*i/rate)*envelope*.4*track.volume*note.velocity*gain*(tap===0?1:track.echo!.decay**tap);
      }
    }
    maximum=Math.max(maximum,Math.abs(wav.samples[index]-Math.round(value*(value<0?32768:32767))));
  }
  expect(maximum).toBeLessThanOrEqual(2);
  return wav;
}

test('volume ramp is explicit, reversible, persistent and retained in complete backups',async({page})=>{
  await openRoll(page);
  await expect(page.getByLabel('Enable volume ramp',{exact:true})).toBeVisible();
  const before=await readRoll(page),dry=await rollDownload(page,'Export WAV'),midi=await rollDownload(page,'Export MIDI');
  await setRamp(page,'1.25','3.5','.8','0');
  expect(await readRoll(page)).toEqual(before);expect(await rollDownload(page,'Export WAV')).toEqual(dry);
  await applyRamp(page);
  await expect(page.locator('#notice')).toContainText('Volume ramp applied');
  const after=await readRoll(page);
  expect(after.document.composition.tracks[0].volumeRamp).toEqual({start:.25,end:2.5,from:.8,to:0});
  expect(after.document.references).toEqual(before.document.references);expect(after.assets).toEqual(before.assets);
  expect(after.document.composition.tracks[0].notes).toEqual(before.document.composition.tracks[0].notes);
  expect(after.document.composition.tracks[1]).toEqual(before.document.composition.tracks[1]);
  expect(await rollDownload(page,'Export MIDI')).toEqual(midi);
  const wet=await rollDownload(page,'Export WAV');expect(wet).not.toEqual(dry);assertRampWav(wet,after.document.composition);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);
  expect(await rollDownload(page,'Export WAV')).toEqual(dry);
  await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(after);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(after);
  await expect(page.getByLabel('Ramp start beat',{exact:true})).toHaveValue('1.25');
  await page.getByRole('button',{name:'Duplicate track',exact:true}).click();
  expect((await readRoll(page)).document.composition.tracks[1].volumeRamp).toEqual(after.document.composition.tracks[0].volumeRamp);
});

test('actual playback buffers, aligned stem and section exports use the committed ramp',async({page})=>{
  await page.addInitScript(()=>{
    const starts:unknown[]=[];Object.assign(window,{rampStarts:starts});
    const original=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args:Parameters<typeof original>){
      if(this.buffer){const pcm=this.buffer.getChannelData(0);starts.push({rate:this.buffer.sampleRate,length:pcm.length,points:Array.from({length:Math.ceil(pcm.length/503)},(_,i)=>[i*503,pcm[i*503]])});}
      return original.apply(this,args);
    };
  });
  await openRoll(page);await setRamp(page);await applyRamp(page);
  await expect(page.locator('#notice')).toContainText('Volume ramp applied');
  const p=(await readRoll(page)).document.composition,bytes=await rollDownload(page,'Export WAV'),expected=assertRampWav(bytes,p);
  expect(await rollDownload(page,'Export track WAV')).toEqual(bytes);
  await page.getByLabel('Section start beat',{exact:true}).fill('2');await page.getByLabel('Section end beat (exclusive)',{exact:true}).fill('3');
  expect(decodeWav(await rollDownload(page,'Export section WAV')).samples).toEqual(expected.samples.slice(11025,22050));
  for(const name of ['Play composition','Solo track']){
    await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('#notice')).toContainText(name==='Solo track'?'Soloing':'Playing your composition');
    await page.getByRole('button',{name:'Stop playback',exact:true}).click();
  }
  const starts=await page.evaluate(()=>(window as unknown as {rampStarts:{rate:number;length:number;points:[number,number][]}[]}).rampStarts);
  expect(starts).toHaveLength(2);
  for(const start of starts){expect(start.rate).toBe(22050);expect(start.length).toBe(expected.samples.length);for(const [index,sample] of start.points)expect(Math.abs(Math.round(sample*(sample<0?32768:32767))-expected.samples[index])).toBeLessThanOrEqual(1);}
});

test('invalid drafts survive track switching and bypass restores exact original WAV',async({page})=>{
  await openRoll(page);const before=await readRoll(page),dry=await rollDownload(page,'Export WAV');
  await setRamp(page);const start=page.getByLabel('Ramp start beat',{exact:true});await start.fill('');
  await applyRamp(page);await expect(page.locator('#notice')).toContainText('nonempty');expect(await readRoll(page)).toEqual(before);
  await page.getByRole('button',{name:'Select track: Muted independent part',exact:true}).click();await page.getByRole('button',{name:'Select track: Fractional sine',exact:true}).click();await expect(start).toHaveValue('');
  await start.fill('4');await applyRamp(page);await expect(page.locator('#notice')).toContainText('after');expect(await readRoll(page)).toEqual(before);
  await start.fill('1');await page.getByLabel('Ramp end level',{exact:true}).fill('1.1');await applyRamp(page);await expect(page.locator('#notice')).toContainText('0 to 1');expect(await readRoll(page)).toEqual(before);
  await page.getByRole('button',{name:'Discard volume ramp edits',exact:true}).click();await expect(page.getByLabel('Enable volume ramp',{exact:true})).not.toBeChecked();
  await setRamp(page);await applyRamp(page);await page.getByLabel('Enable volume ramp',{exact:true}).uncheck();await applyRamp(page);
  expect(await readRoll(page)).toEqual(before);expect(await rollDownload(page,'Export WAV')).toEqual(dry);
});

test('Apply protects a focused unrelated draft before blur and works by keyboard on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openRoll(page);const before=await readRoll(page);
  await setRamp(page);const title=page.getByLabel('Project title',{exact:true});await title.fill('Unsent fade title');
  await applyRamp(page);await expect(title).toHaveValue('Unsent fade title');await expect(title).toBeFocused();await expect(page.locator('#notice')).toContainText('other editor drafts');expect(await savedProject(page)).toEqual(before.document.composition);
  await title.fill(before.document.composition.title);await title.press('Tab');await page.getByRole('button',{name:'Apply volume ramp',exact:true}).focus();await page.keyboard.press('Enter');
  expect((await readRoll(page)).document.composition.tracks[0].volumeRamp).toEqual({start:0,end:3,from:1,to:0});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Apply volume ramp',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath('volume-ramp-mobile.png')});
});

test('a held polyphonic phrase and its echo tail fade on the same song clock',async({page})=>{
  const backup=rollBackup();backup.document.composition.tracks[0].notes[0].duration=4;
  backup.document.composition.tracks[0].echo={beats:.5,decay:.5,repeats:3};
  await openRoll(page,backup);await setRamp(page,'2','4','1','0');await applyRamp(page);
  await expect(page.locator('#notice')).toContainText('Volume ramp applied');
  const p=(await readRoll(page)).document.composition,wav=assertRampWav(await rollDownload(page,'Export WAV'),p);
  expect(wav.samples.length).toBeGreaterThan(33075);expect(wav.samples.slice(33075).every(x=>x===0)).toBe(true);
});

test('saved library and portable import retain exact complete ramp projects; malformed import preserves them',async({page,context})=>{
  await openRoll(page);await setRamp(page);await applyRamp(page);
  await expect(page.locator('#notice')).toContainText('Volume ramp applied');
  const after=await readRoll(page),bytes=await rollDownload(page),wav=await rollDownload(page,'Export WAV');
  await page.getByLabel('Saved-copy label',{exact:true}).fill('Synthetic sustained fade');
  await page.getByRole('button',{name:'Save new copy',exact:true}).click();
  await expect(page.locator('#library-select option')).toHaveCount(2);
  const id=await page.locator('#library-select option').nth(1).getAttribute('value');await page.locator('#library-select').selectOption(id!);
  expect(await rollDownload(page,'Download selected copy')).toEqual(bytes);
  await page.getByLabel('Enable volume ramp',{exact:true}).uncheck();await applyRamp(page);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Open selected copy',exact:true}).click();
  await expect(page.getByLabel('Enable volume ramp',{exact:true})).toBeChecked();expect(await readRoll(page)).toEqual(after);
  const other=await context.newPage();await openRoll(other,after);expect(await readRoll(other)).toEqual(after);expect(await rollDownload(other,'Export WAV')).toEqual(wav);await other.close();
  const broken=structuredClone(after);broken.document.composition.tracks[0].volumeRamp!.end=0;
  await page.getByLabel('Open project file',{exact:true}).setInputFiles({name:'invalid-ramp.melody.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken))});
  await expect(page.locator('#notice')).toContainText('Volume ramp end beat');expect(await readRoll(page)).toEqual(after);
});
