import {test,expect} from '@playwright/test';
import {sequenceStoredState} from './sequence-storage-fixtures.js';
import {installStageTiming,sampleStageTiming,stopStageTiming} from '../../scripts/stage-timing-diagnostics.mjs';

test('native stage timing retains original WebM export and restores methods',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
 await page.locator('#sequence-add-current').click();
 await page.locator('#sequence-add-shot').click();
 await installStageTiming(page);
 try{
  const download=page.waitForEvent('download');
  await page.locator('#sequence-export').click();await download;
  const report=await sampleStageTiming(page);
  expect(report.mode).toBe('stage-timing-diagnostic-variation');
  expect(report.stages.create.calls).toBe(1);
  expect(report.stages.draw.calls).toBeGreaterThan(0);
  expect(report.stages.video.completed).toBeGreaterThan(0);
  expect(report.stages.addVideo.completed).toBe(report.stages.video.completed);
  expect(report.stages.finalize.completed).toBe(1);
  expect(report.stages.finalize.errors).toBe(0);
  expect(report.nativeQueues.video.encodeCalls).toBe(report.stages.video.completed);
  expect(report.nativeQueues.video.pending).toBe(0);expect(report.nativeQueues.video.tracked).toBe(0);
  expect(report.nativeQueues.video.unobserved).toBe(0);expect(report.stages.sinkWrite.completed).toBeGreaterThan(0);
  expect(Object.keys(report.stages)).toHaveLength(11);
 }finally{await stopStageTiming(page);}
 expect(await sampleStageTiming(page)).toEqual({unavailable:'stage timing not installed'});
 const next=page.waitForEvent('download');await page.locator('#sequence-export').click();await next;
 await expect(page.locator('#sequence-status')).toContainText('Sequence WebM downloaded');
});


test('native stage timing observes genuine cancellation and retires without changing saved authoring',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
 await page.locator('#duration').fill('15');await page.locator('#duration').press('Tab');
 await page.locator('#sequence-add-current').click();await page.locator('#sequence-add-shot').click();
 await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
 const before=await page.evaluate(()=>localStorage.getItem('shot-studio-v1')),sequenceBefore=await sequenceStoredState(page);
 const downloads=[];page.on('download',file=>downloads.push(file.suggestedFilename()));
 await installStageTiming(page);
 try{
  await page.locator('#sequence-export').click();
  await expect.poll(async()=>Number((await sampleStageTiming(page)).stages?.video.completed??0)).toBeGreaterThan(0);
  await page.locator('#sequence-cancel').click();
  await expect(page.locator('#sequence-status')).toContainText('export cancelled');
  await expect(page.locator('#sequence-export')).toBeEnabled();
  const report=await sampleStageTiming(page);
  expect(report.stages.cancel.calls).toBe(1);expect(report.stages.cancel.completed).toBe(1);
  expect(report.stages.cancel.pending).toBe(0);expect(report.stages.finalize.calls).toBe(0);
  expect(downloads).toEqual([]);
  expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(before);
  expect(await sequenceStoredState(page)).toEqual(sequenceBefore);
 }finally{await stopStageTiming(page);}
 expect(await sampleStageTiming(page)).toEqual({unavailable:'stage timing not installed'});
});
