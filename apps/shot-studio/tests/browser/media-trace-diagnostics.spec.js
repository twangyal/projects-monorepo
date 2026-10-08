import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {startMediaTrace} from '../../scripts/media-trace-diagnostics.mjs';
test('native media trace brackets thirty actual complete production frames with sanitized codec event buckets',async({page,browser},info)=>{
 await page.goto('/');const trace=await startMediaTrace(browser);let result;
 try{result=await page.evaluate(async()=>{
  const {exportTimestampedFilm}=await import('/src/export.js');const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d');let draws=0;
  const blob=await exportTimestampedFilm(canvas,()=>{draws++;c.fillStyle='#ff8000';c.fillRect(0,0,64,64);},1);return{draws,bytes:blob.size};
 });}finally{
  const receipt=await trace.finish();await writeFile(info.outputPath('native-media-trace-receipt.json'),JSON.stringify(receipt,null,2));
  expect(receipt.status).toBe('measured');expect(receipt.dataLossOccurred).toBe(false);expect(receipt.eventLimitReached).toBe(false);
  expect(receipt.buckets.vpx_codec_encode.events).toBe(30);expect(receipt.buckets.vpx_codec_encode.wallMs).toBeGreaterThan(0);
  expect(receipt.buckets.vpx_codec_encode.threadCpuEvents+receipt.buckets.vpx_codec_encode.missingThreadCpuEvents+receipt.buckets.vpx_codec_encode.invalidThreadCpuEvents).toBe(30);
  expect(JSON.stringify(receipt)).not.toMatch(/"args"|"pid"|"tid"|deviceId|https?:\/\//);expect(await trace.finish()).toEqual(receipt);
 }
 expect(result.draws).toBe(30);expect(result.bytes).toBeGreaterThan(0);
});
