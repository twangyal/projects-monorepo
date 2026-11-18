import {ARTWORK_PART_NAMES, bottomsArtworkFrame, bottomsArtworkProblem, isBottoms, isSleeveArtwork, LIMITS, panelSize, sleeveArtworkFrame, sleeveArtworkProblem, topMeasurements, type Artwork, type Product} from './product.ts';

export const ARTWORK_SHOULDER_OFFSET = 4;
/** Flat fabric x faces outward on both sides; fabric y measures downward from the top. On bottoms, whose pattern
 * coordinates run from each leg's side seam, the picked point in 3D (`at`, cm, y up) is used: x across from the centre
 * as seen from that side, y below the waist seam. On a sleeve the flat point is on the sleeve's pattern piece, placed
 * from its centre line and shoulder point (see sleeveArtworkFrame). */
export function placementFromSurface(product:Product, artwork:Artwork, point:{part:Artwork['part'];x:number;y:number;at?:{x:number;y:number}}, widthCm:number) {
  if (point.part !== artwork.part) throw new Error(`Choose the visible ${isSleeveArtwork(artwork.part) ? ARTWORK_PART_NAMES[artwork.part] : `${artwork.part} body panel`}.`);
  if (!Number.isFinite(widthCm) || widthCm < LIMITS.artworkWidthCm[0] || widthCm > LIMITS.artworkWidthCm[1]) throw new Error('Artwork width must be from 3 to 40 cm before picking.');
  if (![point.x,point.y].every(Number.isFinite)) throw new Error('Choose a point on the garment.');
  if (isSleeveArtwork(artwork.part)) {
    const frame=sleeveArtworkFrame(product), height=widthCm*artwork.height/artwork.width;
    const xCm=Math.round(frame.mirror(artwork.part)*(point.x-frame.centre)*100)/100, yCm=Math.round((point.y-height/2)*100)/100;
    const problem=sleeveArtworkProblem(product,{...artwork,xCm,yCm,widthCm});
    if (problem) throw new Error(problem);
    return {xCm,yCm};
  }
  if (isBottoms(product)) {
    if (!point.at || ![point.at.x,point.at.y].every(Number.isFinite)) throw new Error('Choose a point on the garment.');
    const frame=bottomsArtworkFrame(product), height=widthCm*artwork.height/artwork.width;
    const xCm=Math.round((artwork.part==='front'?point.at.x:-point.at.x)*100)/100, yCm=Math.round((frame.top-point.at.y-height/2)*100)/100;
    if (yCm<0) throw new Error('Choose a lower point for this artwork centre: the artwork must start below the waist seam.');
    if (yCm+height>frame.length) throw new Error('Choose a higher point for this artwork centre: the artwork must end above the hem.');
    const problem=bottomsArtworkProblem(product,{...artwork,xCm,yCm,widthCm});
    if (problem) throw new Error(problem);
    return {xCm,yCm};
  }
  const measurements=topMeasurements(product), panel=panelSize(measurements), height=widthCm*artwork.height/artwork.width;
  const xCm=Math.round(point.x*100)/100, yCm=Math.round((point.y-ARTWORK_SHOULDER_OFFSET-height/2)*100)/100;
  if (Math.abs(xCm)>panel.width/2 || yCm<0 || yCm>panel.length) throw new Error('Choose a lower point inside the body panel for this artwork centre.');
  return {xCm,yCm};
}

