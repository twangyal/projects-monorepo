import {test,expect} from '@playwright/test';
import {openRoll,readRoll,rollDownload} from './roll-edit-fixtures.ts';
import {decodeWav,savedProject} from './browser/continuation-fixtures.ts';
import type {Composition} from '../src/types.ts';

function assertSound(bytes:Buffer,p:Composition){
 const wav=decodeWav(bytes),rate=22050;expect(wav.sampleRate).toBe(rate);
 const end=Math.max(...p.tracks.flatMap(t=>t.notes.map(n=>(n.start+n.duration)*.5+(t.envelope?.release??.08))));expect(wav.samples.length).toBe(Math.ceil(end*rate));
 let maximum=0;for(let frame=0;frame<wav.samples.length;frame+=37){let value=0;for(const t of p.tracks)if(!t.muted)for(const n of t.notes){const offset=frame-Math.round(n.start*.5*rate);if(offset<0)continue;const e=t.envelope??{attack:.01,decay:0,sustain:1,release:.08};const duration=n.duration*.5*rate,a=e.attack*rate,d=e.decay*rate,r=e.release*rate;const at=Math.min(offset,duration);const held=a>0&&at<a?at/a:d>0&&at<a+d?1-(1-e.sustain)*(at-a)/d:e.sustain;const level=offset<=duration?held:r>0?held*Math.max(0,1-(offset-duration)/r):0;value+=.4*t.volume*n.velocity*Math.sin(2*Math.PI*440*2**((n.pitch-69)/12)*offset/rate)*level;}const expected=Math.round(value*(value<0?32768:32767));maximum=Math.max(maximum,Math.abs(wav.samples[frame]-expected));}expect(maximum).toBeLessThanOrEqual(2);
}

test('applied sound is one reference-preserving history edit with independent WAV and full reload retention',async({page})=>{
 await page.addInitScript(()=>{const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer)(window as unknown as {soundPlayback:{frames:number;rate:number;values:number[]}}).soundPlayback={frames:this.buffer.length,rate:this.buffer.sampleRate,values:[3969,5513,8820,11466,15435,24255,35280].map(index=>this.buffer!.getChannelData(0)[index])};return start.apply(this,args);};});
 await openRoll(page);const before=await readRoll(page),oldWav=await rollDownload(page,'Export WAV'),oldMidi=await rollDownload(page,'Export MIDI');
 await page.getByLabel('Attack (seconds)',{exact:true}).fill('.2');await page.getByLabel('Decay (seconds)',{exact:true}).fill('.1');await page.getByLabel('Sustain level',{exact:true}).fill('.25');await page.getByLabel('Release (seconds)',{exact:true}).fill('.6');
 expect(await readRoll(page)).toEqual(before);expect(await rollDownload(page,'Export WAV')).toEqual(oldWav);
 await page.getByRole('button',{name:'Apply sound envelope',exact:true}).click();await expect(page.locator('#notice')).toContainText('Sound envelope applied');
 const after=await readRoll(page);expect(after.document.composition.tracks[0].envelope).toEqual({attack:.2,decay:.1,sustain:.25,release:.6});expect(after.document.composition.tracks[1]).toEqual(before.document.composition.tracks[1]);expect(after.assets).toEqual(before.assets);expect(after.document.references).toEqual(before.document.references);
 expect(await rollDownload(page,'Export MIDI')).toEqual(oldMidi);
 const soundWav=await rollDownload(page,'Export WAV');assertSound(soundWav,after.document.composition);
 await page.getByRole('button',{name:'Play composition',exact:true}).click();await expect(page.locator('#notice')).toContainText('Playing your composition');
 const playback=await page.evaluate(()=>(window as unknown as {soundPlayback:{frames:number;rate:number;values:number[]}}).soundPlayback),decoded=decodeWav(soundWav);expect(playback.frames).toBe(decoded.samples.length);expect(playback.rate).toBe(22050);
 for(const [position,index] of [3969,5513,8820,11466,15435,24255,35280].entries()){const sample=playback.values[position];expect(Math.abs(decoded.samples[index]-Math.round(sample*(sample<0?32768:32767)))).toBeLessThanOrEqual(1);}
 await page.getByRole('button',{name:'Stop playback',exact:true}).click();
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);expect(await rollDownload(page,'Export WAV')).toEqual(oldWav);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(after);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(after);await expect(page.getByLabel('Attack (seconds)',{exact:true})).toHaveValue('0.2');
});

test('invalid or unapplied envelope fields stay raw across track selection and cannot affect exports or redo',async({page})=>{
 await openRoll(page);await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();const before=await readRoll(page);
 const attack=page.getByLabel('Attack (seconds)',{exact:true});await attack.fill('');await page.getByRole('button',{name:'Apply sound envelope',exact:true}).click();await expect(page.locator('#notice')).toContainText('nonempty');await expect(attack).toHaveValue('');expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Select track: Muted independent part',exact:true}).click();await expect(page.getByLabel('Attack (seconds)',{exact:true})).toHaveValue('0.01');await page.getByRole('button',{name:'Select track: Fractional sine',exact:true}).click();await expect(attack).toHaveValue('');
 await attack.fill('2.1');await page.getByRole('button',{name:'Apply sound envelope',exact:true}).click();await expect(page.locator('#notice')).toContainText('0 to 2');await expect(attack).toHaveValue('2.1');expect(await readRoll(page)).toEqual(before);
 await page.getByRole('button',{name:'Discard sound edits',exact:true}).click();await expect(attack).toHaveValue('0.01');expect(await readRoll(page)).toEqual(before);await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
});

test('keyboard application at 390px retains another focused raw field and does not overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openRoll(page);const before=await readRoll(page);
 await page.getByLabel('Release (seconds)',{exact:true}).fill('0');
 const title=page.getByLabel('Project title',{exact:true});await title.fill('Unsent title');
 await page.getByRole('button',{name:'Apply sound envelope',exact:true}).click();await expect(title).toHaveValue('Unsent title');await expect(page.locator('#notice')).toContainText('other editor drafts');await expect(page.locator('#save-status')).toHaveText('Saved in this browser');expect((await savedProject(page)).title).toBe(before.document.composition.title);
 await title.fill(before.document.composition.title);await title.press('Tab');
 await page.getByLabel('Attack (seconds)',{exact:true}).fill('0');await page.getByRole('button',{name:'Apply sound envelope',exact:true}).focus();await page.keyboard.press('Enter');
 expect((await readRoll(page)).document.composition.tracks[0].envelope).toEqual({attack:0,decay:0,sustain:1,release:0});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
