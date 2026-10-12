import type {Composition} from './types.ts';
import {validateComposition} from './model.ts';
/** Deliberately replace two matching attacks by one continuous held voice. */
export function joinNextNote(input:Composition,trackId:string,noteId:string):Composition {
 const next=validateComposition(input),track=next.tracks.find(item=>item.id===trackId);
 const note=track?.notes.find(item=>item.id===noteId);
 if(!track || !note)throw new Error('Choose an existing note in the selected track.');
 const end=note.start+note.duration,tolerance=Number.EPSILON*Math.max(1,Math.abs(end))*4;
 const candidates=track.notes.filter(item=>item.id!==noteId && item.pitch===note.pitch && item.velocity===note.velocity && Math.abs(item.start-end)<=tolerance);
 if(candidates.length!==1)throw new Error('Choose a note with exactly one touching next note of the same pitch and velocity.');
 const following=candidates[0],outerEnd=following.start+following.duration;
 const duration=outerEnd-note.start;
 const boundaryTolerance=Number.EPSILON*Math.max(1,Math.abs(outerEnd))*4;
 note.duration=Math.abs(duration-16)<=boundaryTolerance ? 16 : duration;
 track.notes=track.notes.filter(item=>item.id!==following.id);
 return validateComposition(next);
}
