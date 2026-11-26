import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const autoName='Use matching published timings automatically for untouched new uploads in this session';
const words=['Published first','Published second'];
const record={id:42,trackName:'Test song',artistName:'Example singer',albumName:'Test edition',duration:16,instrumental:false,plainLyrics:words.join('\n'),syncedLyrics:'[00:02]Published first\n[00:06]Published second\n[00:10]'};
const owned:string[]=[];
function audio(duration=16,tagged=true){
  const n=duration*44100,b=Buffer.alloc(44+n*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(176400,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40);
  if(!tagged)return b;
  const info=Buffer.concat([['INAM','Test song'],['IART','Example singer']].map(([id,text])=>{const data=Buffer.from(`${text}\0`),padded=Buffer.alloc(data.length+data.length%2);data.copy(padded);const head=Buffer.alloc(8);head.write(id);head.writeUInt32LE(data.length,4);return Buffer.concat([head,padded]);}));
  const list=Buffer.alloc(12);list.write('LIST');list.writeUInt32LE(info.length+4,4);list.write('INFO',8);const bytes=Buffer.concat([b,list,info]);bytes.writeUInt32LE(bytes.length-8,4);return bytes;
}
async function setup(page:Page,optIn=true){
  await page.goto('/');await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');await page.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);
  const option=page.getByRole('checkbox',{name:autoName,exact:true});await expect(option).not.toBeChecked();await expect(option).toBeDisabled();
  await page.locator('#lookup-auto').check();await expect(option).toBeEnabled();if(optIn)await option.check();
}
async function upload(page:Page,duration=16,name='03 - track.wav',tagged=true){
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');
  await page.getByLabel('Upload song clip').setInputFiles({name,mimeType:'audio/wav',buffer:audio(duration,tagged)});
  const response=await pending;expect(response.status()).toBe(202);const id=(await response.json()).job.projectId as string;owned.push(id);
  await expect(page.locator('#projects')).toHaveValue(id,{timeout:15000});return id;
}
const lines=(page:Page)=>page.locator('#cue-list textarea').evaluateAll(nodes=>nodes.map(n=>(n as HTMLTextAreaElement).value));
test.afterEach(async({request})=>{const session=await(await request.get('/api/session')).json(),ids=owned.splice(0);if(session.activeJob&&ids.includes(session.activeJob.projectId)){await request.post(`/api/jobs/${session.activeJob.id}/cancel`,{headers:{'X-Karaoke-Token':session.token},data:{}});await expect.poll(async()=>(await(await request.get(`/api/jobs/${session.activeJob.id}`)).json()).job.status).not.toBe('running');}for(const id of ids)expect((await request.delete(`/api/projects/${id}`,{headers:{'X-Karaoke-Token':session.token},data:{}})).ok()).toBe(true);});

for(const width of [1280,390])test(`opted-in new upload reaches an undoable published preview and can save/export at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const queries:URL[]=[];await page.route('https://lrclib.net/api/get?**',r=>{queries.push(new URL(r.request().url()));return r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}});});
  await setup(page);const id=await upload(page);await expect(page.locator('#lookup-status')).toContainText('applied automatically');expect(await lines(page)).toEqual(words);
  await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('2');await expect(page.getByLabel('End line 2',{exact:true})).toHaveValue('10');
  await expect(page.locator('#lookup-source')).toBeVisible();await expect(page.locator('#lookup-source')).toHaveAttribute('href','https://lrclib.net/api/get/42');
  expect((await(await page.request.get(`/api/projects/${id}`)).json()).cues).toHaveLength(3);await expect(page.locator('#save-state')).toContainText('Unsaved');
  expect(queries).toHaveLength(1);expect([...queries[0].searchParams.keys()].sort()).toEqual(['artist_name','duration','track_name']);
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await lines(page)).not.toEqual(words);await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();expect(await lines(page)).toEqual(words);
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  const download=page.waitForEvent('download');await page.locator('#lyrics-download').click();const srt=await readFile((await(await download).path())!,'utf8');expect(srt).toContain('Published first');expect(srt).toContain('00:00:02,000');
  await page.reload();await page.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);await expect(page.getByRole('checkbox',{name:autoName,exact:true})).not.toBeChecked();await expect.poll(()=>lines(page)).toEqual(words);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('ordinary automatic lookup still only reviews unless the separate session option was enabled',async({page})=>{
  await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));await setup(page,false);await upload(page);
  await expect(page.locator('#lookup-preview')).toContainText('Published first');expect(await lines(page)).not.toEqual(words);await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
});

for(const variant of ['plain only','different edition','far duration','invalid timings','partial timed prefix'] as const)test(`${variant} remains available for manual review without automatic replacement`,async({page})=>{
  const changed=variant==='plain only'?{syncedLyrics:null}:variant==='different edition'?{trackName:'Test song (Live)'}:variant==='far duration'?{duration:17.5}:variant==='partial timed prefix'?{plainLyrics:'Published first\nSecond missing\nThird missing\nFourth missing',syncedLyrics:'[00:02]Published first'}:{syncedLyrics:'[00:02]Good\n[00:17]Outside'};
  await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:{...record,...changed},headers:{'access-control-allow-origin':'*'}}));await setup(page);await upload(page);
  await expect(page.locator('#lookup-review')).toBeVisible();await expect(page.locator('#lookup-status')).toContainText('Review');expect(await lines(page)).not.toEqual(words);await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
});

for(const action of ['edit ABA','raw timing','other lyric draft','export setting','focused lyric field','pasted draft','metadata','opt out','opt out ABA','other tab opt out','cancel lookup','review ABA'] as const)test(`${action} while a published result is pending keeps the user's current work`,async({page})=>{
  let release=()=>{};const gate=new Promise<void>(r=>release=r);let requested=false;
  await page.route('https://lrclib.net/api/get?**',async r=>{requested=true;await gate;await r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}).catch(()=>undefined);});
  await setup(page);const id=await upload(page);await expect.poll(()=>requested).toBe(true);const before=await lines(page);
  if(action==='edit ABA'){await page.getByLabel('Lyric line 1',{exact:true}).fill('Changed then returned');await page.getByLabel('Lyric line 1',{exact:true}).fill(before[0]);}
  if(action==='raw timing')await page.getByLabel('Start line 1',{exact:true}).fill('');
  if(action==='other lyric draft'){await page.locator('.lyric-replace').evaluate(n=>(n as HTMLDetailsElement).open=true);await page.locator('#words-replace-find').fill('Unfinished replacement');}
  if(action==='export setting')await page.locator('#lyric-style').selectOption({index:1});
  if(action==='focused lyric field')await page.getByLabel('Lyric line 1',{exact:true}).focus();
  if(action==='pasted draft')await page.getByLabel('Paste lyrics, one line per cue').fill('Private unpublished words');
  if(action==='metadata')await page.getByLabel('Artist for lookup',{exact:true}).fill('Different artist');
  if(action==='opt out')await page.getByRole('checkbox',{name:autoName,exact:true}).uncheck();
  if(action==='opt out ABA'){await page.getByRole('checkbox',{name:autoName,exact:true}).uncheck();await page.getByRole('checkbox',{name:autoName,exact:true}).check();}
  if(action==='other tab opt out'){const other=await page.context().newPage();await other.goto('/');await other.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);await other.locator('#lookup-auto').uncheck();await expect(page.locator('#lookup-auto')).not.toBeChecked();await other.close();}
  if(action==='cancel lookup')await page.getByRole('button',{name:'Cancel lyrics lookup',exact:true}).click();
  if(action==='review ABA'){await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();await page.getByRole('button',{name:'Cancel lyric import',exact:true}).click();}
  release();await expect(page.locator('#lookup-cancel')).not.toHaveText('Cancel lyrics lookup');expect(await lines(page)).toEqual(before);
  if(action==='raw timing')await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('');expect((await(await page.request.get(`/api/projects/${id}`)).json()).cues).toHaveLength(3);
  if(action==='pasted draft')await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('Private unpublished words');
  if(action==='other lyric draft')await expect(page.locator('#words-replace-find')).toHaveValue('Unfinished replacement');
  if(action==='focused lyric field')await expect(page.getByLabel('Lyric line 1',{exact:true})).toBeFocused();
});

test('published timing can make a fresh no-recognition upload usable without manual timing',async({page})=>{
  await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:{...record,duration:12},headers:{'access-control-allow-origin':'*'}}));await setup(page);const id=await upload(page,12);
  await expect(page.locator('#lookup-status')).toContainText('applied automatically');expect(await lines(page)).toEqual(words);expect((await(await page.request.get(`/api/projects/${id}`)).json()).cues).toHaveLength(0);
});

test('an untagged file naming its artist and title can use exact matched timings',async({page})=>{
  await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));await setup(page);await upload(page,16,'Example singer - Test song.wav',false);
  await expect(page.locator('#lookup-status')).toContainText('applied automatically');expect(await lines(page)).toEqual(words);
});

test('an existing saved correction is never automatically replaced even with the session option already on',async({page})=>{
  const session=await(await page.request.get('/api/session')).json();const response=await page.request.post('/api/projects',{headers:{'X-Karaoke-Token':session.token,'X-Audio-Name':encodeURIComponent('Example singer - Test song.wav'),'Content-Type':'application/octet-stream'},data:audio(16,false)});expect(response.status()).toBe(202);
  const job=(await response.json()).job;owned.push(job.projectId);await expect.poll(async()=>(await(await page.request.get(`/api/jobs/${job.id}`)).json()).job.status,{timeout:15000}).toBe('complete');
  const project=await(await page.request.get(`/api/projects/${job.projectId}`)).json();project.cues[0].text='Personal saved correction';expect((await page.request.put(`/api/projects/${job.projectId}`,{headers:{'X-Karaoke-Token':session.token},data:{title:project.title,cues:project.cues,revision:project.revision}})).ok()).toBe(true);
  await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));await setup(page);await expect(page.locator('#projects')).toHaveValue('');await page.locator('#projects').selectOption(job.projectId);
  await expect(page.locator('#lookup-review')).toBeVisible();expect((await lines(page))[0]).toBe('Personal saved correction');await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
});

test('late published timing still applies after background batch preparation',async({page})=>{
  const ids:string[]=[];page.on('response',async response=>{if(response.url().endsWith('/api/projects')&&response.request().method()==='POST'&&response.status()===202){const id=(await response.json()).job.projectId as string;ids.push(id);owned.push(id);}});
  let release=()=>{};const gate=new Promise<void>(r=>release=r);let queries=0;
  await page.route('https://lrclib.net/api/get?**',async r=>{queries++;await gate;await r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}});});await setup(page);
  await page.getByLabel('Upload song clip').setInputFiles([{name:'03 - track.wav',mimeType:'audio/wav',buffer:audio()},{name:'other.wav',mimeType:'audio/wav',buffer:audio(12,false)}]);
  await expect.poll(()=>ids.length,{timeout:15000}).toBe(2);await expect(page.locator('#projects')).toHaveValue(ids[0]);await expect(page.locator('#job-panel')).toBeHidden({timeout:15000});await expect.poll(()=>queries).toBe(1);release();
  await expect(page.locator('#lookup-status')).toContainText('applied automatically',{timeout:15000});expect(await lines(page)).toEqual(words);expect(queries).toBe(1);
});

for(const optOut of [false,true])test(`a completed match waits for background work and ${optOut?'keeps opt-out':'applies once it finishes'}`,async({page})=>{
  const ids:string[]=[];page.on('response',async response=>{if(response.url().endsWith('/api/projects')&&response.request().method()==='POST'&&response.status()===202){const id=(await response.json()).job.projectId as string;ids.push(id);owned.push(id);}});
  let release=()=>{};const gate=new Promise<void>(r=>release=r);await page.route('https://lrclib.net/api/get?**',async r=>{await gate;await r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}});});await setup(page);
  await page.getByLabel('Upload song clip').setInputFiles([{name:'03 - track.wav',mimeType:'audio/wav',buffer:audio()},{name:'background.wav',mimeType:'audio/wav',buffer:audio(18,false)}]);
  await expect.poll(()=>ids.length,{timeout:15000}).toBe(2);await expect(page.locator('#job-stage')).toContainText('Waiting for recognition cancellation',{timeout:15000});release();
  await expect(page.locator('#lookup-status')).toContainText('Waiting for current studio work');expect(await lines(page)).not.toEqual(words);
  if(optOut)await page.getByRole('checkbox',{name:autoName,exact:true}).uncheck();
  await page.getByRole('button',{name:'Cancel job',exact:true}).click();await expect(page.locator('#job-panel')).toBeHidden({timeout:15000});
  if(optOut){expect(await lines(page)).not.toEqual(words);await expect(page.locator('#lookup-review')).toBeVisible();}
  else{await expect(page.locator('#lookup-status')).toContainText('applied automatically');expect(await lines(page)).toEqual(words);}
});

test('a refused automatic-lookup preference is visibly session-only and still needs explicit current consent',async({page})=>{
  await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='karaoke-lookup-auto')throw new DOMException('Preference refused','SecurityError');return original.call(this,key,value);};});
  await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));await setup(page);
  await expect(page.locator('#lookup-preference-status')).toContainText('only to this session');expect(await page.evaluate(()=>localStorage.getItem('karaoke-lookup-auto'))).toBeNull();await upload(page);
  await expect(page.locator('#lookup-status')).toContainText('applied automatically');expect(await lines(page)).toEqual(words);
});

test('automatic use updates the preview without changing the selected focused-workspace tool',async({page})=>{
  let release=()=>{};const gate=new Promise<void>(r=>release=r);let requested=false;await page.route('https://lrclib.net/api/get?**',async r=>{requested=true;await gate;await r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}});});await setup(page);await upload(page);await expect.poll(()=>requested).toBe(true);
  await page.locator('#workspace-mode').click();await page.getByRole('tab',{name:'Export',exact:true}).click();release();
  await expect(page.locator('#lookup-status')).toContainText('applied automatically');await expect(page.getByRole('tab',{name:'Export',exact:true})).toHaveAttribute('aria-selected','true');expect(await lines(page)).toEqual(words);
});

test('a correction saved by another client before the upload is opened is never claimed as untouched',async({page})=>{
  let release=()=>{};const gate=new Promise<void>(r=>release=r);let terminal='';
  await page.route('**/api/jobs/*',async route=>{const response=await route.fetch();const data=await response.json();if(data.job.status==='complete'&&data.job.kind==='separate'){terminal=data.job.projectId;await gate;}await route.fulfill({response,json:data});});
  await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));await setup(page);
  const accepted=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');await page.getByLabel('Upload song clip').setInputFiles({name:'03 - track.wav',mimeType:'audio/wav',buffer:audio()});const id=(await(await accepted).json()).job.projectId as string;owned.push(id);await expect.poll(()=>terminal,{timeout:15000}).toBe(id);
  const session=await(await page.request.get('/api/session')).json(),project=await(await page.request.get(`/api/projects/${id}`)).json();expect(project.revision).toBe(0);project.cues[0].text='Saved correction from another client';expect((await page.request.put(`/api/projects/${id}`,{headers:{'X-Karaoke-Token':session.token},data:{title:project.title,cues:project.cues,revision:project.revision}})).ok()).toBe(true);release();
  await expect(page.locator('#lookup-review')).toBeVisible();expect((await lines(page))[0]).toBe('Saved correction from another client');expect((await(await page.request.get(`/api/projects/${id}`)).json()).cues[0].text).toBe('Saved correction from another client');await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
});

test('a tagged song queued behind an observed job with an empty editor only offers review',async({page})=>{
  const session=await(await page.request.get('/api/session')).json(),response=await page.request.post('/api/projects',{headers:{'X-Karaoke-Token':session.token,'X-Audio-Name':'observed.wav','Content-Type':'application/octet-stream'},data:audio(18,false)});const observed=(await response.json()).job;owned.push(observed.projectId);
  await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));await setup(page);await expect(page.locator('#job-panel')).toBeVisible();await expect(page.locator('#projects')).toHaveValue('');
  const accepted=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST'&&r.status()===202);await page.getByLabel('Upload song clip').setInputFiles({name:'03 - track.wav',mimeType:'audio/wav',buffer:audio()});await expect(page.locator('#upload-queue-list li')).toHaveCount(1);
  await page.request.post(`/api/jobs/${observed.id}/cancel`,{headers:{'X-Karaoke-Token':session.token},data:{}});const id=(await(await accepted).json()).job.projectId as string;owned.push(id);await expect(page.locator('#projects')).toHaveValue(id,{timeout:15000});
  await expect(page.locator('#lookup-review')).toBeVisible();expect(await lines(page)).not.toEqual(words);await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
});

test('checking a doubtful word keeps its original lyric line and auto-pause despite a delayed match',async({page})=>{
  let release=()=>{};const gate=new Promise<void>(r=>release=r);await page.route('https://lrclib.net/api/get?**',async r=>{await gate;await r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}});});await setup(page);await upload(page);
  await expect(page.locator('#next-doubt')).toBeEnabled();const before=await lines(page),end=Number(await page.getByLabel('End line 3',{exact:true}).inputValue());await page.locator('#next-doubt').click();await expect(page.locator('#fix-line-status')).toContainText('line 3');release();
  await expect(page.locator('#lookup-review')).toBeVisible();expect(await lines(page)).toEqual(before);await page.locator('audio').evaluate((node,at)=>(node as HTMLAudioElement).currentTime=at,end+.4);await expect.poll(()=>page.locator('audio').evaluate(a=>(a as HTMLAudioElement).paused)).toBe(true);
});

for(const crossTab of [false,true])test(`automatic lookup withdrawal ${crossTab?'in another tab':'here'} stops actual fallback URLs`,async({page})=>{
  const urls:string[]=[];let release=()=>{},finished=false;const gate=new Promise<void>(r=>release=r);
  await page.route('https://lrclib.net/api/**',async route=>{const url=new URL(route.request().url());urls.push(url.pathname);if(url.pathname==='/api/get'&&urls.length===1)await gate;await route.fulfill({status:url.pathname==='/api/get'?404:200,json:url.pathname==='/api/get'?{}:[],headers:{'access-control-allow-origin':'*'}}).catch(()=>undefined);finished=true;});
  await setup(page);await upload(page,16,'Example singer - Test song.wav',false);await expect.poll(()=>urls.length).toBe(1);
  if(crossTab){const other=await page.context().newPage();await other.goto('/');await other.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);await other.locator('#lookup-auto').uncheck();await other.close();}else await page.locator('#lookup-auto').uncheck();
  release();await expect.poll(()=>finished).toBe(true);await expect(page.locator('#lookup-cancel')).toBeHidden();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(urls).toEqual(['/api/get']);expect(await lines(page)).not.toEqual(words);
});

test('explicit manual lookup remains authorized through catalogue fallback after automatic lookup is turned off',async({page})=>{
  const urls:string[]=[];let release=()=>{};const gate=new Promise<void>(r=>release=r);await page.route('https://lrclib.net/api/**',async route=>{const url=new URL(route.request().url());urls.push(url.pathname);if(url.pathname==='/api/get')await gate;await route.fulfill({status:url.pathname==='/api/get'?404:200,json:url.pathname==='/api/get'?{}:[record],headers:{'access-control-allow-origin':'*'}});});
  await setup(page,false);await upload(page,16,'unlabeled.wav',false);await page.getByLabel('Song title for lookup',{exact:true}).fill('Test song');await page.getByLabel('Artist for lookup',{exact:true}).fill('Example singer');await page.locator('#lookup-find').click();await expect.poll(()=>urls.length).toBe(1);await page.locator('#lookup-auto').uncheck();release();
  await expect(page.locator('#lookup-review')).toBeVisible();expect(urls).toEqual(['/api/get','/api/search']);expect(await lines(page)).not.toEqual(words);
});
