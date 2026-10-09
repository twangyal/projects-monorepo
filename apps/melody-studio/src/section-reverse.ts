import {compositionDurationBeats,validateComposition} from './model.ts';
import {sectionWindow,type SectionRange} from './section.ts';
import type {Composition} from './types.ts';

/** Mirror whole selected-track intervals in the section, never split a note. */
export function reverseSection(input:Composition,trackId:string,range:SectionRange):Composition {
 const next=validateComposition(input);
 sectionWindow(range.start,range.end,next.tempo,compositionDurationBeats(next),22050);
 const track=next.tracks.find(item=>item.id===trackId);
 if(!track)throw new Error('Choose an existing track.');
 const first=Number(range.start)-1,last=Number(range.end)-1;
 for(const note of track.notes){
  const stop=note.start+note.duration;
  if(note.start<first&&stop>first||note.start<last&&stop>last)throw new Error('A note on the selected track crosses a section boundary. Choose bounds that include whole notes.');
 }
 const notes=track.notes.filter(note=>note.start>=first&&note.start<last);
 if(!notes.length)throw new Error('The selected track has no note onsets in this section.');
 for(const note of notes)note.start=first+(last-(note.start+note.duration));
 return validateComposition(next);
}
