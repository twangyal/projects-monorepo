import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {startBrowserCpu} from '../../scripts/browser-cpu-diagnostics.mjs';

test('native process CPU receipt brackets a real complete export without claiming codec-only usage',async({page,browser},info)=>{
 await page.goto('/');
 const observer=await startBrowserCpu(browser);let result;
 try{
  result=await page.evaluate(async()=>{
   const {exportTimestampedFilm}=await import('/src/export.js');
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d');let draws=0;
   const blob=await exportTimestampedFilm(canvas,()=>{draws++;c.fillStyle='#ff8000';c.fillRect(0,0,64,64);},1);
   return{draws,bytes:blob.size};
  });
 }finally{
  const receipt=await observer.finish();
  expect(['measured','unavailable']).toContain(receipt.status);
  if(receipt.status==='measured'){expect(receipt.matchedCpuMs).toBeGreaterThan(0);expect(receipt.wallMs).toBeGreaterThan(0);
  expect(receipt.matchedProcesses).toBeGreaterThan(0);expect(receipt.complete).toBe(receipt.newProcesses+receipt.missingProcesses+receipt.invalidPairs+receipt.zeroCounterPairs===0);
  expect(Object.values(receipt.byType).reduce((sum,row)=>sum+row.cpuMs,0)).toBeCloseTo(receipt.matchedCpuMs,6);
  }else{expect(receipt.reason).toBe('Native process counters remained zero.');expect(receipt.zeroCounterPairs).toBeGreaterThan(0);expect(receipt.matchedCpuMs).toBeUndefined();}
  expect(JSON.stringify(receipt)).not.toMatch(/commandLine|deviceId|"id":/);
  expect(await observer.finish()).toEqual(receipt);
  await writeFile(info.outputPath('native-process-cpu-receipt.json'),JSON.stringify(receipt,null,2));
 }
 expect(result.draws).toBe(30);expect(result.bytes).toBeGreaterThan(0);
});
