import {previewMeshQuality,type MeshQuality} from './garment-mesh.ts';
import Delaunator from 'delaunator';
import { simulateGarment, simulateOutfit, garmentBody, previewDrapeFrames, threePiece, type TopBodyShape } from './garment-drape.ts';
import { isBottoms, layerOrder, layeredSleeveAngle, teeMesh, validateProduct, withSleeveAngle, type Product } from './product.ts';

/** One garment drape per worker; the owner terminates it to cancel or when the design changes. */
self.onmessage = (event: MessageEvent<{ product: Product; bodyReference?: Product[]; companion?: Product; also?: Product; tucked?: boolean; frames?: number; meshQuality?:MeshQuality; bodyChest: number; bodyShape?:TopBodyShape }>) => {
  try {
    const quality=previewMeshQuality(event.data.meshQuality);
    const garments = [event.data.product, event.data.companion, event.data.also].filter((item): item is Product => !!item).map(item => validateProduct(item));
    // Two tops worn together are made for one arm pose, and so is the body they drape on.
    const layers = garments.length === 3 ? threePiece(garments) : garments.length === 2 ? layerOrder(garments[0]!, garments[1]!) : null;
    const pose = layers ? layeredSleeveAngle(layers.inner, layers.outer) : null;
    if (layers) for (const top of [layers.inner, layers.outer]) garments[garments.indexOf(top)] = withSleeveAngle(top, pose!);
    const [product, companion, also] = garments as [Product, Product | undefined, Product | undefined];
    const reference = event.data.bodyReference?.map(item => validateProduct(item));
    if (reference && (reference.length !== garments.length || reference.some((item, index) => item.base !== garments[index]!.base))) throw new Error('The body reference must match the outfit garments.');
    const referenceLayers = reference && (reference.length === 3 ? threePiece(reference) : reference.length === 2 ? layerOrder(reference[0]!, reference[1]!) : null);
    const referenceTop = referenceLayers?.outer ?? reference?.find(item => !isBottoms(item));
    const bodyProducts = referenceTop ? { top: pose === null ? referenceTop : withSleeveAngle(referenceTop, pose), bottoms: reference?.find(item => isBottoms(item)) } : undefined;
    const options = {
      frames: previewDrapeFrames(event.data.frames),
      ...(quality==='fine'?{substeps:48}:{}),
      bodyShape:event.data.bodyShape,
      ...(bodyProducts ? { bodyProducts } : {}),
      progress: (frame: number, frames: number) => { if (frame % 15 === 0) self.postMessage({ kind: 'progress', frame, frames }); },
    };
    const result = companion ? simulateOutfit(product, teeMesh(product, Delaunator, quality), companion, teeMesh(companion, Delaunator, quality), event.data.bodyChest,
      { ...options, tucked: event.data.tucked === true, ...(also ? { also: { product: also, meshes: teeMesh(also, Delaunator, quality) } } : {}) })
      : simulateGarment(product, teeMesh(product, Delaunator, quality), event.data.bodyChest, { ...options, ...(reference?.[0] ? { body: garmentBody(reference[0], event.data.bodyChest, event.data.bodyShape) } : {}) });
    if(quality==='fine')for(const piece of [result,result.companion,result.also])if(piece)piece.settings={...piece.settings,meshQuality:quality};
    const parts = [...result.parts, ...result.companion?.parts ?? [], ...result.also?.parts ?? []];
    self.postMessage({ kind: 'result', result }, { transfer: parts.map(part => part.positions.buffer as ArrayBuffer) });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The drape simulation failed.' });
  }
};
