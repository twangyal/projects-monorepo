import {expect,type Page,type APIRequestContext} from '@playwright/test';
import {test,timingWav,timingSha,fromServer,openTiming,media,nativeToggle,type NativeCue,type NativeProject} from './sequential-timing-fixtures';

// Independent, literal practice acceptance data; these expectations do not import producers.
export {test,timingWav,timingSha,fromServer,openTiming,media,nativeToggle};
export type {NativeCue,NativeProject};
export const PRACTICE_CUES:NativeCue[]=[
  {start:.35,end:1.05,text:'  First café 🌓  '},
  {start:1.6,end:2.25,text:'Second <literal> & line'},
  {start:4.75,end:6,text:'Final cue reaches the original song end'},
];
// Frozen before implementation/native runs. Do not fit to observed output or widen after failure.
export const PRACTICE_BOUNDARY_TOLERANCE=.15;
export async function openPractice(page:Page,project:NativeProject){
  await openTiming(page,project);
  // The existing fixture opens the default Backing track. Practice's baseline
  // and repeat cases explicitly promise Original, so select and admit that source.
  await loadedTrack(page,'Original');
  await expect(page.locator('#practice-first')).toBeVisible();
  await expect(page.locator('#practice-last')).toBeVisible();
}

export interface PracticeObservation{
  kind:string;wall:number;time:number;paused:boolean;seeking:boolean;ended:boolean;rate:number;src:string;active:string|null;
}
interface PracticeWindow extends Window{practice125Observations:PracticeObservation[]}
export async function observePractice(page:Page){
  await page.addInitScript(()=>{
    const target=window as unknown as PracticeWindow;
    target.practice125Observations=[];
    let active=true;
    const record=(kind:string)=>{
      const audio=document.querySelector<HTMLAudioElement>('#audio');
      if(!audio||target.practice125Observations.length>=6000)return;
      target.practice125Observations.push({kind,wall:performance.now(),time:audio.currentTime,
        paused:audio.paused,seeking:audio.seeking,ended:audio.ended,rate:audio.playbackRate,
        src:audio.currentSrc,active:document.querySelector('#stage')?.getAttribute('data-active-cue')??null});
    };
    for(const kind of ['playing','pause','seeking','seeked','ended','ratechange','timeupdate'])
      document.addEventListener(kind,event=>{if((event.target as HTMLElement)?.id==='audio')record(kind);},true);
    const tick=()=>{if(!active)return;record('frame');requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
    window.addEventListener('pagehide',()=>{active=false;});
  });
}
export async function observations(page:Page){
  return page.evaluate(()=>(window as unknown as PracticeWindow).practice125Observations);
}
export function repeatJumps(samples:PracticeObservation[]){
  return samples.flatMap((current,index)=>{
    const previous=samples[index-1];
    return previous&&previous.time-current.time>.8?[{before:previous,after:current}]:[];
  });
}
export async function selectPractice(page:Page,first:number,last:number){
  await page.locator('#practice-first').selectOption(String(first));
  await page.locator('#practice-last').selectOption(String(last));
}
export async function startPractice(page:Page,repeat=false){
  const button=page.locator(repeat?'#practice-repeat':'#practice-once');
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(async()=>(await media(page)).paused).toBe(false);
  await expect(page.locator('#practice-stop')).toBeEnabled();
}
export async function atLeast(page:Page,time:number){
  await expect.poll(async()=>(await media(page)).time,{intervals:[20,20,20],timeout:7000}).toBeGreaterThanOrEqual(time);
}
export async function idlePractice(page:Page){
  await expect(page.locator('#practice-stop')).toBeDisabled();
  await expect(page.locator('#practice-pause')).toBeDisabled();
}
export async function loadedTrack(page:Page,name:'Original'|'Vocals'|'Backing'){
  await page.getByRole('button',{name,exact:true}).click();
  await expect.poll(()=>page.locator('#audio').evaluate((node,suffix)=>{
    const audio=node as HTMLAudioElement;
    return audio.currentSrc.endsWith(suffix)&&audio.readyState>=2&&!audio.seeking&&!audio.error;
  },`/audio/${name.toLowerCase()}`)).toBe(true);
}
export async function rawEditor(page:Page){
  return page.evaluate(()=>({
    title:(document.querySelector('#title')as HTMLInputElement).value,
    paste:(document.querySelector('#lyric-draft')as HTMLTextAreaElement).value,
    cues:Array.from(document.querySelectorAll('#cue-list [data-cue]')).map(row=>({
      start:(row.querySelector('[data-boundary=start]')as HTMLInputElement).value,
      end:(row.querySelector('[data-boundary=end]')as HTMLInputElement).value,
      text:(row.querySelector('.cue-text textarea')as HTMLTextAreaElement).value,
    })),
    undoDisabled:(document.querySelector('#undo-lyrics')as HTMLButtonElement).disabled,
    redoDisabled:(document.querySelector('#redo-lyrics')as HTMLButtonElement).disabled,
    saveState:document.querySelector('#save-state')?.textContent,
  }));
}
export async function audioHashes(request:APIRequestContext,id:string){
  return Promise.all(['original','vocals','backing'].map(async name=>{
    const response=await request.get(`/api/projects/${id}/audio/${name}`);
    expect(response.status()).toBe(200);
    return {name,sha256:timingSha(await response.body())};
  }));
}
export async function settleNative(page:Page,milliseconds=250){
  // Wall-clock settling only: neither currentTime nor playback events are fabricated.
  await page.evaluate(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)),milliseconds);
}
