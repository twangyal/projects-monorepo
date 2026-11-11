import { validateProject, type Project } from './model.ts';
import { canTuck, threePiece } from './garment-drape.ts';
import { canWearTogether, isBottoms, template, type Product } from './product.ts';

export type OutfitLayer = 'inner' | 'outer' | 'bottoms';

/** Switch the applied garment being edited; the outfit and its shared body stay together. */
export function switchOutfitEditing(project: Project, layer?: OutfitLayer): Project {
  const current = validateProject(project);
  const design = current.product ?? template('blank');
  if (!current.wornWith || !canWearTogether(design, current.wornWith)) {
    throw new Error('Choose a top and bottoms, or a T-shirt and a sweatshirt or hoodie, with Wear with before editing the worn garment.');
  }
  if (layer) {
    const pieces = current.wornAlso && threePiece([design, current.wornWith, current.wornAlso]);
    if (!pieces) throw new Error('Choose a three-piece outfit before selecting a layer to edit.');
    const selected = pieces[layer];
    if (selected === design) return current;
    if (selected === current.wornAlso) {
      return validateProject({ ...current, product: current.wornAlso, wornWith: design, wornAlso: current.wornWith });
    }
  }
  // Preserve the order of the remaining garments around the newly selected one.
  if (current.wornAlso) return validateProject({ ...current, product: current.wornWith, wornWith: current.wornAlso, wornAlso: design });
  return validateProject({ ...current, product: current.wornWith, wornWith: design });
}

/** Plan a primary replacement without discarding copies until the caller accepts the named removals. */
export function replaceOutfitProduct(current: Project, product: Product): { project: Project; removed: Product[] } {
  const { wornWith: first, wornAlso: second, tucked, ...rest } = current;
  const wornWith = first && canWearTogether(product, first) ? first : second && canWearTogether(product, second) ? second : undefined;
  const wornAlso = wornWith === first && wornWith && second && threePiece([product, wornWith, second]) ? second : undefined;
  const keepTucked = tucked && wornWith && !wornAlso && isBottoms(product) !== isBottoms(wornWith)
    && canTuck(isBottoms(product) ? wornWith : product);
  const removed = [first, second].filter((item): item is Product => !!item && item !== wornWith && item !== wornAlso);
  return { project: { ...rest, product, ...(wornWith ? { wornWith } : {}), ...(wornAlso ? { wornAlso } : {}), ...(keepTucked ? { tucked: true } : {}) }, removed };
}
