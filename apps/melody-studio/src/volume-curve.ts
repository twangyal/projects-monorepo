import {validateCurve,parseCurve,formatCurve,shiftCurve} from './breakpoint-curve.ts';
import type {VolumeCurve} from './types.ts';
export {curveLevel as volumeCurveLevel} from './breakpoint-curve.ts';
export const validateVolumeCurve=(value:unknown):VolumeCurve=>validateCurve(value,'Volume');
export const parseVolumeCurve=(text:string):VolumeCurve=>parseCurve(text,'Volume');
export const formatVolumeCurve=(value:VolumeCurve):string=>formatCurve(value,'Volume');
export const shiftVolumeCurve=(value:VolumeCurve,shift:number):VolumeCurve=>shiftCurve(value,shift,'Volume');
