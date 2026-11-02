import {test} from 'node:test';import assert from 'node:assert/strict';
import {lookupLyrics,retryAfterSeconds} from '../src/lyrics-lookup.ts';
// Runs in its own process: a 429 makes every later lookup in it wait.
const query={title:'Test song',artist:'Example singer',duration:16};
test('Retry-After is read as seconds or a date, within bounds',()=>{
 assert.equal(retryAfterSeconds('30'),30);
 assert.equal(retryAfterSeconds(new Date(Date.now()+90_000).toUTCString()),90);
 assert.equal(retryAfterSeconds(null),60);assert.equal(retryAfterSeconds('soon'),60);
 assert.equal(retryAfterSeconds('0'),1);assert.equal(retryAfterSeconds('999999'),3600);
});
test('after a 429 no request is sent until the provider\'s wait is over',async()=>{
 let calls=0;
 const busy=async()=>{calls++;return new Response('PRIVATE PROVIDER BODY',{status:429,headers:{'retry-after':'120'}});};
 await assert.rejects(lookupLyrics(query,new AbortController().signal,busy),e=>e instanceof Error&&/asked to wait 120 seconds/.test(e.message)&&!e.message.includes('PRIVATE'));
 assert.equal(calls,1);
 await assert.rejects(lookupLyrics(query,new AbortController().signal,busy),/asked to wait 1[12]\d seconds/);
 assert.equal(calls,1,'the second lookup waited without asking');
});
