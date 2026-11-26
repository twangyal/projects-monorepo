import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLyricsRecord,automaticPublishedTiming,lookupLyrics} from '../src/lyrics-lookup.ts';
const query={title:'Test song',artist:'Example singer',duration:16};
const raw={id:42,trackName:'Test song',artistName:'Example singer',duration:16,instrumental:false,plainLyrics:'Published first\nPublished second',syncedLyrics:'[00:02]Published first\n[00:06]Published second\n[00:10]'};
test('automatic published timing requires the exact named edition but tolerates case spacing and rounded duration',()=>{
  const record=parseLyricsRecord(raw,query);
  assert.equal(automaticPublishedTiming(record,query),true);
  assert.equal(automaticPublishedTiming({...record,title:'  TEST   song ',artist:'EXAMPLE singer',duration:16.9},query),true);
  assert.equal(automaticPublishedTiming({...record,duration:17},query),true);
  assert.equal(automaticPublishedTiming({...record,duration:17.001},query),false);
  assert.equal(automaticPublishedTiming({...record,title:'Café',artist:'歌手'},{title:'Cafe\u0301',artist:'歌手',duration:16}),true);
  for(const changed of [{trackName:'Test song (Live)'},{artistName:'Example singer feat. Another singer'}]){
    const loose=parseLyricsRecord({...raw,...changed},query);assert.equal(automaticPublishedTiming(loose,query),false);
  }
});
test('automatic published timing refuses plain-only invalid incomplete or oversized cue sets',()=>{
  const record=parseLyricsRecord(raw,query);
  assert.equal(automaticPublishedTiming(parseLyricsRecord({...raw,syncedLyrics:null},query),query),false);
  assert.equal(automaticPublishedTiming(parseLyricsRecord({...raw,syncedLyrics:'[00:02]Good\n[00:17]Outside'},query),query),false);
  for(const cues of [[],[{start:2,end:17,text:'Outside'}],[{start:NaN,end:4,text:'Not finite'}],[{start:2,end:4,text:'x'.repeat(241)}]])assert.equal(automaticPublishedTiming({...record,cues},query),false);
  assert.equal(automaticPublishedTiming(record,{...query,duration:NaN}),false);
  assert.deepEqual(record.cues?.map(cue=>cue.text),['Published first','Published second']);
});

test('automatic replacement refuses a demonstrably partial timed prefix or subset of supplied plain lyrics',()=>{
  for(const syncedLyrics of ['[00:02]Published first','[00:02]Published first\n[00:06]Published second']){
    const record=parseLyricsRecord({...raw,plainLyrics:'Published first\nMissing middle\nPublished second\nMissing ending',syncedLyrics},query);
    assert.equal(automaticPublishedTiming(record,query),false);
  }
  const formatted=parseLyricsRecord({...raw,plainLyrics:'Hello, world!\n日本語の歌\nSame chorus',syncedLyrics:'[00:01]Hello world\n[00:03]日本\n[00:05]語の歌\n[00:09]Same chorus'},query);
  assert.equal(automaticPublishedTiming(formatted,query),true);
  assert.equal(automaticPublishedTiming(parseLyricsRecord({...raw,plainLyrics:null},query),query),true);
});

test('withdrawing automatic request permission stops a delayed 404 before catalogue fallback',async()=>{
  const urls:string[]=[];let release=()=>{},allowed=true;const gate=new Promise<void>(r=>release=r);
  const fetcher=(async(url:URL)=>{urls.push(url.pathname);if(url.pathname==='/api/get'){await gate;return new Response('',{status:404});}return Response.json([]);})as typeof fetch;
  const pending=lookupLyrics(query,new AbortController().signal,fetcher,2000,()=>allowed);allowed=false;release();
  await assert.rejects(pending,/cancel|off/i);assert.deepEqual(urls,['/api/get']);
});
