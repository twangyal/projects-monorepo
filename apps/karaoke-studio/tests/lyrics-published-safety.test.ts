import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseSyncedLyrics,parseLyricsRecord} from '../src/lyrics-lookup.ts';
const query={title:'Test song',artist:'Example singer',duration:16};
const record={id:42,trackName:query.title,artistName:query.artist,duration:16,instrumental:false,plainLyrics:'Plain words',syncedLyrics:'[00:02.25]Supplied first\n[00:04.50]\n[00:08.10]日本語の歌\n[00:13.00]'};
test('published lyric parsing refuses partial lyrics rather than dropping or truncating words',()=>{
 for(const lrc of ['[00:01]Valid\n[00:17]Outside clip', '[00:01]Valid\n[00:60]Invalid seconds', '[00:01]Valid\n[00:02]'+ 'x'.repeat(241), '[00:01]Valid\nUntimed words', '[offset:500]\n[00:01]Wrong offset', '[00:01]Valid\n[00:xx]Malformed time', 'x'.repeat(128*1024+1)])assert.equal(parseSyncedLyrics(lrc,16),null,lrc.slice(0,70));
 assert.equal(parseSyncedLyrics('[00:01]'+ '😊'.repeat(240),16)?.[0].text,'😊'.repeat(240));
 assert.deepEqual(parseSyncedLyrics('[00:01.000]Short\n[00:01.010]Next',16)?.map(c=>c.text),['Short','Next']);
});
test('a valid synchronized-only edition is usable and invalid timing explains fallback',()=>{
 const parsed=parseLyricsRecord({...record,plainLyrics:null},query);
 assert.equal(parsed.text,'Supplied first\n日本語の歌');assert.equal(parsed.cues?.length,2);
 const fallback=parseLyricsRecord({...record,syncedLyrics:'[offset:500]\n[00:01]Wrong'},query);
 assert.equal(fallback.text,'Plain words');assert.equal(fallback.cues,undefined);
 assert.match('timingNotice' in fallback?String(fallback.timingNotice):'',/could not be used/);
});
