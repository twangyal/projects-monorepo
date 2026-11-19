import { test, expect, type Page } from '@playwright/test';

function tone(): Buffer {
  const frames = 16 * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 44100) * 5000), 44 + i * 4 + channel * 2);
  return wav;
}
async function withClip(page: Page, run: (id: string) => Promise<void>) {
  const before = new Set<string>((await (await page.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id));
  let ownedId: string | null = null;
  try {
    await page.goto('/');
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'automatic-audition.wav', mimeType: 'audio/wav', buffer: tone() });
    const response = await accepted;
    expect(response.status()).toBe(202);
    ownedId = (await response.json()).job.projectId;
    expect(typeof ownedId).toBe('string');
    await expect(page.locator('#message')).toContainText('3 automatically timed lyric lines', { timeout: 15000 });
    await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
    expect(await page.locator('#projects').inputValue()).toBe(ownedId);
    await run(ownedId!);
  } finally {
    const session = await (await page.request.get('/api/session')).json();
    if (ownedId && session.activeJob?.projectId === ownedId) {
      await page.request.post(`/api/jobs/${session.activeJob.id}/cancel`, { headers: { 'X-Karaoke-Token': session.token }, data: {} });
      await expect.poll(async () => (await (await page.request.get(`/api/jobs/${session.activeJob.id}`)).json()).job.status).not.toBe('running');
    }
    const projects = (await (await page.request.get('/api/projects')).json()).projects;
    if (ownedId && projects.some((p: { id: string }) => p.id === ownedId)) {
      expect((await page.request.delete(`/api/projects/${ownedId}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} })).ok()).toBe(true);
    }
    const after: string[] = (await (await page.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id);
    expect(after.filter(id => before.has(id)).sort()).toEqual([...before].sort());
    if (ownedId) expect(after).not.toContain(ownedId);
  }
}


import {readFile} from 'node:fs/promises';
for(const mode of ['automatic passage','automatic whole','SRT whole']) test(`a mixed ${mode} review keeps unchanged hand-set word timing through history, save and export`,async({page})=>withClip(page,async id=>{
  const base=`/api/projects/${id}`, saved=await(await page.request.get(base)).json(), session=await(await page.request.get('/api/session')).json();
  const starts=[1.1,1.6,2.2];saved.cues[0].wordStarts=starts;saved.cues[0].singer=1;
  const seeded=await page.request.put(base,{headers:{'X-Karaoke-Token':session.token},data:{title:saved.title,cues:saved.cues,revision:saved.revision}});expect(seeded.ok()).toBe(true);
  await page.reload();await page.locator('#projects').selectOption(id);
  const manual=page.locator('[data-cue="0"] .cue-words');await expect(manual).toContainText('Word times set by hand');
  if(mode==='SRT whole'){
    const stamp=(seconds:number)=>new Date(Math.round(seconds*1000)).toISOString().slice(11,23).replace('.',',');
    const srt=(saved.cues as {start:number;end:number;text:string}[]).map((cue,index)=>`${index+1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${index===1?'Better chorus':cue.text}\n`).join('\n');
    await page.getByLabel('Import timed lyrics (SRT)',{exact:true}).setInputFiles({name:'review.srt',mimeType:'application/x-subrip',buffer:Buffer.from(srt)});
  }else{
    await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
    await page.getByLabel('Reviewed lyric line 2',{exact:true}).fill('Better chorus');
  }
  if(mode==='automatic passage'){
    await page.getByText('Apply a reviewed passage',{exact:true}).click();
    await page.getByRole('combobox',{name:'Last automatic line in passage',exact:true}).selectOption('1');
    await page.getByRole('button',{name:'Apply reviewed passage',exact:true}).click();
  }else await page.getByRole('button',{name:'Replace lyric cues',exact:true}).click();
  await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('Better chorus');
  await expect(manual).toContainText('Word times set by hand');
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('This is our chorus');await expect(manual).toContainText('Word times set by hand');
  await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('Better chorus');await expect(manual).toContainText('Word times set by hand');
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
  expect((await(await page.request.get(base)).json()).cues[0].wordStarts).toEqual(starts);
  await page.reload();await page.locator('#projects').selectOption(id);await expect(manual).toContainText('Word times set by hand');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export word-timed LRC',exact:true}).click();
  const lrc=await readFile((await(await pending).path())!,'utf8');
  expect(lrc).toContain('<00:01.10>Hello <00:01.60>little <00:02.20>world');
}));
