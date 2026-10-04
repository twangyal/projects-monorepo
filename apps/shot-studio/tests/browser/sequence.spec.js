import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createProject} from '../../src/model.js';

const stored=page=>page.evaluate(()=>localStorage.getItem('shot-studio-sequence-v1'));
async function ready(page){await page.goto('/');await expect(page.locator('#status')).toContainText('Ready');await expect(page.locator('#sequence-capture-scene')).toBeVisible({timeout:1000});}
async function downloadText(page,button){const event=page.waitForEvent('download');await page.locator(button).click();return readFile(await (await event).path(),'utf8');}
test('capture scenes, sequence whole shots, repeat/reorder/undo and portable restore without scene changes',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
  await page.locator('#sequence-capture-scene').click();await expect(page.locator('#sequence-source')).toHaveCount(1);
  await expect(page.locator('#sequence-source option')).toHaveCount(1);
  await page.locator('#sequence-shot').selectOption('1');await page.locator('#sequence-add').click();
  const captured=JSON.parse(await stored(page));expect(captured.clips).toEqual([{sourceId:'s1',shotIndex:1}]);
  await page.locator('#title').fill('Changed scene');await page.locator('#title').press('Tab');
  const scene=await page.evaluate(()=>localStorage.getItem('shot-studio-v1'));
  await page.locator('#sequence-capture-scene').click();await page.locator('#sequence-shot').selectOption('0');await page.locator('#sequence-add').click();
  await page.locator('#sequence-repeat').click();await expect(page.locator('#sequence-clips button')).toHaveCount(3);
  await page.locator('#sequence-earlier').click();await page.locator('#sequence-remove').click();
  await expect(page.locator('#sequence-clips button')).toHaveCount(2);await page.locator('#sequence-undo').click();await expect(page.locator('#sequence-clips button')).toHaveCount(3);
  const backup=await downloadText(page,'#sequence-save');const p=JSON.parse(backup);
  expect(p.sources[0].film.title).toBe('The arrival');expect(p.sources[1].film.title).toBe('Changed scene');
  await page.locator('#sequence-title').fill('Temporary');await page.locator('#sequence-title').press('Tab');
  await page.locator('#sequence-open').setInputFiles({name:'cut.shot-sequence.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  expect(await stored(page)).toBe(JSON.stringify(p));expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(scene);
  await page.reload();await expect(page.locator('#sequence-clips button')).toHaveCount(3);
  expect(JSON.parse(await stored(page))).toEqual(p);expect(errors).toEqual([]);
});
test('source shot preview uses original time and renders actual different source pixels at the exact cut',async({page})=>{
  await ready(page);const film=createProject();film.light=.4;film.shots[0].duration=2;
  film.shots[1].duration=2;film.actors[0]={name:'Timed',color:'#ff0000',performanceMode:'blocking',cues:[
    {time:0,x:-3,z:0,action:'idle',visible:true},{time:2,x:0,z:0,action:'wave',visible:true},{time:4,x:3,z:0,action:'idle',visible:false}]};
  await page.locator('#sequence-import-scene').setInputFiles({name:'red.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(film))});
  await page.locator('#sequence-shot').selectOption('1');await page.locator('#sequence-add').click();
  await expect(page.locator('#sequence-clock')).toContainText('source 2.00');
  const first=await page.locator('#sequence-stage').screenshot();
  const blue=structuredClone(film);blue.title='Bright blue';blue.light=2;blue.actors[0].color='#0000ff';
  await page.locator('#sequence-import-scene').setInputFiles({name:'blue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(blue))});
  await page.locator('#sequence-shot').selectOption('1');await page.locator('#sequence-add').click();
  await page.locator('#sequence-scrub').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#sequence-clock')).toContainText('source 2.00');await expect(page.locator('#sequence-clock')).toContainText('clip 2');
  expect(await page.locator('#sequence-stage').screenshot()).not.toEqual(first);
  await page.locator('#sequence-export').click();const event=page.waitForEvent('download');const file=await event;const path=await file.path();
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',path],{encoding:'utf8'}));
  expect(probe.streams[0].width).toBe(960);expect(probe.streams[0].height).toBe(540);expect(Number(probe.streams[0].nb_read_frames)).toBeGreaterThan(60);
});
test('raw scene and sequence fields are preserved; stale sequence import cannot replace newer typing',async({page})=>{
  await page.addInitScript(()=>{const native=File.prototype.text;File.prototype.text=async function(){const text=await native.call(this);if(this.name==='delayed.json'){window.sequenceReadReady=true;await new Promise(r=>window.releaseSequenceRead=r);}return text;};});
  await ready(page);await page.locator('#sequence-capture-scene').click();await page.locator('#sequence-add').click();const before=await stored(page);
  await page.locator('#shotName').fill('Raw scene');
  await page.locator('#sequence-save').dispatchEvent('click');await expect(page.locator('#shotName')).toHaveValue('Raw scene');
  const incoming={...JSON.parse(before),title:'Incoming'};
  await page.locator('#sequence-open').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
  await expect.poll(()=>page.evaluate(()=>window.sequenceReadReady)).toBe(true);
  await page.locator('#sequence-title').fill('Raw sequence');await page.evaluate(()=>window.releaseSequenceRead());
  await expect(page.locator('#sequence-status')).toContainText('changed');await expect(page.locator('#sequence-title')).toHaveValue('Raw sequence');
  await expect(page.locator('#sequence-title')).toBeFocused();expect(await stored(page)).toBe(before);
});
test('protected unreadable sequence survives edits, failed writes and canceled replacement',async({page})=>{
  const raw='invalid sequence😺';await page.addInitScript(raw=>localStorage.setItem('shot-studio-sequence-v1',raw),raw);await ready(page);
  await expect(page.locator('#sequence-status')).toContainText('protected');await page.locator('#sequence-capture-scene').click();await page.locator('#sequence-add').click();expect(await stored(page)).toBe(raw);
  const recovery=JSON.parse(await downloadText(page,'#sequence-recovery'));expect(recovery.raw).toBe(raw);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#sequence-replace').click();expect(await stored(page)).toBe(raw);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#sequence-replace').click();expect(JSON.parse(await stored(page)).clips).toHaveLength(1);
});
test('narrow keyboard controls and canceled export keep the complete sequence',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page);await page.locator('#sequence-capture-scene').click();await page.locator('#sequence-add').focus();await page.keyboard.press('Enter');
  const before=await stored(page);await page.locator('#sequence-export').click();await expect(page.locator('#sequence-cancel')).toBeVisible();await page.locator('#sequence-cancel').click();await expect(page.locator('#sequence-status')).toContainText('cancelled');expect(await stored(page)).toBe(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
