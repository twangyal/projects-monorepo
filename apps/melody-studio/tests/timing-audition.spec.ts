import {test,expect} from '@playwright/test';
import {openRoll,readRoll,rollDownload,assertWav} from './roll-edit-fixtures.ts';
import {installAudioProbe,audioProbe,controlProbe} from './browser/continuation-fixtures.ts';

test('native timing audition renders reviewed onsets while exports and complete project remain committed',async({page})=>{
 await page.addInitScript(()=>{
  const original=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args){
   const buffer=this.buffer;
   if(buffer)(window as unknown as {timingAudio:{frames:number;rate:number;values:number[]}}).timingAudio={frames:buffer.length,rate:buffer.sampleRate,values:[3087,13230,23814,26460].map(i=>buffer.getChannelData(0)[i])};
   return original.apply(this,args);
  };
 });
 await openRoll(page);const before=await readRoll(page);await page.getByRole('button',{name:'Review timing',exact:true}).click();
 const audition=page.getByRole('button',{name:'Audition timing',exact:true});await expect(audition).toBeVisible({timeout:1000});await audition.click();
 await expect(page.locator('#notice')).toContainText('Auditioning reviewed timing');
 const measured=await page.evaluate(()=>(window as unknown as {timingAudio:{frames:number;rate:number;values:number[]}}).timingAudio);
 expect(measured.rate).toBe(22050);expect(measured.frames).toBe(40352);
 const candidate=structuredClone(before.document.composition);candidate.tracks[0].notes[0].start=.25;candidate.tracks[0].notes[2].start=2.25;
 for(const [position,index] of [3087,13230,23814,26460].entries()){
  let expected=0;
  for(const note of candidate.tracks[0].notes){const offset=index-Math.round(note.start*.5*22050),duration=note.duration*.5*22050;if(offset<0||offset>=Math.ceil(duration+.08*22050))continue;
   const envelope=offset<220.5?offset/220.5:offset<=duration?1:Math.max(0,1-(offset-duration)/1764);
   expected+=Math.sin(2*Math.PI*440*2**((note.pitch-69)/12)*offset/22050)*envelope*.4*note.velocity*.4;
  }
  expect(Math.abs(measured.values[position]-expected)).toBeLessThan(.00002);
 }
 await expect(page.getByRole('button',{name:'Stop playback',exact:true})).toBeDisabled({timeout:5000});await expect(audition).toBeEnabled();
 assertWav(await rollDownload(page,'Export WAV'),before.document.composition);expect(await readRoll(page)).toEqual(before);
 await page.getByRole('button',{name:'Apply timing',exact:true}).click();expect((await readRoll(page)).document.composition).toEqual(candidate);
});
test('settings and discard retire owned audition but a later Solo keeps its independent ownership',async({page})=>{
 await openRoll(page);const before=await readRoll(page);const stop=page.getByRole('button',{name:'Stop playback',exact:true});
 await page.getByRole('button',{name:'Review timing',exact:true}).click();await page.getByRole('button',{name:'Audition timing',exact:true}).click();await expect(stop).toBeEnabled();
 await page.getByLabel('Timing strength (%)',{exact:true}).fill('75');await expect(stop).toBeDisabled();await expect(page.getByRole('button',{name:'Apply timing',exact:true})).toBeDisabled();
 await page.getByLabel('Timing strength (%)',{exact:true}).press('Tab');
 await page.getByRole('button',{name:'Review timing',exact:true}).click();await page.getByRole('button',{name:'Audition timing',exact:true}).click();await expect(stop).toBeEnabled();
 await stop.click();await page.getByRole('button',{name:'Solo track',exact:true}).click();await expect(stop).toBeEnabled();
 await page.getByRole('button',{name:'Discard timing',exact:true}).click();await expect(stop).toBeEnabled();await stop.click();expect(await readRoll(page)).toEqual(before);
});
test('discard retires a held timing render and its late reply cannot replace fresh playback',async({page})=>{
 await installAudioProbe(page);await openRoll(page);const before=await readRoll(page);await controlProbe(page,'holdReplies');
 await page.getByRole('button',{name:'Review timing',exact:true}).click();await page.getByRole('button',{name:'Audition timing',exact:true}).click();await expect.poll(async()=>(await audioProbe(page)).pendingReplies).toBe(1);
 await page.getByRole('button',{name:'Discard timing',exact:true}).click();await page.getByRole('button',{name:'Play composition',exact:true}).click();await expect.poll(async()=>(await audioProbe(page)).pendingReplies).toBe(2);
 await controlProbe(page,'releaseNext');expect((await audioProbe(page)).starts).toHaveLength(0);
 await controlProbe(page,'releaseNext');await expect.poll(async()=>(await audioProbe(page)).starts.length).toBe(1);await expect(page.locator('#notice')).toContainText('Playing your composition');
 await page.getByRole('button',{name:'Stop playback',exact:true}).click();expect(await readRoll(page)).toEqual(before);
});
