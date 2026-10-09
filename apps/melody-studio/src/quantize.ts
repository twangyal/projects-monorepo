import {compositionDurationBeats,validateComposition} from './model.ts';
import {sectionWindow,type SectionRange} from './section.ts';
import type {Composition} from './types.ts';

/** Tighten selected original note onsets; preserve lengths and all other data. */
export function quantizeSection(input:Composition,trackId:string,range:SectionRange,grid:number,strength:number):Composition {
  const next=validateComposition(input);
  if (![1,.5,.25,.125].includes(grid)) throw new Error('Choose a quantize grid of 1, 0.5, 0.25 or 0.125 beats.');
  if (typeof strength!=='number'||!Number.isFinite(strength)||strength<0||strength>1) throw new Error('Quantize strength must be a finite number from 0 to 1.');
  sectionWindow(range.start,range.end,next.tempo,compositionDurationBeats(next),22050);
  const track=next.tracks.find(item=>item.id===trackId);
  if (!track) throw new Error('Choose an existing track.');
  const first=Number(range.start)-1,last=Number(range.end)-1;
  const notes=track.notes.filter(note=>note.start>=first&&note.start<last);
  if (!notes.length) throw new Error('The selected track has no note onsets in this section.');
  for (const note of notes) note.start+=strength*(Math.round(note.start/grid)*grid-note.start);
  return validateComposition(next);
}
