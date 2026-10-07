import {test,expect} from '@playwright/test';
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
  expect(Object.keys(report.stages)).toHaveLength(10);
 }finally{await stopStageTiming(page);}
 expect(await sampleStageTiming(page)).toEqual({unavailable:'stage timing not installed'});
 const next=page.waitForEvent('download');await page.locator('#sequence-export').click();await next;
 await expect(page.locator('#sequence-status')).toContainText('Sequence WebM downloaded');
});
