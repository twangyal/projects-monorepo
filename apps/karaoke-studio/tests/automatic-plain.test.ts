import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticPlainLyrics,parseLyricsRecord,type LyricsRecord} from '../src/lyrics-lookup.ts';
import {parseAlignment,automaticAlignment} from '../src/auto-lyrics.ts';
const record:LyricsRecord={id:1,title:'Song',artist:'Singer',album:'',duration:16,text:'Hello world\nSing again',source:'https://lrclib.net/api/get/1'};
const query={title:'Song',artist:'Singer',duration:16};
test('only exact plain-only editions can start automatic local alignment',()=>{
 assert.equal(automaticPlainLyrics(record,query),true);
 for(const changed of [{title:'Song (Live)'},{artist:'Other Singer'},{duration:17.01},{text:''},{cues:[{start:1,end:3,text:'Hello world'}]},{timingNotice:'Invalid published timings'}])assert.equal(automaticPlainLyrics({...record,...changed},query),false);
 assert.equal(automaticPlainLyrics({...record,title:' SONG ',artist:'singer',duration:17},query),true);
});
test('automatic alignment refuses estimates, missing provenance and uncertain lines',()=>{
 const lines=['Hello world','Sing again'];const cues=[{start:1,end:3,text:lines[0],matched:1},{start:5,end:7,text:lines[1],matched:.8}];
 for(const method of ['letters','recognized-words','mixed'])assert.deepEqual(automaticAlignment({cues,method},16,lines),cues);
 for(const value of [{cues},{cues,method:'estimated'},{cues,method:'unknown'},{cues:[cues[0],{...cues[1],matched:.79}],method:'letters'},{cues:[{...cues[0],end:10}, {...cues[1],start:11,end:12}],method:'letters'}])assert.equal(automaticAlignment(value,16,lines),null);
 assert.deepEqual(parseAlignment({cues,method:'letters'},16,lines),cues);
 assert.throws(()=>parseAlignment({cues,method:'unknown'},16,lines));
 assert.throws(()=>parseAlignment({cues,method:'letters',extra:1},16,lines));
});

test('malformed provider timing types preserve words but cannot qualify as plain-only',()=>{
 const raw={id:1,trackName:'Song',artistName:'Singer',albumName:'',duration:16,instrumental:false,plainLyrics:'Hello world'};
 for(const syncedLyrics of [['[00:01]Hello world'],{},true,false,0]){
  const found=parseLyricsRecord({...raw,syncedLyrics},query);
  assert.equal(found.text,'Hello world');assert.ok(found.timingNotice);
  assert.equal(automaticPlainLyrics(found,query),false);
 }
 for(const syncedLyrics of [null,undefined,'','  '])assert.equal(automaticPlainLyrics(parseLyricsRecord({...raw,syncedLyrics},query),query),true);
});
