import type {Composition} from './types.ts';
import {validateComposition} from './model.ts';
/** Two fresh attacks, retaining the original outer interval without grid snapping. */
export function splitNote(input:Composition,trackId:string,noteId:string,beat:number,newId:string):Composition {
 const next=validateComposition(input),track=next.tracks.find(item=>item.id===trackId);
 const index=track?.notes.findIndex(item=>item.id===noteId) ?? -1;
 if(!track || index<0)throw new Error('Choose an existing note in the selected track.');
 const note=track.notes[index],end=note.start+note.duration;
 // Decimal song-beat input can lose a few ulps when converted to zero-based
 // time. Canonicalize only values indistinguishable from the minimum boundary.
 const tolerance=Number.EPSILON*Math.max(1,Math.abs(end))*4;
 if(typeof beat==='number' && Number.isFinite(beat)) {
  if(Math.abs(beat-note.start-.25)<=tolerance)beat=note.start+.25;
  if(Math.abs(end-beat-.25)<=tolerance)beat=end-.25;
 }
 const left=beat-note.start,right=end-beat;
 if(typeof beat!=='number' || !Number.isFinite(beat) || left<.25-tolerance || right<.25-tolerance)throw new Error('Split inside the note, leaving at least 0.25 beats on each side.');
 if(track.notes.length>=256)throw new Error('Splitting requires space for another note; this track already has 256 notes.');
 track.notes.splice(index,1,{...note,duration:Math.max(.25,left)},{...note,id:newId,start:beat,duration:Math.max(.25,right)});
 return validateComposition(next);
}
