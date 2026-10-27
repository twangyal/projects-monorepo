import {lookupLyrics,type LyricsRecord} from './lyrics-lookup.ts';
export const lyricsLookupMarkup=`<details id="lyrics-lookup"><summary>Look up existing song lyrics</summary>
<p class="fine">Optional online lookup from LRCLIB. Only the title, artist and this clip’s duration are sent when you click Look up lyrics. Audio stays local. Works with matching full-song editions; excerpts may have no match.</p>
<label class="field">Song title for lookup<input id="lookup-title" maxlength="200" autocomplete="off"></label><label class="field">Artist for lookup<input id="lookup-artist" maxlength="200" autocomplete="off"></label>
<div class="timing-actions"><button id="lookup-find" disabled>Look up lyrics</button><button id="lookup-cancel" class="quiet" hidden>Cancel lyrics lookup</button></div>
<p id="lookup-status" class="fine" role="status" aria-live="polite">Choose a clip, then enter its song title and artist.</p>
<section id="lookup-review" aria-label="Review found lyrics" hidden><p id="lookup-match" class="fine"></p><a id="lookup-source" target="_blank" rel="noopener noreferrer">Source: LRCLIB</a><pre id="lookup-preview" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto"></pre>
<p class="fine">Review the words and song edition. Use lyrics replaces the lyric draft and aligns to locally recognized vocals. Without recognized words, timing is estimated. Current cues change as one unsaved edit; Undo restores them and Save lyrics is separate. Finish or discard any pasted draft first.</p><p id="lookup-readiness" class="fine" role="status"></p><button id="lookup-use" disabled>Use lyrics and align</button></section></details>`;
interface Context {key:string;projectId:string;duration:number;busy:boolean;pastedDirty:boolean;alignmentState:'loading'|'ready'|'error'}
interface Options {context:()=>Context|null;useLyrics:(text:string)=>void;suggest:()=>{title:string;artist:string}|null}
/** Lookup owns only its metadata/result; it never writes cues or audio itself. */
export function mountLyricsLookup(options:Options):{sync:()=>void} {
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const title=el<HTMLInputElement>('lookup-title'),artist=el<HTMLInputElement>('lookup-artist'),find=el<HTMLButtonElement>('lookup-find'),use=el<HTMLButtonElement>('lookup-use');
  const review=el('lookup-review'),status=el('lookup-status'),cancel=el<HTMLButtonElement>('lookup-cancel');
  let request:AbortController|null=null,epoch=0,owner='',result:LyricsRecord|null=null,suggestedFor='';
  const current=()=>options.context();
  function clear(text?:string){epoch++;request?.abort();request=null;result=null;owner='';review.hidden=true;el('lookup-preview').textContent='';if(text)status.textContent=text;}
  function sync(){
    const context=current();
    if(owner&&(!context||context.key!==owner))clear('The editor changed. Look up lyrics again when ready; current words are unchanged.');
    // Each clip starts from its own title and the artist its song file names, ready to check and look up.
    if(context&&context.projectId!==suggestedFor){
      suggestedFor=context.projectId;const suggestion=options.suggest();
      title.value=suggestion?.title??'';artist.value=suggestion?.artist??'';
      if(!request&&!result)status.textContent=suggestion?.artist?'Title and artist come from the song file. Check them, then look up lyrics.':'Enter or check the song title and artist, then look up lyrics.';
    }
    find.disabled=!context||context.busy||!!request;title.disabled=artist.disabled=!context||context.busy;
    use.disabled=!result||!context||context.key!==owner||context.busy||context.pastedDirty||context.alignmentState!=='ready';
    el('lookup-readiness').textContent=context?.alignmentState==='loading'?'Waiting for this clip’s local recognition information before alignment.':context?.alignmentState==='error'?'Recognized words could not be read. Refresh projects, then try again before applying lyrics.':'';cancel.hidden=!request;
  }
  for(const input of [title,artist])input.addEventListener('input',()=>{clear('Metadata changed. Look up lyrics when ready.');sync();});
  cancel.addEventListener('click',()=>{clear('Lyrics lookup cancelled. Your lyrics are unchanged.');sync();});
  find.addEventListener('click',async()=>{
    const context=current();if(!context||context.busy)return;
    clear();const ticket=++epoch,controller=new AbortController();request=controller;owner=context.key;status.textContent='Looking up lyrics from LRCLIB…';sync();
    try{
      const found=await lookupLyrics({title:title.value,artist:artist.value,duration:context.duration},controller.signal);
      if(ticket!==epoch||current()?.key!==context.key)return;
      result=found;el('lookup-preview').textContent=found.text;
      el('lookup-match').textContent=`${found.title} — ${found.artist}${found.album?` · ${found.album}`:''} · ${found.duration}s`;
      el<HTMLAnchorElement>('lookup-source').href=found.source;review.hidden=false;
      status.textContent=current()?.pastedDirty?'Lyrics found. Your pasted draft is kept; finish or discard it before using these words.':'Lyrics found. Review the match, then use and align when ready.';
    }catch(error){if(ticket===epoch)status.textContent=error instanceof Error?error.message:'Lyrics lookup failed. Current words are unchanged.';}
    finally{if(ticket===epoch){request=null;sync();}}
  });
  use.addEventListener('click',()=>{
    const context=current();if(!result||!context||context.key!==owner||context.busy||context.pastedDirty||context.alignmentState!=='ready'){sync();return;}
    const text=result.text;clear('Found words sent to the local alignment workflow. Review timing before saving.');options.useLyrics(text);sync();
  });
  window.addEventListener('pagehide',()=>clear());
  sync();return {sync};
}
