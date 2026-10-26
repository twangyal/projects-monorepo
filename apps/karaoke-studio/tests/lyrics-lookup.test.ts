import {test} from 'node:test';import assert from 'node:assert/strict';
import {lookupLyrics,parseLyricsRecord,lookupQuery} from '../src/lyrics-lookup.ts';
const query={title:'Test song',artist:'Example singer',duration:16};
const record={id:42,trackName:'Test song',artistName:'Example singer',albumName:'Demo',duration:16,instrumental:false,plainLyrics:'Hello little world\nThis is our chorus\nSing it back to me',syncedLyrics:'ignored'};
test('metadata lookup uses only the fixed provider and returns reviewed plain lines',async()=>{
 let url='',init:RequestInit|undefined;const fetcher=async(input:URL|RequestInfo,options?:RequestInit)=>{url=String(input);init=options;return Response.json(record);};
 const result=await lookupLyrics(query,new AbortController().signal,fetcher);
 const target=new URL(url);assert.equal(target.origin,'https://lrclib.net');assert.equal(target.pathname,'/api/get');assert.equal(target.searchParams.get('track_name'),query.title);assert.equal(target.searchParams.get('artist_name'),query.artist);assert.equal(target.searchParams.get('duration'),'16');
 assert.equal(init?.credentials,'omit');assert.equal(init?.referrerPolicy,'no-referrer');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.equal(init?.body,undefined);
 assert.equal(result.text,record.plainLyrics);assert.equal(result.source,'https://lrclib.net/api/get/42');
});
test('query and record reject malformed metadata, wrong editions, instrumentals and oversized lyric graphs',()=>{
 for(const q of [{...query,title:''},{...query,artist:'x'.repeat(201)},{...query,duration:NaN},{...query,title:'bad\u0000title'}])assert.throws(()=>lookupQuery(q));
 for(const value of [null,[],{...record,id:1.5},{...record,trackName:'Other song'},{...record,artistName:'Other artist'},{...record,duration:19},{...record,instrumental:true},{...record,plainLyrics:null},{...record,plainLyrics:'x'.repeat(241)},{...record,plainLyrics:Array(201).fill('line').join('\n')}])assert.throws(()=>parseLyricsRecord(value,query));
 assert.equal(parseLyricsRecord({...record,trackName:' TEST  SONG ',duration:18},query).id,42);
});
test('provider failures stay generic and bounded; cancellation and deadlines release work',async()=>{
 for(const status of [404,429,500])await assert.rejects(lookupLyrics(query,new AbortController().signal,async()=>new Response('PRIVATE PROVIDER BODY',{status})),e=>e instanceof Error&&!e.message.includes('PRIVATE'));
 await assert.rejects(lookupLyrics(query,new AbortController().signal,async()=>new Response('x'.repeat(128*1024+1))),/too large/i);
 await assert.rejects(lookupLyrics(query,new AbortController().signal,async()=>new Response('{}',{headers:{'content-length':String(128*1024+1)}})),/too large/i);
 const controller=new AbortController();controller.abort();let called=false;
 await assert.rejects(lookupLyrics(query,controller.signal,async()=>{called=true;return Response.json(record);}));assert.equal(called,false);
 await assert.rejects(lookupLyrics(query,new AbortController().signal,async(_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('aborted')));}),20),/timed out/i);
});

test('deadline also cancels a stalled response stream even if fetch ignores abort',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}));
  await assert.rejects(lookupLyrics(query,new AbortController().signal,async()=>response,20),/timed out/i);
  assert.equal(cancelled,true);
});
