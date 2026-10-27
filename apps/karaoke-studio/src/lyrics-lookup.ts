import {draftLines,validateCues} from './lyrics.ts';
export interface LyricsQuery { title:string; artist:string; duration:number }
export interface LyricsCue {start:number;end:number;text:string}
/** `cues` are the provider's own line timings, when it has synced lyrics that fit this clip. */
export interface LyricsRecord {id:number; title:string;artist:string;album:string;duration:number;text:string;source:string;cues?:LyricsCue[];timingNotice?:string}
const MAX_BYTES=128*1024;
function metadata(value:unknown,label:string,empty=false):string {
  // eslint-disable-next-line no-control-regex -- Query metadata must not contain control characters.
  if(typeof value!=='string'||[...value].length>200||(!empty&&!value.trim())||/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value))throw new Error(`Enter a valid ${label} of up to 200 characters.`);
  return value.trim();
}
export function lookupQuery(query:LyricsQuery):LyricsQuery {
  if(!Number.isFinite(query.duration)||query.duration<1||query.duration>600)throw new Error('Choose a saved clip before looking up lyrics.');
  return {title:metadata(query.title,'song title'),artist:metadata(query.artist,'artist'),duration:query.duration};
}
/** The longest a last line or a line before a long gap is held, in seconds. */
const MAX_HOLD=8;
/**
 * Published line timings from synced LRC ("[01:02.34] words", several stamps for a repeated line). A line ends when the
 * next timed line, or a timed blank (an instrumental gap), starts, and is held at most MAX_HOLD seconds. Returns null
 * when the timings do not fit the clip, so the plain words are aligned locally instead.
 */
export function parseSyncedLyrics(lrc:string,duration:number):LyricsCue[]|null {
  if(typeof lrc!=='string'||lrc.length>MAX_BYTES)return null;
  const stamps:{time:number;text:string}[]=[];
  for(const line of lrc.split(/\r\n|\n|\r/)){
    const tags=/^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/.exec(line.trim());
    if(!tags){
      // Metadata is harmless; offsets and unparsed lyric lines would change or lose timing.
      if(!line.trim()||/^\[(?:ar|ti|al|by|re|ve|length):[^\]\r\n]*\]$/iu.test(line.trim()))continue;
      return null;
    }
    const text=tags[2]!.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g,'').replace(/\s+/g,' ').trim();
    for(const tag of tags[1]!.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)){
      const fraction=tag[3]?Number(tag[3])/10**tag[3].length:0,time=Number(tag[1])*60+Number(tag[2])+fraction;
      if(Number(tag[2])>=60||time>duration||(text&&time===duration))return null;
      stamps.push({time,text});if(stamps.length>401)return null;
    }
  }
  stamps.sort((a,b)=>a.time-b.time);
  const cues:LyricsCue[]=[];
  stamps.forEach((stamp,index)=>{
    if(!stamp.text)return;
    const next=stamps.slice(index+1).find(other=>other.time>stamp.time)?.time??duration;
    const end=Math.min(next,stamp.time+MAX_HOLD,duration);
    cues.push({start:Math.round(stamp.time*1000)/1000,end:Math.round(end*1000)/1000,text:stamp.text});
  });
  if(!cues.length)return null;
  try{return validateCues(cues,duration);}catch{return null;}
}
const comparable=(text:string)=>text.normalize('NFC').toLowerCase().replace(/\s+/gu,' ').trim();
export function parseLyricsRecord(value:unknown,input:LyricsQuery):LyricsRecord {
  const query=lookupQuery(input);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The lyrics provider returned an invalid record.');
  const r=value as Record<string,unknown>;
  const title=metadata(r.trackName,'song title'),artist=metadata(r.artistName,'artist'),album=metadata(r.albumName??'','album',true);
  if(!Number.isSafeInteger(r.id)||Number(r.id)<1||typeof r.duration!=='number'||!Number.isFinite(r.duration)||Math.abs(r.duration-query.duration)>2
    ||comparable(title)!==comparable(query.title)||comparable(artist)!==comparable(query.artist))throw new Error('The returned title, artist or duration does not match this clip. Check the song edition and metadata.');
  if(r.instrumental!==false)throw new Error('No lyrics are available for this song. Local recognition and pasting still work.');
  const cues=typeof r.syncedLyrics==='string'?parseSyncedLyrics(r.syncedLyrics,query.duration):null;
  let lines:string[];
  if(typeof r.plainLyrics==='string'&&r.plainLyrics.trim()){
    lines=draftLines(r.plainLyrics);
    validateCues(lines.map((text,i)=>({start:i,end:i+1,text})),Math.max(lines.length,1));
  }else if(cues)lines=cues.map(cue=>cue.text);
  else throw new Error('No usable lyrics are available for this song. Local recognition and pasting still work.');
  const timingNotice=!cues&&typeof r.syncedLyrics==='string'&&r.syncedLyrics.trim()?'Published timing could not be used. Plain words can still be aligned locally.':'';
  return {id:Number(r.id),title,artist,album,duration:r.duration,text:lines.join('\n'),source:`https://lrclib.net/api/get/${r.id}`,...(cues?{cues}:{}),timingNotice};
}
/** A deliberate metadata-only browser request. No audio, credentials, redirects or referrer. */
export async function lookupLyrics(input:LyricsQuery,signal:AbortSignal,fetcher:typeof fetch=fetch,timeoutMs=8000):Promise<LyricsRecord> {
  const query=lookupQuery(input),controller=new AbortController();
  const url=new URL('https://lrclib.net/api/get');url.search=new URLSearchParams({track_name:query.title,artist_name:query.artist,duration:String(query.duration)}).toString();
  let timedOut=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let rejectAbort:(error:Error)=>void=()=>undefined;
  const aborted=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;});
  const abort=()=>controller.abort();
  const onAbort=()=>{void reader?.cancel().catch(()=>undefined);rejectAbort(new Error(timedOut?'Lyrics lookup timed out. Try again; your lyrics are unchanged.':'Lyrics lookup cancelled.'));};
  controller.signal.addEventListener('abort',onAbort,{once:true});signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try {
    if(signal.aborted){controller.abort();return await aborted;}
    const operation=async()=>{
      const response=await fetcher(url,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
      if(controller.signal.aborted)throw new Error('Lyrics lookup cancelled.');
      if(!response.ok)throw new Error(response.status===404?'No matching lyrics found. Check title, artist and full-song duration.':response.status===429?'The lyrics provider is busy. Try again later.':'Lyrics lookup is unavailable. Your current lyrics are unchanged.');
      const declared=response.headers.get('content-length');
      if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))throw new Error('Lyrics response is too large.');
      if(!response.body)throw new Error('The lyrics provider returned an empty response.');
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)throw new Error('Lyrics response is too large.');chunks.push(part.value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('The lyrics provider returned invalid text.');}
      return parseLyricsRecord(value,query);
    };
    return await Promise.race([operation(),aborted]);
  } catch(error) {
    if(error instanceof Error&&/^(Lyrics |The |No |Enter |Line |Pasted |Use )/.test(error.message))throw error;
    throw new Error('Lyrics lookup is unavailable. Check your connection; your current lyrics are unchanged.');
  } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);void reader?.cancel().catch(()=>undefined);controller.abort();}
}
