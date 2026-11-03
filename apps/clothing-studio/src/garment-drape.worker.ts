import Delaunator from 'delaunator';
import { simulateGarment, simulateOutfit, threePiece, type TopBodyShape } from './garment-drape.ts';
import { layerOrder, sleeveAngleOf, teeMesh, validateProduct, withSleeveAngle, type Product } from './product.ts';

/** One garment drape per worker; the owner terminates it to cancel or when the design changes. */
self.onmessage = (event: MessageEvent<{ product: Product; companion?: Product; also?: Product; tucked?: boolean; bodyChest: number; bodyShape?:TopBodyShape }>) => {
  try {
    const garments = [event.data.product, event.data.companion, event.data.also].filter((item): item is Product => !!item).map(item => validateProduct(item));
    // A top worn under another is made for the outer one's arm pose.
    const layers = garments.length === 3 ? threePiece(garments) : garments.length === 2 ? layerOrder(garments[0]!, garments[1]!) : null;
    if (layers) garments[garments.indexOf(layers.inner)] = withSleeveAngle(layers.inner, sleeveAngleOf(layers.outer));
    const [product, companion, also] = garments as [Product, Product | undefined, Product | undefined];
    const options = {
      bodyShape:event.data.bodyShape,
      progress: (frame: number, frames: number) => { if (frame % 15 === 0) self.postMessage({ kind: 'progress', frame, frames }); },
    };
    const result = companion ? simulateOutfit(product, teeMesh(product, Delaunator), companion, teeMesh(companion, Delaunator), event.data.bodyChest,
      { ...options, tucked: event.data.tucked === true, ...(also ? { also: { product: also, meshes: teeMesh(also, Delaunator) } } : {}) })
      : simulateGarment(product, teeMesh(product, Delaunator), event.data.bodyChest, options);
    const parts = [...result.parts, ...result.companion?.parts ?? [], ...result.also?.parts ?? []];
    self.postMessage({ kind: 'result', result }, { transfer: parts.map(part => part.positions.buffer as ArrayBuffer) });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The drape simulation failed.' });
  }
};
