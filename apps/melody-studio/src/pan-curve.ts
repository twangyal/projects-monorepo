import {validateCurve,parseCurve,formatCurve,shiftCurve} from './breakpoint-curve.ts';
import type {PanCurve} from './types.ts';
export {curveLevel as panCurvePosition} from './breakpoint-curve.ts';
export const validatePanCurve=(value:unknown):PanCurve=>validateCurve(value,'Pan');
export const parsePanCurve=(text:string):PanCurve=>parseCurve(text,'Pan');
export const formatPanCurve=(value:PanCurve):string=>formatCurve(value,'Pan');
export const shiftPanCurve=(value:PanCurve,shift:number):PanCurve=>shiftCurve(value,shift,'Pan');
