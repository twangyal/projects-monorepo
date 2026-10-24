import {validateCurve,parseCurve,formatCurve,shiftCurve} from './breakpoint-curve.ts';
import type {VolumeCurve} from './types.ts';
export const validateFilterCurve=(value:unknown):VolumeCurve=>validateCurve(value,'Cutoff');
export const parseFilterCurve=(text:string):VolumeCurve=>parseCurve(text,'Cutoff');
export const formatFilterCurve=(value:VolumeCurve):string=>formatCurve(value,'Cutoff');
export const shiftFilterCurve=(value:VolumeCurve,shift:number):VolumeCurve=>shiftCurve(value,shift,'Cutoff');
