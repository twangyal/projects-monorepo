/** Independent original PCM fixtures and real-service helpers; never log private seat material. */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

export const SONGS = [
  { title:'Amber original', artist:'Original oracle A', frequency:263 },
  { title:'Birch original', artist:'Original oracle B', frequency:397 },
  { title:'Cedar original', artist:'Original oracle C', frequency:541 },
] as const;
export function originalWav(frequency: number): Buffer {
  const rate = 16000, frames = rate * 12, output = Buffer.alloc(44 + frames * 2);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8,4); output.write('WAVEfmt ',8);
  output.writeUInt32LE(16,16); output.writeUInt16LE(1,20); output.writeUInt16LE(1,22);
  output.writeUInt32LE(rate,24); output.writeUInt32LE(rate*2,28); output.writeUInt16LE(2,32); output.writeUInt16LE(16,34);
  output.write('data',36); output.writeUInt32LE(frames*2,40);
  for (let index=0; index<frames; index++) output.writeInt16LE(Math.round(4000*Math.sin(2*Math.PI*frequency*index/rate)),44+2*index);
  return output;
}
export const ORIGINAL_WAV_MANIFEST = SONGS.map(song => ({...song,frames:192000,sampleRate:16000,channels:1,bits:16,bytes:384044,sha256:createHash('sha256').update(originalWav(song.frequency)).digest('hex')}));
export interface MixEntry { trackId:string;title:string;artist:string }
export interface Mix { id:string;name:string;entries:MixEntry[] }
export interface Snapshot {
  id:string;myRole:'host'|'guest';tracks:Array<{id:string;title:string;artist:string;duration:number}>;
  ratings:Record<string,{host:number;guest:number}>;playlist:string[];playlistRevision:number;
  playback:{trackId:string|null;playing:boolean;position:number;revision:number;updatedAt:number};
  savedMixes:Mix[];savedMixesRevision:number;memories:unknown[];
}
export async function request<T = Snapshot>(page:Page,suffix='',method='GET',body?:unknown):Promise<{status:number;value:T}> {
  return page.evaluate(async ({suffix,method,body}) => {
    const id = new URL(location.href).searchParams.get('room')!;
    const token = (JSON.parse(localStorage.getItem('duet-participants-v1') || '{}') as Record<string,{token:string}>)[id]?.token;
    if (!token) throw Error('Oracle seat is unavailable');
    const response = await fetch(`/api/rooms/${id}${suffix}`,{method,headers:{Authorization:`Bearer ${token}`,...(method==='GET'?{}:{'Content-Type':'application/json'})},body:method==='GET'?undefined:JSON.stringify(body??{}),cache:'no-store'});
    return {status:response.status,value:await response.json() as T};
  },{suffix,method,body});
}
export async function snapshot(page:Page) { const result = await request(page); expect(result.status).toBe(200); return result.value; }
export async function playlist(page:Page,ids:string[]) {
  const before = await snapshot(page), result = await request(page,'/playlist','PUT',{trackIds:ids,revision:before.playlistRevision}); expect(result.status).toBe(200);
  await expect.poll(async () => page.locator('#playlist [data-mix-track-id]').count()).toBe(ids.length);
  await expect.poll(() => page.locator('#playlist [data-mix-track-id]').evaluateAll(rows=>rows.map(row=>(row as HTMLElement).dataset.mixTrackId))).toEqual(ids);
  return result.value;
}
export async function audioFingerprints(page:Page) {
  return page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('room')!, auth = JSON.parse(localStorage.getItem('duet-participants-v1')!)[id];
    const headers = {Authorization:`Bearer ${auth.token}`}, response = await fetch(`/api/rooms/${id}`,{headers}), room = await response.json();
    const result:Record<string,{bytes:number;sha256:string}> = {};
    for (const track of room.tracks as {id:string}[]) {
      const audio = await fetch(`/api/rooms/${id}/tracks/${track.id}/audio`,{headers}); if (!audio.ok) throw Error('Oracle media unavailable');
      const bytes = await audio.arrayBuffer(), digest = await crypto.subtle.digest('SHA-256',bytes);
      result[track.id] = {bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
    }
    return result;
  });
}
export async function seats(page:Page,browser:Browser,baseURL:string|undefined,amberUploader:'host'|'guest'='host'):Promise<{guest:Page;context:BrowserContext;ids:string[];close:()=>Promise<void>}> {
  await page.goto('/'); await page.locator('#host-name').fill('Oracle host'); await page.locator('#room-title').fill('Original saved alternatives');
  await page.getByRole('button',{name:'Create our room',exact:true}).click(); await expect(page.locator('#room-heading')).toHaveText('Original saved alternatives');
  const invite = await page.locator('#share-link').inputValue(); await page.locator('#close-link').click();
  const context = await browser.newContext({baseURL}),guest = await context.newPage();
  try {
    await guest.goto(invite); await guest.locator('#guest-name').fill('Oracle partner'); await guest.getByRole('button',{name:'Join the room',exact:true}).click(); await expect(guest.locator('#room-view')).toBeVisible();
    for (const song of SONGS) {
      const uploader = song === SONGS[0] && amberUploader === 'guest' ? guest : page;
      await expect(uploader.locator('#audio-file')).toBeEnabled();
      await uploader.locator('#audio-file').setInputFiles({name:`${song.title}.wav`,mimeType:'audio/wav',buffer:originalWav(song.frequency)});
      await uploader.locator('#track-title').fill(song.title); await uploader.locator('#track-artist').fill(song.artist); await uploader.locator('#upload').click();
      await expect(uploader.locator('#library-list h4').filter({hasText:song.title})).toBeVisible({timeout:20000}); await expect(uploader.locator('#upload-job')).toBeHidden();
    }
    const room = await snapshot(page),ids = SONGS.map(song=>room.tracks.find(t=>t.title===song.title)!.id);
    await expect(guest.locator('#library-list .track')).toHaveCount(3);
    return {guest,context,ids,close:()=>context.close()};
  } catch(error) { await context.close(); throw error; }
}
export async function cleanup(page:Page) {
  await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('duet-participants-v1')||'{}') as Record<string,{token:string}>;
    for(const[id,value]of Object.entries(saved)) await fetch(`/api/rooms/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${value.token}`,'Content-Type':'application/json'},body:'{}'});
    localStorage.clear();
  });
}
