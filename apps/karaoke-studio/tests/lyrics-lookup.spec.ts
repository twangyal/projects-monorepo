import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const words='Hello, little world!\nThis is our chorus\nSing it back to me';
const record={id:42,trackName:'Test song',artistName:'Example singer',albumName:'Demo',duration:16,instrumental:false,plainLyrics:words};
function tone(duration=16){const n=duration*44100,b=Buffer.alloc(44+n*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(176400,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40);return b;}
const lines=(page:Page)=>page.locator('#cue-list textarea').evaluateAll(nodes=>nodes.map(n=>(n as HTMLTextAreaElement).value));
test.afterEach(async({request})=>{const s=await(await request.get('/api/session')).json();for(const p of (await(await request.get('/api/projects')).json()).projects)await request.delete(`/api/projects/${p.id}`,{headers:{'X-Karaoke-Token':s.token},data:{}});});
async function setup(page:Page,duration=16){await page.goto('/');await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');await page.getByLabel('Upload song clip').setInputFiles({name:'test-song.wav',mimeType:'audio/wav',buffer:tone(duration)});await expect(page.locator('#message')).toContainText(duration===16?'Your stems and 3 automatically timed lyric lines':'Your stems are ready',{timeout:15000});await page.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);await page.getByLabel('Song title for lookup',{exact:true}).fill('Test song');await page.getByLabel('Artist for lookup',{exact:true}).fill('Example singer');}
test('deliberate metadata lookup previews plain lyrics, aligns to local words, saves and exports',async({page})=>{
  test.setTimeout(60000);
  const queries:URL[]=[];await page.route('https://lrclib.net/api/get?**',route=>{queries.push(new URL(route.request().url()));return route.fulfill({json:record,headers:{'access-control-allow-origin':'*'}});});
  await setup(page);expect(queries).toHaveLength(0);const before=await lines(page);
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-preview')).toHaveText(words);expect(await lines(page)).toEqual(before);expect(queries).toHaveLength(1);expect([...queries[0].searchParams.keys()].sort()).toEqual(['artist_name','duration','track_name']);
  await page.getByRole('button',{name:'Use lyrics and align',exact:true}).click();await expect(page.locator('#message')).toContainText('Aligned 3 lines');expect(await lines(page)).toEqual(words.split('\n'));await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('0.85');
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await lines(page)).toEqual(before);await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue(before.join('\n'));await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();expect(await lines(page)).toEqual(words.split('\n'));
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  const project=(await(await page.request.get('/api/projects')).json()).projects[0];const saved=await(await page.request.get(`/api/projects/${project.id}`)).json();expect(saved.cues.map((c:{text:string})=>c.text)).toEqual(words.split('\n'));
  const wait=page.waitForEvent('download',{timeout:30000});await page.getByRole('button',{name:'Export karaoke MP4',exact:true}).click();const bytes=await readFile((await(await wait).path())!);expect(bytes.subarray(4,8).toString()).toBe('ftyp');expect(bytes.length).toBeGreaterThan(1000);
});
test('dirty pasted words and later edits cannot be replaced by a delayed lookup',async({page})=>{
  let release:()=>void=()=>undefined;const gate=new Promise<void>(r=>release=r);await page.route('https://lrclib.net/api/get?**',async route=>{await gate;await route.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}).catch(()=>undefined);});
  await setup(page);await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await page.getByLabel('Paste lyrics, one line per cue').fill('My unpublished draft');release();
  await expect(page.locator('#lookup-use')).toBeDisabled();await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('My unpublished draft');
  await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-preview')).toHaveText(words);await page.getByLabel('Artist for lookup',{exact:true}).fill('Another artist');await expect(page.locator('#lookup-use')).toBeDisabled();
});
test('provider failure and explicit cancel keep local automatic cues usable',async({page})=>{
  const searches:URL[]=[];await page.route('https://lrclib.net/api/search?**',route=>{searches.push(new URL(route.request().url()));return route.fulfill({json:[{...record,id:7,duration:200}],headers:{'access-control-allow-origin':'*'}});});
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({status:404,body:'PRIVATE PROVIDER RESPONSE',headers:{'access-control-allow-origin':'*'}}));await setup(page);const before=await lines(page);
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-status')).toContainText('No matching lyrics');expect(searches.map(url=>[url.searchParams.get('track_name'),url.searchParams.get('artist_name')])).toEqual([['test song','example singer']]);expect(await lines(page)).toEqual(before);await expect(page.locator('#lookup-status')).not.toContainText('PRIVATE');
  let release:()=>void=()=>undefined;const gate=new Promise<void>(r=>release=r);await page.route('https://lrclib.net/api/get?**',async route=>{await gate;await route.abort().catch(()=>undefined);});await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await page.getByRole('button',{name:'Cancel lyrics lookup',exact:true}).click();release();await expect(page.locator('#lookup-status')).toContainText('cancelled');expect(await lines(page)).toEqual(before);await expect(page.getByRole('button',{name:'Export karaoke MP4',exact:true})).toBeEnabled();
});

test('lookup waits for local recognition availability before applying',async({page})=>{
  let release:()=>void=()=>undefined;const gate=new Promise<void>(r=>release=r);
  await page.route('**/api/projects/*/transcript',async route=>{const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>undefined);});
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));
  try{
    await setup(page);const before=await lines(page);
    await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-preview')).toHaveText(words);
    await expect(page.locator('#lookup-use')).toBeDisabled();expect(await lines(page)).toEqual(before);
    release();await expect(page.locator('#lookup-use')).toBeEnabled();await page.locator('#lookup-use').click();await expect(page.locator('#message')).toContainText('Aligned 3 lines');await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('0.85');
  }finally{release();}
});

test('a failed transcript read cannot be mistaken for confirmed absent recognition',async({page})=>{
  await page.route('**/api/projects/*/transcript',route=>route.fulfill({status:500,json:{error:'fixture unavailable'}}));
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));
  await setup(page);const before=await lines(page);await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();
  await expect(page.locator('#lookup-preview')).toHaveText(words);await expect(page.locator('#lookup-use')).toBeDisabled();await expect(page.locator('#lookup-readiness')).toContainText('Refresh projects');expect(await lines(page)).toEqual(before);
});

test('confirmed absent recognition allows clearly explained estimated timings',async({page})=>{
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:{...record,duration:2},headers:{'access-control-allow-origin':'*'}}));
  await setup(page,2);await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-preview')).toHaveText(words);await expect(page.locator('#lookup-use')).toBeEnabled();await page.locator('#lookup-use').click();await expect(page.locator('#message')).toContainText('evenly spaced');expect(await lines(page)).toEqual(words.split('\n'));await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('0');
});
// A WAV with RIFF INFO title and artist tags, as music libraries write them.
function tagged(title:string,artist:string,duration=16){
  const info=Buffer.concat([['INAM',title],['IART',artist]].map(([id,text])=>{const data=Buffer.from(`${text}\0`,'utf8'),padded=Buffer.alloc(data.length+(data.length%2));data.copy(padded);const head=Buffer.alloc(8);head.write(id);head.writeUInt32LE(data.length,4);return Buffer.concat([head,padded]);}));
  const list=Buffer.alloc(12);list.write('LIST');list.writeUInt32LE(info.length+4,4);list.write('INFO',8);
  const wav=Buffer.concat([tone(duration),list,info]);wav.writeUInt32LE(wav.length-8,4);return wav;
}
test('a song file’s own title and artist name the clip and prefill the lookup, which still waits for a click',async({page})=>{
  const queries:URL[]=[];await page.route('https://lrclib.net/api/get?**',route=>{queries.push(new URL(route.request().url()));return route.fulfill({json:record,headers:{'access-control-allow-origin':'*'}});});
  await page.goto('/');await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles({name:'03 - track.wav',mimeType:'audio/wav',buffer:tagged('Test song','Example singer')});
  await expect(page.locator('#message')).toContainText('Your stems and 3 automatically timed lyric lines',{timeout:15000});
  await expect(page.getByLabel('Clip title')).toHaveValue('Test song');
  await page.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);
  await expect(page.getByLabel('Song title for lookup',{exact:true})).toHaveValue('Test song');
  await expect(page.getByLabel('Artist for lookup',{exact:true})).toHaveValue('Example singer');
  await expect(page.locator('#lookup-status')).toHaveText('Title and artist come from the song file. Check them, then look up lyrics.');
  expect(queries).toHaveLength(0);
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-preview')).toHaveText(words);
  expect(queries[0].searchParams.get('track_name')).toBe('Test song');expect(queries[0].searchParams.get('artist_name')).toBe('Example singer');
  // After a reload the clip still offers the artist its file named.
  await page.reload();await page.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);
  await expect(page.getByLabel('Artist for lookup',{exact:true})).toHaveValue('Example singer');
});
test('published line timings time each found line directly, without waiting for alignment, and Undo restores the lines',async({page})=>{
  const synced='[00:01.50] Hello, little world!\n[00:05.00] This is our chorus\n[00:09.25] Sing it back to me\n[00:13.00]';
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:{...record,syncedLyrics:synced},headers:{'access-control-allow-origin':'*'}}));
  await setup(page);const before=await lines(page);
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-preview')).toHaveText(words);
  await expect(page.locator('#lookup-timed-note')).toBeVisible();
  await page.getByRole('button',{name:'Use lyrics with published timings',exact:true}).click();
  await expect(page.locator('#message')).toContainText('Timed 3 lines from the published line timings');
  expect(await lines(page)).toEqual(words.split('\n'));
  for(const [label,value] of [['Start line 1','1.5'],['End line 1','5'],['Start line 2','5'],['End line 3','13']] as const)await expect(page.getByLabel(label,{exact:true})).toHaveValue(value);
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await lines(page)).toEqual(before);
  // Without synced lines, only aligning is offered.
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-preview')).toHaveText(words);
  await expect(page.getByRole('button',{name:'Use lyrics with published timings',exact:true})).toBeHidden();
});

const synchronized={...record,plainLyrics:'Different plain words',syncedLyrics:'[00:02.25]Supplied first line\n[00:04.50]\n[00:08.10]日本語の歌\n[00:13.00]'};
test('reviewed supplied timings work without recognition and survive Undo, save, reopen and SRT export',async({page})=>{
  await page.route('**/api/projects/*/transcript',route=>route.fulfill({status:500,json:{error:'fixture unavailable'}}));
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:synchronized,headers:{'access-control-allow-origin':'*'}}));
  await setup(page);const before=await lines(page);
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();
  await expect(page.locator('#lookup-preview')).toHaveText('Different plain words');
  await expect(page.locator('#lookup-timing-preview')).toContainText('0:02.25 → 0:04.50');
  await expect(page.locator('#lookup-timing-preview')).toContainText('日本語の歌');
  expect(await lines(page)).toEqual(before);
  await expect(page.locator('#lookup-use')).toBeDisabled();
  await page.getByRole('button',{name:'Use lyrics with published timings',exact:true}).click();
  expect(await lines(page)).toEqual(['Supplied first line','日本語の歌']);
  await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('2.25');
  await expect(page.getByLabel('End line 1',{exact:true})).toHaveValue('4.5');
  await expect(page.getByLabel('Start line 2',{exact:true})).toHaveValue('8.1');
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await lines(page)).toEqual(before);
  await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();expect(await lines(page)).toEqual(['Supplied first line','日本語の歌']);
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  await page.reload();await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('2.25');
  const projects=(await(await page.request.get('/api/projects')).json()).projects;
  const saved=await(await page.request.get(`/api/projects/${projects[0].id}`)).json();
  expect(saved.cues).toEqual([{start:2.25,end:4.5,text:'Supplied first line'},{start:8.1,end:13,text:'日本語の歌'}]);
  const srt=await(await page.request.get(`/api/projects/${projects[0].id}/lyrics`)).text();
  expect(srt).toContain('00:00:02,250 --> 00:00:04,500');expect(srt).toContain('日本語の歌');
});

test('supplied timings cannot overwrite pasted words or a changed editor',async({page})=>{
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:synchronized,headers:{'access-control-allow-origin':'*'}}));
  await setup(page);const before=await lines(page);
  await page.getByLabel('Paste lyrics, one line per cue').fill('Private draft');
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();
  await expect(page.locator('#lookup-timing-preview')).toContainText('Supplied first line');
  await expect(page.locator('#lookup-use-timed')).toBeDisabled();expect(await lines(page)).toEqual(before);
  await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-use-timed')).toBeEnabled();
  await page.getByLabel('Start line 1',{exact:true}).fill('0.5');
  await expect(page.locator('#lookup-use-timed')).toBeDisabled();await expect(page.locator('#lookup-review')).toBeHidden();
  expect(await lines(page)).toEqual(before);
});

test('unsupported supplied timing explains the plain-word fallback',async({page})=>{
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:{...record,syncedLyrics:'[offset:100]\n[00:01]One'},headers:{'access-control-allow-origin':'*'}}));
  await setup(page);await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();
  await expect(page.locator('#lookup-timing-notice')).toContainText('could not be used');
  await expect(page.locator('#lookup-use-timed')).toBeHidden();await expect(page.locator('#lookup-use')).toBeEnabled();
  await page.locator('#lookup-use').click();await expect(page.locator('#message')).toContainText('Aligned 3 lines');
});

test('a song not found exactly is searched, and the same song at this duration is offered',async({page})=>{
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({status:404,body:'{}',headers:{'access-control-allow-origin':'*'}}));
  await page.route('https://lrclib.net/api/search?**',route=>route.fulfill({json:[{...record,id:5,duration:120},{...record,id:6,trackName:'Test Song (Remastered)',duration:16.5}],headers:{'access-control-allow-origin':'*'}}));
  await setup(page);await page.getByLabel('Song title for lookup',{exact:true}).fill('Test song - Remastered 2020');
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await expect(page.locator('#lookup-preview')).toHaveText(words);
  await expect(page.locator('#lookup-match')).toContainText('Test Song (Remastered) — Example singer');
});
