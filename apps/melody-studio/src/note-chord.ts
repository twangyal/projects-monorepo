import {validateComposition} from './model.ts';
import type {Composition} from './types.ts';
export const CHORD_QUALITIES={major:'Major',minor:'Minor',sus2:'Suspended 2',sus4:'Suspended 4'} as const;
export type ChordQuality=keyof typeof CHORD_QUALITIES;
const INTERVALS={major:[4,7],minor:[3,7],sus2:[2,7],sus4:[5,7]} as const;
/** Add two ordinary editable tones; never replace, clamp or silently duplicate a voice. */
export function addChord(input:Composition,trackId:string,noteId:string,quality:unknown,newIds:[string,string]):Composition {
 const next=validateComposition(input),track=next.tracks.find(item=>item.id===trackId),root=track?.notes.find(item=>item.id===noteId);
 if(!track||!root)throw new Error('Choose an existing note in the selected track.');
 if(track.instrument==='drums')throw new Error('Chord tones require a melodic track, not drums.');
 if(typeof quality!=='string'||!Object.hasOwn(INTERVALS,quality))throw new Error('Choose a supported chord quality.');
 if(!Array.isArray(newIds)||newIds.length!==2)throw new Error('A chord needs exactly two new note IDs.');
 if(track.notes.length>254)throw new Error('A chord needs space for two notes within the 256-note track capacity.');
 const pitches=INTERVALS[quality as ChordQuality].map(interval=>root.pitch+interval),end=root.start+root.duration;
 if(pitches.some(pitch=>pitch>96))throw new Error('Chord tones must fit at or below C7 (MIDI 96).');
 if(track.notes.some(note=>pitches.includes(note.pitch)&&note.start<end&&note.start+note.duration>root.start))throw new Error('A target chord tone already overlaps this note. Edit the existing voice instead.');
 const index=track.notes.indexOf(root);
 track.notes.splice(index+1,0,...pitches.map((pitch,i)=>({...root,id:newIds[i],pitch})));
 return validateComposition(next);
}
