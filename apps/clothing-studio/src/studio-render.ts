// Studio renders (see StudioScene in product-3d.ts): the views, backdrops and size of a presentation picture, how each
// fabric looks under studio light, and how the camera frames the garment. Kept apart from the 3D view so the workspace
// can offer the choices without loading three.js, and so they can be tested on their own.
import type { Material } from './materials.ts';

/** A studio render's view: the garment turned to face the camera, half turned, side on or from behind. */
export type StudioView = 'front' | 'three-quarter' | 'side' | 'back';
export type StudioBackdrop = 'studio' | 'white' | 'transparent';
export const STUDIO_VIEWS: Record<StudioView, string> = { front: 'Front', 'three-quarter': 'Three-quarter', side: 'Side', back: 'Back' };
export const STUDIO_BACKDROPS: Record<StudioBackdrop, string> = { studio: 'Warm studio', white: 'White', transparent: 'Transparent' };
/** A studio render is a 4:5 portrait, as product photographs are. */
export const STUDIO_WIDTH = 1600, STUDIO_HEIGHT = 2000;
/** How far the garment turns for each view, in degrees about its upright axis (a quarter turn shows its right side). */
export const STUDIO_TURN: Record<StudioView, number> = { front: 0, 'three-quarter': 35, side: 90, back: 180 };

/**
 * How a fabric looks under studio light: as rough as in the live view (lustrous nylon and viscose shine, cotton is
 * matte), with the soft sheen its fibres give where the cloth turns away from the light: strongest for brushed terry
 * and wool, gentler for knits, least for smooth wovens.
 */
export function fabricLook(fabric: Material): { roughness: number; sheen: number; sheenRoughness: number } {
  const fibre = /wool/i.test(fabric.composition) ? 0.5 : ({ terry: 0.55, jersey: 0.35, slub: 0.35, rib: 0.35, pique: 0.3, twill: 0.25, linen: 0.2, chiffon: 0.2, poplin: 0.15 } as Record<string, number>)[fabric.texture] ?? 0.25;
  return { roughness: Math.min(0.95, Math.max(0.3, 1 - fabric.sheen * 3)), sheen: fibre, sheenRoughness: fabric.sheen >= 0.15 ? 0.35 : 0.8 };
}

/** Where the garment sits in a studio render: the camera distance that frames its box with a margin, for a lens of
 * `fov` degrees (vertical) and an `aspect` of width to height. */
export function studioDistance(size: { x: number; y: number; z: number }, fov: number, aspect: number, margin = 1.18): number {
  const tan = Math.tan(fov * Math.PI / 360);
  return Math.max(size.y / 2 / tan, size.x / 2 / (tan * aspect)) * margin + size.z / 2;
}

/** The studio view and backdrop chosen in the workspace, if they are ones it offers. */
export function studioChoice(view: string, backdrop: string): { view: StudioView; backdrop: StudioBackdrop } {
  if (!Object.hasOwn(STUDIO_VIEWS, view)) throw new Error('Choose a studio view: front, three-quarter, side or back.');
  if (!Object.hasOwn(STUDIO_BACKDROPS, backdrop)) throw new Error('Choose a backdrop: warm studio, white or transparent.');
  return { view: view as StudioView, backdrop: backdrop as StudioBackdrop };
}
