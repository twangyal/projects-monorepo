import {compositionDurationBeats,validateComposition} from './model.ts';
import {sectionWindow,type SectionRange} from './section.ts';
import type {Composition} from './types.ts';

function selectedNotes(input:Composition,trackId:string,range:SectionRange) {
 const next=validateComposition(input);
 sectionWindow(range.start,range.end,next.tempo,compositionDurationBeats(next),22050);
 const track=next.tracks.find(item=>item.id===trackId);
 if(!track)throw new Error('Choose an existing track.');
 const first=Number(range.start)-1,last=Number(range.end)-1;
 const notes=track.notes.filter(note=>note.start>=first&&note.start<last);
 if(!notes.length)throw new Error('The selected track has no note onsets in this section.');
 return {next,notes};
}
/** Change only pitches selected by original onset; validate the whole result. */
export function transposeSection(input:Composition,trackId:string,range:SectionRange,semitones:number):Composition {
 if(![-12,-1,1,12].includes(semitones))throw new Error('Choose a section transpose of one semitone or one octave up or down.');
 const {next,notes}=selectedNotes(input,trackId,range);
 for(const note of notes)note.pitch+=semitones;
 return validateComposition(next);
}
/** Mirror intervals about the lowest pitch at the first included onset. */
export function invertSection(input:Composition,trackId:string,range:SectionRange):Composition {
 const {next,notes}=selectedNotes(input,trackId,range);
 const first=Math.min(...notes.map(note=>note.start));
 const pivot=Math.min(...notes.filter(note=>note.start===first).map(note=>note.pitch));
 for(const note of notes)note.pitch=2*pivot-note.pitch;
 return validateComposition(next);
}
