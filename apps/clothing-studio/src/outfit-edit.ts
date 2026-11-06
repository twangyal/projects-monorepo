import { validateProject, type Project } from './model.ts';
import { canTuck, threePiece } from './garment-drape.ts';
import { canWearTogether, isBottoms, type Product } from './product.ts';

/** Switch the applied garment being edited; the outfit and its shared body stay together. */
export function switchOutfitEditing(project: Project): Project {
  const current = validateProject(project);
  if (!current.product || !current.wornWith || !canWearTogether(current.product, current.wornWith)) {
    throw new Error('Choose a top and bottoms, or a T-shirt and a sweatshirt or hoodie, with Wear with before editing the worn garment.');
  }
  // Of three garments, each is edited in turn.
  if (current.wornAlso) return validateProject({ ...current, product: current.wornWith, wornWith: current.wornAlso, wornAlso: current.product });
  return validateProject({ ...current, product: current.wornWith, wornWith: current.product });
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
