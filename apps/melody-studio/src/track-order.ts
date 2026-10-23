import {validateComposition} from './model.ts';
import type {Composition} from './types.ts';
/** Move an existing layer one slot without changing its contents or identity. */
export function moveTrack(input:Composition,trackId:string,delta:unknown):Composition {
 const next=validateComposition(input);
 if(delta!==-1&&delta!==1)throw new Error('Choose one track position earlier or later.');
 const index=next.tracks.findIndex(track=>track.id===trackId);
 if(index<0)throw new Error('Choose an existing track to reorder.');
 const target=index+delta;
 if(target<0||target>=next.tracks.length)return next;
 [next.tracks[index],next.tracks[target]]=[next.tracks[target],next.tracks[index]];
 return next;
}
