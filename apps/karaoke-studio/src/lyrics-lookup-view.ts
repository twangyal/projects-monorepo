import {formatTime} from './lyrics.ts';
import {lookupLyrics,automaticPublishedTiming,type LyricsCue,type LyricsRecord} from './lyrics-lookup.ts';
export const lyricsLookupMarkup=`<details id="lyrics-lookup"><summary>Look up existing song lyrics</summary>
<p class="fine">Optional online lookup from LRCLIB. Only the title, artist and this clip’s duration are sent when you look up lyrics or enable automatic lookup. Audio stays local. Works with matching full-song editions; excerpts may have no match.</p>
<label class="field">Song title for lookup<input id="lookup-title" maxlength="200" autocomplete="off"></label><label class="field">Artist for lookup<input id="lookup-artist" maxlength="200" autocomplete="off"></label>
<label class="fine"><input id="lookup-auto" type="checkbox"> Look up automatically when a song file’s tags or name give its title and artist (sends only those and the clip’s duration, once per clip; results normally wait for your review)</label>
<p id="lookup-preference-status" class="fine" role="status"></p>
<label class="fine"><input id="lookup-auto-timed" type="checkbox" disabled> Use matching published timings automatically for untouched new uploads in this session</label><p class="fine">This separate option starts off each time the app opens and requires automatic lookup. Only foreground uploads opened here at their original saved revision, before you engage other studio tools, can use an exact title/artist match within one second of this recording’s duration. Timed words must agree with the full plain lyrics when supplied; other matches wait for review. Turning off automatic lookup stops further automatic requests. Line ends use the next timestamp or gap, capped at eight seconds. Published timing may need correction: it replaces cues as one unsaved Undo/Redo edit; listen and Save lyrics separately. It never updates existing or reopened clips automatically.</p>
<div class="timing-actions"><button id="lookup-find" disabled>Look up lyrics</button><button id="lookup-cancel" class="quiet" hidden>Cancel lyrics lookup</button></div>
<p id="lookup-status" class="fine" role="status" aria-live="polite">Choose a clip, then enter its song title and artist.</p>
<a id="lookup-source" target="_blank" rel="noopener noreferrer" hidden>Source: LRCLIB</a>
<section id="lookup-review" aria-label="Review found lyrics" hidden><p id="lookup-match" class="fine"></p><pre id="lookup-preview" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto"></pre>
<p id="lookup-timing-notice" class="fine" role="status"></p><section id="lookup-timing-review" aria-label="Published words and line timings" hidden><h3>Published words and line timings</h3><pre id="lookup-timing-preview" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto"></pre></section>
<p class="fine">Review the words and song edition. Use lyrics replaces the lyric draft and aligns to locally recognized vocals. Without recognized words, timing is estimated. Current cues change as one unsaved edit; Undo restores them and Save lyrics is separate. Finish or discard any pasted draft first.</p><p id="lookup-timed-note" class="fine" hidden>This edition also has published line timings. Review their words and times above before using them. Lines end at the next timestamp or instrumental gap and are held at most eight seconds. Word highlighting uses local recognition where it heard the words.</p><p id="lookup-readiness" class="fine" role="status"></p><div class="timing-actions"><button id="lookup-review-timed" class="quiet" hidden disabled>Review published timings</button><button id="lookup-use-timed" hidden disabled>Use lyrics with published timings</button><button id="lookup-use" disabled>Use lyrics and align</button></div></section></details>`;
interface Context {key:string;projectId:string;duration:number;busy:boolean;pastedDirty:boolean;alignmentState:'loading'|'ready'|'error';automaticTimedEligible?:boolean}
interface Options {context:()=>Context|null;useLyrics:(text:string)=>void;useTimedLyrics:(cues:LyricsCue[],automatic?:boolean)=>void;reviewTimedLyrics:(cues:LyricsCue[])=>void;suggest:()=>{title:string;artist:string;fromName?:boolean}|null;
  /** Brings the lookup into view where the studio shows one tool at a time. */
  reveal?:()=>void;
  /** Refresh controls that wait for this request or reviewed result. */
  stateChanged?:()=>void}
/** Lookup owns only its metadata/result; it never writes cues or audio itself. */
export function mountLyricsLookup(options:Options):{sync:()=>void;active:()=>boolean} {
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const title=el<HTMLInputElement>('lookup-title'),artist=el<HTMLInputElement>('lookup-artist'),find=el<HTMLButtonElement>('lookup-find'),use=el<HTMLButtonElement>('lookup-use'),useTimed=el<HTMLButtonElement>('lookup-use-timed');
  const reviewTimed=el<HTMLButtonElement>('lookup-review-timed');
  const autoTimed=el<HTMLInputElement>('lookup-auto-timed'),source=el<HTMLAnchorElement>('lookup-source'),preferenceStatus=el('lookup-preference-status');
  const review=el('lookup-review'),status=el('lookup-status'),cancel=el<HTMLButtonElement>('lookup-cancel');
  let request:AbortController|null=null,epoch=0,owner='',result:LyricsRecord|null=null,suggestedFor='',tagged=false,automatic=false,fromName=false;
  let requestIsAutomatic=false;
  let automaticUseEpoch=0,automaticSourceOwner='',automaticQueuedFor='';
  let automaticPending:{record:LyricsRecord;key:string;intent:number}|null=null;
  // Automatic lookup is an opt-in kept in this browser; each clip is looked up automatically at most once.
  const auto=el<HTMLInputElement>('lookup-auto'),AUTO_KEY='karaoke-lookup-auto',TRIED_KEY='karaoke-lookup-auto-tried';
  let tried:string[]=[],preferenceRemembered=true;
  try{auto.checked=localStorage.getItem(AUTO_KEY)==='on';const kept=JSON.parse(localStorage.getItem(TRIED_KEY)??'[]');tried=Array.isArray(kept)?kept.filter(id=>typeof id==='string').slice(-200):[];}catch{auto.checked=false;preferenceRemembered=false;preferenceStatus.textContent='Automatic lookup starts off because its browser preference could not be read. Check the choice after reopening.';}
  function automaticLookupEnabled():boolean {
    if(!auto.checked)return false;
    if(!preferenceRemembered)return true;
    try{return localStorage.getItem(AUTO_KEY)==='on';}
    catch{preferenceRemembered=false;preferenceStatus.textContent='The automatic lookup choice applies only to this session because its browser preference could not be read. Check it after reopening.';return true;}
  }
  const remember=(id:string)=>{tried=[...tried.filter(other=>other!==id),id].slice(-200);try{localStorage.setItem(TRIED_KEY,JSON.stringify(tried));}catch{/* storage unavailable */}};
  auto.addEventListener('change',()=>{automaticUseEpoch++;if(!auto.checked){autoTimed.checked=false;if(requestIsAutomatic)clear('Automatic lyrics lookup stopped. Your lyrics are unchanged.');}try{localStorage.setItem(AUTO_KEY,auto.checked?'on':'off');preferenceRemembered=true;preferenceStatus.textContent='';}catch{preferenceRemembered=false;preferenceStatus.textContent='The automatic lookup choice applies only to this session because the browser could not remember it. Check it after reopening.';}sync();});
  autoTimed.addEventListener('change',()=>{automaticUseEpoch++;sync();});
  window.addEventListener('storage',event=>{
    if(event.key!==AUTO_KEY&&event.key!==null)return;
    try{if(event.storageArea!==localStorage)return;auto.checked=localStorage.getItem(AUTO_KEY)==='on';}catch{return;}
    preferenceRemembered=true;preferenceStatus.textContent='';automaticUseEpoch++;if(!auto.checked){autoTimed.checked=false;if(requestIsAutomatic)clear('Automatic lyrics lookup stopped. Your lyrics are unchanged.');}sync();
  });
  const current=()=>options.context();
  function clear(text?:string){epoch++;request?.abort();request=null;requestIsAutomatic=false;result=null;owner='';automaticSourceOwner='';automaticQueuedFor='';automaticPending=null;source.hidden=true;review.hidden=true;el('lookup-preview').textContent='';el('lookup-timing-preview').textContent='';el('lookup-timing-notice').textContent='';if(text)status.textContent=text;}
  function applyAutomaticWhenReady(context:Context|null):boolean {
    const pending=automaticPending;if(!pending)return false;
    if(!context||context.key!==pending.key||!context.automaticTimedEligible||context.pastedDirty||!automaticLookupEnabled()||!autoTimed.checked||automaticUseEpoch!==pending.intent||result!==pending.record){
      automaticPending=null;status.textContent='Automatic use stopped. Current work is kept; review the found lyrics before using them.';return false;
    }
    if(context.busy){status.textContent='Matched published timings are ready. Waiting for current studio work to finish; dismiss the result or turn off automatic use to keep the original cues.';return false;}
    const found=pending.record,cues=structuredClone(found.cues!);
    clear('Published words and line timings applied automatically as one unsaved edit. Listen and correct if needed; Undo restores recognition. Save lyrics is separate.');
    options.useTimedLyrics(cues,true);
    automaticSourceOwner=current()?.key??'';source.href=found.source;source.hidden=!automaticSourceOwner;sync();return true;
  }
  function sync(){
    const context=current();
    autoTimed.disabled=!automaticLookupEnabled();
    if(automaticSourceOwner&&automaticSourceOwner!==context?.key){automaticSourceOwner='';source.hidden=true;}
    if(owner&&(!context||context.key!==owner))clear('The editor changed. Look up lyrics again when ready; current words are unchanged.');
    if(applyAutomaticWhenReady(context))return;
    // Each clip starts from its own title and the artist its song file names, ready to check and look up.
    if(context&&context.projectId!==suggestedFor){
      suggestedFor=context.projectId;const suggestion=options.suggest();
      title.value=suggestion?.title??'';artist.value=suggestion?.artist??'';tagged=!!(suggestion?.title&&suggestion?.artist);fromName=!!suggestion?.fromName;
      if(!request&&!result)status.textContent=fromName?'Title and artist come from the song file’s name. Check them, then look up lyrics.':suggestion?.artist?'Title and artist come from the song file. Check them, then look up lyrics.':'Enter or check the song title and artist, then look up lyrics.';
    }
    if(automaticLookupEnabled()&&tagged&&context&&!context.busy&&!request&&!result&&!tried.includes(context.projectId)&&!automaticQueuedFor){
      const key=context.key;automaticQueuedFor=key;
      queueMicrotask(()=>{
        if(automaticQueuedFor!==key)return;automaticQueuedFor='';
        const live=current();
        if(!automaticLookupEnabled()||!tagged||!live||live.key!==key||live.busy||request||result||tried.includes(live.projectId)){sync();return;}
        automatic=true;find.disabled=false;find.click();
      });
    }
    // Where the automatic lyrics are shown, a song file that names its title and artist is offered a lookup, until one has
    // been tried for this clip.
    const offered=!!context&&tagged&&!context.busy&&!request&&!result&&!tried.includes(context.projectId);
    el('lookup-offer').hidden=!offered;
    // Found lyrics wait in the lookup until used or dismissed; where the automatic lyrics are shown, they are pointed to.
    const found=!!result&&!!context&&context.key===owner;
    const applied=!!automaticSourceOwner&&automaticSourceOwner===context?.key;
    el('lookup-found').hidden=!found&&!applied;
    if(found)el('lookup-found-text').textContent=`Published lyrics were found for “${title.value.trim()}”${artist.value.trim()?` by ${artist.value.trim()}`:''}. Review them before using them.`;
    if(applied)el('lookup-found-text').textContent='Published words and line timings were applied automatically as an unsaved edit. Listen, correct and Save lyrics; Undo restores the automatic recognition.';
    el('lookup-found-review').textContent=applied?'View published lyric source':'Review published lyrics';
    if(offered)el('lookup-offer-text').textContent=`Published lyrics may exist for “${title.value.trim()}” by ${artist.value.trim()}: usually more accurate than recognition. Looking them up sends only the title, artist and clip length to LRCLIB.`;
    find.disabled=!context||context.busy||!!request;title.disabled=artist.disabled=!context||context.busy;
    use.disabled=!result||!context||context.key!==owner||context.busy||context.pastedDirty||context.alignmentState!=='ready';
    // Published timings need no alignment, so they do not wait for recognition information.
    reviewTimed.hidden=useTimed.hidden=el('lookup-timed-note').hidden=el('lookup-timing-review').hidden=!result?.cues;
    reviewTimed.disabled=useTimed.disabled=!result?.cues||!context||context.key!==owner||context.busy||context.pastedDirty;
    el('lookup-readiness').textContent=context?.alignmentState==='loading'?'Waiting for this clip’s local recognition information before alignment.':context?.alignmentState==='error'?'Recognized words could not be read. Refresh projects for local alignment. Published timings, when offered, can still be used.':'';cancel.hidden=!request&&!result;cancel.textContent=request?'Cancel lyrics lookup':'Dismiss found lyrics';
    options.stateChanged?.();
  }
  for(const input of [title,artist])input.addEventListener('input',()=>{tagged=false;fromName=false;clear('Metadata changed. Look up lyrics when ready.');sync();});
  cancel.addEventListener('click',()=>{clear('Lyrics lookup cancelled. Your lyrics are unchanged.');sync();});
  el('lookup-offer-find').addEventListener('click',()=>{options.reveal?.();(el('lyrics-lookup') as HTMLDetailsElement).open=true;find.click();el('lookup-status').scrollIntoView({block:'nearest'});});
  el('lookup-found-review').addEventListener('click',()=>{options.reveal?.();(el('lyrics-lookup') as HTMLDetailsElement).open=true;(automaticSourceOwner?source:review).scrollIntoView({block:'nearest'});});
  find.addEventListener('click',async()=>{
    const context=current(),wasAutomatic=automatic;automatic=false;if(!context||context.busy||(wasAutomatic&&!automaticLookupEnabled()))return;
    const automaticIntent=automaticUseEpoch,mayUseAutomatically=wasAutomatic&&automaticLookupEnabled()&&autoTimed.checked&&context.automaticTimedEligible===true;
    remember(context.projectId);
    clear();const ticket=++epoch,controller=new AbortController();request=controller;requestIsAutomatic=wasAutomatic;owner=context.key;status.textContent='Looking up lyrics from LRCLIB…';sync();
    try{
      let found:LyricsRecord;
      try{found=await lookupLyrics({title:title.value,artist:artist.value,duration:context.duration},controller.signal,fetch,8000,()=>!wasAutomatic||automaticLookupEnabled());}
      catch(error){
        // A file name may read "Title - Artist": the other way round is tried once.
        if(!fromName||!(error instanceof Error&&error.message.startsWith('No matching lyrics'))||ticket!==epoch)throw error;
        found=await lookupLyrics({title:artist.value,artist:title.value,duration:context.duration},controller.signal,fetch,8000,()=>!wasAutomatic||automaticLookupEnabled());
        if(ticket!==epoch||current()?.key!==context.key)return;
        [title.value,artist.value]=[artist.value,title.value];
      }
      if(ticket!==epoch||current()?.key!==context.key)return;
      result=found;el('lookup-preview').textContent=found.text;
      el('lookup-timing-notice').textContent=found.timingNotice??'';
      el('lookup-timing-preview').textContent=found.cues?.map(cue=>`${formatTime(cue.start)} → ${formatTime(cue.end)}  ${cue.text}`).join('\n')??'';
      el('lookup-match').textContent=`${found.title} — ${found.artist}${found.album?` · ${found.album}`:''} · ${found.duration}s`;
      source.href=found.source;source.hidden=false;review.hidden=false;
      status.textContent=current()?.pastedDirty?'Lyrics found. Your pasted draft is kept; finish or discard it before using these words.':'Lyrics found. Review the match, then use and align when ready.';
      // Default automatic lookup still only opens review. The separate session option can own only a fresh untouched upload.
      if(wasAutomatic){el<HTMLDetailsElement>('lyrics-lookup').open=true;status.textContent=`Found automatically from the song file’s ${fromName?'name':'title and artist'}. ${status.textContent}`;}
      const live=current();
      if(mayUseAutomatically&&automaticIntent===automaticUseEpoch&&automaticLookupEnabled()&&autoTimed.checked&&live?.automaticTimedEligible&&!live.pastedDirty
        &&automaticPublishedTiming(found,{title:title.value,artist:artist.value,duration:live.duration})){
        automaticPending={record:found,key:context.key,intent:automaticIntent};sync();
      }
    }catch(error){if(ticket===epoch)status.textContent=error instanceof Error?error.message:'Lyrics lookup failed. Current words are unchanged.';}
    finally{if(ticket===epoch){request=null;requestIsAutomatic=false;sync();}}
  });
  reviewTimed.addEventListener('click',()=>{
    const context=current();if(!result?.cues||!context||context.key!==owner||context.busy||context.pastedDirty){sync();return;}
    options.reviewTimedLyrics(structuredClone(result.cues));sync();
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
  sync();return {sync,active:()=>!!request||!!result};
}
