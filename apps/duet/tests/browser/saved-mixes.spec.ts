/** Independent two-seat saved-mix browser oracle; original fixtures precede producer reads. */
import { test as base, expect, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { SONGS, seats, cleanup, snapshot, request, playlist, audioFingerprints, type Mix, type Snapshot } from './saved-mixes-fixtures.ts';

type RoomFixture = Awaited<ReturnType<typeof seats>>;
const test = base.extend<{ mixRoom:RoomFixture; amberUploader:'host'|'guest' }>({
  amberUploader: ['host', { option:true }],
  mixRoom: async ({page,browser,baseURL,amberUploader},use) => {
    const room = await seats(page,browser,baseURL,amberUploader);
    try { await use(room); } finally { await room.close(); await cleanup(page); }
  },
});
test.setTimeout(90000);
function entries(ids:string[],order:number[]) { return order.map(index=>({trackId:ids[index],title:SONGS[index].title,artist:SONGS[index].artist})); }
async function select(page:Page,mix:Mix) {
  await page.locator(`#saved-mixes-list [data-saved-mix-id="${mix.id}"]`).click();
  await expect(page.locator('#saved-mix-preview [data-saved-track-id]')).toHaveCount(mix.entries.length);
}
async function save(page:Page,name:string) {
  await page.locator('#mix-name').fill(name);
  const pending = page.waitForResponse(response => /\/mixes$/.test(new URL(response.url()).pathname) && response.request().method()==='POST');
  await page.locator('#save-mix').click(); const response = await pending; expect(response.status()).toBe(201);
  const result = await response.json() as {mixId:string;room:Snapshot};
  await expect(page.locator(`#saved-mixes-list [data-saved-mix-id="${result.mixId}"]`)).toBeVisible();
  return result.room.savedMixes.find(mix=>mix.id===result.mixId)!;
}
async function load(page:Page,mix:Mix,availableOnly=false) {
  await select(page,mix);
  const pending = page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/mixes/${mix.id}/load`) && r.request().method()==='POST');
  if(availableOnly) page.once('dialog',dialog=>dialog.accept());
  await page.locator(availableOnly?'#load-available-mix':'#load-mix').click();
  const response = await pending; expect(response.status()).toBe(200); return response.json() as Promise<Snapshot>;
}
async function gate(page:Page,suffix:string,method:string,afterServer=false) {
  let release!:()=>void,arrived!:()=>void,finished!:()=>void;
  const ready = new Promise<void>(resolve=>{arrived=resolve;}),done = new Promise<void>(resolve=>{finished=resolve;}),wait = new Promise<void>(resolve=>{release=resolve;});
  let captured = false;
  const handler = async (route:Route) => {
    if(route.request().method()!==method || captured) { await route.continue(); return; }
    captured=true;
    const response = afterServer ? await route.fetch() : null;
    arrived(); await wait;
    try { if(response) await route.fulfill({response}); else await route.continue(); } finally { finished(); }
  };
  const pattern=`**/api/rooms/*${suffix}`; await page.route(pattern,handler);
  return {ready,release,done,close:async()=>{release();await page.unroute(pattern,handler);}};
}
async function media(page:Page) { return page.locator('#audio').evaluate((a:HTMLAudioElement)=>({paused:a.paused,position:a.currentTime,source:a.currentSrc})); }


test('two named orders retain original labels votes and media through current rebuild and token-free export', async ({page,mixRoom}) => {
  const {guest,ids}=mixRoom;
  await page.getByRole('button',{name:`Like ${SONGS[0].title}`,exact:true}).click(); await guest.getByRole('button',{name:`Like ${SONGS[0].title}`,exact:true}).click();
  await expect.poll(async()=> (await snapshot(page)).ratings[ids[0]]).toEqual({host:1,guest:1});
  const before=await snapshot(page),mediaBefore=await audioFingerprints(page);
  await page.getByRole('button',{name:`Add to current mix ${SONGS[2].title}`,exact:true}).click();
  await expect(page.locator('#playlist .song-link')).toHaveText([SONGS[2].title]);
  await page.getByRole('button',{name:`Add to current mix ${SONGS[0].title}`,exact:true}).click();
  await expect(page.locator('#playlist .song-link')).toHaveText([SONGS[2].title,SONGS[0].title]);
  const first=await save(page,'Night <quiet> 🌙'); expect(first.entries).toEqual(entries(ids,[2,0]));
  await page.getByRole('button',{name:`Remove from current mix ${SONGS[0].title}`,exact:true}).click();await expect(page.locator('#playlist .song-link')).toHaveText([SONGS[2].title]);
  await page.getByRole('button',{name:`Add to current mix ${SONGS[0].title}`,exact:true}).click();await expect(page.locator('#playlist .song-link')).toHaveText([SONGS[2].title,SONGS[0].title]);expect((await snapshot(page)).savedMixes).toEqual([first]);
  await playlist(guest,[ids[1]]); const second=await save(guest,'Morning'); expect(second.entries).toEqual(entries(ids,[1]));
  const library=await snapshot(page); expect(library.savedMixes).toEqual([first,second]); expect(library.savedMixesRevision).toBe(2);
  await page.locator('#build-mix').click(); await expect(page.locator('#playlist .song-link')).toHaveCount(3);
  const after=await snapshot(page);expect(after.savedMixes).toEqual([first,second]);expect(after.ratings).toEqual(before.ratings);expect(after.tracks).toEqual(before.tracks);expect(await audioFingerprints(page)).toEqual(mediaBefore);
  expect(await page.locator('#saved-mixes-list script').count()).toBe(0);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#room-export').click()]);
  const text=await readFile((await download.path())!,'utf8'), exported=JSON.parse(text);
  expect(exported.schemaVersion).toBe(2);expect(exported.savedMixes).toEqual([first,second]);
  const leaked=await page.evaluate(text=>Object.values(JSON.parse(localStorage.getItem('duet-participants-v1')!)).some(value=>text.includes((value as {token:string}).token)),text);
  expect(leaked).toBe(false);expect(text).not.toMatch(/"(?:token|hostTokenHash|guestTokenHash|inviteHash)"/);
});

test('explicit load pauses first source at zero exactly once without enabling the second device', async ({page,mixRoom}) => {
  const{guest,ids}=mixRoom;await playlist(page,[ids[0],ids[2]]);const mix=await save(page,'Paused entry');
  await page.locator('#library-list [data-track-id="'+ids[0]+'"]').getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(async()=> (await media(page)).position).toBeGreaterThan(.2);
  await expect(guest.locator('#enable-audio')).toHaveText('Enable audio on this device');expect((await media(guest)).paused).toBe(true);
  const before=await snapshot(page), after=await load(page,mix);
  expect(after.playlist).toEqual([ids[0],ids[2]]);expect(after.playlistRevision).toBe(before.playlistRevision+1);expect(after.playback).toMatchObject({trackId:ids[0],playing:false,position:0,revision:before.playback.revision+1});expect(after.savedMixesRevision).toBe(before.savedMixesRevision);
  await expect.poll(async()=> (await media(page)).paused).toBe(true);await expect.poll(async()=> (await media(page)).position).toBeLessThan(.1);
  await expect(guest.locator('#enable-audio')).toHaveText('Enable audio on this device');
  await guest.locator('#enable-audio').click();await page.locator('#play').click();
  await expect.poll(async()=>!(await media(page)).paused&&!(await media(guest)).paused).toBe(true);
  await page.locator('#play').click();await expect.poll(async()=>(await media(page)).paused&&(await media(guest)).paused).toBe(true);
});

test('same-source Load rejects both a captured seek gesture and an old queued Play revision', async ({page,mixRoom}) => {
  const{guest,ids}=mixRoom;await playlist(page,[ids[0],ids[1]]);const mix=await save(page,'Same source');await load(page,mix);
  await page.locator('#seek').evaluate((node:HTMLInputElement)=>{node.value='4';node.dispatchEvent(new Event('input',{bubbles:true}));});
  const loaded=await load(guest,mix);
  // A real poll response is the ordering receipt before releasing the old gesture.
  await expect.poll(async()=>Number(await page.locator('#seek').getAttribute('max'))).toBeGreaterThan(10);
  const poll=page.waitForResponse(async r=>new URL(r.url()).pathname===`/api/rooms/${loaded.id}`&&r.request().method()==='GET'&&(await r.json()).playback.revision===loaded.playback.revision);await poll;
  await page.locator('#seek').dispatchEvent('change');await expect(page.locator('#notice')).toContainText('Playback changed while you were seeking');
  expect((await snapshot(page)).playback).toEqual(loaded.playback);
  const held=await gate(page,'/playback','PUT');const staleResponse=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/playback')&&r.request().method()==='PUT');
  await page.locator('#play').click();await held.ready;const newest=await load(guest,mix);held.release();expect((await staleResponse).status()).toBe(409);await held.done;await held.close();
  expect((await snapshot(page)).playback).toEqual(newest.playback);await expect.poll(async()=>(await media(page)).paused).toBe(true);
});

test('stale save and update capture their displayed playlist and never retry a different order', async ({page,mixRoom}) => {
  const{guest,ids}=mixRoom;await playlist(page,[ids[0],ids[1]]);
  let held=await gate(page,'/mixes','POST');let response=page.waitForResponse(r=>/\/mixes$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST');
  await page.locator('#mix-name').fill('Keep this raw name');await page.locator('#save-mix').click();await held.ready;await playlist(guest,[ids[2]]);held.release();expect((await response).status()).toBe(409);await held.done;await held.close();
  expect((await snapshot(page)).savedMixes).toEqual([]);await expect(page.locator('#mix-name')).toHaveValue('Keep this raw name');
  await expect(page.locator('#playlist .song-link')).toHaveText([SONGS[2].title]);const mix=await save(page,'Explicit retry');expect(mix.entries).toEqual(entries(ids,[2]));
  await playlist(page,[ids[1],ids[0]]);await select(page,mix);
  held=await gate(page,`/mixes/${mix.id}/playlist`,'PUT');response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/mixes/${mix.id}/playlist`));
  page.once('dialog',dialog=>dialog.accept());await page.locator('#update-mix').click();await held.ready;await playlist(guest,[ids[0]]);held.release();expect((await response).status()).toBe(409);await held.done;await held.close();
  expect((await snapshot(page)).savedMixes).toEqual([mix]);
});

test('static raw name node caret and changed-back intent survive polls and successful delayed save response', async ({page,mixRoom}) => {
  const{guest,ids}=mixRoom;await playlist(page,[ids[0],ids[2]]);const held=await gate(page,'/mixes','POST',true);
  await page.locator('#mix-name').fill('Submitted literal name');await page.locator('#save-mix').click();await held.ready;
  const name=page.locator('#mix-name');await name.fill('Temporarily different');await name.fill('Submitted literal name');
  await name.evaluate(node=>{const input=node as HTMLInputElement;input.setSelectionRange(3,8);(window as unknown as {oracleMixName:Element}).oracleMixName=node;});
  await guest.getByRole('button',{name:`Like ${SONGS[1].title}`,exact:true}).click();await expect(page.locator(`[data-track-id="${ids[1]}"] .rating-summary`)).toContainText('Oracle partner: likes it');
  held.release();await held.done;await held.close();await expect(page.locator('#saved-mixes-list [data-saved-mix-id]')).toHaveCount(1);
  expect(await name.evaluate(node=>({same:node===(window as unknown as {oracleMixName:Element}).oracleMixName,focused:document.activeElement===node,value:(node as HTMLInputElement).value,start:(node as HTMLInputElement).selectionStart,end:(node as HTMLInputElement).selectionEnd}))).toEqual({same:true,focused:true,value:'Submitted literal name',start:3,end:8});
  const room=await snapshot(page);expect(room.savedMixes[0].name).toBe('Submitted literal name');expect(room.savedMixes[0].entries).toEqual(entries(ids,[0,2]));expect(room.savedMixesRevision).toBe(1);
});

test('rename and explicit update preserve identity while later current edits and named deletion are independent', async ({page,mixRoom}) => {
  const{ids}=mixRoom;await playlist(page,[ids[2],ids[0]]);const mix=await save(page,'Original name'),mediaBefore=await audioFingerprints(page);await select(page,mix);
  await page.locator('#saved-mix-name').fill('Renamed <literal> 🎶');await page.locator('#rename-mix').click();
  await expect.poll(async()=>(await snapshot(page)).savedMixes[0].name).toBe('Renamed <literal> 🎶');
  await playlist(page,[ids[1]]);await select(page,{...mix,name:'Renamed <literal> 🎶'});page.once('dialog',d=>d.accept());await page.locator('#update-mix').click();
  await expect.poll(async()=>(await snapshot(page)).savedMixes[0].entries).toEqual(entries(ids,[1]));
  const updated=await snapshot(page);expect(updated.savedMixes).toEqual([{id:mix.id,name:'Renamed <literal> 🎶',entries:entries(ids,[1])}]);expect(updated.savedMixesRevision).toBe(3);
  await playlist(page,[ids[0],ids[2]]);const before=await snapshot(page);page.once('dialog',d=>d.accept());await page.locator('#delete-mix').click();
  await expect.poll(async()=>(await snapshot(page)).savedMixes).toEqual([]);const after=await snapshot(page);
  expect(after.playlist).toEqual(before.playlist);expect(after.playlistRevision).toBe(before.playlistRevision);expect(after.playback).toEqual(before.playback);expect(after.ratings).toEqual(before.ratings);expect(after.savedMixesRevision).toBe(4);expect(await audioFingerprints(page)).toEqual(mediaBefore);
});

test('external deletion clears selected authority without substituting another mix or losing raw rename draft', async ({page,mixRoom}) => {
  const{guest,ids}=mixRoom;await playlist(page,[ids[0]]);const first=await save(page,'First');await playlist(page,[ids[2]]);const second=await save(page,'Second');await select(page,first);
  await page.locator('#saved-mix-name').fill('Raw rename after selection');await page.locator('#saved-mix-name').evaluate(node=>(window as unknown as {oracleRename:Element}).oracleRename=node);
  const before=await snapshot(guest),removed=await request(guest,`/mixes/${first.id}`,'DELETE',{savedMixesRevision:before.savedMixesRevision});expect(removed.status).toBe(200);
  await expect(page.locator(`#saved-mixes-list [data-saved-mix-id="${first.id}"]`)).toHaveCount(0);await expect(page.locator('#load-mix')).toBeDisabled();await expect(page.locator('#update-mix')).toBeDisabled();
  expect(await page.locator('#saved-mix-name').evaluate(node=>({same:node===(window as unknown as {oracleRename:Element}).oracleRename,value:(node as HTMLInputElement).value}))).toEqual({same:true,value:'Raw rename after selection'});
  const after=await snapshot(page);expect(after.playlist).toEqual(before.playlist);expect(after.playback).toEqual(before.playback);expect(after.savedMixes).toEqual([second]);
  const choice=page.waitForEvent('dialog'),loading=load(page,second),dialog=await choice;
  try { expect(dialog.message()).toBe('Select another mix and discard the unsaved selected-mix name?');await dialog.accept();await loading; }
  finally { await dialog.dismiss().catch(()=>{}); }
  expect((await snapshot(page)).playlist).toEqual([ids[2]]);
});

test.describe('guest owns original Amber for the third-writer deletion', () => {
  test.use({amberUploader:'guest'});
  test('missing labels remain visible and available-only confirmation refuses a third-writer changed subset', async ({page,mixRoom}) => {
  const{guest,ids}=mixRoom;await playlist(page,[ids[2],ids[1],ids[0]]);const mix=await save(page,'Missing songs');
  expect((await request(page,`/tracks/${ids[1]}`,'DELETE',{})).status).toBe(200);await select(page,mix);
  await expect(page.locator('#saved-mix-preview')).toContainText(SONGS[1].title);await expect(page.locator('#saved-mix-preview')).toContainText(SONGS[1].artist);
  const before=await snapshot(page),denied=await request(page,`/mixes/${mix.id}/load`,'POST',{savedMixesRevision:before.savedMixesRevision,playlistRevision:before.playlistRevision,playbackRevision:before.playback.revision,availableOnly:false});expect(denied.status).toBe(409);
  const dialogue=page.waitForEvent('dialog'),clicked=page.locator('#load-available-mix').click();const dialog=await dialogue;
  try {
    expect(dialog.message()).toContain(SONGS[1].title);
    expect((await request(guest,`/tracks/${ids[0]}`,'DELETE',{})).status).toBe(200);
    const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/mixes/${mix.id}/load`));await dialog.accept();await clicked;expect((await response).status()).toBe(409);
  } finally { await dialog.dismiss().catch(()=>{});await clicked.catch(()=>{}); }
  const retained=await snapshot(page);expect(retained.savedMixes).toEqual([mix]);expect(retained.savedMixesRevision).toBe(1);
  await expect(page.locator('#saved-mix-preview')).toContainText(SONGS[0].title);
  const loaded=await load(page,mix,true);expect(loaded.playlist).toEqual([ids[2]]);expect(loaded.playback).toMatchObject({trackId:ids[2],playing:false,position:0});expect(loaded.savedMixes).toEqual([mix]);
  });
});

test('all-missing mix cannot load and captured labels survive without orphan audio', async ({page,mixRoom}) => {
  const{ids}=mixRoom;await playlist(page,[ids[0]]);const mix=await save(page,'One removed song');expect((await request(page,`/tracks/${ids[0]}`,'DELETE',{})).status).toBe(200);await select(page,mix);
  await expect(page.locator('#saved-mix-preview')).toContainText(SONGS[0].title);
  const before=await snapshot(page);
  for(const availableOnly of[false,true]) expect((await request(page,`/mixes/${mix.id}/load`,'POST',{savedMixesRevision:before.savedMixesRevision,playlistRevision:before.playlistRevision,playbackRevision:before.playback.revision,availableOnly})).status).toBe(409);
  const after=await snapshot(page);expect(after).toMatchObject({playlist:before.playlist,playlistRevision:before.playlistRevision,playback:before.playback,savedMixes:[mix],savedMixesRevision:1});
  const fingerprints=await audioFingerprints(page);expect(Object.keys(fingerprints).sort()).toEqual([ids[1],ids[2]].sort());
});

test('eight independent copies allow repeated literal names and reject a ninth without changing media or transport', async ({page,mixRoom}) => {
  const{ids}=mixRoom;await playlist(page,[ids[2],ids[0]]);const original=await snapshot(page),audio=await audioFingerprints(page);
  for(let i=0;i<8;i++) {
    const room=await snapshot(page), result=await request<{mixId:string;room:Snapshot}>(page,'/mixes','POST',{name:'Same literal name 🌿',playlistRevision:room.playlistRevision,savedMixesRevision:room.savedMixesRevision});expect(result.status).toBe(201);
  }
  await expect(page.locator('#saved-mixes-list [data-saved-mix-id]')).toHaveCount(8);const before=await snapshot(page);
  expect(new Set(before.savedMixes.map(m=>m.id)).size).toBe(8);for(const mix of before.savedMixes)expect(mix.entries).toEqual(entries(ids,[2,0]));
  const ninth=await request(page,'/mixes','POST',{name:'Ninth',playlistRevision:before.playlistRevision,savedMixesRevision:before.savedMixesRevision});expect(ninth.status).toBe(409);
  const after=await snapshot(page);expect(after.savedMixes).toEqual(before.savedMixes);expect(after.savedMixesRevision).toBe(8);expect(after.playlist).toEqual(original.playlist);expect(after.playback).toEqual(original.playback);expect(await audioFingerprints(page)).toEqual(audio);
});
