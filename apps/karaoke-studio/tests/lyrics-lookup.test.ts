import {test} from 'node:test';import assert from 'node:assert/strict';
import {lookupLyrics,parseLyricsRecord,lookupQuery,songFromFileName} from '../src/lyrics-lookup.ts';
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

test('published line timings become cues that end at the next line or gap and fit the clip', async () => {
  const { parseSyncedLyrics, parseLyricsRecord } = await import('../src/lyrics-lookup.ts');
  const lrc = '[ar:Example]\n[00:01.50] Hello <00:02.00>little world\n[00:04.00][00:12.25] This is our chorus\n[00:07.10]\n[00:09.000] Sing it back';
  assert.deepEqual(parseSyncedLyrics(lrc, 16), [
    { start: 1.5, end: 4, text: 'Hello little world' }, { start: 4, end: 7.1, text: 'This is our chorus' },
    { start: 9, end: 12.25, text: 'Sing it back' }, { start: 12.25, end: 16, text: 'This is our chorus' }]);
  // Nothing usable, or timings out of order with the clip, fall back to aligning the plain words.
  assert.equal(parseSyncedLyrics('no timings here', 16), null);
  assert.equal(parseSyncedLyrics('[00:20.00] after the clip', 16), null);
  const record = parseLyricsRecord({ id: 7, trackName: 'Song', artistName: 'Band', duration: 16, instrumental: false, plainLyrics: 'Hello little world', syncedLyrics: lrc }, { title: 'Song', artist: 'Band', duration: 16 });
  assert.equal(record.cues?.length, 4);
  assert.equal(parseLyricsRecord({ id: 7, trackName: 'Song', artistName: 'Band', duration: 16, instrumental: false, plainLyrics: 'Hello', syncedLyrics: null }, { title: 'Song', artist: 'Band', duration: 16 }).cues, undefined);
});

test('editions and featured credits match the same song, and a missed exact lookup searches the catalogue', async () => {
  const { coreTitle, coreArtist, parseLyricsRecord, lookupLyrics } = await import('../src/lyrics-lookup.ts');
  assert.equal(coreTitle('Bohemian Rhapsody - Remastered 2011'), 'bohemian rhapsody');
  assert.equal(coreTitle('Song (Live at Wembley) [Bonus Track]'), 'song');
  assert.equal(coreTitle('Song feat. Somebody'), 'song');
  assert.equal(coreTitle('Love - Me - Do'), 'love me do');
  assert.equal(coreArtist('Queen & David Bowie'), 'queen');
  assert.equal(coreArtist('Daft Punk feat. Pharrell Williams'), 'daft punk');
  const edition = { id: 9, trackName: 'Bohemian rhapsody', artistName: 'Queen', duration: 354, instrumental: false, plainLyrics: 'Is this the real life?', syncedLyrics: null };
  assert.equal(parseLyricsRecord(edition, { title: 'Bohemian Rhapsody - Remastered 2011', artist: 'Queen', duration: 354 }).id, 9);
  assert.throws(() => parseLyricsRecord(edition, { title: 'Under Pressure', artist: 'Queen', duration: 354 }), /does not match/);
  const urls: URL[] = [];
  const fetcher = async (input: URL | RequestInfo) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.pathname === '/api/get') return new Response('{}', { status: 404 });
    return Response.json([{ ...edition, id: 1, duration: 300 }, { ...edition, id: 2, trackName: 'Other song' }, { ...edition, id: 3, duration: 355, plainLyrics: 'Closest edition' }, { ...edition, id: 4, duration: 352.5 }]);
  };
  const found = await lookupLyrics({ title: 'Bohemian Rhapsody (2011 Remaster)', artist: 'Queen feat. Nobody', duration: 354.4 }, new AbortController().signal, fetcher);
  assert.equal(found.id, 3);
  assert.deepEqual([urls[1]!.pathname, urls[1]!.searchParams.get('track_name'), urls[1]!.searchParams.get('artist_name')], ['/api/search', 'bohemian rhapsody', 'queen']);
  const none = async (input: URL | RequestInfo) => new URL(String(input)).pathname === '/api/get' ? new Response('{}', { status: 404 }) : Response.json([{ ...edition, duration: 200 }]);
  await assert.rejects(lookupLyrics({ title: 'Bohemian Rhapsody', artist: 'Queen', duration: 354 }, new AbortController().signal, none), /No matching lyrics/);
});
test('a song file name gives its artist and title without track numbers or video notes',()=>{
 assert.deepEqual(songFromFileName('Adele - Hello'),{artist:'Adele',title:'Hello'});
 assert.deepEqual(songFromFileName('03. Daft Punk – Get Lucky (Official Video) [HD]'),{artist:'Daft Punk',title:'Get Lucky'});
 assert.deepEqual(songFromFileName('07 - Queen - Bohemian Rhapsody - Remastered 2011'),{artist:'Queen',title:'Bohemian Rhapsody - Remastered 2011'});
 assert.deepEqual(songFromFileName('50 Cent - In da Club'),{artist:'50 Cent',title:'In da Club'});
 assert.deepEqual(songFromFileName('Nina_Simone_-_Feeling_Good'),{artist:'Nina Simone',title:'Feeling Good'});
 assert.deepEqual(songFromFileName('Hey Jude (Lyrics)'),null);
 assert.deepEqual(songFromFileName('demo-take-3'),null);
 assert.deepEqual(songFromFileName(' - Title'),null);
});
