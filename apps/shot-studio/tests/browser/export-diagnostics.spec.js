import {test,expect} from '@playwright/test';
import {observeExport} from '../../scripts/export-diagnostics.mjs';

test('passive maximum-probe observations retain real successful export state',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
 await page.locator('#sequence-add-current').click();
 await expect(page.locator('#sequence-sources [data-sequence-source-id]')).toHaveCount(1);
 await page.locator('#sequence-add-shot').click();
 await expect(page.locator('#sequence-clips [data-sequence-clip-id]')).toHaveCount(1);
 const observer=observeExport(page,{intervalMs:100});
 try{
  await observer.sample('before-click');
  const download=page.waitForEvent('download');
  await page.locator('#sequence-export').click();await download;
  await observer.sample('download-event');
  expect(observer.samples[0].visibility).toBe('visible');
  expect(observer.samples.at(-1)).toMatchObject({reason:'download-event',progress:1,progressMax:1});
  expect(observer.samples.at(-1).status).toContain('Sequence WebM downloaded');
  expect(observer.samples.some(row=>row.progress>0)).toBe(true);
 }finally{observer.stop();}
});

test('snapshots retain literal refusal, progress and controls from the native DOM',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
 await page.evaluate(()=>{
  document.getElementById('sequence-status').textContent='Export timed out. Try a shorter film.';
  document.getElementById('sequence-export-progress').value=.37;
  document.getElementById('sequence-export').disabled=true;
 });
 const observer=observeExport(page);
 try{
  await observer.sample('first-failure');
  expect(observer.samples.at(-1)).toMatchObject({reason:'first-failure',status:'Export timed out. Try a shorter film.',progress:.37,exportDisabled:true,visibility:'visible'});
 }finally{observer.stop();}
});
