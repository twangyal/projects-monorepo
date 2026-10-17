import {isBottoms, LIMITS, panelSize, topMeasurements, type Artwork, type Product} from './product.ts';

export const ARTWORK_SHOULDER_OFFSET = 4;
/** Flat fabric coordinates already face outward on both front and back. */
export function placementFromSurface(product:Product, artwork:Artwork, point:{part:Artwork['part'];x:number;y:number}, widthCm:number) {
  if (isBottoms(product) || point.part !== artwork.part) throw new Error(`Choose the visible ${artwork.part} body panel.`);
  if (!Number.isFinite(widthCm) || widthCm < LIMITS.artworkWidthCm[0] || widthCm > LIMITS.artworkWidthCm[1]) throw new Error('Artwork width must be from 3 to 40 cm before picking.');
  if (![point.x,point.y].every(Number.isFinite)) throw new Error('Choose a point on the garment.');
  const measurements=topMeasurements(product), panel=panelSize(measurements), height=widthCm*artwork.height/artwork.width;
  const xCm=Math.round(point.x*100)/100, yCm=Math.round((measurements.length-ARTWORK_SHOULDER_OFFSET-point.y-height/2)*100)/100;
  if (Math.abs(xCm)>panel.width/2 || yCm<0 || yCm>panel.length) throw new Error('Choose a lower point inside the body panel for this artwork centre.');
  return {xCm,yCm};
}

