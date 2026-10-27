import {formatTime} from './lyrics.ts';
import {lookupLyrics,type LyricsCue,type LyricsRecord} from './lyrics-lookup.ts';
export const lyricsLookupMarkup=`<details id="lyrics-lookup"><summary>Look up existing song lyrics</summary>
<p class="fine">Optional online lookup from LRCLIB. Only the title, artist and this clip’s duration are sent when you click Look up lyrics. Audio stays local. Works with matching full-song editions; excerpts may have no match.</p>
<label class="field">Song title for lookup<input id="lookup-title" maxlength="200" autocomplete="off"></label><label class="field">Artist for lookup<input id="lookup-artist" maxlength="200" autocomplete="off"></label>
<label class="fine"><input id="lookup-auto" type="checkbox"> Look up automatically when a song file names its title and artist (sends only those and the clip’s duration, once per clip; you still review before using)</label>
<div class="timing-actions"><button id="lookup-find" disabled>Look up lyrics</button><button id="lookup-cancel" class="quiet" hidden>Cancel lyrics lookup</button></div>
<p id="lookup-status" class="fine" role="status" aria-live="polite">Choose a clip, then enter its song title and artist.</p>
<section id="lookup-review" aria-label="Review found lyrics" hidden><p id="lookup-match" class="fine"></p><a id="lookup-source" target="_blank" rel="noopener noreferrer">Source: LRCLIB</a><pre id="lookup-preview" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto"></pre>
<p id="lookup-timing-notice" class="fine" role="status"></p><section id="lookup-timing-review" aria-label="Published words and line timings" hidden><h3>Published words and line timings</h3><pre id="lookup-timing-preview" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto"></pre></section>
<p class="fine">Review the words and song edition. Use lyrics replaces the lyric draft and aligns to locally recognized vocals. Without recognized words, timing is estimated. Current cues change as one unsaved edit; Undo restores them and Save lyrics is separate. Finish or discard any pasted draft first.</p><p id="lookup-timed-note" class="fine" hidden>This edition also has published line timings. Review their words and times above before using them. Lines end at the next timestamp or instrumental gap and are held at most eight seconds. Word highlighting uses local recognition where it heard the words.</p><p id="lookup-readiness" class="fine" role="status"></p><div class="timing-actions"><button id="lookup-use-timed" hidden disabled>Use lyrics with published timings</button><button id="lookup-use" disabled>Use lyrics and align</button></div></section></details>`;
interface Context {key:string;projectId:string;duration:number;busy:boolean;pastedDirty:boolean;alignmentState:'loading'|'ready'|'error'}
interface Options {context:()=>Context|null;useLyrics:(text:string)=>void;useTimedLyrics:(cues:LyricsCue[])=>void;suggest:()=>{title:string;artist:string}|null}
/** Lookup owns only its metadata/result; it never writes cues or audio itself. */
export function mountLyricsLookup(options:Options):{sync:()=>void} {
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const title=el<HTMLInputElement>('lookup-title'),artist=el<HTMLInputElement>('lookup-artist'),find=el<HTMLButtonElement>('lookup-find'),use=el<HTMLButtonElement>('lookup-use'),useTimed=el<HTMLButtonElement>('lookup-use-timed');
  const review=el('lookup-review'),status=el('lookup-status'),cancel=el<HTMLButtonElement>('lookup-cancel');
  let request:AbortController|null=null,epoch=0,owner='',result:LyricsRecord|null=null,suggestedFor='',tagged=false,automatic=false;
  // Automatic lookup is an opt-in kept in this browser; each clip is looked up automatically at most once.
  const auto=el<HTMLInputElement>('lookup-auto'),AUTO_KEY='karaoke-lookup-auto',TRIED_KEY='karaoke-lookup-auto-tried';
  let tried:string[]=[];
  try{auto.checked=localStorage.getItem(AUTO_KEY)==='on';const kept=JSON.parse(localStorage.getItem(TRIED_KEY)??'[]');tried=Array.isArray(kept)?kept.filter(id=>typeof id==='string').slice(-200):[];}catch{auto.checked=false;}
  const remember=(id:string)=>{tried=[...tried.filter(other=>other!==id),id].slice(-200);try{localStorage.setItem(TRIED_KEY,JSON.stringify(tried));}catch{/* storage unavailable */}};
  auto.addEventListener('change',()=>{try{localStorage.setItem(AUTO_KEY,auto.checked?'on':'off');}catch{/* storage unavailable */}sync();});
  const current=()=>options.context();
  function clear(text?:string){epoch++;request?.abort();request=null;result=null;owner='';review.hidden=true;el('lookup-preview').textContent='';el('lookup-timing-preview').textContent='';el('lookup-timing-notice').textContent='';if(text)status.textContent=text;}
  function sync(){
    const context=current();
    if(owner&&(!context||context.key!==owner))clear('The editor changed. Look up lyrics again when ready; current words are unchanged.');
    // Each clip starts from its own title and the artist its song file names, ready to check and look up.
    if(context&&context.projectId!==suggestedFor){
      suggestedFor=context.projectId;const suggestion=options.suggest();
      title.value=suggestion?.title??'';artist.value=suggestion?.artist??'';tagged=!!(suggestion?.title&&suggestion?.artist);
      if(!request&&!result)status.textContent=suggestion?.artist?'Title and artist come from the song file. Check them, then look up lyrics.':'Enter or check the song title and artist, then look up lyrics.';
    }
    if(auto.checked&&tagged&&context&&!context.busy&&!request&&!result&&!tried.includes(context.projectId)){
      remember(context.projectId);automatic=true;find.disabled=false;queueMicrotask(()=>find.click());
    }
    find.disabled=!context||context.busy||!!request;title.disabled=artist.disabled=!context||context.busy;
    use.disabled=!result||!context||context.key!==owner||context.busy||context.pastedDirty||context.alignmentState!=='ready';
    // Published timings need no alignment, so they do not wait for recognition information.
    useTimed.hidden=el('lookup-timed-note').hidden=el('lookup-timing-review').hidden=!result?.cues;
    useTimed.disabled=!result?.cues||!context||context.key!==owner||context.busy||context.pastedDirty;
    el('lookup-readiness').textContent=context?.alignmentState==='loading'?'Waiting for this clip’s local recognition information before alignment.':context?.alignmentState==='error'?'Recognized words could not be read. Refresh projects for local alignment. Published timings, when offered, can still be used.':'';cancel.hidden=!request;
  }
  for(const input of [title,artist])input.addEventListener('input',()=>{tagged=false;clear('Metadata changed. Look up lyrics when ready.');sync();});
  cancel.addEventListener('click',()=>{clear('Lyrics lookup cancelled. Your lyrics are unchanged.');sync();});
  find.addEventListener('click',async()=>{
    const context=current(),wasAutomatic=automatic;automatic=false;if(!context||context.busy)return;
    clear();const ticket=++epoch,controller=new AbortController();request=controller;owner=context.key;status.textContent='Looking up lyrics from LRCLIB…';sync();
    try{
      const found=await lookupLyrics({title:title.value,artist:artist.value,duration:context.duration},controller.signal);
      if(ticket!==epoch||current()?.key!==context.key)return;
      result=found;el('lookup-preview').textContent=found.text;
      el('lookup-timing-notice').textContent=found.timingNotice??'';
      el('lookup-timing-preview').textContent=found.cues?.map(cue=>`${formatTime(cue.start)} → ${formatTime(cue.end)}  ${cue.text}`).join('\n')??'';
      el('lookup-match').textContent=`${found.title} — ${found.artist}${found.album?` · ${found.album}`:''} · ${found.duration}s`;
      el<HTMLAnchorElement>('lookup-source').href=found.source;review.hidden=false;
      status.textContent=current()?.pastedDirty?'Lyrics found. Your pasted draft is kept; finish or discard it before using these words.':'Lyrics found. Review the match, then use and align when ready.';
      // A lookup made automatically opens the panel, so the match is seen; nothing is used without a click.
      if(wasAutomatic){el<HTMLDetailsElement>('lyrics-lookup').open=true;status.textContent=`Found automatically from the song file’s title and artist. ${status.textContent}`;}
    }catch(error){if(ticket===epoch)status.textContent=error instanceof Error?error.message:'Lyrics lookup failed. Current words are unchanged.';}
    finally{if(ticket===epoch){request=null;sync();}}
  });
  useTimed.addEventListener('click',()=>{
    const context=current();if(!result?.cues||!context||context.key!==owner||context.busy||context.pastedDirty){sync();return;}
    const cues=structuredClone(result.cues);clear('Published line timings applied. Review them before saving.');options.useTimedLyrics(cues);sync();
  });
  use.addEventListener('click',()=>{
    const context=current();if(!result||!context||context.key!==owner||context.busy||context.pastedDirty||context.alignmentState!=='ready'){sync();return;}
    const text=result.text;clear('Found words sent to the local alignment workflow. Review timing before saving.');options.useLyrics(text);sync();
  });
  window.addEventListener('pagehide',()=>clear());
  sync();return {sync};
}
