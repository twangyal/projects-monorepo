import test from 'node:test';
import assert from 'node:assert/strict';
import {observeExport} from '../scripts/export-diagnostics.mjs';

test('an unresponsive renderer cannot hang first-failure diagnostics',async()=>{
 const observer=observeExport({evaluate:()=>new Promise(()=>{})},{timeoutMs:15,intervalMs:1000});
 await observer.sample('first-failure');
 observer.stop();
 assert.equal(observer.samples.length,1);
 assert.equal(observer.samples[0].reason,'first-failure');
 assert.match(observer.samples[0].unavailable,/timed out/);
});

test('diagnostic rejection is retained without throwing over the original failure',async()=>{
 const observer=observeExport({evaluate:async()=>{throw Error('closed renderer');}});
 await observer.sample('first-failure');observer.stop();
 assert.match(observer.samples[0].unavailable,/closed renderer/);
});

test('bounded snapshots keep the latest failure and stop retires pending observations',async()=>{
 let release;
 const observer=observeExport({evaluate:async()=>({status:'Encoding',progress:.2})},{maxSamples:2});
 await observer.sample('start');await observer.sample('poll');await observer.sample('first-failure');
 assert.deepEqual(observer.samples.map(x=>x.reason),['poll','first-failure']);
 const pendingObserver=observeExport({evaluate:()=>new Promise(resolve=>{release=resolve;})});
 const pending=pendingObserver.sample('poll');await Promise.resolve();pendingObserver.stop();release({status:'late'});await pending;
 assert.deepEqual(pendingObserver.samples,[]);
 assert.deepEqual(await pendingObserver.sample('after-stop'),undefined);
});
