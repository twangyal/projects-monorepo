import {test,expect} from '@playwright/test';
import {openRoll,readRoll,rollDownload} from './roll-edit-fixtures.ts';
import {decodeWav,savedProject} from './browser/continuation-fixtures.ts';
import type {Composition} from '../src/types.ts';

function assertFilteredWav(bytes:Buffer,p:Composition){
 const wav=decodeWav(bytes),rate=22050,seconds=60/p.tempo;expect(wav.sampleRate).toBe(rate);
 const end=Math.max(...p.tracks.flatMap(t=>t.notes.map(n=>(n.start+n.duration)*seconds+(t.envelope?.release??.08))));expect(wav.samples.length).toBe(Math.ceil(end*rate));const expected=new Float64Array(wav.samples.length);
 for(const t of p.tracks)if(!t.muted)for(const n of t.notes){
  const f=t.filter,w=2*Math.PI*(f?.cutoff??8000)/rate,c=Math.cos(w),alpha=Math.sin(w)/(2*(f?.resonance??.707)),a0=1+alpha,b=[(1-c)/(2*a0),(1-c)/a0,(1-c)/(2*a0)],a=[-2*c/a0,(1-alpha)/a0];
  let x1=0,x2=0,y1=0,y2=0;const offset=Math.round(n.start*seconds*rate),duration=n.duration*seconds*rate,e=t.envelope??{attack:.01,decay:0,sustain:1,release:.08},length=Math.ceil(duration+e.release*rate);
  for(let i=0;i<length&&offset+i<expected.length;i++){const x=Math.sin(2*Math.PI*440*2**((n.pitch-69)/12)*i/rate),y=f?b[0]*x+b[1]*x1+b[2]*x2-a[0]*y1-a[1]*y2:x;x2=x1;x1=x;y2=y1;y1=y;
   const at=Math.min(i,duration),attack=e.attack*rate,decay=e.decay*rate,held=attack>0&&at<attack?at/attack:decay>0&&at<attack+decay?1-(1-e.sustain)*(at-attack)/decay:e.sustain,level=i<=duration?held:e.release?held*Math.max(0,1-(i-duration)/(e.release*rate)):0;expected[offset+i]+=y*level*.4*t.volume*n.velocity;
  }
 }
 let maximum=0;for(let i=0;i<expected.length;i+=37)maximum=Math.max(maximum,Math.abs(wav.samples[i]-Math.round(expected[i]*(expected[i]<0?32768:32767))));expect(maximum).toBeLessThanOrEqual(2);
}
test('filter application changes actual WAV while preserving reference assets and one-edit history',async({page})=>{
 await openRoll(page);const before=await readRoll(page),oldWav=await rollDownload(page,'Export WAV'),oldMidi=await rollDownload(page,'Export MIDI');
 await page.getByLabel('Enable low-pass filter',{exact:true}).check();await page.getByLabel('Filter cutoff (Hz)',{exact:true}).fill('500');await page.getByLabel('Filter resonance (Q)',{exact:true}).fill('.707');expect(await readRoll(page)).toEqual(before);expect(await rollDownload(page,'Export WAV')).toEqual(oldWav);
 await page.getByRole('button',{name:'Apply sound filter',exact:true}).click();await expect(page.locator('#notice')).toContainText('Sound filter applied');const after=await readRoll(page);expect(after.document.composition.tracks[0].filter).toEqual({cutoff:500,resonance:.707});expect(after.document.references).toEqual(before.document.references);expect(after.assets).toEqual(before.assets);expect(after.document.composition.tracks[1]).toEqual(before.document.composition.tracks[1]);expect(await rollDownload(page,'Export MIDI')).toEqual(oldMidi);
 const wav=await rollDownload(page,'Export WAV');expect(wav).not.toEqual(oldWav);assertFilteredWav(wav,after.document.composition);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await readRoll(page)).toEqual(before);expect(await rollDownload(page,'Export WAV')).toEqual(oldWav);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await readRoll(page)).toEqual(after);
 await expect(page.locator('#save-status')).toHaveText('Saved in this browser');await page.reload();expect(await readRoll(page)).toEqual(after);await expect(page.getByLabel('Enable low-pass filter',{exact:true})).toBeChecked();await expect(page.getByLabel('Filter cutoff (Hz)',{exact:true})).toHaveValue('500');
 await page.getByRole('button',{name:'Duplicate track',exact:true}).click();const duplicated=await readRoll(page);expect(duplicated.document.composition.tracks[1].filter).toEqual({cutoff:500,resonance:.707});
});
test('invalid filter drafts survive track selection and bypass returns exact legacy PCM',async({page})=>{
 await openRoll(page);const before=await readRoll(page),legacy=await rollDownload(page,'Export WAV');await page.getByLabel('Enable low-pass filter',{exact:true}).check();const cutoff=page.getByLabel('Filter cutoff (Hz)',{exact:true});await cutoff.fill('');await page.getByRole('button',{name:'Apply sound filter',exact:true}).click();await expect(page.locator('#notice')).toContainText('nonempty');expect(await readRoll(page)).toEqual(before);await expect(cutoff).toHaveValue('');
 await page.getByRole('button',{name:'Select track: Muted independent part',exact:true}).click();await page.getByRole('button',{name:'Select track: Fractional sine',exact:true}).click();await expect(cutoff).toHaveValue('');await cutoff.fill('500');await page.getByLabel('Filter resonance (Q)',{exact:true}).fill('9');await page.getByRole('button',{name:'Apply sound filter',exact:true}).click();await expect(page.locator('#notice')).toContainText('0.5 to 8');expect(await readRoll(page)).toEqual(before);
 await page.getByLabel('Filter resonance (Q)',{exact:true}).fill('.707');await page.getByRole('button',{name:'Apply sound filter',exact:true}).click();await page.getByLabel('Enable low-pass filter',{exact:true}).uncheck();await page.getByRole('button',{name:'Apply sound filter',exact:true}).click();expect(await readRoll(page)).toEqual(before);expect(await rollDownload(page,'Export WAV')).toEqual(legacy);
});
test('filter Apply retains another raw draft at 390px and supports explicit keyboard application',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openRoll(page);const before=await readRoll(page);await page.getByLabel('Enable low-pass filter',{exact:true}).check();const title=page.getByLabel('Project title',{exact:true});await title.fill('Unsent title');await page.getByRole('button',{name:'Apply sound filter',exact:true}).click();await expect(title).toHaveValue('Unsent title');await expect(page.locator('#notice')).toContainText('other editor drafts');expect(await savedProject(page)).toEqual(before.document.composition);await title.fill(before.document.composition.title);await title.press('Tab');await page.getByRole('button',{name:'Apply sound filter',exact:true}).focus();await page.keyboard.press('Enter');expect((await readRoll(page)).document.composition.tracks[0].filter).toEqual({cutoff:8000,resonance:.707});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
