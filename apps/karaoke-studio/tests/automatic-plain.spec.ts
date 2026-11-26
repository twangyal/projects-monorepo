import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const autoName='Align matching untimed published lyrics automatically for untouched new uploads in this session';
const words=['Hello little','world This is','our chorus','Sing it back to me'];
const record={id:42,trackName:'Test song',artistName:'Example singer',albumName:'Test edition',duration:16,instrumental:false,plainLyrics:words.join('\n'),syncedLyrics:null};
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


for(const width of [1280,390])test(`plain-only lookup aligns locally into an undoable preview at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));
 await setup(page);const id=await upload(page);await expect(page.locator('#lookup-status')).toContainText('aligned locally');
 expect(await lines(page)).toEqual(words);await expect(page.locator('#save-state')).toContainText('Unsaved');
 await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('0.85');
 await expect(page.locator('#lookup-source')).toBeVisible();await expect(page.locator('#lookup-found-text')).toContainText('local');
 expect((await(await page.request.get(`/api/projects/${id}`)).json()).cues).toHaveLength(3);
 await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await lines(page)).not.toEqual(words);
 await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();expect(await lines(page)).toEqual(words);
 await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
 const pending=page.waitForEvent('download');await page.locator('#lyrics-download').click();const srt=await readFile((await(await pending).path())!,'utf8');expect(srt).toContain('Hello little');expect(srt).toContain('00:00:00,850');
 await page.reload();await page.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);await expect(page.getByRole('checkbox',{name:autoName,exact:true})).not.toBeChecked();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const action of ['cancel','opt out ABA','edit ABA','metadata','project change','raw timing','pasted draft','other tab opt out'] as const)test(`${action} during local alignment keeps current work`,async({page})=>{
 let release=()=>{};const gate=new Promise<void>(r=>release=r);let started=false;
 await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));
 await page.route('**/api/projects/*/align',async r=>{const response=await r.fetch();started=true;await gate;await r.fulfill({response}).catch(()=>undefined);});
 await setup(page);await upload(page);await expect.poll(()=>started).toBe(true);const before=await lines(page);
 if(action==='cancel')await page.locator('#lookup-cancel').click();
 if(action==='opt out ABA'){await page.getByRole('checkbox',{name:autoName,exact:true}).uncheck();await page.getByRole('checkbox',{name:autoName,exact:true}).check();}
 if(action==='edit ABA'){await page.getByLabel('Lyric line 1',{exact:true}).fill('Private correction');await page.getByLabel('Lyric line 1',{exact:true}).fill(before[0]);}
 if(action==='metadata')await page.locator('#lookup-artist').fill('Another singer');
 if(action==='project change')await page.locator('#projects').selectOption('');
 if(action==='raw timing')await page.getByLabel('Start line 1',{exact:true}).fill('');
 if(action==='pasted draft')await page.getByLabel('Paste lyrics, one line per cue').fill('Private draft');
 if(action==='other tab opt out'){const other=await page.context().newPage();await other.goto('/');await other.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);await other.locator('#lookup-auto').uncheck();await expect(page.locator('#lookup-auto')).not.toBeChecked();await other.close();}
 release();await expect(page.locator('#lookup-cancel')).not.toHaveText('Cancel local alignment');expect(await lines(page)).not.toEqual(words);
 if(action==='pasted draft')await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('Private draft');
});

for(const variant of ['uncertain','estimated','legacy','error'] as const)test(`${variant} alignment leaves found words for manual review`,async({page})=>{
 await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));
 await page.route('**/api/projects/*/align',async r=>{const response=await r.fetch(),value=await response.json();if(variant==='error')return r.fulfill({status:409,json:{error:'Local alignment unavailable'}});if(variant==='uncertain')value.cues[0].matched=.2;if(variant==='estimated')value.method='estimated';if(variant==='legacy')delete value.method;await r.fulfill({json:value});});
 await setup(page);await upload(page);await expect(page.locator('#lookup-status')).toContainText('manual review');expect(await lines(page)).not.toEqual(words);
 await expect(page.locator('#lookup-use')).toBeEnabled();await expect(page.locator('#lookup-review')).toBeVisible();
 await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
});

test('published-timing consent alone does not align plain editions',async({page})=>{
 await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));await setup(page,false);await page.locator('#lookup-auto-timed').check();await upload(page);
 await expect(page.locator('#lookup-review')).toBeVisible();expect(await lines(page)).not.toEqual(words);await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
});

for(const variant of ['edition','duration','timed edition','no transcript'] as const)test(`${variant} preserves manual review`,async({page})=>{
 let alignmentRequests=0;page.on('request',r=>{if(r.url().endsWith('/align'))alignmentRequests++;});
 const changed=variant==='edition'?{trackName:'Test song (Live)'}:variant==='duration'?{duration:17.5}:variant==='timed edition'?{syncedLyrics:'[00:02]Hello little\n[00:04]world This is\n[00:06]our chorus\n[00:09]Sing it back to me'}:{duration:12};
 await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:{...record,...changed},headers:{'access-control-allow-origin':'*'}}));await setup(page);await upload(page,variant==='no transcript'?12:16);
 await expect(page.locator('#lookup-review')).toBeVisible();await expect(page.locator('#lookup-status')).toContainText(variant==='no transcript'?'manual review':'Review');expect(await lines(page)).not.toEqual(words);
 if(variant!=='no transcript')expect(alignmentRequests).toBe(0);
});

for(const optOut of [false,true])test(`local timing waits for background work and ${optOut?'honours withdrawal':'applies after it finishes'}`,async({page})=>{
 const ids:string[]=[];page.on('response',async response=>{if(response.url().endsWith('/api/projects')&&response.request().method()==='POST'&&response.status()===202){const id=(await response.json()).job.projectId as string;ids.push(id);owned.push(id);}});
 let release=()=>{};const gate=new Promise<void>(r=>release=r);
 await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:record,headers:{'access-control-allow-origin':'*'}}));
 await page.route('**/api/projects/*/align',async r=>{const response=await r.fetch();await gate;await r.fulfill({response}).catch(()=>undefined);});await setup(page);
 await page.getByLabel('Upload song clip').setInputFiles([{name:'song.wav',mimeType:'audio/wav',buffer:audio()},{name:'background.wav',mimeType:'audio/wav',buffer:audio(18,false)}]);
 await expect.poll(()=>ids.length,{timeout:15000}).toBe(2);await expect(page.locator('#job-stage')).toContainText('Waiting for recognition cancellation',{timeout:15000});release();
 await expect(page.locator('#lookup-status')).toContainText('Waiting for current studio work');expect(await lines(page)).not.toEqual(words);
 if(optOut)await page.getByRole('checkbox',{name:autoName,exact:true}).uncheck();
 await page.getByRole('button',{name:'Cancel job',exact:true}).click();await expect(page.locator('#job-panel')).toBeHidden({timeout:15000});
 if(optOut){expect(await lines(page)).not.toEqual(words);await expect(page.locator('#lookup-review')).toBeVisible();}
 else{await expect(page.locator('#lookup-status')).toContainText('aligned locally');expect(await lines(page)).toEqual(words);}
});

test('a dropped recognized-word anchor sends actual local alignment to manual review',async({page})=>{
 await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:{...record,duration:20,plainLyrics:'Hello\nWorld\nGoodbye'},headers:{'access-control-allow-origin':'*'}}));
 await setup(page);await upload(page,20);await expect(page.locator('#lookup-status')).toContainText('manual review');
 await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
 await page.locator('#lookup-use').click();await expect(page.locator('#message')).toContainText('Check line 2');
 expect(await lines(page)).toEqual(['Hello','World','Goodbye']);
});

test('a malformed published-timing field keeps words for manual review without local alignment',async({page})=>{
 let started=false;page.on('request',r=>{if(r.url().endsWith('/align'))started=true;});
 await page.route('https://lrclib.net/api/get?**',r=>r.fulfill({json:{...record,syncedLyrics:['[00:01]Hello']},headers:{'access-control-allow-origin':'*'}}));await setup(page);await upload(page);
 await expect(page.locator('#lookup-review')).toBeVisible();await expect(page.locator('#lookup-timing-notice')).not.toBeEmpty();expect(await lines(page)).not.toEqual(words);expect(started).toBe(false);
});
