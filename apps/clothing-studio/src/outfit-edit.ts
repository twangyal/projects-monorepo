import { validateProject, type Project } from './model.ts';
import { canWearTogether } from './product.ts';

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
